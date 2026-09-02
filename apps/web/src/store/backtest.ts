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
  precharger2ans1d,
  SEUIL_PROFONDEUR_BT,
  type ProgressionAccumulation,
} from "../data/backtestData";
import type { WorkerRequest, WorkerResponse } from "../workers/backtest.worker";
import { windowManagerStore, mirrorOpenState } from "./windowManager";
import { signatureRun, type ConfigRun } from "./backtestSignature";

export { BACKTEST_TIMEFRAMES, SEUIL_PROFONDEUR_BT };

/** Clé localStorage des presets de stratégie UTILISATEUR. */
const STORAGE_KEY = "axiom:backtest:v1";
/** Minimum de bougies pour un run exploitable (amorce indicateurs + trades). */
export const MIN_BOUGIES = 30;

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
  indFixe("supertrend", "direction", "Supertrend (direction)", { period: 10, multiplier: 3 }),
  indLen("adx", "adx", "ADX", 14),
  indFixe("psar", "psar", "PSAR", { step: 0.02, max: 0.2 }),
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
  /** Optionnel : presets utilisateur post-v2.7. Absents = comportement inchangé. */
  stopAtr?: { length: number; mult: number } | null;
  risquePct?: number | null;
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
const macdLigne = (): Operande => ({
  type: "indicateur",
  indicateurId: "macd",
  params: { fast: 12, slow: 26, signal: 9 },
  output: "macd",
});
const macdSignal = (): Operande => ({
  type: "indicateur",
  indicateurId: "macd",
  params: { fast: 12, slow: 26, signal: 9 },
  output: "signal",
});
const supertrendDir = (): Operande => ({
  type: "indicateur",
  indicateurId: "supertrend",
  params: { period: 10, multiplier: 3 },
  output: "direction",
});
const adx14 = (): Operande => ({
  type: "indicateur",
  indicateurId: "adx",
  params: { length: 14 },
  output: "adx",
});
const bollLower = (): Operande => ({
  type: "indicateur",
  indicateurId: "bollinger",
  params: { length: 20, mult: 2 },
  output: "lower",
});
const bollBasis = (): Operande => ({
  type: "indicateur",
  indicateurId: "bollinger",
  params: { length: 20, mult: 2 },
  output: "basis",
});
const prixClose: Operande = { type: "prix", champ: "close" };
const constante = (v: number): Operande => ({ type: "constante", valeur: v });
const rsi14 = (): Operande => ({
  type: "indicateur",
  indicateurId: "rsi",
  params: { length: 14 },
  output: "rsi",
});
const psarDefaut = (): Operande => ({
  type: "indicateur",
  indicateurId: "psar",
  params: { step: 0.02, max: 0.2 },
  output: "psar",
});

/**
 * Presets livrés. Tous LONG-ONLY (convention des builtins) et NON supprimables.
 *
 * Les conditions des quatre presets ci-dessous (macd-cross, supertrend,
 * bollinger-reversion, mm-adx) reprennent au littéral près les defs FIABLES de
 * la contre-épreuve `EXPRIMABLES` (`scripts/valider-strategies.ts`, corrigées
 * en Task 5) : des conditions de NIVEAU (`comparaison`) là où le def source
 * décrit un ÉTAT continu (MACD vs signal, direction Supertrend, EMA9 vs
 * EMA21), et un vrai franchissement (`croisement`) seulement pour l'entrée
 * Bollinger, qui teste un FRANCHISSEMENT réel de la bande basse. `mm-adx`
 * répète le gate ADX ≥ 25 sur la sortie (comme la def source) : les règles
 * étant conjonctives, tant que ADX < 25 aucune sortie par règle n'est
 * possible — le stop à 5 % est le filet de secours dans ce cas.
 *
 * `tf` = le timeframe le plus favorable au moteur de backtest (frais/slippage
 * inclus, cf. section 2 du rapport `docs/superpowers/research/2026-07-28-
 * backtest-strategies.md`) : 4h partout. Ces mesures portent sur les defs
 * `les-deux` SANS stop de la contre-épreuve, pas sur ces presets long-only
 * avec stop — le tf n'est qu'un défaut de commodité, PAS une promesse de
 * gain : macd-cross et supertrend ressortent positifs en 4h (macd +0.069 %
 * BTC / +0.252 % ETH ; supertrend -0.047 % BTC / +0.497 % ETH), mais
 * bollinger-reversion n'est positif qu'en BTC 4h (+0.063 %) — c'est la PIRE
 * cellule DE CETTE STRATÉGIE en ETH 4h (-0.819 %, pas la pire du tableau
 * complet : stratRsiReversion fait -2.824 % sur la même cellule) — et
 * mm-adx est négatif dans les quatre cellules, 4h y étant seulement la
 * MOINS mauvaise (-0.037 % BTC).
 *
 * Quirk non mesuré par la contre-épreuve (qui n'a pas de stop) : pour
 * macd-cross et mm-adx, une condition de NIVEAU reste vraie après un
 * stop-out tant que le régime ne s'est pas retourné — combinée à
 * `stopPct: 5`, une position stoppée peut donc se rouvrir DÈS LA BARRE
 * SUIVANTE si le niveau tient encore, ce qu'une entrée par `croisement`
 * (événement d'une seule barre) n'aurait pas permis.
 */
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
  {
    id: "builtin:macd-cross",
    name: "MACD vs signal",
    tf: "4h",
    direction: "long",
    tailleFixe: 1000,
    stopPct: 5,
    targetPct: null,
    reglesEntree: [{ type: "comparaison", gauche: macdLigne(), comparateur: ">", droite: macdSignal() }],
    reglesSortie: [{ type: "comparaison", gauche: macdLigne(), comparateur: "<", droite: macdSignal() }],
    builtin: true,
  },
  {
    id: "builtin:supertrend",
    name: "Supertrend (direction)",
    tf: "4h",
    direction: "long",
    tailleFixe: 1000,
    stopPct: null,
    targetPct: null,
    reglesEntree: [{ type: "comparaison", gauche: supertrendDir(), comparateur: ">", droite: constante(0) }],
    reglesSortie: [{ type: "comparaison", gauche: supertrendDir(), comparateur: "<", droite: constante(0) }],
    builtin: true,
  },
  {
    id: "builtin:bollinger-reversion",
    name: "Bollinger réversion",
    tf: "4h",
    direction: "long",
    tailleFixe: 1000,
    stopPct: 5,
    targetPct: null,
    reglesEntree: [{ type: "croisement", a: prixClose, b: bollLower(), sens: "hausse" }],
    reglesSortie: [{ type: "comparaison", gauche: prixClose, comparateur: ">=", droite: bollBasis() }],
    builtin: true,
  },
  {
    id: "builtin:mm-adx",
    name: "EMA 9 > 21 + ADX ≥ 25",
    tf: "4h",
    direction: "long",
    tailleFixe: 1000,
    stopPct: 5,
    targetPct: null,
    reglesEntree: [
      { type: "comparaison", gauche: ema(9), comparateur: ">", droite: ema(21) },
      { type: "comparaison", gauche: adx14(), comparateur: ">=", droite: constante(25) },
    ],
    reglesSortie: [
      { type: "comparaison", gauche: ema(9), comparateur: "<", droite: ema(21) },
      { type: "comparaison", gauche: adx14(), comparateur: ">=", droite: constante(25) },
    ],
    builtin: true,
  },
  // Les trois presets v2.6 expriment les stratégies chart du même nom (Lot B) —
  // mesurées et RECALÉES par la campagne, d'où le « (non validé) » conservé
  // dans le nom affiché (principe d'honnêteté de la spec v2.6 §5).
  // Limite du conjonctif assumée : leurs defs sortent quand N'IMPORTE QUELLE
  // condition se retourne (OU), inexprimable en listes ET — la sortie retenue
  // est le DÉCLENCHEUR inverse seul, le stop 5 % sert de filet quand c'est le
  // filtre qui lâche en premier.
  {
    id: "builtin:macd-supertrend",
    name: "MACD + direction Supertrend (non validé)",
    tf: "4h",
    direction: "long",
    tailleFixe: 1000,
    stopPct: 5,
    targetPct: null,
    reglesEntree: [
      { type: "comparaison", gauche: macdLigne(), comparateur: ">", droite: macdSignal() },
      { type: "comparaison", gauche: supertrendDir(), comparateur: ">", droite: constante(0) },
    ],
    reglesSortie: [{ type: "comparaison", gauche: macdLigne(), comparateur: "<", droite: macdSignal() }],
    builtin: true,
  },
  {
    id: "builtin:triple-confirmation",
    name: "Triple confirmation ST+MACD+RSI (non validé)",
    tf: "4h",
    direction: "long",
    tailleFixe: 1000,
    stopPct: 5,
    targetPct: null,
    reglesEntree: [
      { type: "comparaison", gauche: supertrendDir(), comparateur: ">", droite: constante(0) },
      { type: "comparaison", gauche: macdLigne(), comparateur: ">", droite: macdSignal() },
      { type: "comparaison", gauche: rsi14(), comparateur: ">", droite: constante(50) },
    ],
    reglesSortie: [{ type: "comparaison", gauche: macdLigne(), comparateur: "<", droite: macdSignal() }],
    builtin: true,
  },
  {
    id: "builtin:psar-adx",
    name: "PSAR + ADX ≥ 25 (non validé)",
    tf: "4h",
    direction: "long",
    tailleFixe: 1000,
    stopPct: 5,
    targetPct: null,
    reglesEntree: [
      { type: "comparaison", gauche: prixClose, comparateur: ">", droite: psarDefaut() },
      { type: "comparaison", gauche: adx14(), comparateur: ">=", droite: constante(25) },
    ],
    // Déclencheur inverse SEUL (pas de gate ADX répété) : répéter le gate
    // bloquerait la sortie tout le temps que le range dure (quirk mm-adx),
    // alors que la def chart est flat forcé dès ADX < 25 — le déclencheur
    // seul est strictement plus proche du comportement chart.
    reglesSortie: [{ type: "comparaison", gauche: prixClose, comparateur: "<", droite: psarDefaut() }],
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
  stopAtr: { length: number; mult: number } | null;
  risquePct: number | null;
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
  setStopAtr: (v: { length: number; mult: number } | null) => void;
  setRisquePct: (v: number | null) => void;
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
  /**
   * Signature de la configuration qui a PRODUIT `resultat`. Comparée à la config
   * courante, elle dit si les stats affichées décrivent encore ce que montre le
   * builder — aucun setter n'invalidait le résultat, et il y en a quatorze
   * (cf. store/backtestSignature.ts).
   */
  signatureRun: string | null;
  error: string | null;
  note: string | null;
  /** Dernier nombre de bougies accumulées (run ou précharge 2a/1d) ; null = jamais. */
  nbBougiesChargees: number | null;
  run: () => void;
  /** Précharge 2 ans de 1d pour le symbole courant (cache daemon + REST). */
  charger2ans1d: () => void;
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

/** Extrait de l'état la configuration qui décide du résultat d'un run. */
export function configCourante(s: BacktestState): ConfigRun {
  return {
    symbol: s.symbol,
    tf: s.tf,
    plage: s.plage,
    direction: s.direction,
    tailleFixe: s.tailleFixe,
    stopPct: s.stopPct,
    targetPct: s.targetPct,
    stopAtr: s.stopAtr,
    risquePct: s.risquePct,
    fraisPct: s.fraisPct,
    slippagePct: s.slippagePct,
    capitalInitial: s.capitalInitial,
    reglesEntree: s.reglesEntree,
    reglesSortie: s.reglesSortie,
  };
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
  stopAtr: null,
  risquePct: null,
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
  setStopPct: (v) => set({ stopPct: v, stopAtr: v !== null ? null : get().stopAtr }),
  setTargetPct: (v) => set({ targetPct: v }),
  setStopAtr: (v) => set({ stopAtr: v, stopPct: v !== null ? null : get().stopPct }),
  setRisquePct: (v) => set({ risquePct: v }),
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
      stopAtr: preset.stopAtr ?? null,
      risquePct: preset.risquePct ?? null,
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
      stopAtr: s.stopAtr,
      risquePct: s.risquePct,
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
  signatureRun: null,
  error: null,
  note: null,
  nbBougiesChargees: null,

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
          nbBougiesChargees: candles.length,
          error:
            `Trop peu de bougies (${candles.length} < ${MIN_BOUGIES}). ` +
            `Utilise « Charger 2 ans 1d », élargis la plage ou change de TF.`,
        });
        return;
      }

      const profondeurFaible = candles.length < SEUIL_PROFONDEUR_BT;
      const noteBase = `${candles.length} bougies · ${s.symbol} ${s.tf}`;
      set({
        phase: "calcul",
        nbBougiesChargees: candles.length,
        note: profondeurFaible
          ? `${noteBase} · profondeur faible (< ${SEUIL_PROFONDEUR_BT}) — « Charger 2 ans 1d » recommandé`
          : noteBase,
      });

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
          set({
            phase: "done",
            resultat: msg.resultat,
            signatureRun: signatureRun(configCourante(get())),
          });
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
        ...(s.stopAtr !== null ? { stopAtr: s.stopAtr } : s.stopPct !== null ? { stopPct: s.stopPct } : {}),
        ...(s.targetPct !== null ? { targetPct: s.targetPct } : {}),
        ...(s.risquePct !== null ? { risquePct: s.risquePct } : {}),
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

  charger2ans1d: () => {
    abort?.abort();
    terminateWorker();
    const runId = ++currentRunId;
    const s = get();
    // Figé le builder sur la config d'acceptation C3 (2a / 1d).
    set({
      tf: "1d",
      plage: "2a",
      phase: "chargement",
      progress: { recuperees: 0, cible: 0 },
      resultat: null,
      error: null,
      note: `Précharge 2 ans 1d · ${s.symbol}…`,
    });

    const ctrl = new AbortController();
    abort = ctrl;
    void (async () => {
      let candles: Candle[];
      try {
        candles = await precharger2ans1d(s.symbol, {
          signal: ctrl.signal,
          onProgress: (p) => {
            if (runId === currentRunId) set({ progress: p });
          },
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (runId !== currentRunId) return;
        set({ phase: "error", error: "Précharge 2 ans 1d indisponible (Binance)." });
        return;
      }
      if (runId !== currentRunId) return;
      const ok = candles.length >= SEUIL_PROFONDEUR_BT;
      set({
        phase: ok ? "idle" : "error",
        nbBougiesChargees: candles.length,
        progress: { recuperees: candles.length, cible: candles.length },
        note: ok
          ? `${candles.length} bougies 1d en cache · ${s.symbol} (2 ans) — prêt pour le backtest`
          : null,
        error: ok
          ? null
          : `Série encore trop courte (${candles.length} < ${SEUIL_PROFONDEUR_BT}). ` +
            `Vérifie le symbole ou relance « Charger 2 ans 1d ».`,
      });
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
