/**
 * Store clé SoSoValue (ETF flows BTC/ETH/SOL) — Zustand VANILLA.
 * Clé OPTIONNELLE (même pattern que FRED/Coinalyze) : si saisie ici, elle part en
 * en-tête x-soso-api-key et reste PRIORITAIRE ; sinon le proxy /sosoapi injecte la
 * clé de repli SOSOVALUE_API_KEY lue dans apps/web/.env (voir data/onchain/etf.ts).
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
  /**
   * Compteur incrémenté à CHAQUE setKey/clearKey : remplacer une clé existante laisse
   * `hasKey` à true→true (aucune notification) — les effets qui doivent re-fetcher sur
   * changement de clé (OnchainWindow) s'abonnent à `version`, pas à `hasKey`.
   */
  version: number;
  setKey: (key: string) => void;
  clearKey: () => void;
}

export const soSoValueKeyStore = createStore<SoSoValueKeyState>((set) => ({
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
