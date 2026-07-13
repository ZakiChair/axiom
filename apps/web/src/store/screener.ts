/**
 * Store du screener (EQS) — Zustand VANILLA (hors render-loop React).
 *
 * Détient : l'état d'ouverture du panneau, le BUILDER de filtres (TF + conditions de
 * base + conditions indicateurs), les PRESETS de l'utilisateur (persistés localStorage,
 * en plus des presets livrés), et l'état d'un RUN (progression, résultats, note honnête).
 *
 * Un run se déroule en deux temps :
 *  1. thread principal : 1 requête ticker 24h (univers) + 1 requête premiumIndex (funding),
 *     puis (si filtres OI/L-S) enrichissement position sur top N liquides via Binance
 *     `/futures/data` (rate-limité, note de couverture honnête), puis filtres de base
 *     PURS (data/screener.ts) → candidats ;
 *  2. Web Worker : évaluation des filtres indicateurs sur les candidats (plafonnés à
 *     SCREENER_CAP), avec progression au fil de l'eau. Le worker est instancié À LA DEMANDE
 *     (jamais à l'import) et relancé/terminé proprement à chaque run.
 *
 * Dégradation gracieuse : ticker en échec → état « error » (aucune boucle console) ;
 * premiumIndex en échec → funding absent (les filtres funding ne retiennent alors rien,
 * ce qui est honnête) + note ; OI/L-S en échec partiel → métriques absentes (filtres
 * position échouent honnêtement) + note. 100 % fonctionnel sans daemon.
 */
import { createStore } from "zustand/vanilla";
import type { Timeframe } from "@axiom/types";
import type { Commande } from "../commands/registry";
import {
  fetchGlobalLongShortAccountRatio,
  fetchOpenInterestHist,
} from "../data/binanceFutures";
import { extUrl } from "../data/extapi";
import { navigateTo } from "../lib/navigation";
import { watchlistStore } from "./watchlist";
import {
  applyBaseFilters,
  applyFunding,
  applyLongShortRatio,
  applyOiChange,
  BUILTIN_PRESETS,
  lastLongShortRatio,
  needsPositionMetrics,
  oiChangePctFromHist,
  parsePremiumIndex,
  parseTicker24h,
  selectCandidates,
  splitBaseConditions,
  SCREENER_CAP,
  SCREENER_KLINE_LIMIT,
  SCREENER_POSITION_CAP,
  type BaseCondition,
  type IndicatorCondition,
  type ScreenerPreset,
  type ScreenerRow,
} from "../data/screener";
import type { WorkerRequest, WorkerResponse } from "../workers/screener.worker";
import { windowManagerStore, mirrorOpenState } from "./windowManager";

const TICKER_24H_URL = "https://api.binance.com/api/v3/ticker/24hr";
/** Nombre max de lignes affichées quand le run n'a PAS de filtre indicateur (table lisible). */
const DISPLAY_CAP = 100;
/** Clé localStorage des presets UTILISATEUR (les livrés sont constants, non persistés). */
const STORAGE_KEY = "axiom:screener:v1";
/**
 * Concurrence pour l'enrichissement OI + L/S (2 req/symbole). 6 en parallèle →
 * 20 symboles ≈ quelques secondes, budget << 1000 req / 5 min Binance.
 */
const POSITION_CONCURRENCY = 6;
/** Historique OI : 25 points 1h ≈ fenêtre 24 h pour le Δ%. */
const OI_HIST_LIMIT = 25;

/** Phases d'un run. */
export type RunState = "idle" | "loading" | "running" | "done" | "error";

export interface ScreenerState {
  /** true quand le panneau screener est ouvert. */
  open: boolean;
  openScreener: () => void;
  closeScreener: () => void;
  toggle: () => void;

  // — Builder de filtres —
  tf: Timeframe;
  baseConditions: BaseCondition[];
  indicatorConditions: IndicatorCondition[];
  setTf: (tf: Timeframe) => void;
  addBaseCondition: () => void;
  updateBaseCondition: (index: number, patch: Partial<BaseCondition>) => void;
  removeBaseCondition: (index: number) => void;
  addIndicatorCondition: () => void;
  updateIndicatorCondition: (index: number, patch: Partial<IndicatorCondition>) => void;
  removeIndicatorCondition: (index: number) => void;

  // — Presets (livrés + utilisateur) —
  userPresets: ScreenerPreset[];
  loadPreset: (id: string) => void;
  savePreset: (name: string) => void;
  deletePreset: (id: string) => void;

  // — Run —
  runState: RunState;
  progress: { done: number; total: number };
  rows: ScreenerRow[];
  error: string | null;
  note: string | null;
  run: () => void;
  cancel: () => void;
}

/** Condition de base par défaut (à l'ajout d'une ligne). */
function defaultBaseCondition(): BaseCondition {
  return { kind: "base", field: "volumeUsd24h", op: ">", value: 10_000_000 };
}

/** Condition indicateur par défaut (RSI < 30). */
function defaultIndicatorCondition(): IndicatorCondition {
  return { kind: "indicator", fieldId: "rsi", param: 14, op: "<", value: 30 };
}

/** Identifiant de preset utilisateur (crypto.randomUUID si dispo, repli horodaté). */
function genPresetId(): string {
  const c = globalThis.crypto;
  const suffix = c && typeof c.randomUUID === "function" ? c.randomUUID() : Date.now().toString(36);
  return `user:${suffix}`;
}

/** Lecture tolérante des presets utilisateur (localStorage absent / JSON corrompu → []). */
function readUserPresets(): ScreenerPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ScreenerPreset[]).filter((p) => !p.builtin) : [];
  } catch {
    return [];
  }
}

/** Écriture tolérante des presets utilisateur (best-effort). */
function writeUserPresets(presets: ScreenerPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    /* quota / mode privé : la persistance est best-effort */
  }
}

/**
 * Exécute `fn` sur chaque item avec un plafond de concurrence (pool simple).
 * Préserve l'ordre des résultats. PURE sur le contrôle de flux (I/O via fn).
 */
async function mapPool<T, R>(
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

// ─────────────────────────── Cycle de vie du worker ───────────────────────────

let worker: Worker | null = null;
/** Identifiant du run courant : les messages d'un run périmé sont ignorés. */
let currentRunId = 0;

/** Termine le worker courant s'il existe (annulation / relance). */
function terminateWorker(): void {
  if (worker !== null) {
    worker.terminate();
    worker = null;
  }
}

export const screenerStore = createStore<ScreenerState>((set, get) => ({
  open: false,
  openScreener: () => windowManagerStore.getState().openWindow("screener"),
  closeScreener: () => windowManagerStore.getState().closeWindow("screener"),
  toggle: () => windowManagerStore.getState().toggleWindow("screener"),

  tf: "4h",
  baseConditions: [{ kind: "base", field: "volumeUsd24h", op: ">", value: 10_000_000 }],
  indicatorConditions: [{ kind: "indicator", fieldId: "rsi", param: 14, op: "<", value: 30 }],

  setTf: (tf) => set({ tf }),
  addBaseCondition: () => set((s) => ({ baseConditions: [...s.baseConditions, defaultBaseCondition()] })),
  updateBaseCondition: (index, patch) =>
    set((s) => ({
      baseConditions: s.baseConditions.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    })),
  removeBaseCondition: (index) =>
    set((s) => ({ baseConditions: s.baseConditions.filter((_, i) => i !== index) })),
  addIndicatorCondition: () =>
    set((s) => ({ indicatorConditions: [...s.indicatorConditions, defaultIndicatorCondition()] })),
  updateIndicatorCondition: (index, patch) =>
    set((s) => ({
      indicatorConditions: s.indicatorConditions.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    })),
  removeIndicatorCondition: (index) =>
    set((s) => ({ indicatorConditions: s.indicatorConditions.filter((_, i) => i !== index) })),

  userPresets: readUserPresets(),

  loadPreset: (id) => {
    const preset = [...BUILTIN_PRESETS, ...get().userPresets].find((p) => p.id === id);
    if (preset === undefined) return;
    // Copies profondes : éditer le builder ne doit pas muter le preset source.
    set({
      tf: preset.tf,
      baseConditions: preset.baseConditions.map((c) => ({ ...c })),
      indicatorConditions: preset.indicatorConditions.map((c) => ({ ...c })),
    });
  },
  savePreset: (name) => {
    const nom = name.trim();
    if (nom.length === 0) return;
    const { tf, baseConditions, indicatorConditions } = get();
    const preset: ScreenerPreset = {
      id: genPresetId(),
      name: nom,
      tf,
      baseConditions: baseConditions.map((c) => ({ ...c })),
      indicatorConditions: indicatorConditions.map((c) => ({ ...c })),
    };
    const userPresets = [...get().userPresets, preset];
    writeUserPresets(userPresets);
    set({ userPresets });
  },
  deletePreset: (id) => {
    const userPresets = get().userPresets.filter((p) => p.id !== id);
    writeUserPresets(userPresets);
    set({ userPresets });
  },

  runState: "idle",
  progress: { done: 0, total: 0 },
  rows: [],
  error: null,
  note: null,

  run: () => {
    // Un seul run à la fois : on annule le précédent.
    terminateWorker();
    const runId = ++currentRunId;
    const { tf, baseConditions, indicatorConditions } = get();
    set({ runState: "loading", progress: { done: 0, total: 0 }, rows: [], error: null, note: null });

    void (async () => {
      // 1. Univers (ticker 24h en direct, CORS *) + funding (premiumIndex via /extapi).
      let rows: ScreenerRow[];
      try {
        const res = await fetch(TICKER_24H_URL);
        if (!res.ok) throw new Error(`ticker24h ${res.status}`);
        rows = parseTicker24h(await res.json());
      } catch {
        if (runId !== currentRunId) return;
        set({ runState: "error", error: "Univers indisponible (Binance ticker 24h)." });
        return;
      }
      if (runId !== currentRunId) return;

      // Funding : best-effort (une panne ne bloque pas le run, mais est signalée).
      let fundingIndisponible = false;
      try {
        const res = await fetch(extUrl("fapi.binance.com", "fapi/v1/premiumIndex"));
        if (!res.ok) throw new Error(`premiumIndex ${res.status}`);
        applyFunding(rows, parsePremiumIndex(await res.json()));
      } catch {
        fundingIndisponible = true;
      }
      if (runId !== currentRunId) return;

      // 2. Filtres de base (purs) — éventuel enrichissement position avant filtres OI/L-S.
      const notes: string[] = [];
      if (fundingIndisponible) notes.push("funding indisponible");

      const { pre, position } = splitBaseConditions(baseConditions);
      let working = applyBaseFilters(rows, pre);

      if (needsPositionMetrics(baseConditions)) {
        // Échantillon top N liquides : pas d'historique OI/L-S batch gratuit universel.
        const sample = selectCandidates(working, SCREENER_POSITION_CAP);
        if (working.length > SCREENER_POSITION_CAP) {
          notes.push(
            `OI/L-S : échantillon top ${SCREENER_POSITION_CAP} liquides (sur ${working.length})`,
          );
        } else {
          notes.push(`OI/L-S : échantillon ${sample.length} symbole${sample.length > 1 ? "s" : ""}`);
        }
        set({
          runState: "loading",
          progress: { done: 0, total: sample.length },
          note: notes.join(" · ") + " · enrichissement position…",
        });
        const { oiOk, lsOk } = await enrichPositionSample(sample);
        if (runId !== currentRunId) return;
        if (oiOk === 0 && lsOk === 0) {
          notes.push("OI/L-S indisponibles (Binance futures data)");
        } else if (oiOk < sample.length || lsOk < sample.length) {
          notes.push(`OI ${oiOk}/${sample.length} · L/S ${lsOk}/${sample.length}`);
        }
        working = applyBaseFilters(sample, position);
      }

      const baseFiltered = working;

      // Sans filtre indicateur : résultats directs (triés par volume, plafond d'affichage).
      if (indicatorConditions.length === 0) {
        const sorted = selectCandidates(baseFiltered, DISPLAY_CAP);
        if (baseFiltered.length > DISPLAY_CAP) {
          notes.push(`${baseFiltered.length} résultats, ${DISPLAY_CAP} affichés (plus liquides)`);
        }
        set({
          runState: "done",
          rows: sorted,
          progress: { done: sorted.length, total: sorted.length },
          note: notes.length > 0 ? notes.join(" · ") : `${baseFiltered.length} résultats`,
        });
        return;
      }

      // Avec filtres indicateurs : cap 60 candidats les plus liquides → worker.
      const candidates = selectCandidates(baseFiltered, SCREENER_CAP);
      if (baseFiltered.length > SCREENER_CAP) {
        notes.push(`${baseFiltered.length} filtrés, ${SCREENER_CAP} évalués (plus liquides)`);
      }
      if (candidates.length === 0) {
        set({
          runState: "done",
          rows: [],
          progress: { done: 0, total: 0 },
          note: notes.length > 0 ? notes.join(" · ") : "Aucun candidat après filtres de base",
        });
        return;
      }

      set({
        runState: "running",
        progress: { done: 0, total: candidates.length },
        note: notes.length > 0 ? notes.join(" · ") : null,
      });

      // Instanciation À LA DEMANDE (jamais à l'import) → Vite bundle le worker en chunk.
      terminateWorker();
      const w = new Worker(new URL("../workers/screener.worker.ts", import.meta.url), {
        type: "module",
      });
      worker = w;
      w.onmessage = (event: MessageEvent) => {
        if (runId !== currentRunId) return;
        const msg = event.data as WorkerResponse;
        if (msg.type === "progress") {
          set({ progress: { done: msg.done, total: msg.total } });
        } else if (msg.type === "result") {
          set((s) => ({
            runState: "done",
            rows: msg.rows,
            note:
              s.note !== null ? `${s.note} · ${msg.rows.length} résultats` : `${msg.rows.length} résultats`,
          }));
          terminateWorker();
        } else if (msg.type === "error") {
          set({ runState: "error", error: `Étage indicateurs : ${msg.message}` });
          terminateWorker();
        }
      };
      w.onerror = () => {
        if (runId !== currentRunId) return;
        set({ runState: "error", error: "Worker du screener en échec." });
        terminateWorker();
      };
      const request: WorkerRequest = {
        type: "run",
        runId,
        candidates,
        tf,
        klineLimit: SCREENER_KLINE_LIMIT,
        indicatorConditions,
      };
      w.postMessage(request);
    })();
  },

  cancel: () => {
    currentRunId++; // invalide les messages en vol
    terminateWorker();
    set({ runState: "idle" });
  },
}));

mirrorOpenState("screener", screenerStore);

// ─────────────────────────── Actions dérivées (chart / watchlist) ───────────────────────────

/**
 * Ouvre un résultat dans le graphe via le bus panneau→chart (Lot C2) :
 * source Binance + symbole + TF du run.
 */
export function ouvrirDansChart(symbol: string): void {
  navigateTo({
    symbol,
    exchange: "binance",
    timeframe: screenerStore.getState().tf,
    source: "eqs",
  });
}

/** Ajoute un résultat à la watchlist (groupe actif), source Binance figée. */
export function ajouterAWatchlist(symbol: string): void {
  watchlistStore.getState().add(symbol, "binance");
}

// ─────────────────────────── Commandes de la palette (EXPORT pour l'intégrateur) ───────────────────────────

/**
 * Commande EQS pour la « command palette ». L'INTÉGRATEUR l'enregistre via
 * `enregistrerCommandes(commandesScreener)` (cf. commands/registry.ts). Import de type
 * seulement : aucun cycle runtime avec le registre.
 */
export const commandesScreener: Commande[] = [
  {
    id: "panneau:screener",
    mnemonique: "EQS",
    libelle: "Screener d'actifs",
    categorie: "panneau",
    motsCles: [
      "screener",
      "eqs",
      "scan",
      "filtre",
      "rsi",
      "funding",
      "volume",
      "survendu",
      "crowded",
      "squeeze",
      "oi",
      "positionnement",
    ],
    apercu: "Ouvre / ferme le screener d'actifs",
    action: () => screenerStore.getState().toggle(),
  },
];
