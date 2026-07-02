/**
 * Store du backtest (BT) — Zustand VANILLA (hors render-loop React).
 *
 * Détient : l'état d'ouverture de la fenêtre, le BUILDER de stratégie (symbole/TF/plage,
 * règles d'entrée/sortie composables, stop/objectif, direction, taille, frais/slippage,
 * capital), les PRESETS de stratégie (livrés + utilisateur persistés en localStorage), et
 * l'état d'un RUN (phase, progression, résultat).
 *
 * Un run se déroule en deux temps :
 *  1. thread principal : ACCUMULATION des klines historiques (data/backtestData.ts) avec
 *     cache daemon + pagination REST, progression au fil de l'eau ;
 *  2. Web Worker : exécution du MOTEUR pur (@axiom/backtest) sur les bougies clôturées.
 *     Le worker est instancié À LA DEMANDE et terminé proprement à chaque run.
 *
 * 100 % fonctionnel sans daemon (repli pagination REST directe). Les données du run
 * (bougies, résultat) restent hors du render-loop : le state ne porte que le résultat final.
 */
import { createStore } from "zustand/vanilla";
import type { Candle, Timeframe } from "@axiom/types";
import type {
  Condition,
  Direction,
  Operande,
  ParamsBacktest,
  ResultatBacktest,
  StrategieDef,
} from "@axiom/backtest";
import type { Commande } from "../commands/registry";
import { marketStore } from "./market";
import {
  accumulerKlines,
  BACKTEST_TIMEFRAMES,
  type ProgressionAccumulation,
} from "../data/backtestData";
import type { WorkerRequest, WorkerResponse } from "../workers/backtest.worker";
import { windowManagerStore, mirrorOpenState } from "./windowManager";

export { BACKTEST_TIMEFRAMES };

/** Clé localStorage des presets de stratégie UTILISATEUR. */
const STORAGE_KEY = "axiom:backtest:v1";
/** Minimum de bougies pour un run exploitable (amorce indicateurs + trades). */
const MIN_BOUGIES = 30;

// ─────────────────────────── Plages temporelles ───────────────────────────

export type PlageId = "3m" | "6m" | "1a" | "2a";
const JOUR_MS = 86_400_000;

/** Plages proposées (durées relatives à maintenant). Ordre = ordre du sélecteur. */
export const PLAGES: { id: PlageId; label: string; ms: number }[] = [
  { id: "3m", label: "3 mois", ms: 90 * JOUR_MS },
  { id: "6m", label: "6 mois", ms: 182 * JOUR_MS },
  { id: "1a", label: "1 an", ms: 365 * JOUR_MS },
  { id: "2a", label: "2 ans", ms: 730 * JOUR_MS },
];

// ─────────────────────────── Catalogue d'opérandes (UI) ───────────────────────────

export type CategorieOperande = "prix" | "indicateur";

/** Spécification d'un opérande sélectionnable dans le builder (curé pour la lisibilité). */
export interface OperandeSpec {
  id: string;
  label: string;
  categorie: CategorieOperande;
  /** Paramètre principal configurable (ex. "length"), s'il existe. */
  paramKey?: string;
  defaultParam?: number;
  /** Construit l'opérande @axiom/backtest (param appliqué si `paramKey`). */
  make: (param?: number) => Operande;
}

/** Opérande « prix » (champ OHLCV). */
function prix(champ: "open" | "high" | "low" | "close" | "volume", label: string): OperandeSpec {
  return { id: `prix:${champ}`, label, categorie: "prix", make: () => ({ type: "prix", champ }) };
}

/** Opérande « indicateur » à un paramètre `length` configurable. */
function indLen(
  indicateurId: string,
  output: string,
  label: string,
  defaultLen: number,
): OperandeSpec {
  return {
    id: `${indicateurId}:${output}`,
    label,
    categorie: "indicateur",
    paramKey: "length",
    defaultParam: defaultLen,
    make: (p) => ({ type: "indicateur", indicateurId, params: { length: p ?? defaultLen }, output }),
  };
}

/** Opérande « indicateur » à paramètres FIXES (MACD, Bollinger, Stochastic). */
function indFixe(
  indicateurId: string,
  output: string,
  label: string,
  params: Record<string, number>,
): OperandeSpec {
  return {
    id: `${indicateurId}:${output}`,
    label,
    categorie: "indicateur",
    make: () => ({ type: "indicateur", indicateurId, params: { ...params }, output }),
  };
}

/** Catalogue curé des opérandes proposés dans le builder. */
export const CATALOGUE_OPERANDES: OperandeSpec[] = [
  prix("close", "Prix (close)"),
  prix("open", "Prix (open)"),
  prix("high", "Prix (high)"),
  prix("low", "Prix (low)"),
  prix("volume", "Volume"),
  indLen("rsi", "rsi", "RSI", 14),
  indLen("ema", "ema", "EMA", 20),
  indLen("sma", "sma", "SMA", 20),
  indLen("atr", "atr", "ATR", 14),
  indLen("cci", "cci", "CCI", 20),
  indFixe("macd", "macd", "MACD (ligne)", { fast: 12, slow: 26, signal: 9 }),
  indFixe("macd", "signal", "MACD (signal)", { fast: 12, slow: 26, signal: 9 }),
  indFixe("macd", "hist", "MACD (hist)", { fast: 12, slow: 26, signal: 9 }),
  indFixe("bollinger", "upper", "Bollinger sup", { length: 20, mult: 2 }),
  indFixe("bollinger", "basis", "Bollinger base", { length: 20, mult: 2 }),
  indFixe("bollinger", "lower", "Bollinger inf", { length: 20, mult: 2 }),
  indFixe("stochastic", "k", "Stoch %K", { kLength: 14, dLength: 3 }),
  indFixe("stochastic", "d", "Stoch %D", { kLength: 14, dLength: 3 }),
];

/** Résout une spec d'opérande par son id. */
export function specParId(id: string): OperandeSpec | undefined {
  return CATALOGUE_OPERANDES.find((s) => s.id === id);
}

/** Retrouve la spec + le paramètre d'un opérande (pour re-remplir les contrôles du builder). */
export function decrireOperande(op: Operande): { specId: string; param?: number } {
  if (op.type === "prix") return { specId: `prix:${op.champ}` };
  if (op.type === "constante") return { specId: "constante" };
  const specId = `${op.indicateurId}:${op.output}`;
  const spec = specParId(specId);
  if (spec?.paramKey !== undefined) {
    const v = Number(op.params[spec.paramKey]);
    return { specId, param: Number.isFinite(v) ? v : undefined };
  }
  return { specId };
}

// ─────────────────────────── Conditions & presets par défaut ───────────────────────────

function condEntreeDefaut(): Condition {
  return {
    type: "comparaison",
    gauche: { type: "indicateur", indicateurId: "rsi", params: { length: 14 }, output: "rsi" },
    comparateur: "<",
    droite: { type: "constante", valeur: 30 },
  };
}

function condSortieDefaut(): Condition {
  return {
    type: "comparaison",
    gauche: { type: "indicateur", indicateurId: "rsi", params: { length: 14 }, output: "rsi" },
    comparateur: ">",
    droite: { type: "constante", valeur: 70 },
  };
}

/** Preset de stratégie (livré ou utilisateur). */
export interface StrategiePreset {
  id: string;
  name: string;
  tf: Timeframe;
  direction: Direction;
  tailleFixe: number;
  stopPct: number | null;
  targetPct: number | null;
  reglesEntree: Condition[];
  reglesSortie: Condition[];
  /** true pour les presets livrés (non supprimables). */
  builtin?: boolean;
}

const ema = (len: number): Operande => ({
  type: "indicateur",
  indicateurId: "ema",
  params: { length: len },
  output: "ema",
});

/** Presets livrés (deux stratégies classiques, non supprimables). */
export const BUILTIN_STRATEGIES: StrategiePreset[] = [
  {
    id: "builtin:rsi",
    name: "RSI survente/surachat",
    tf: "4h",
    direction: "long",
    tailleFixe: 1000,
    stopPct: null,
    targetPct: null,
    reglesEntree: [condEntreeDefaut()],
    reglesSortie: [condSortieDefaut()],
    builtin: true,
  },
  {
    id: "builtin:ema-cross",
    name: "Croisement EMA 9/21",
    tf: "1h",
    direction: "long",
    tailleFixe: 1000,
    stopPct: 5,
    targetPct: null,
    reglesEntree: [{ type: "croisement", a: ema(9), b: ema(21), sens: "hausse" }],
    reglesSortie: [{ type: "croisement", a: ema(9), b: ema(21), sens: "baisse" }],
    builtin: true,
  },
];

/** Copie profonde d'une liste de conditions (éviter de muter un preset source). */
function clonerConditions(conds: Condition[]): Condition[] {
  return conds.map((c) => JSON.parse(JSON.stringify(c)) as Condition);
}

// ─────────────────────────── Persistance des presets utilisateur ───────────────────────────

function genPresetId(): string {
  const c = globalThis.crypto;
  const suffix = c && typeof c.randomUUID === "function" ? c.randomUUID() : Date.now().toString(36);
  return `user:${suffix}`;
}

function readUserPresets(): StrategiePreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as StrategiePreset[]).filter((p) => !p.builtin) : [];
  } catch {
    return [];
  }
}

function writeUserPresets(presets: StrategiePreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    /* quota / mode privé : persistance best-effort */
  }
}

// ─────────────────────────── État du store ───────────────────────────

export type PhaseBacktest = "idle" | "chargement" | "calcul" | "done" | "error";

export interface BacktestState {
  open: boolean;
  openBacktest: () => void;
  closeBacktest: () => void;
  toggle: () => void;

  // — Builder —
  symbol: string;
  tf: Timeframe;
  plage: PlageId;
  direction: Direction;
  tailleFixe: number;
  stopPct: number | null;
  targetPct: number | null;
  fraisPct: number;
  slippagePct: number;
  capitalInitial: number;
  reglesEntree: Condition[];
  reglesSortie: Condition[];

  setSymbol: (s: string) => void;
  setTf: (tf: Timeframe) => void;
  setPlage: (p: PlageId) => void;
  setDirection: (d: Direction) => void;
  setTailleFixe: (v: number) => void;
  setStopPct: (v: number | null) => void;
  setTargetPct: (v: number | null) => void;
  setFraisPct: (v: number) => void;
  setSlippagePct: (v: number) => void;
  setCapitalInitial: (v: number) => void;
  addEntree: () => void;
  updateEntree: (index: number, cond: Condition) => void;
  removeEntree: (index: number) => void;
  addSortie: () => void;
  updateSortie: (index: number, cond: Condition) => void;
  removeSortie: (index: number) => void;

  // — Presets —
  userPresets: StrategiePreset[];
  loadPreset: (id: string) => void;
  savePreset: (name: string) => void;
  deletePreset: (id: string) => void;

  // — Run —
  phase: PhaseBacktest;
  progress: ProgressionAccumulation;
  resultat: ResultatBacktest | null;
  error: string | null;
  note: string | null;
  run: () => void;
  cancel: () => void;
}

// ─────────────────────────── Cycle de vie run/worker ───────────────────────────

let worker: Worker | null = null;
let abort: AbortController | null = null;
let currentRunId = 0;

function terminateWorker(): void {
  if (worker !== null) {
    worker.terminate();
    worker = null;
  }
}

export const backtestStore = createStore<BacktestState>((set, get) => ({
  open: false,
  openBacktest: () => windowManagerStore.getState().openWindow("backtest"),
  closeBacktest: () => windowManagerStore.getState().closeWindow("backtest"),
  toggle: () => windowManagerStore.getState().toggleWindow("backtest"),

  symbol: "BTCUSDT",
  tf: "1h",
  plage: "6m",
  direction: "long",
  tailleFixe: 1000,
  stopPct: null,
  targetPct: null,
  fraisPct: 0.05,
  slippagePct: 0.02,
  capitalInitial: 10_000,
  reglesEntree: [condEntreeDefaut()],
  reglesSortie: [condSortieDefaut()],

  setSymbol: (s) => set({ symbol: s.trim().toUpperCase() }),
  setTf: (tf) => set({ tf }),
  setPlage: (plage) => set({ plage }),
  setDirection: (direction) => set({ direction }),
  setTailleFixe: (v) => set({ tailleFixe: v }),
  setStopPct: (v) => set({ stopPct: v }),
  setTargetPct: (v) => set({ targetPct: v }),
  setFraisPct: (v) => set({ fraisPct: v }),
  setSlippagePct: (v) => set({ slippagePct: v }),
  setCapitalInitial: (v) => set({ capitalInitial: v }),

  addEntree: () => set((s) => ({ reglesEntree: [...s.reglesEntree, condEntreeDefaut()] })),
  updateEntree: (index, cond) =>
    set((s) => ({ reglesEntree: s.reglesEntree.map((c, i) => (i === index ? cond : c)) })),
  removeEntree: (index) =>
    set((s) => ({ reglesEntree: s.reglesEntree.filter((_, i) => i !== index) })),
  addSortie: () => set((s) => ({ reglesSortie: [...s.reglesSortie, condSortieDefaut()] })),
  updateSortie: (index, cond) =>
    set((s) => ({ reglesSortie: s.reglesSortie.map((c, i) => (i === index ? cond : c)) })),
  removeSortie: (index) =>
    set((s) => ({ reglesSortie: s.reglesSortie.filter((_, i) => i !== index) })),

  userPresets: readUserPresets(),

  loadPreset: (id) => {
    const preset = [...BUILTIN_STRATEGIES, ...get().userPresets].find((p) => p.id === id);
    if (preset === undefined) return;
    set({
      tf: preset.tf,
      direction: preset.direction,
      tailleFixe: preset.tailleFixe,
      stopPct: preset.stopPct,
      targetPct: preset.targetPct,
      reglesEntree: clonerConditions(preset.reglesEntree),
      reglesSortie: clonerConditions(preset.reglesSortie),
    });
  },
  savePreset: (name) => {
    const nom = name.trim();
    if (nom.length === 0) return;
    const s = get();
    const preset: StrategiePreset = {
      id: genPresetId(),
      name: nom,
      tf: s.tf,
      direction: s.direction,
      tailleFixe: s.tailleFixe,
      stopPct: s.stopPct,
      targetPct: s.targetPct,
      reglesEntree: clonerConditions(s.reglesEntree),
      reglesSortie: clonerConditions(s.reglesSortie),
    };
    const userPresets = [...s.userPresets, preset];
    writeUserPresets(userPresets);
    set({ userPresets });
  },
  deletePreset: (id) => {
    const userPresets = get().userPresets.filter((p) => p.id !== id);
    writeUserPresets(userPresets);
    set({ userPresets });
  },

  phase: "idle",
  progress: { recuperees: 0, cible: 0 },
  resultat: null,
  error: null,
  note: null,

  run: () => {
    // Un seul run à la fois : annuler l'accumulation + le worker précédents.
    abort?.abort();
    terminateWorker();
    const runId = ++currentRunId;
    const s = get();
    set({
      phase: "chargement",
      progress: { recuperees: 0, cible: 0 },
      resultat: null,
      error: null,
      note: null,
    });

    const ctrl = new AbortController();
    abort = ctrl;
    const jusqua = Date.now();
    const plage = PLAGES.find((p) => p.id === s.plage) ?? PLAGES[1]!;
    const depuis = jusqua - plage.ms;

    void (async () => {
      let candles: Candle[];
      try {
        candles = await accumulerKlines(s.symbol, s.tf, depuis, jusqua, {
          signal: ctrl.signal,
          onProgress: (p) => {
            if (runId === currentRunId) set({ progress: p });
          },
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return; // annulation propre
        if (runId !== currentRunId) return;
        set({ phase: "error", error: "Historique indisponible (Binance)." });
        return;
      }
      if (runId !== currentRunId) return;
      if (candles.length < MIN_BOUGIES) {
        set({
          phase: "error",
          error: `Trop peu de bougies (${candles.length}). Élargis la plage ou change de TF.`,
        });
        return;
      }

      set({ phase: "calcul", note: `${candles.length} bougies · ${s.symbol} ${s.tf}` });

      // Instanciation À LA DEMANDE (jamais à l'import) → Vite bundle le worker en chunk.
      terminateWorker();
      const w = new Worker(new URL("../workers/backtest.worker.ts", import.meta.url), {
        type: "module",
      });
      worker = w;
      w.onmessage = (event: MessageEvent) => {
        if (runId !== currentRunId) return;
        const msg = event.data as WorkerResponse;
        if (msg.type === "result") {
          set({ phase: "done", resultat: msg.resultat });
          terminateWorker();
        } else if (msg.type === "error") {
          set({ phase: "error", error: `Moteur : ${msg.message}` });
          terminateWorker();
        }
        // "progress" (phase calcul) : déjà reflété par la phase, rien à faire.
      };
      w.onerror = () => {
        if (runId !== currentRunId) return;
        set({ phase: "error", error: "Worker du backtest en échec." });
        terminateWorker();
      };

      const strat: StrategieDef = {
        reglesEntree: s.reglesEntree,
        reglesSortie: s.reglesSortie,
        direction: s.direction,
        tailleFixe: s.tailleFixe,
        ...(s.stopPct !== null ? { stopPct: s.stopPct } : {}),
        ...(s.targetPct !== null ? { targetPct: s.targetPct } : {}),
      };
      const params: ParamsBacktest = {
        fraisPct: s.fraisPct,
        slippagePct: s.slippagePct,
        capitalInitial: s.capitalInitial,
      };
      const request: WorkerRequest = { type: "run", runId, candles, strat, params };
      w.postMessage(request);
    })();
  },

  cancel: () => {
    currentRunId++; // invalide les messages en vol
    abort?.abort();
    terminateWorker();
    set({ phase: "idle" });
  },
}));

mirrorOpenState("backtest", backtestStore);

// ─────────────────────────── Action dérivée ───────────────────────────

/** Pré-remplit le symbole/TF du builder depuis le graphe courant (source Binance figée). */
export function importerDepuisChart(): void {
  const m = marketStore.getState();
  backtestStore.getState().setSymbol(m.symbol);
  const tf = m.timeframe;
  if (BACKTEST_TIMEFRAMES.includes(tf)) backtestStore.getState().setTf(tf);
}

// ─────────────────────────── Commande de palette (EXPORT pour l'intégrateur) ───────────────────────────

/**
 * Commande BT pour la « command palette ». L'INTÉGRATEUR l'enregistre via
 * `enregistrerCommandes(commandes)` (cf. commands/registry.ts). Import de type seulement.
 */
export const commandes: Commande[] = [
  {
    id: "panneau:backtest",
    mnemonique: "BT",
    libelle: "Backtest de stratégie",
    categorie: "panneau",
    motsCles: ["backtest", "bt", "strategie", "test", "equity", "backtesting", "regles"],
    apercu: "Ouvre / ferme le backtest de stratégie",
    action: () => backtestStore.getState().toggle(),
  },
];
