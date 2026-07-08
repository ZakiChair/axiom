/**
 * Store clé Etherscan v2 (réseau ETH — gas, supply, nœuds — panneau CHAIN) — Zustand VANILLA.
 * Clé OBLIGATOIRE (pas de repli serveur .env, contrairement à FRED/Coinalyze) : le
 * module `data/onchain/etherscan.ts` refuse d'appeler l'API sans clé.
 */
import { createStore } from "zustand/vanilla";

const STORAGE_KEY = "axiom:etherscan:key";

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

export function getEtherscanKey(): string | null {
  return readKey();
}

export interface EtherscanKeyState {
  hasKey: boolean;
  setKey: (key: string) => void;
  clearKey: () => void;
}

export const etherscanKeyStore = createStore<EtherscanKeyState>((set) => ({
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
