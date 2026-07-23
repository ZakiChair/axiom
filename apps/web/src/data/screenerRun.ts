/**
 * Pipeline de run du screener (EQS) — RÉUTILISABLE hors du store.
 *
 * `executerScreener` exécute le pipeline complet (ticker 24h → funding best-effort →
 * filtres de base → enrichissement position si requis → étage indicateurs via worker)
 * et renvoie les lignes survivantes + les notes de couverture, SANS jamais toucher
 * l'état du screenerStore. La progression du worker est remontée via `onProgress`.
 *
 * Le worker est instancié À LA DEMANDE et terminé LOCALEMENT à chaque appel : un run
 * d'alerte (T2) ne tue pas le worker d'un run UI et inversement.
 *
 * Extrait à l'identique du store (déplacement, pas réécriture) : les caps, autrefois
 * constantes internes, deviennent des paramètres (`capIndicateurs`, `capPosition`) pour
 * qu'un run d'alerte puisse réduire l'échantillon évalué.
 */
import type { Timeframe } from "@axiom/types";
import {
  fetchGlobalLongShortAccountRatio,
  fetchOpenInterestHist,
} from "./binanceFutures";
import { extUrl } from "./extapi";
import {
  applyBaseFilters,
  applyFunding,
  applyLongShortRatio,
  applyOiChange,
  lastLongShortRatio,
  needsPositionMetrics,
  oiChangePctFromHist,
  parsePremiumIndex,
  parseTicker24h,
  selectCandidates,
  splitBaseConditions,
  SCREENER_KLINE_LIMIT,
  type BaseCondition,
  type IndicatorCondition,
  type ScreenerRow,
} from "./screener";
import type { WorkerRequest, WorkerResponse } from "../workers/screener.worker";

/** URL ticker 24 h Binance (univers spot commun screener / signaux / squeeze). */
export const TICKER_24H_URL = "https://api.binance.com/api/v3/ticker/24hr";
/** Nombre max de lignes affichées quand le run n'a PAS de filtre indicateur (table lisible). */
const DISPLAY_CAP = 100;
/**
 * Concurrence pour l'enrichissement OI + L/S (2 req/symbole). 6 en parallèle →
 * 20 symboles ≈ quelques secondes, budget << 1000 req / 5 min Binance.
 */
const POSITION_CONCURRENCY = 6;
/** Historique OI : 25 points 1h ≈ fenêtre 24 h pour le Δ%. */
export const OI_HIST_LIMIT = 25;

/** Options d'un run : caps (réduits pour les alertes) + progression optionnelle. */
export interface OptionsRunScreener {
  capIndicateurs: number;
  capPosition: number;
  onProgress?: (done: number, total: number) => void;
}

/** Résultat d'un run : lignes survivantes + notes de couverture (affichées telles quelles). */
export interface ResultatRunScreener {
  rows: ScreenerRow[];
  notes: string[];
}

/**
 * Exécute `fn` sur chaque item avec un plafond de concurrence (pool simple).
 * Préserve l'ordre des résultats. PURE sur le contrôle de flux (I/O via fn).
 * Exporté : réutilisé par les runs des vues Signaux (store/signaux.ts) et Squeeze.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      const item = items[i];
      if (item === undefined) return;
      results[i] = await fn(item);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Enrichit un échantillon de lignes avec ΔOI % (≈24 h) et ratio L/S via Binance
 * futures data (sans clé, 1 symbole / req). Best-effort par symbole : un échec
 * laisse le champ absent (filtre position échouera pour cette ligne).
 */
async function enrichPositionSample(
  sample: ScreenerRow[],
): Promise<{ oiOk: number; lsOk: number }> {
  const oiBySymbol = new Map<string, number>();
  const lsBySymbol = new Map<string, number>();

  await mapPool(sample, POSITION_CONCURRENCY, async (row) => {
    const [oiRes, lsRes] = await Promise.allSettled([
      fetchOpenInterestHist(row.symbol, "1h", OI_HIST_LIMIT),
      fetchGlobalLongShortAccountRatio(row.symbol, "1h", 5),
    ]);
    if (oiRes.status === "fulfilled") {
      const delta = oiChangePctFromHist(oiRes.value);
      if (delta !== undefined) oiBySymbol.set(row.symbol, delta);
    }
    if (lsRes.status === "fulfilled") {
      const ratio = lastLongShortRatio(lsRes.value);
      if (ratio !== undefined) lsBySymbol.set(row.symbol, ratio);
    }
  });

  applyOiChange(sample, oiBySymbol);
  applyLongShortRatio(sample, lsBySymbol);
  return { oiOk: oiBySymbol.size, lsOk: lsBySymbol.size };
}

/**
 * Pipeline complet d'un run. Ne touche AUCUN état de store : renvoie rows + notes,
 * remonte la progression du worker via `opts.onProgress`. Le worker est instancié et
 * terminé localement à chaque appel.
 *
 * En cas d'univers indisponible ou d'échec du worker : rejette avec un message prêt à
 * afficher (les appelants décident quoi en faire).
 */
export async function executerScreener(
  base: BaseCondition[],
  indicateurs: IndicatorCondition[],
  tf: Timeframe,
  opts: OptionsRunScreener,
): Promise<ResultatRunScreener> {
  // 1. Univers (ticker 24h en direct, CORS *) + funding (premiumIndex via /extapi).
  let rows: ScreenerRow[];
  try {
    const res = await fetch(TICKER_24H_URL);
    if (!res.ok) throw new Error(`ticker24h ${res.status}`);
    rows = parseTicker24h(await res.json());
  } catch {
    throw new Error("Univers indisponible (Binance ticker 24h).");
  }

  // Funding : best-effort (une panne ne bloque pas le run, mais est signalée).
  let fundingIndisponible = false;
  try {
    const res = await fetch(extUrl("fapi.binance.com", "fapi/v1/premiumIndex"));
    if (!res.ok) throw new Error(`premiumIndex ${res.status}`);
    applyFunding(rows, parsePremiumIndex(await res.json()));
  } catch {
    fundingIndisponible = true;
  }

  // 2. Filtres de base (purs) — éventuel enrichissement position avant filtres OI/L-S.
  const notes: string[] = [];
  if (fundingIndisponible) notes.push("funding indisponible");

  const { pre, position } = splitBaseConditions(base);
  let working = applyBaseFilters(rows, pre);

  if (needsPositionMetrics(base)) {
    // Échantillon top N liquides : pas d'historique OI/L-S batch gratuit universel.
    const sample = selectCandidates(working, opts.capPosition);
    if (working.length > opts.capPosition) {
      notes.push(`OI/L-S : échantillon top ${opts.capPosition} liquides (sur ${working.length})`);
    } else {
      notes.push(`OI/L-S : échantillon ${sample.length} symbole${sample.length > 1 ? "s" : ""}`);
    }
    const { oiOk, lsOk } = await enrichPositionSample(sample);
    if (oiOk === 0 && lsOk === 0) {
      notes.push("OI/L-S indisponibles (Binance futures data)");
    } else if (oiOk < sample.length || lsOk < sample.length) {
      notes.push(`OI ${oiOk}/${sample.length} · L/S ${lsOk}/${sample.length}`);
    }
    working = applyBaseFilters(sample, position);
  }

  const baseFiltered = working;

  // Sans filtre indicateur : résultats directs (triés par volume, plafond d'affichage).
  if (indicateurs.length === 0) {
    const sorted = selectCandidates(baseFiltered, DISPLAY_CAP);
    if (baseFiltered.length > DISPLAY_CAP) {
      notes.push(`${baseFiltered.length} résultats, ${DISPLAY_CAP} affichés (plus liquides)`);
    }
    return {
      rows: sorted,
      notes: notes.length > 0 ? notes : [`${baseFiltered.length} résultats`],
    };
  }

  // Avec filtres indicateurs : cap candidats les plus liquides → worker.
  const candidates = selectCandidates(baseFiltered, opts.capIndicateurs);
  if (baseFiltered.length > opts.capIndicateurs) {
    notes.push(`${baseFiltered.length} filtrés, ${opts.capIndicateurs} évalués (plus liquides)`);
  }
  if (candidates.length === 0) {
    return {
      rows: [],
      notes: notes.length > 0 ? notes : ["Aucun candidat après filtres de base"],
    };
  }

  // Étage indicateurs : worker instancié À LA DEMANDE (jamais à l'import) → Vite le
  // bundle en chunk séparé. Progression annoncée immédiatement (total figé) puis au fil
  // de l'eau, à l'image de l'état « running » du store d'origine.
  opts.onProgress?.(0, candidates.length);

  return await new Promise<ResultatRunScreener>((resolve, reject) => {
    const w = new Worker(new URL("../workers/screener.worker.ts", import.meta.url), {
      type: "module",
    });
    w.onmessage = (event: MessageEvent) => {
      const msg = event.data as WorkerResponse;
      if (msg.type === "progress") {
        opts.onProgress?.(msg.done, msg.total);
      } else if (msg.type === "result") {
        w.terminate();
        resolve({ rows: msg.rows, notes: [...notes, `${msg.rows.length} résultats`] });
      } else if (msg.type === "error") {
        w.terminate();
        reject(new Error(`Étage indicateurs : ${msg.message}`));
      }
    };
    w.onerror = () => {
      w.terminate();
      reject(new Error("Worker du screener en échec."));
    };
    const request: WorkerRequest = {
      type: "run",
      runId: 0,
      candidates,
      tf,
      klineLimit: SCREENER_KLINE_LIMIT,
      indicatorConditions: indicateurs,
    };
    w.postMessage(request);
  });
}
