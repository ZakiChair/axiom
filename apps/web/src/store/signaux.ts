/**
 * Store de la vue « Signaux » d'EQS (inbox de setups) — Zustand VANILLA.
 *
 * Un run (spec 2026-07-23) : univers ticker 24 h + funding premiumIndex (mêmes
 * requêtes que le screener), échantillon top liquides à perp ∪ watchlist, puis par
 * symbole (pool de concurrence limitée, thread principal — ~25 symboles × 4-5
 * requêtes, calculs triviaux, le worker serait de la sur-ingénierie) :
 *   funding réglé (histFunding, cache TTL 1 h) → z-score extrême ;
 *   OI hist 1 h ×25 → quadrant OI×prix ;
 *   L/S foule + top traders → positionnement divergent ;
 *   klines 4 h ×200 → RSI (@axiom/indicators) → divergence prix/RSI.
 * Les détecteurs et l'agrégation sont PURS (data/signaux.ts). Dégradation gracieuse :
 * un fetch en échec prive le symbole de CE signal, jamais du run.
 */
import { createStore } from "zustand/vanilla";
import type { Candle, Timeframe } from "@axiom/types";
import { computeIndicator, getIndicator } from "@axiom/indicators";
import type { Commande } from "../commands/registry";
import { navigateTo } from "../lib/navigation";
import {
  fetchGlobalLongShortAccountRatio,
  fetchOpenInterestHist,
  fetchTopLongShortPositionRatio,
} from "../data/binanceFutures";
import { extUrl } from "../data/extapi";
import { histFunding } from "../data/referentiels";
import {
  applyFunding,
  lastLongShortRatio,
  oiChangePctFromHist,
  parsePremiumIndex,
  parseTicker24h,
  type ScreenerRow,
} from "../data/screener";
import {
  agregerSignaux,
  selectionEchantillon,
  signalDivergenceRsi,
  signalFundingExtreme,
  signalPositionnement,
  signalQuadrantOiPrix,
  SIGNAUX_CAP,
  type LigneSignaux,
} from "../data/signaux";
import {
  etudeEvenements,
  evenementsDivergenceRsi,
  evenementsFundingExtreme,
  finaliserEtude,
  fusionnerEtudes,
  HORIZONS_VALIDATION,
  type SommesEtude,
  type StatsEtude,
} from "../data/validationSignaux";
import type { PointSerie } from "../lib/referentiel";
import { futuresSymbol } from "../data/binanceFutures";
import { mapPool } from "./screener";
import { watchlistStore } from "./watchlist";
import { windowManagerStore } from "./windowManager";

const TICKER_24H_URL = "https://api.binance.com/api/v3/ticker/24hr";
const KLINES_URL = "https://api.binance.com/api/v3/klines";
/** Concurrence du pool par symbole (4-5 requêtes chacun, budget très en deçà des limites). */
const SIGNAUX_CONCURRENCY = 4;
/** Historique OI : 25 points 1 h ≈ fenêtre 24 h (même choix que l'enrichissement EQS). */
const OI_HIST_LIMIT = 25;
/** Klines de la divergence : 4 h ×200 couvre l'amorce RSI + la fenêtre de pivots. */
const DIVERGENCE_TF: Timeframe = "4h";
const DIVERGENCE_KLINE_LIMIT = 200;

export type VueScreener = "filtres" | "signaux";
export type SignauxRunState = "idle" | "loading" | "running" | "done" | "error";

/** Résultats de la validation historique, par type de signal validable × horizon. */
export interface ResultatValidation {
  parSignal: {
    id: "funding" | "divergence-rsi";
    libelle: string;
    horizons: { id: string; libelle: string; stats: StatsEtude | null }[];
  }[];
  note: string;
}

export interface SignauxState {
  /** Vue affichée par la fenêtre EQS (la commande SIG force « signaux »). */
  vue: VueScreener;
  setVue: (vue: VueScreener) => void;

  runState: SignauxRunState;
  progress: { done: number; total: number };
  lignes: LigneSignaux[];
  note: string | null;
  error: string | null;
  run: () => void;
  cancel: () => void;

  // — Validation historique (event study sur l'échantillon du dernier scan) —
  validationState: SignauxRunState;
  validationProgress: { done: number; total: number };
  validation: ResultatValidation | null;
  validationError: string | null;
  validerSignaux: () => void;
}

/** Identifiant du run courant : les résultats d'un run périmé sont ignorés. */
let currentRunId = 0;
/** Identifiant du run de validation courant (annulation / relance). */
let validationRunId = 0;
/** Échantillon du dernier scan — la validation porte sur CE qui a été scanné. */
let dernierEchantillon: ScreenerRow[] = [];

/** Télécharge et convertit les klines spot d'un symbole (même parsing que le worker EQS). */
async function fetchCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
  const url = `${KLINES_URL}?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(
    interval,
  )}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`klines ${res.status}`);
  const raw: unknown = await res.json();
  if (!Array.isArray(raw)) return [];
  const out: Candle[] = [];
  for (const k of raw) {
    if (!Array.isArray(k)) continue;
    out.push({
      time: Number(k[0]),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
    });
  }
  return out;
}

/** Série RSI(14) alignée sur les bougies, via la source unique @axiom/indicators. */
function serieRsi(candles: Candle[]): Array<number | undefined> {
  const def = getIndicator("rsi");
  if (def === undefined) return [];
  const result = computeIndicator(def, candles, { length: 14 });
  return result.series["rsi"] ?? [];
}

/** Évalue les 4 détecteurs d'un symbole à partir de ses fetchs (best-effort chacun). */
async function evaluerSymbole(row: ScreenerRow): Promise<LigneSignaux | null> {
  const [fundingRes, oiRes, fouleRes, topRes, klinesRes] = await Promise.allSettled([
    histFunding(row.symbol),
    fetchOpenInterestHist(row.symbol, "1h", OI_HIST_LIMIT),
    fetchGlobalLongShortAccountRatio(row.symbol, "1h", 5),
    fetchTopLongShortPositionRatio(row.symbol, "1h", 5),
    fetchCandles(row.symbol, DIVERGENCE_TF, DIVERGENCE_KLINE_LIMIT),
  ]);

  const funding =
    fundingRes.status === "fulfilled" && fundingRes.value !== null
      ? signalFundingExtreme(fundingRes.value.map((p) => p.v))
      : null;

  let quadrant = null;
  if (oiRes.status === "fulfilled") {
    const deltaOi = oiChangePctFromHist(oiRes.value);
    if (deltaOi !== undefined) quadrant = signalQuadrantOiPrix(row.priceChangePct24h, deltaOi);
  }

  let positionnement = null;
  if (fouleRes.status === "fulfilled" && topRes.status === "fulfilled") {
    const foule = lastLongShortRatio(fouleRes.value);
    const top = lastLongShortRatio(topRes.value);
    if (foule !== undefined && top !== undefined) {
      positionnement = signalPositionnement(foule, top);
    }
  }

  let divergence = null;
  if (klinesRes.status === "fulfilled" && klinesRes.value.length > 0) {
    const candles = klinesRes.value;
    divergence = signalDivergenceRsi(
      candles.map((c) => c.close),
      serieRsi(candles),
    );
  }

  return agregerSignaux(row, [funding, quadrant, positionnement, divergence]);
}

// ─────────────────────────── Validation historique (event study) ───────────────────────────

/** Durée d'une bougie 4 h (ms) — grille d'entrée de l'event study. */
const DUREE_4H_MS = 4 * 3_600_000;
/** Profondeur klines de la validation (max 1 requête Binance) : 1000 × 4 h ≈ 166 j. */
const VALIDATION_KLINE_LIMIT = 1000;
/** Profondeur funding de la validation (max API) : 1000 règlements 8 h ≈ 333 j. */
const VALIDATION_FUNDING_LIMIT = 1000;

/**
 * Funding réglé PROFOND (fetch direct, sans le cache 270 points de histFunding —
 * la validation est ponctuelle et veut le maximum d'événements). Fractions, trié.
 */
async function fetchFundingProfond(symbol: string): Promise<PointSerie[]> {
  const url = extUrl(
    "fapi.binance.com",
    `fapi/v1/fundingRate?symbol=${encodeURIComponent(futuresSymbol(symbol))}&limit=${VALIDATION_FUNDING_LIMIT}`,
  );
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fundingRate ${res.status}`);
  const brut: unknown = await res.json();
  if (!Array.isArray(brut)) return [];
  const points: PointSerie[] = [];
  for (const item of brut) {
    const o = item as { fundingTime?: unknown; fundingRate?: unknown };
    const t = Number(o.fundingTime);
    const v = Number(o.fundingRate);
    if (Number.isFinite(t) && Number.isFinite(v)) points.push({ t, v });
  }
  points.sort((a, b) => a.t - b.t);
  return points;
}

/** Sommes d'étude d'UN symbole, indexées comme HORIZONS_VALIDATION. */
interface SommesSymbole {
  funding: SommesEtude[];
  divergence: SommesEtude[];
}

const sommesVides = (): SommesEtude => ({ n: 0, reussites: 0, sommePct: 0, sommeBaselinePct: 0 });

/** Rejoue les deux signaux validables d'un symbole et mesure leurs événements. */
async function validerSymbole(symbol: string): Promise<SommesSymbole> {
  const [fundingRes, klinesRes] = await Promise.allSettled([
    fetchFundingProfond(symbol),
    fetchCandles(symbol, DIVERGENCE_TF, VALIDATION_KLINE_LIMIT),
  ]);
  // Sans klines, rien n'est mesurable (les rendements forward viennent de là).
  if (klinesRes.status !== "fulfilled" || klinesRes.value.length === 0) {
    return {
      funding: HORIZONS_VALIDATION.map(sommesVides),
      divergence: HORIZONS_VALIDATION.map(sommesVides),
    };
  }
  const candles = klinesRes.value;
  const closes = candles.map((c) => c.close);
  const times = candles.map((c) => c.time);
  const evDivergence = evenementsDivergenceRsi(closes, serieRsi(candles), times, DUREE_4H_MS);
  const evFunding =
    fundingRes.status === "fulfilled" ? evenementsFundingExtreme(fundingRes.value) : [];
  return {
    funding: HORIZONS_VALIDATION.map((h) =>
      etudeEvenements(evFunding, times, closes, h.bougies, DUREE_4H_MS),
    ),
    divergence: HORIZONS_VALIDATION.map((h) =>
      etudeEvenements(evDivergence, times, closes, h.bougies, DUREE_4H_MS),
    ),
  };
}

export const signauxStore = createStore<SignauxState>((set) => ({
  vue: "filtres",
  setVue: (vue) => set({ vue }),

  runState: "idle",
  progress: { done: 0, total: 0 },
  lignes: [],
  note: null,
  error: null,

  run: () => {
    const runId = ++currentRunId;
    set({ runState: "loading", progress: { done: 0, total: 0 }, lignes: [], error: null, note: null });

    void (async () => {
      // 1. Univers + funding (mêmes sources que le screener ; funding = marqueur perp).
      let rows: ScreenerRow[];
      try {
        const res = await fetch(TICKER_24H_URL);
        if (!res.ok) throw new Error(`ticker24h ${res.status}`);
        rows = parseTicker24h(await res.json());
        const fRes = await fetch(extUrl("fapi.binance.com", "fapi/v1/premiumIndex"));
        if (!fRes.ok) throw new Error(`premiumIndex ${fRes.status}`);
        applyFunding(rows, parsePremiumIndex(await fRes.json()));
      } catch {
        if (runId !== currentRunId) return;
        set({
          runState: "error",
          error: "Univers indisponible (ticker 24 h ou funding Binance) — tous les détecteurs sont perp-based.",
        });
        return;
      }
      if (runId !== currentRunId) return;

      // 2. Échantillon honnête : top liquides à perp ∪ watchlist ∩ univers perp.
      const watchlist = watchlistStore.getState().symbols;
      const echantillon = selectionEchantillon(rows, watchlist);
      // Taille de la part « top liquides » (le reste vient de la watchlist).
      const nbPerp = rows.filter((r) => r.fundingPct !== undefined).length;
      const nbWatchlist = echantillon.length - Math.min(SIGNAUX_CAP, nbPerp);
      if (echantillon.length === 0) {
        set({ runState: "done", lignes: [], note: "Aucun symbole à perp dans l'univers." });
        return;
      }
      // Nouveau scan → l'ancienne validation ne décrit plus l'échantillon affiché.
      dernierEchantillon = echantillon;
      validationRunId++;
      set({
        runState: "running",
        progress: { done: 0, total: echantillon.length },
        validationState: "idle",
        validation: null,
        validationError: null,
      });

      // 3. Détection par symbole (pool) — la progression avance au fil de l'eau.
      const lignes = (
        await mapPool(echantillon, SIGNAUX_CONCURRENCY, async (row) => {
          const ligne = await evaluerSymbole(row);
          if (runId === currentRunId) {
            set((s) => ({ progress: { done: s.progress.done + 1, total: s.progress.total } }));
          }
          return ligne;
        })
      ).filter((l): l is LigneSignaux => l !== null);
      if (runId !== currentRunId) return;

      // Tri : confluence d'abord, liquidité ensuite.
      lignes.sort((a, b) => b.score - a.score || b.volumeUsd24h - a.volumeUsd24h);
      const noteEchantillon =
        nbWatchlist > 0
          ? `échantillon top ${SIGNAUX_CAP} liquides à perp + ${nbWatchlist} watchlist`
          : `échantillon top ${echantillon.length} liquides à perp`;
      set({
        runState: "done",
        lignes,
        note: `${noteEchantillon} · ${lignes.length} setup${lignes.length > 1 ? "s" : ""} · lectures heuristiques, pas des recommandations`,
      });
    })();
  },

  cancel: () => {
    currentRunId++; // invalide les résultats en vol
    validationRunId++;
    set({ runState: "idle", validationState: "idle" });
  },

  validationState: "idle",
  validationProgress: { done: 0, total: 0 },
  validation: null,
  validationError: null,

  validerSignaux: () => {
    if (dernierEchantillon.length === 0) {
      set({ validationState: "error", validationError: "Lancez d'abord un scan : la validation porte sur l'échantillon scanné." });
      return;
    }
    const runId = ++validationRunId;
    const echantillon = dernierEchantillon;
    set({
      validationState: "running",
      validationProgress: { done: 0, total: echantillon.length },
      validation: null,
      validationError: null,
    });

    void (async () => {
      const parSymbole = (
        await mapPool(echantillon, SIGNAUX_CONCURRENCY, async (row) => {
          const sommes = await validerSymbole(row.symbol);
          if (runId === validationRunId) {
            set((s) => ({
              validationProgress: { done: s.validationProgress.done + 1, total: s.validationProgress.total },
            }));
          }
          return sommes;
        })
      ).filter((s): s is SommesSymbole => s !== null && s !== undefined);
      if (runId !== validationRunId) return;

      const cellule = (type: "funding" | "divergence", i: number) =>
        finaliserEtude(fusionnerEtudes(parSymbole.map((s) => s[type][i] ?? sommesVides())));
      const horizons = (type: "funding" | "divergence") =>
        HORIZONS_VALIDATION.map((h, i) => ({ id: h.id, libelle: h.libelle, stats: cellule(type, i) }));

      set({
        validationState: "done",
        validation: {
          parSignal: [
            { id: "funding", libelle: "Funding extrême (contrarian)", horizons: horizons("funding") },
            { id: "divergence-rsi", libelle: "Divergence RSI", horizons: horizons("divergence") },
          ],
          note:
            `event study sur ${echantillon.length} symboles · ~333 j de funding réglé, ~166 j de klines 4 h · ` +
            "rendements signés par la direction, sans frais ni slippage — mesure du signal, pas d'une stratégie exécutable · " +
            "quadrant OI×prix et positionnement non validables (historiques OI/L-S gratuits ≈ 20-30 j)",
        },
      });
    })();
  },
}));

/**
 * Ouvre un setup dans le graphe (bus panneau→chart) sur le TF de la divergence :
 * la lecture affichée correspond ainsi à ce que montre le chart.
 */
export function ouvrirSetupDansChart(symbol: string): void {
  navigateTo({ symbol, exchange: "binance", timeframe: DIVERGENCE_TF, source: "eqs" });
}

// ─────────────────────────── Commande de la palette ───────────────────────────

/** Commande SIG : ouvre EQS directement en vue Signaux (enregistrée par App.tsx). */
export const commandesSignaux: Commande[] = [
  {
    id: "panneau:signaux",
    mnemonique: "SIG",
    libelle: "Signaux — scan de setups",
    categorie: "panneau",
    motsCles: [
      "signaux",
      "setup",
      "confluence",
      "inbox",
      "divergence",
      "squeeze",
      "build-up",
      "crowded",
      "quadrant",
    ],
    apercu: "Ouvre le screener en vue Signaux (détection de setups)",
    action: () => {
      signauxStore.getState().setVue("signaux");
      windowManagerStore.getState().openWindow("screener");
    },
  },
];
