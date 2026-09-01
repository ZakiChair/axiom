import { createStore } from "zustand/vanilla";

const STORAGE_KEY = "axiom:ccdata:key";

export function getCcDataApiKey(): string | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)?.trim() ?? "";
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeKey(key: string | null): void {
  try {
    if (key === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, key);
  } catch {
    return;
  }
}

export interface CcDataKeyState {
  hasKey: boolean;
  revision: number;
  setKey: (key: string) => void;
  clearKey: () => void;
}

export const ccdataKeyStore = createStore<CcDataKeyState>((set) => ({
  hasKey: getCcDataApiKey() !== null,
  revision: 0,
  setKey: (key) => {
    const trimmed = key.trim();
    const value = trimmed.length > 0 ? trimmed : null;
    writeKey(value);
    set((state) => ({ hasKey: value !== null, revision: state.revision + 1 }));
  },
  clearKey: () => {
    writeKey(null);
    set((state) => ({ hasKey: false, revision: state.revision + 1 }));
  },
}));
