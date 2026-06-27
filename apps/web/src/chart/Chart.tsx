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
import type { Chart as KLineChartInstance, KLineData } from "klinecharts";
import { useStore } from "zustand";
import type { Candle, Unsubscribe } from "@axiom/types";
import { getAdapter } from "../data/adapters";
import { marketStore } from "../store/market";
import { indicatorsStore } from "../store/indicators";
import { orderflowStore } from "../store/orderflow";
import { compareStore } from "../store/compare";
import { themeStore } from "../store/theme";
import { ChartIndicators } from "./indicators";
import { OrderflowController } from "./orderflow";
import { CompareController } from "./compare";
import { bindChart, unbindChart } from "./drawing";

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

/**
 * Lit un token CSS sémantique résolu (couleur concrète) depuis <html>, où vit
 * l'attribut [data-theme]. Indispensable : le canvas KLineChart n'évalue PAS
 * var(--…) (ctx.fillStyle ignore silencieusement une chaîne var()).
 */
function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Applique la palette du thème courant au graphe.
 *  - bougies (up/down + bords + mèches), grille, axes, crosshair via setStyles
 *    (merge PARTIEL : on ne touche pas la section `indicator` -> CVD orderflow et
 *    indicateurs @axiom gardent leurs styles) ;
 *  - « fond » : le canvas KLineChart est transparent -> on colore le conteneur.
 */
function applyChartTheme(chart: KLineChartInstance, chartDom: HTMLElement): void {
  const bg = readToken("--bg");
  const surface = readToken("--surface");
  const border = readToken("--border");
  const text = readToken("--text");
  const textDim = readToken("--text-dim");
  const up = readToken("--up");
  const down = readToken("--down");
  const grid = readToken("--grid");
  const crosshair = readToken("--crosshair");

  chartDom.style.backgroundColor = bg;

  chart.setStyles({
    grid: {
      horizontal: { color: grid },
      vertical: { color: grid },
    },
    candle: {
      bar: {
        upColor: up,
        downColor: down,
        noChangeColor: textDim,
        upBorderColor: up,
        downBorderColor: down,
        noChangeBorderColor: textDim,
        upWickColor: up,
        downWickColor: down,
        noChangeWickColor: textDim,
      },
      priceMark: {
        high: { color: textDim },
        low: { color: textDim },
        last: { upColor: up, downColor: down, noChangeColor: textDim },
      },
    },
    xAxis: {
      axisLine: { color: border },
      tickLine: { color: border },
      tickText: { color: textDim },
    },
    yAxis: {
      axisLine: { color: border },
      tickLine: { color: border },
      tickText: { color: textDim },
    },
    crosshair: {
      horizontal: {
        line: { color: crosshair },
        text: { color: text, backgroundColor: surface, borderColor: border },
      },
      vertical: {
        line: { color: crosshair },
        text: { color: text, backgroundColor: surface, borderColor: border },
      },
    },
  });
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

    // Lie l'instance courante au pont des outils de dessin (la barre d'outils y
    // déclenche createOverlay/removeOverlay). Déliée au cleanup avant dispose.
    bindChart(chart);

    // Applique la palette du thème courant (bougies/grille/axes/crosshair + fond),
    // PUIS s'abonne pour réappliquer à chaque changement de thème. Le premier
    // appel est obligatoire : le chart est recréé à chaque changement symbole/TF,
    // un simple abonnement raterait la peinture initiale.
    applyChartTheme(chart, chartDom);
    const unsubscribeTheme = themeStore.subscribe(() => applyChartTheme(chart, chartDom));

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

    // Contrôleur multi-courbes (comparaison base 100) : superpose le principal +
    // les symboles comparés dans un sous-pane dédié. Re-synchronise sur ajout/retrait
    // (impératif, hors render-loop React). Le backfill principal déclenche le 1er sync.
    const compare = new CompareController(chart, exchange, timeframe);
    const unsubscribeCompare = compareStore.subscribe((state) => {
      compare.sync(state.symbols);
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

        // Backfill prêt : (re)trace les courbes de comparaison alignées sur le
        // nouveau symbole/TF/source (fetch des comparés + ligne du principal).
        compare.sync(compareStore.getState().symbols);

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
            // Réaligne la ligne base 100 du principal sur le buffer étendu (live,
            // impératif, sans re-render). Les comparés gardent leur série fetchée.
            compare.onCandles();
          }
        });
      })
      .catch((err) => {
        console.error("[AXIOM] Échec du backfill Binance", err);
      });

    return () => {
      cancelled = true;
      unsubscribeTheme();
      unsubscribeIndicators();
      unsubscribeOrderflow();
      unsubscribeCompare();
      compare.dispose(); // retire le sous-pane de comparaison AVANT dispose.
      orderflow.dispose(); // ferme le WS aggTrade + retire le pane CVD AVANT dispose.
      if (unsubscribe) unsubscribe();
      unbindChart(chart); // détache le pont de dessin avant de détruire l'instance.
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
