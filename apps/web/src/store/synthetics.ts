import { createStore } from "zustand/vanilla";
import { parseSyntheticSymbol } from "../data/synthetic";

export const SYNTHETIC_PRESETS: { label: string; symbol: string }[] = [
  { label: "ETH / BTC", symbol: "binance:ETHUSDT|/|binance:BTCUSDT" },
  { label: "SOL / BTC", symbol: "binance:SOLUSDT|/|binance:BTCUSDT" },
  { label: "BNB / BTC", symbol: "binance:BNBUSDT|/|binance:BTCUSDT" },
  { label: "BTC / DXY (proxy UUP)", symbol: "binance:BTCUSDT|/|twelvedata:UUP" },
  { label: "BTC / OR (proxy GLD)", symbol: "binance:BTCUSDT|/|twelvedata:GLD" },
];

export interface SyntheticsState {
  recents: string[];
  addRecent: (symbol: string) => void;
  setRecents: (symbols: string[]) => void;
}

function normalizeRecents(symbols: string[]): string[] {
  const out: string[] = [];
  for (const symbol of symbols) {
    if (parseSyntheticSymbol(symbol) === null) continue;
    if (!out.includes(symbol)) out.push(symbol);
    if (out.length >= 8) break;
  }
  return out;
}

export const syntheticsStore = createStore<SyntheticsState>((set, get) => ({
  recents: [],

  addRecent: (symbol) => {
    if (parseSyntheticSymbol(symbol) === null) return;
    set({ recents: normalizeRecents([symbol, ...get().recents.filter((s) => s !== symbol)]) });
  },

  setRecents: (symbols) => set({ recents: normalizeRecents(symbols) }),
}));
