/**
 * Store clé Finnhub (profil société, earnings — panneau FUND) — Zustand VANILLA.
 * Clé OBLIGATOIRE (pas de repli serveur .env, contrairement à FRED/Coinalyze) : le
 * module `data/fund/finnhub.ts` refuse d'appeler l'API sans clé.
 */
import { createStore } from "zustand/vanilla";

const STORAGE_KEY = "axiom:finnhub:key";

function readKey(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v !== null && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

function writeKey(key: string | null): void {
  try {
    if (key === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, key);
  } catch {
    /* best-effort */
  }
}

export function getFinnhubKey(): string | null {
  return readKey();
}

export interface FinnhubKeyState {
  hasKey: boolean;
  setKey: (key: string) => void;
  clearKey: () => void;
}

export const finnhubKeyStore = createStore<FinnhubKeyState>((set) => ({
  hasKey: readKey() !== null,
  setKey: (key) => {
    const k = key.trim();
    const value = k.length > 0 ? k : null;
    writeKey(value);
    set({ hasKey: value !== null });
  },
  clearKey: () => {
    writeKey(null);
    set({ hasKey: false });
  },
}));
