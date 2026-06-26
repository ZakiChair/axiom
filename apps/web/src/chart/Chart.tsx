/**
 * Chart — intégration impérative de KLineChart (API v9.8.x confirmée via context7 / d.ts).
 *
 * Flux : à chaque changement symbole/TF on (1) init l'instance, (2) backfill REST ->
 * applyNewData, puis (3) souscription WS -> updateData sur chaque kline. Les ticks
 * live sont appliqués DIRECTEMENT sur l'instance (aucun re-render React). Au
 * changement symbole/TF ou au démontage : unsubscribe WS + dispose.
 */
import { useEffect, useRef } from "react";
import { dispose, init } from "klinecharts";
import type { KLineData } from "klinecharts";
import { useStore } from "zustand";
import type { Candle, Unsubscribe } from "@axiom/types";
import { getAdapter } from "../data/adapters";
import { marketStore } from "../store/market";
import { indicatorsStore } from "../store/indicators";
import { orderflowStore } from "../store/orderflow";
import { ChartIndicators } from "./indicators";
import { OrderflowController } from "./orderflow";

/** Candle (@axiom/types) -> KLineData (KLineChart). */
function toKLineData(c: Candle): KLineData {
  return {
    timestamp: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  };
}

export function Chart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const exchange = useStore(marketStore, (s) => s.exchange);
  const symbol = useStore(marketStore, (s) => s.symbol);
  const timeframe = useStore(marketStore, (s) => s.timeframe);

  useEffect(() => {
    const container = containerRef.current;
    const chartDom = chartRef.current;
    const canvas = canvasRef.current;
    if (!container || !chartDom || !canvas) return;

    const chart = init(chartDom);
    if (!chart) return;

    // Thème sombre minimal : la couleur de fond vient du conteneur (canvas transparent),
    // on ajuste seulement la grille et le texte des axes pour la lisibilité.
    chart.setStyles({
      grid: {
        horizontal: { color: "#1f2937" },
        vertical: { color: "#1f2937" },
      },
      xAxis: { tickText: { color: "#9ca3af" } },
      yAxis: { tickText: { color: "#9ca3af" } },
    });

    // Contrôleur d'indicateurs @axiom (source de vérité du calcul = @axiom/indicators).
    const indicators = new ChartIndicators(chart);

    // Re-synchronise overlays/panes quand la sélection d'indicateurs change (toggle
    // du panneau) — impératif, hors render-loop React.
    const unsubscribeIndicators = indicatorsStore.subscribe((state) => {
      indicators.sync(state.indicators, marketStore.getState().candles);
    });

    // Contrôleur orderflow (M5) : CVD (sous-pane) + footprint (canvas overlay).
    // Le drapeau d'activation vient du orderflowStore (toggle « Orderflow »).
    const orderflow = new OrderflowController(chart, container, canvas, symbol);
    orderflow.setEnabled(orderflowStore.getState().enabled);
    const unsubscribeOrderflow = orderflowStore.subscribe((state) => {
      orderflow.setEnabled(state.enabled);
    });

    let cancelled = false;
    let unsubscribe: Unsubscribe | null = null;

    // Adaptateur de la source courante (Binance/Kraken/Coinbase).
    const adapter = getAdapter(exchange);

    // 1) Backfill REST, puis 2) live WS.
    adapter
      .fetchKlines(symbol, timeframe, { limit: 500 })
      .then((candles) => {
        if (cancelled) return; // symbole/TF déjà changé : on abandonne ce backfill.
        marketStore.getState().setCandles(candles);
        chart.applyNewData(candles.map(toKLineData));

        // Applique les indicateurs actifs (restaurés depuis localStorage) au graphe.
        indicators.sync(indicatorsStore.getState().indicators, candles);

        // Backfill prêt : reseed le CVD et lance le flux de trades si actif.
        orderflow.onCandles();

        unsubscribe = adapter.subscribeKline(symbol, timeframe, (candle) => {
          marketStore.getState().upsertCandle(candle);
          chart.updateData(toKLineData(candle)); // mise à jour impérative, pas de re-render.

          // CVD live : rafraîchi à chaque tick kline (impératif, hors render React).
          orderflow.onTick();

          // Recalcul des indicateurs à CHAQUE bougie clôturée (cf. BUILD-CONTRACT).
          if (candle.closed) {
            indicators.recompute(
              indicatorsStore.getState().indicators,
              marketStore.getState().candles
            );
          }
        });
      })
      .catch((err) => {
        console.error("[AXIOM] Échec du backfill Binance", err);
      });

    return () => {
      cancelled = true;
      unsubscribeIndicators();
      unsubscribeOrderflow();
      orderflow.dispose(); // ferme le WS aggTrade + retire le pane CVD AVANT dispose.
      if (unsubscribe) unsubscribe();
      dispose(chart); // détruit panes + indicateurs ; pas de removeIndicator manuel.
    };
  }, [exchange, symbol, timeframe]);

  return (
    // Conteneur relatif : le graphe le remplit (absolute inset-0), le canvas
    // footprint se superpose (pointer-events:none -> pan/zoom passent au graphe).
    <div ref={containerRef} className="relative h-full w-full">
      <div ref={chartRef} className="absolute inset-0" />
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0"
        style={{ display: "none" }}
      />
    </div>
  );
}
