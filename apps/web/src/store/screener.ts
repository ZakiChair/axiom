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
import { navigateTo } from "../lib/navigation";
import { watchlistStore } from "./watchlist";
import {
  BUILTIN_PRESETS,
  SCREENER_CAP,
  SCREENER_POSITION_CAP,
  type BaseCondition,
  type IndicatorCondition,
  type ScreenerPreset,
  type ScreenerRow,
} from "../data/screener";
import { executerScreener } from "../data/screenerRun";
import { windowManagerStore, mirrorOpenState } from "./windowManager";

// Utilitaires du pipeline déplacés vers data/screenerRun.ts ; ré-exportés ici pour
// les consommateurs existants (store/signaux.ts, store/squeeze.ts) — aucun cycle
// (screenerRun n'importe rien du store).
export { mapPool, TICKER_24H_URL, OI_HIST_LIMIT } from "../data/screenerRun";

/** Clé localStorage des presets UTILISATEUR (les livrés sont constants, non persistés). */
const STORAGE_KEY = "axiom:screener:v1";

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

// ─────────────────────────── Suivi du run courant ───────────────────────────

/**
 * Identifiant du run courant. Le worker vit désormais DANS `executerScreener` ; le
 * store ne peut plus le terminer directement. `cancel` / un nouveau run incrémente cet
 * id et les callbacks (onProgress / résultat) d'un run périmé sont ignorés à l'arrivée
 * — comportement UI identique (état « idle », plus aucune écriture), le run périmé
 * s'achève en arrière-plan sans effet visible.
 */
let currentRunId = 0;

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
    // Un seul run à la fois : on invalide le précédent (ses callbacks seront ignorés).
    const runId = ++currentRunId;
    const { tf, baseConditions, indicatorConditions } = get();
    set({ runState: "loading", progress: { done: 0, total: 0 }, rows: [], error: null, note: null });

    // Pipeline extrait (aucune écriture de store) : la progression du worker fait passer
    // l'état en « running » (le premier appel avec total figé, comme avant), le résultat
    // final porte les notes de couverture prêtes à afficher.
    void executerScreener(baseConditions, indicatorConditions, tf, {
      capIndicateurs: SCREENER_CAP,
      capPosition: SCREENER_POSITION_CAP,
      onProgress: (done, total) => {
        if (runId !== currentRunId) return;
        set({ runState: "running", progress: { done, total } });
      },
    })
      .then((res) => {
        if (runId !== currentRunId) return;
        set({
          runState: "done",
          rows: res.rows,
          progress: { done: res.rows.length, total: res.rows.length },
          note: res.notes.length > 0 ? res.notes.join(" · ") : null,
        });
      })
      .catch((err: unknown) => {
        if (runId !== currentRunId) return;
        set({ runState: "error", error: err instanceof Error ? err.message : String(err) });
      });
  },

  cancel: () => {
    currentRunId++; // invalide les callbacks en vol (le run périmé s'achève sans effet)
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
