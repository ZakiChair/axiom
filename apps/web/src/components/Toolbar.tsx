/**
 * Toolbar — sélecteurs symbole et timeframe, branchés sur le store marché vanilla.
 * Un changement re-déclenche backfill + souscription côté Chart (effet [symbol, tf]).
 */
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { Timeframe } from "@axiom/types";
import { marketStore } from "../store/market";
import { orderflowStore } from "../store/orderflow";
import { IndicatorMenu } from "./IndicatorMenu";

const SYMBOL_PRESETS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"] as const;
// "m" = minute, "M" = mois (1M/3M/6M/12M). 1w & 1M sont natifs Binance ;
// 3M/6M/12M sont agrégés côté client depuis le mensuel (voir binance.ts).
const TIMEFRAMES: Timeframe[] = [
  "1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M", "3M", "6M", "12M",
];

export function Toolbar() {
  const symbol = useStore(marketStore, (s) => s.symbol);
  const timeframe = useStore(marketStore, (s) => s.timeframe);
  const setSymbol = useStore(marketStore, (s) => s.setSymbol);
  const setTimeframe = useStore(marketStore, (s) => s.setTimeframe);
  const orderflowEnabled = useStore(orderflowStore, (s) => s.enabled);
  const toggleOrderflow = useStore(orderflowStore, (s) => s.toggle);

  // Brouillon local du champ texte ; synchronisé si le symbole change ailleurs (presets).
  const [draft, setDraft] = useState(symbol);
  useEffect(() => setDraft(symbol), [symbol]);

  const submitSymbol = () => {
    const value = draft.trim();
    if (value.length > 0) setSymbol(value);
  };

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-neutral-800 bg-neutral-950 px-4 py-2">
      <span className="font-semibold tracking-wide text-neutral-100">AXIOM</span>

      {/* Champ symbole libre (validation à Entrée ou à la perte de focus). */}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value.toUpperCase())}
        onKeyDown={(e) => {
          if (e.key === "Enter") submitSymbol();
        }}
        onBlur={submitSymbol}
        spellCheck={false}
        className="w-32 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 outline-none focus:border-neutral-500"
        aria-label="Symbole"
      />

      {/* Presets symbole. */}
      <div className="flex gap-1">
        {SYMBOL_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => setSymbol(preset)}
            className={`rounded px-2 py-1 text-xs ${
              symbol === preset
                ? "bg-neutral-200 text-neutral-900"
                : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
            }`}
          >
            {preset}
          </button>
        ))}
      </div>

      <div className="mx-1 h-5 w-px bg-neutral-800" />

      {/* Sélecteur de timeframe. */}
      <div className="flex gap-1">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            type="button"
            onClick={() => setTimeframe(tf)}
            className={`rounded px-2 py-1 text-xs ${
              timeframe === tf
                ? "bg-emerald-500 text-neutral-950"
                : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
            }`}
          >
            {tf}
          </button>
        ))}
      </div>

      <div className="mx-1 h-5 w-px bg-neutral-800" />

      {/* Panneau des indicateurs @axiom (activer/désactiver). */}
      <IndicatorMenu />

      {/* Orderflow (M5) : active/désactive CVD (sous-pane) + footprint (canvas). */}
      <button
        type="button"
        onClick={toggleOrderflow}
        aria-pressed={orderflowEnabled}
        className={`rounded px-2 py-1 text-xs ${
          orderflowEnabled
            ? "bg-cyan-500 text-neutral-950"
            : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
        }`}
      >
        Orderflow
      </button>
    </header>
  );
}
