import { createStore } from "zustand/vanilla";
import { estSymboleCapitalisation } from "../data/mcap";
import { parseSyntheticSymbol } from "../data/synthetic";

export const SYNTHETIC_PRESETS: { label: string; symbol: string }[] = [
  { label: "TOTAL", symbol: "TOTAL" },
  { label: "TOTAL2 · hors BTC", symbol: "TOTAL2" },
  { label: "TOTAL3 · hors BTC et ETH", symbol: "TOTAL3" },
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

function estSymboleSynthetiqueValide(symbol: string): boolean {
  return estSymboleCapitalisation(symbol) || parseSyntheticSymbol(symbol) !== null;
}

function normalizeRecents(symbols: string[]): string[] {
  const out: string[] = [];
  for (const symbol of symbols) {
    if (!estSymboleSynthetiqueValide(symbol)) continue;
    if (!out.includes(symbol)) out.push(symbol);
    if (out.length >= 8) break;
  }
  return out;
}

export const syntheticsStore = createStore<SyntheticsState>((set, get) => ({
  recents: [],

  addRecent: (symbol) => {
    if (!estSymboleSynthetiqueValide(symbol)) return;
    set({ recents: normalizeRecents([symbol, ...get().recents.filter((s) => s !== symbol)]) });
  },

  setRecents: (symbols) => set({ recents: normalizeRecents(symbols) }),
}));
