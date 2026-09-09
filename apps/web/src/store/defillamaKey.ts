import { createStore } from "zustand/vanilla";

/** Hors `axiom:` : la sauvegarde historique ne doit jamais exporter ce secret. */
export const DEFILLAMA_PRO_STORAGE_KEY = "axiom.defillama.proApiKey";

export function getDefillamaProKey(): string | null {
  try {
    const value = localStorage.getItem(DEFILLAMA_PRO_STORAGE_KEY)?.trim() ?? "";
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function ecrire(cle: string | null): void {
  try {
    if (cle === null) localStorage.removeItem(DEFILLAMA_PRO_STORAGE_KEY);
    else localStorage.setItem(DEFILLAMA_PRO_STORAGE_KEY, cle);
  } catch { /* best-effort */ }
}

export interface DefillamaKeyState {
  hasKey: boolean;
  version: number;
  setKey: (key: string) => void;
  clearKey: () => void;
}

export const defillamaKeyStore = createStore<DefillamaKeyState>((set) => ({
  hasKey: getDefillamaProKey() !== null,
  version: 0,
  setKey: (key) => {
    const value = key.trim() || null;
    ecrire(value);
    set((state) => ({ hasKey: value !== null, version: state.version + 1 }));
  },
  clearKey: () => {
    ecrire(null);
    set((state) => ({ hasKey: false, version: state.version + 1 }));
  },
}));
