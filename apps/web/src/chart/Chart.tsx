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
import { volumeProfileStore } from "../store/volumeProfile";
import { revenueStore } from "../store/revenue";
import { themeStore } from "../store/theme";
import { ChartIndicators } from "./indicators";
import { OrderflowController } from "./orderflow";
import { CompareController } from "./compare";
import { VolumeProfileController } from "./volumeProfile";
import { RevenueController } from "./revenue";
import { bindChart, unbindChart } from "./drawing";

/**
 * Précision d'affichage du prix dérivée de la magnitude (≈5 chiffres significatifs,
 * bornée [2, 8]). Indispensable pour les tokens « sub-cent » : sans ça, un prix
 * comme PUMPUSDT 0.0013 s'affiche « 0.00 ». KLineChart fige 2 décimales par défaut ;
 * on calcule dynamiquement et on appelle setPriceVolumePrecision.
 */
function derivePricePrecision(candles: Candle[]): number {
  const ref = candles.at(-1)?.close ?? candles[0]?.close ?? 0;
  if (!(ref > 0)) return 2;
  const p = 4 - Math.floor(Math.log10(ref));
  return Math.min(8, Math.max(2, p));
}

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
  const atmos = readToken("--atmos");
  // Police du thème (mono terminal, arrondie « cute »…) : appliquée AUSSI au
  // texte dessiné par le canvas (axes, crosshair, marques de prix) pour que les
  // chiffres du graphe partagent la typographie de l'interface.
  const font = readToken("--font-display");

  // Le canvas KLineChart est transparent : on peint le conteneur. On y superpose
  // le voile d'ambiance du thème (--atmos : scanlines Matrix/Bloomberg, aurore,
  // bulles « cute »…) DERRIÈRE les bougies — c'est là que l'atmosphère se voit le plus.
  chartDom.style.backgroundColor = bg;
  chartDom.style.backgroundImage = atmos && atmos !== "none" ? atmos : "";

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
        high: { color: textDim, textFamily: font },
        low: { color: textDim, textFamily: font },
        last: { upColor: up, downColor: down, noChangeColor: textDim, text: { family: font } },
      },
    },
    xAxis: {
      axisLine: { color: border },
      tickLine: { color: border },
      tickText: { color: textDim, family: font },
    },
    yAxis: {
      axisLine: { color: border },
      tickLine: { color: border },
      tickText: { color: textDim, family: font },
    },
    crosshair: {
      horizontal: {
        line: { color: crosshair },
        text: { color: text, family: font, backgroundColor: surface, borderColor: border },
      },
      vertical: {
        line: { color: crosshair },
        text: { color: text, family: font, backgroundColor: surface, borderColor: border },
      },
    },
  });
}

export function Chart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vpCanvasRef = useRef<HTMLCanvasElement>(null);
  const exchange = useStore(marketStore, (s) => s.exchange);
  const symbol = useStore(marketStore, (s) => s.symbol);
  const timeframe = useStore(marketStore, (s) => s.timeframe);

  useEffect(() => {
    const container = containerRef.current;
    const chartDom = chartRef.current;
    const canvas = canvasRef.current;
    const vpCanvas = vpCanvasRef.current;
    if (!container || !chartDom || !canvas || !vpCanvas) return;

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

    // Contrôleur Volume Profile (volume par zone de prix sur la plage visible).
    // Calcul depuis les bougies OHLCV (toutes sources), rendu canvas dédié.
    const volumeProfile = new VolumeProfileController(chart, container, vpCanvas);
    volumeProfile.setEnabled(volumeProfileStore.getState().enabled);
    const unsubscribeVolumeProfile = volumeProfileStore.subscribe((state) => {
      volumeProfile.setEnabled(state.enabled);
    });

    // Contrôleur revenus du protocole (DefiLlama) : courbe d'évolution des revenus
    // on-chain de l'actif analysé, sous-pane dédié. Données journalières (basse
    // fréquence) ; dégradation propre pour les actifs sans protocole (BTC/ETH/SOL…).
    const revenue = new RevenueController(chart, symbol);
    revenue.setEnabled(revenueStore.getState().enabled);
    const unsubscribeRevenue = revenueStore.subscribe((state) => {
      revenue.setEnabled(state.enabled);
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
        // Précision d'axe adaptée à la magnitude (corrige l'affichage « 0.00 »
        // des tokens sub-cent type PUMPUSDT 0.0013). Volume en entiers (precision 0).
        chart.setPriceVolumePrecision(derivePricePrecision(candles), 0);
        chart.applyNewData(candles.map(toKLineData));

        // Applique les indicateurs actifs (restaurés depuis localStorage) au graphe.
        indicators.sync(indicatorsStore.getState().indicators, candles);

        // Backfill prêt : reseed le CVD et lance le flux de trades si actif.
        orderflow.onCandles();

        // Backfill prêt : (re)trace les courbes de comparaison alignées sur le
        // nouveau symbole/TF/source (fetch des comparés + ligne du principal).
        compare.sync(compareStore.getState().symbols);

        // Backfill prêt : le profil de volume recalcule à la frame suivante.
        volumeProfile.onCandles();

        // Backfill prêt : (re)trace la courbe de revenus alignée sur le buffer
        // (le fetch DefiLlama, lancé à l'activation, se reconstruit ici quand prêt).
        revenue.onCandles();

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
            volumeProfile.onCandles();
            // Étend la ligne de revenus aux nouvelles bougies (forward-fill ; la
            // série journalière est en cache, aucun refetch).
            revenue.onCandles();
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
      unsubscribeVolumeProfile();
      unsubscribeRevenue();
      revenue.dispose(); // annule le fetch + retire le sous-pane revenus AVANT dispose.
      volumeProfile.dispose(); // arrête le rAF + nettoie le canvas profil.
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
      {/* Canvas Volume Profile (sous le footprint dans l'ordre de pile). */}
      <canvas
        ref={vpCanvasRef}
        className="pointer-events-none absolute inset-0"
        style={{ display: "none" }}
      />
      {/* Canvas footprint (orderflow M5). */}
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0"
        style={{ display: "none" }}
      />
    </div>
  );
}
