/**
 * Store clé SoSoValue (ETF flows BTC/ETH/SOL) — Zustand VANILLA.
 * Clé OBLIGATOIRE (pas de repli serveur .env, contrairement à FRED/Coinalyze) : le
 * module `data/onchain/etf.ts` refuse d'appeler l'API sans clé et renvoie
 * `disponible:false, raison:"clé SoSoValue non configurée"`.
 */
import { createStore } from "zustand/vanilla";

const STORAGE_KEY = "axiom:sosovalue:key";

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

export function getSoSoValueKey(): string | null {
  return readKey();
}

export interface SoSoValueKeyState {
  hasKey: boolean;
  setKey: (key: string) => void;
  clearKey: () => void;
}

export const soSoValueKeyStore = createStore<SoSoValueKeyState>((set) => ({
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
