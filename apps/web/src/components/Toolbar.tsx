/**
 * Toolbar — sélecteurs source / symbole / timeframe, branchés sur le store marché vanilla.
 * Un changement re-déclenche backfill + souscription côté Chart (effet [exchange, symbol, tf]).
 */
import { useStore } from "zustand";
import type { ExchangeId, Timeframe } from "@axiom/types";
import { marketStore } from "../store/market";
import { orderflowStore } from "../store/orderflow";
import { volumeProfileStore } from "../store/volumeProfile";
import { SUPPORTED_TIMEFRAMES } from "../data/adapters";
import { IndicatorMenu } from "./IndicatorMenu";
import { PairSearch } from "./PairSearch";
import { ThemeSwitcher } from "./ThemeSwitcher";

const SYMBOL_PRESETS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"] as const;
// "m" = minute, "M" = mois (1M/3M/6M/12M). 1w & 1M sont natifs Binance ;
// 3M/6M/12M sont agrégés côté client depuis le mensuel (voir binance.ts).
const TIMEFRAMES: Timeframe[] = [
  "1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M", "3M", "6M", "12M",
];

/** Sources câblées (LOT 4) + libellés affichés. */
const EXCHANGES: { id: ExchangeId; label: string }[] = [
  { id: "binance", label: "Binance" },
  { id: "kraken", label: "Kraken" },
  { id: "coinbase", label: "Coinbase" },
];

/** Libellé d'une source (pour les infobulles de grisage). */
function exchangeLabel(id: ExchangeId): string {
  return EXCHANGES.find((e) => e.id === id)?.label ?? id;
}

export function Toolbar() {
  const exchange = useStore(marketStore, (s) => s.exchange);
  const symbol = useStore(marketStore, (s) => s.symbol);
  const timeframe = useStore(marketStore, (s) => s.timeframe);
  const setExchange = useStore(marketStore, (s) => s.setExchange);
  const setSymbol = useStore(marketStore, (s) => s.setSymbol);
  const setTimeframe = useStore(marketStore, (s) => s.setTimeframe);
  const orderflowEnabled = useStore(orderflowStore, (s) => s.enabled);
  const toggleOrderflow = useStore(orderflowStore, (s) => s.toggle);
  const vpEnabled = useStore(volumeProfileStore, (s) => s.enabled);
  const toggleVp = useStore(volumeProfileStore, (s) => s.toggle);

  const supportedTf = SUPPORTED_TIMEFRAMES[exchange] ?? [];
  const isBinance = exchange === "binance";

  /**
   * Changement de source : si le TF courant n'est pas supporté par la nouvelle source,
   * on retombe sur 1h (commun aux trois). L'orderflow suit désormais la source active
   * (le footprint marche partout ; le CVD-par-bougie est complet là où les klines
   * portent le volume taker — Binance/Coinbase — et plat sur Kraken).
   */
  const onChangeExchange = (next: ExchangeId) => {
    setExchange(next);
    const supported = SUPPORTED_TIMEFRAMES[next] ?? [];
    if (!supported.includes(timeframe)) setTimeframe("1h");
  };

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-neutral-800 bg-neutral-950 px-4 py-2">
      <span className="axiom-wordmark font-semibold tracking-wide text-text">AXIOM</span>

      {/* Sélecteur de source. */}
      <select
        value={exchange}
        onChange={(e) => onChangeExchange(e.target.value as ExchangeId)}
        className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 outline-none focus:border-neutral-500"
        aria-label="Source"
      >
        {EXCHANGES.map((ex) => (
          <option key={ex.id} value={ex.id}>
            {ex.label}
          </option>
        ))}
      </select>

      {/* Recherche de paires (catalogue de la source courante) + saisie libre. */}
      <PairSearch />

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

      {/* Sélecteur de timeframe (grisé si non supporté par la source). */}
      <div className="flex gap-1">
        {TIMEFRAMES.map((tf) => {
          const unsupported = !supportedTf.includes(tf);
          return (
            <button
              key={tf}
              type="button"
              disabled={unsupported}
              onClick={() => setTimeframe(tf)}
              title={unsupported ? `non supporté par ${exchangeLabel(exchange)}` : undefined}
              className={`rounded px-2 py-1 text-xs ${
                unsupported
                  ? "cursor-not-allowed bg-neutral-900 text-neutral-700"
                  : timeframe === tf
                    ? "bg-emerald-500 text-neutral-950"
                    : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
              }`}
            >
              {tf}
            </button>
          );
        })}
      </div>

      <div className="mx-1 h-5 w-px bg-neutral-800" />

      {/* Panneau des indicateurs @axiom (activer/désactiver). */}
      <IndicatorMenu />

      {/* Orderflow (M5) : CVD + footprint, alimenté par le flux de trades de la
          source active. Footprint sur les 3 sources ; CVD complet sur
          Binance/Coinbase (klines à volume taker), plat sur Kraken. */}
      <button
        type="button"
        onClick={toggleOrderflow}
        aria-pressed={orderflowEnabled}
        title={
          isBinance
            ? undefined
            : "Footprint complet ; CVD limité hors Binance/Coinbase"
        }
        className={`rounded px-2 py-1 text-xs ${
          orderflowEnabled
            ? "bg-cyan-500 text-neutral-950"
            : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
        }`}
      >
        Orderflow
      </button>

      {/* Profil de volume par zone de prix (VPVR) — toutes sources. */}
      <button
        type="button"
        onClick={toggleVp}
        aria-pressed={vpEnabled}
        title="Volume par zone de prix (plage visible)"
        className={`rounded px-2 py-1 text-xs ${
          vpEnabled
            ? "bg-amber-500 text-neutral-950"
            : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
        }`}
      >
        Profil Vol
      </button>

      {/* Sélecteur de thème (poussé à droite). */}
      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs text-neutral-500">Thème</span>
        <ThemeSwitcher />
      </div>
    </header>
  );
}
