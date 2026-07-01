import { createStore } from "zustand/vanilla";

export const MACRO_OVERLAYS = ["crypto-total", "stablecoins", "m2"] as const;
export type MacroOverlayId = (typeof MACRO_OVERLAYS)[number];

export interface MacroOverlayState {
  enabled: MacroOverlayId[];
  toggle: (id: MacroOverlayId) => void;
  setEnabled: (ids: MacroOverlayId[]) => void;
}

function unique(ids: MacroOverlayId[]): MacroOverlayId[] {
  return MACRO_OVERLAYS.filter((id) => ids.includes(id));
}

export const macroOverlayStore = createStore<MacroOverlayState>((set, get) => ({
  enabled: [],

  toggle: (id) => {
    const current = get().enabled;
    set({ enabled: current.includes(id) ? current.filter((x) => x !== id) : [...current, id] });
  },

  setEnabled: (ids) => set({ enabled: unique(ids) }),
}));
