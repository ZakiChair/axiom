/**
 * Store clé Etherscan v2 (réseau ETH — gas, supply, nœuds — panneau CHAIN) — Zustand VANILLA.
 * Clé OPTIONNELLE (même pattern que FRED/Coinalyze) : si saisie ici, elle part en query
 * param `apikey` et reste PRIORITAIRE ; sinon le proxy /ethscanapi injecte la clé de
 * repli ETHERSCAN_API_KEY lue dans apps/web/.env (voir data/onchain/etherscan.ts).
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
  /**
   * Compteur incrémenté à CHAQUE setKey/clearKey : remplacer une clé existante laisse
   * `hasKey` à true→true (aucune notification) — les effets qui doivent re-fetcher sur
   * changement de clé (OnchainWindow) s'abonnent à `version`, pas à `hasKey`.
   */
  version: number;
  setKey: (key: string) => void;
  clearKey: () => void;
}

export const etherscanKeyStore = createStore<EtherscanKeyState>((set) => ({
  hasKey: readKey() !== null,
  version: 0,
  setKey: (key) => {
    const k = key.trim();
    const value = k.length > 0 ? k : null;
    writeKey(value);
    set((s) => ({ hasKey: value !== null, version: s.version + 1 }));
  },
  clearKey: () => {
    writeKey(null);
    set((s) => ({ hasKey: false, version: s.version + 1 }));
  },
}));
