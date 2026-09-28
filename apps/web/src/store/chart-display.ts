/** Préférence visuelle par vue ; aucune donnée de marché ni aucun calcul ne change. */
import { createStore } from "zustand/vanilla";
import type { ExchangeId } from "@axiom/types";

export const CHART_MODES = ["candles", "line", "area"] as const;
export type ChartDisplayMode = typeof CHART_MODES[number];
const CLE = "axiom:chartDisplay:v1";

export function preferencesAffichage(valeur: unknown): ChartDisplayMode[] {
  return Array.from({ length: 4 }, (_, slot) => {
    const mode: unknown = Array.isArray(valeur) ? valeur[slot] : undefined;
    return CHART_MODES.includes(mode as ChartDisplayMode) ? mode as ChartDisplayMode : "candles";
  });
}

/** Le footprint conserve les hauts/bas ; la préférence reprend ensuite sa place. */
export function modeEffectif(mode: ChartDisplayMode, footprint: boolean): ChartDisplayMode {
  return footprint ? "candles" : mode;
}

/** Même capacité que les commandes Orderflow : ces sources n'ont aucun flux de trades. */
export function footprintDisponible(exchange: ExchangeId): boolean {
  return exchange !== "twelvedata" && exchange !== "mexc" && exchange !== "synthetic";
}

function restaurer(): ChartDisplayMode[] {
  try { return preferencesAffichage(JSON.parse(localStorage.getItem(CLE) ?? "null")); }
  catch { return preferencesAffichage(null); }
}

export const chartDisplayStore = createStore<{
  modes: ChartDisplayMode[];
  setMode: (slot: number, mode: ChartDisplayMode) => void;
}>((set, get) => ({
  modes: restaurer(),
  setMode: (slot, mode) => {
    if (!Number.isInteger(slot) || slot < 0 || slot > 3 || !CHART_MODES.includes(mode)) return;
    const modes = [...get().modes];
    modes[slot] = mode;
    set({ modes });
    try { localStorage.setItem(CLE, JSON.stringify(modes)); } catch { /* stockage indisponible */ }
  },
}));
