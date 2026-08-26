import { createStore } from "zustand/vanilla";
import { setTwelveDataApiKey } from "../data/twelvedata";

const STORAGE_KEY = "axiom:twelvedata:key";

function readKey(): string | null {
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

export interface TwelveDataKeyState {
  hasKey: boolean;
  setKey: (key: string) => void;
  clearKey: () => void;
}

function hydrateKey(): boolean {
  const key = readKey();
  setTwelveDataApiKey(key);
  return key !== null;
}

const hasPersistedKey = hydrateKey();

export const twelveDataKeyStore = createStore<TwelveDataKeyState>((set) => ({
  hasKey: hasPersistedKey,
  setKey: (key) => {
    const trimmed = key.trim();
    const value = trimmed.length > 0 ? trimmed : null;
    writeKey(value);
    setTwelveDataApiKey(value);
    set({ hasKey: value !== null });
  },
  clearKey: () => {
    writeKey(null);
    setTwelveDataApiKey(null);
    set({ hasKey: false });
  },
}));
