/**
 * Disposition multi-chart — Zustand VANILLA (hors render-loop React).
 *
 * Décrit la grille de graphes (Phase 4) : mode de disposition, configuration
 * (symbole/TF/source) des slots SECONDAIRES, slot focus et liaison des symboles.
 *
 * Modèle des slots :
 *  - Slot 0 = MAÎTRE : sa config est le `marketStore` GLOBAL (piloté par la toolbar,
 *    la palette, la watchlist…). Ce store NE le stocke donc PAS — il n'y a pas de
 *    double source de vérité pour le slot maître.
 *  - Slots 1..3 = SECONDAIRES : leur config vit ici (`slots[0..2]` ↔ positions 1..3),
 *    persistée. Chaque slot secondaire a son propre `createMarketStore()` monté par
 *    ChartGrid ; ce store-ci n'en garde que la config déclarative.
 *
 * Persistance : localStorage dédié (`axiom:chartLayout:v1`), auto-sauvegarde sur
 * changement — même patron que `store/theme` / `store/workspaces`, sans toucher à
 * `store/persist.ts` (hors périmètre). Pas de flux haute fréquence ici (BASSE fréq.).
 */
import { createStore } from "zustand/vanilla";
import { EXCHANGE_IDS, type ExchangeId, type Timeframe } from "@axiom/types";
import { supportedTimeframesFor } from "../data/adapters";
import { normalizeMarketSymbol } from "./market";

/** Modes de disposition : 1 seul, 2 côte-à-côte, 2 empilés, 2×2. */
export type ChartLayoutMode = "1" | "2h" | "2v" | "2x2";

/** Nombre de slots VISIBLES par mode (slot 0 inclus). */
export const VISIBLE_SLOTS: Record<ChartLayoutMode, number> = {
  "1": 1,
  "2h": 2,
  "2v": 2,
  "2x2": 4,
};

/** Nombre de slots visibles pour un mode (fonction pure, testée). */
export function visibleSlotCount(mode: ChartLayoutMode): number {
  return VISIBLE_SLOTS[mode];
}

/**
 * Autres slots VISIBLES que `source` (cibles d'une propagation de symbole quand la
 * liaison est active). Fonction PURE (testée) : ChartGrid l'utilise pour router le
 * changement de symbole vers le marketStore global (slot 0) ou vers ce store (1..3).
 */
export function linkedTargets(source: number, mode: ChartLayoutMode): number[] {
  const count = visibleSlotCount(mode);
  const out: number[] = [];
  for (let i = 0; i < count; i++) if (i !== source) out.push(i);
  return out;
}

/** Configuration déclarative d'un slot secondaire. */
export interface SlotConfig {
  exchange: ExchangeId;
  symbol: string;
  timeframe: Timeframe;
}

/** Config par défaut des 3 slots secondaires (positions 1,2,3) — symboles distincts. */
const DEFAULT_SLOTS: [SlotConfig, SlotConfig, SlotConfig] = [
  { exchange: "binance", symbol: "ETHUSDT", timeframe: "1m" },
  { exchange: "binance", symbol: "SOLUSDT", timeframe: "1m" },
  { exchange: "binance", symbol: "BNBUSDT", timeframe: "1m" },
];

export interface ChartLayoutState {
  layout: ChartLayoutMode;
  /** Config des slots SECONDAIRES : index 0..2 ↔ positions de grille 1..3. */
  slots: [SlotConfig, SlotConfig, SlotConfig];
  /** Slot focus (0 = maître). Toujours borné aux slots visibles du mode courant. */
  focus: number;
  /** Liaison des symboles : changer un symbole propage aux autres slots visibles. */
  linked: boolean;

  setLayout: (mode: ChartLayoutMode) => void;
  setFocus: (slot: number) => void;
  toggleLinked: () => void;
  /** Modifie la config d'un slot SECONDAIRE (index de grille 1..3). */
  setSlotMarket: (slot: number, config: SlotConfig) => void;
  setSlotSymbol: (slot: number, symbol: string) => void;
  setSlotTimeframe: (slot: number, timeframe: Timeframe) => void;
  setSlotExchange: (slot: number, exchange: ExchangeId) => void;
}

const STORAGE_KEY = "axiom:chartLayout:v1";

/** Forme persistée (sous-ensemble sérialisable de l'état). */
interface Persisted {
  layout: ChartLayoutMode;
  slots: [SlotConfig, SlotConfig, SlotConfig];
  linked: boolean;
}

const LAYOUT_MODES: readonly ChartLayoutMode[] = ["1", "2h", "2v", "2x2"];
/** Sources restaurables. Dérivé de la source de vérité unique `EXCHANGE_IDS` (@axiom/types) — plus de copie locale. */
const RESTORABLE_EXCHANGES: readonly ExchangeId[] = [...EXCHANGE_IDS];

/**
 * Valide intégralement une configuration issue du stockage. Une valeur TypeScript
 * castée depuis JSON n'est pas une preuve runtime : une source inconnue faisait lever
 * `getAdapter()` au montage et pouvait faire tomber toute la grille.
 */
export function sanitizeSlotConfig(raw: unknown, fallback: SlotConfig): SlotConfig {
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.exchange === "string" &&
    !(RESTORABLE_EXCHANGES as readonly string[]).includes(o.exchange)
  ) {
    return fallback;
  }
  const exchange =
    typeof o.exchange === "string" && (RESTORABLE_EXCHANGES as readonly string[]).includes(o.exchange)
      ? (o.exchange as ExchangeId)
      : fallback.exchange;
  const rawSymbol = typeof o.symbol === "string" ? o.symbol.trim() : "";
  const symbol =
    rawSymbol.length > 0 && rawSymbol.length <= 200
      ? normalizeMarketSymbol(rawSymbol)
      : fallback.symbol;
  const supported = supportedTimeframesFor(exchange, symbol);
  // Un synthétique illisible (ou toute combinaison sans capacité) est rejeté en bloc.
  if (supported.length === 0) return fallback;
  const fallbackTimeframe = supported.includes(fallback.timeframe)
    ? fallback.timeframe
    : (supported[0] ?? "1m");
  const timeframe =
    typeof o.timeframe === "string" && (supported as readonly string[]).includes(o.timeframe)
      ? (o.timeframe as Timeframe)
      : fallbackTimeframe;
  return { exchange, symbol, timeframe };
}

/** Lecture tolérante de l'état persisté (localStorage indispo / JSON corrompu → défauts). */
function hydrate(): Persisted {
  const base: Persisted = { layout: "1", slots: DEFAULT_SLOTS, linked: false };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Record<string, unknown>;
    const layout =
      typeof p.layout === "string" && (LAYOUT_MODES as string[]).includes(p.layout)
        ? (p.layout as ChartLayoutMode)
        : "1";
    const slotsRaw = Array.isArray(p.slots) ? p.slots : [];
    const slots: [SlotConfig, SlotConfig, SlotConfig] = [
      sanitizeSlotConfig(slotsRaw[0], DEFAULT_SLOTS[0]),
      sanitizeSlotConfig(slotsRaw[1], DEFAULT_SLOTS[1]),
      sanitizeSlotConfig(slotsRaw[2], DEFAULT_SLOTS[2]),
    ];
    return { layout, slots, linked: p.linked === true };
  } catch {
    return base;
  }
}

/** Écriture tolérante (quota / mode privé → silencieux). */
function persist(state: ChartLayoutState): void {
  try {
    const payload: Persisted = {
      layout: state.layout,
      slots: state.slots,
      linked: state.linked,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* best-effort : la persistance de la disposition n'est pas bloquante */
  }
}

/** Borne un index de focus aux slots visibles du mode. */
function clampFocus(focus: number, mode: ChartLayoutMode): number {
  const count = visibleSlotCount(mode);
  if (focus < 0) return 0;
  if (focus >= count) return count - 1;
  return focus;
}

/** Remplace la config d'un slot SECONDAIRE (grille 1..3) ; index invalide → inchangé. */
function patchSlot(
  slots: [SlotConfig, SlotConfig, SlotConfig],
  gridSlot: number,
  patch: Partial<SlotConfig>
): [SlotConfig, SlotConfig, SlotConfig] {
  const i = gridSlot - 1; // 1..3 → 0..2
  if (i < 0 || i > 2) return slots;
  const cur = slots[i];
  if (cur === undefined) return slots;
  const next = slots.slice() as [SlotConfig, SlotConfig, SlotConfig];
  next[i] = sanitizeSlotConfig({
    exchange: patch.exchange ?? cur.exchange,
    symbol: patch.symbol !== undefined ? normalizeMarketSymbol(patch.symbol) : cur.symbol,
    timeframe: patch.timeframe ?? cur.timeframe,
  }, cur);
  return next;
}

const initial = hydrate();

export const chartLayoutStore = createStore<ChartLayoutState>((set, get) => ({
  layout: initial.layout,
  slots: initial.slots,
  focus: clampFocus(0, initial.layout),
  linked: initial.linked,

  setLayout: (mode) =>
    set((s) => ({ layout: mode, focus: clampFocus(s.focus, mode) })),

  setFocus: (slot) => set((s) => ({ focus: clampFocus(slot, s.layout) })),

  toggleLinked: () => set((s) => ({ linked: !s.linked })),

  setSlotMarket: (slot, config) =>
    set((s) => ({ slots: patchSlot(s.slots, slot, config) })),

  setSlotSymbol: (slot, symbol) => {
    const s = get();
    if (symbol.trim().length === 0) return;
    set({ slots: patchSlot(s.slots, slot, { symbol: symbol.trim() }) });
  },

  setSlotTimeframe: (slot, timeframe) =>
    set((s) => ({ slots: patchSlot(s.slots, slot, { timeframe }) })),

  setSlotExchange: (slot, exchange) =>
    set((s) => ({ slots: patchSlot(s.slots, slot, { exchange }) })),
}));

// Auto-sauvegarde (BASSE fréquence) — même patron que store/theme / store/workspaces.
chartLayoutStore.subscribe((state) => persist(state));
