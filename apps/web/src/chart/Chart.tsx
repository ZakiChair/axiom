/**
 * Chart — intégration impérative de KLineChart (API v9.8.x confirmée via context7 / d.ts).
 *
 * Flux : à chaque changement symbole/TF on (1) init l'instance, (2) backfill REST ->
 * applyNewData, puis (3) souscription WS -> updateData sur chaque kline. Les ticks
 * live sont appliqués DIRECTEMENT sur l'instance (aucun re-render React). Au
 * changement symbole/TF ou au démontage : unsubscribe WS + dispose.
 */
import { useEffect, useRef } from "react";
import { dispose, init, LoadDataType, YAxisType } from "klinecharts";
import type { Chart as KLineChartInstance, KLineData } from "klinecharts";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { Candle, ExchangeId, Timeframe, Unsubscribe } from "@axiom/types";
import { getAdapter } from "../data/adapters";
import { mergeResyncCandles } from "../data/resync";
import { marketStore } from "../store/market";
import { indicatorsStore } from "../store/indicators";
import { orderflowStore } from "../store/orderflow";
import { compareStore } from "../store/compare";
import { volumeProfileStore } from "../store/volumeProfile";
import { revenueStore } from "../store/revenue";
import { macroOverlayStore } from "../store/macro-overlays";
import { macroHistoryStore } from "../store/macroHistory";
import { themeStore } from "../store/theme";
import { ChartIndicators } from "./indicators";
import { OrderflowController } from "./orderflow";
import { CompareController } from "./compare";
import { VolumeProfileController } from "./volumeProfile";
import { RevenueController } from "./revenue";
import { MacroController } from "./macro";
import { DerivativesChartController } from "./derivatives";
import { bindChart, unbindChart, redrawFibOverlays, restoreDrawings } from "./drawing";
import { fibStore } from "./fibonacci";
import { SymbolBanner } from "../components/SymbolBanner";

/** Type d'échelle de l'axe prix (miroir de YAxisType klinecharts). */
export type PriceScaleType = "normal" | "log" | "percentage";

export interface PriceScaleState {
  /** Échelle courante de l'axe prix : linéaire / logarithmique / pourcentage. */
  type: PriceScaleType;
  setType: (type: PriceScaleType) => void;
}

/**
 * Store d'échelle de l'axe prix — Zustand VANILLA (hors render-loop). Réglé par la
 * Toolbar, lu par le Chart (applique `setStyles({ yAxis: { type } })` + propage au
 * footprint orderflow). Co-localisé ici pour éviter un import circulaire orderflow↔Chart.
 */
export const priceScaleStore = createStore<PriceScaleState>((set) => ({
  type: "normal",
  setType: (type) => set({ type }),
}));

/** Mappe l'échelle du store vers l'enum YAxisType attendu par `setStyles` de KLineChart. */
const Y_AXIS_TYPE: Record<PriceScaleType, YAxisType> = {
  normal: YAxisType.Normal,
  log: YAxisType.Log,
  percentage: YAxisType.Percentage,
};

/** Nombre de bougies récupérées par page d'historique (scroll gauche). */
const PAGINATION_LIMIT = 500;
/**
 * Plafond du buffer marché au fil des paginations : au-delà, on cesse de charger plus
 * d'historique (borne mémoire d'une session longue qui scrolle beaucoup vers le passé).
 */
const PAGINATION_MAX_CANDLES = 20_000;

/**
 * Dernier viewport connu (zoom + décalage droit), capturé AVANT `dispose()`. Sert à
 * restaurer le cadrage best-effort au changement de symbole/TF SUR LA MÊME SOURCE
 * (l'instance est recréée, mais on reproduit largeur de bougie + décalage). Réinitialisé
 * au changement de source (`exchange` différent) → cadrage par défaut. Module-scope :
 * survit au démontage/remontage de l'effet.
 */
let lastViewport: { exchange: ExchangeId; barSpace: number; offsetRight: number } | null = null;

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
 * `subscribeKline` enrichi d'un 4e argument `onResync` : rappelé par l'adaptateur
 * après une reconnexion WS avec un lot de bougies REST fraîches à fusionner. Ce
 * paramètre est ABSENT de `IExchangeAdapter` (contrat @axiom/types figé) ; on le
 * type localement et on cast le point d'appel — les adaptateurs le supportent tous.
 */
type SubscribeKlineAvecResync = (
  symbol: string,
  tf: Timeframe,
  cb: (c: Candle) => void,
  onResync?: (candles: Candle[]) => void,
) => Unsubscribe;

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

    // Réglages Fibonacci (niveaux/zones) : re-rend les overlays Fibo déjà tracés.
    const unsubscribeFib = fibStore.subscribe((state) => redrawFibOverlays(state.rev));

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

    // Échelle de l'axe prix (linéaire/log/pourcentage) : appliquée à l'instance via
    // setStyles (merge partiel, la palette du thème n'est pas touchée) ET propagée au
    // footprint orderflow (qui doit convertir prix→y par niveau en mode non linéaire).
    // Réappliquée à chaque (re)création d'instance : une instance neuve démarre en 'normal'.
    const applyPriceScale = (type: PriceScaleType): void => {
      chart.setStyles({ yAxis: { type: Y_AXIS_TYPE[type] } });
      orderflow.setAxisType(type);
    };
    applyPriceScale(priceScaleStore.getState().type);
    const unsubscribePriceScale = priceScaleStore.subscribe((state) => applyPriceScale(state.type));

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

    // Contrôleur macro (M2 / cap totale crypto / stablecoins) : séries externes
    // basse fréquence, affichées dans un pane dédié quand elles sont cochées.
    const macro = new MacroController(chart);
    macro.sync(macroOverlayStore.getState().enabled);
    const unsubscribeMacro = macroOverlayStore.subscribe((state) => {
      macro.sync(state.enabled);
    });
    // Nouvel échantillon de cap. totale crypto (poller central) → réétend l'overlay.
    const unsubscribeMacroHistory = macroHistoryStore.subscribe(() => {
      macro.onCandles();
    });

    // Contrôleur dérivés SUR le chart (OI + funding en sous-panes). AUTONOME : il
    // s'abonne lui-même aux stores toggles + marché (cf. derivatives.ts), donc aucun
    // autre câblage ici (pattern MacroController, câblage minimal).
    const derivativesChart = new DerivativesChartController(chart, symbol);

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

        // Préservation best-effort du cadrage : au changement de symbole/TF SUR LA MÊME
        // SOURCE, on reproduit la largeur de bougie (zoom) et le décalage droit capturés
        // avant le dispose de l'ancienne instance. applyNewData ayant remis le décalage à
        // zéro, on restaure APRÈS. Au changement de source, `exchange` diffère → cadrage neuf.
        if (lastViewport && lastViewport.exchange === exchange) {
          try {
            chart.setBarSpace(lastViewport.barSpace);
            chart.setOffsetRightDistance(lastViewport.offsetRight);
          } catch {
            /* best-effort : un échec de restauration ne doit pas casser l'affichage */
          }
        }

        // Rejoue les dessins sauvegardés de CE symbole (les bougies sont posées :
        // l'ancrage temporel des overlays est valide). Survit aux changements de TF/actif.
        restoreDrawings(symbol);

        // Applique les indicateurs actifs (restaurés depuis localStorage) au graphe.
        indicators.sync(indicatorsStore.getState().indicators, candles);

        // Backfill prêt : reseed le CVD et lance le flux de trades si actif.
        orderflow.onCandles();

        // Backfill prêt : (re)trace les courbes de comparaison alignées sur le
        // nouveau symbole/TF/source (fetch des comparés + ligne du principal).
        compare.sync(compareStore.getState().symbols);

        // Backfill prêt : le profil de volume recalcule à la frame suivante.
        volumeProfile.onCandles();

        // Backfill prêt : (re)trace les courbes basse fréquence alignées sur le buffer.
        revenue.onCandles();
        macro.onCandles();

        // Pagination historique (scroll gauche) : KLineChart appelle ce callback avec
        // `type: Forward` et la bougie la plus ANCIENNE affichée. On récupère un lot plus
        // vieux (endTime = borne - 1) puis on le PRÉPEND au buffer marché ET au graphe.
        //   - Le buffer marché est prolongé en MÊME temps que le graphe → l'alignement
        //     index-par-index des indicateurs / CVD / volume profile reste correct.
        //   - Sources sans `endTime` (Kraken, MEXC, tradfi) : le lot renvoyé ne contient
        //     aucune bougie plus ancienne → filtre vide → `more:false` → arrêt propre
        //     (dégradation silencieuse, pas de boucle ni de données fausses).
        //   - On DOIT toujours rappeler `params.callback` (même vide / en erreur) sinon le
        //     verrou interne `_loading` de KLineChart resterait bloqué.
        chart.setLoadDataCallback((params) => {
          const leftmost = params.data;
          if (params.type !== LoadDataType.Forward || !leftmost) {
            params.callback([], false);
            return;
          }
          if (marketStore.getState().candles.length >= PAGINATION_MAX_CANDLES) {
            params.callback([], false); // borne mémoire atteinte : on cesse de charger.
            return;
          }
          adapter
            .fetchKlines(symbol, timeframe, {
              limit: PAGINATION_LIMIT,
              endTime: leftmost.timestamp - 1,
            })
            .then((fetched) => {
              if (cancelled) return; // instance en cours de destruction : ne rien appliquer.
              const older = fetched.filter((c) => c.time < leftmost.timestamp);
              if (older.length === 0) {
                params.callback([], false); // début de l'historique (ou source sans endTime).
                return;
              }
              const existing = marketStore.getState().candles;
              const merged = older.concat(existing);
              marketStore.getState().setCandles(merged);
              // Re-drive les contrôleurs sur le buffer prolongé (extendData réaligné sur
              // `merged`) AVANT de prépendre au graphe, pour que le recalcul final soit juste.
              indicators.recompute(indicatorsStore.getState().indicators, merged);
              orderflow.onCandles();
              compare.onCandles();
              volumeProfile.onCandles();
              revenue.onCandles();
              macro.onCandles();
              // Prépend au graphe (déclenche le recalcul interne) ; le cadrage reste stable.
              params.callback(older.map(toKLineData), true);
            })
            .catch((err) => {
              if (!cancelled) params.callback([], true); // débloque _loading, autorise un retry.
              console.error("[AXIOM] pagination historique échouée", err);
            });
        });

        const onKline = (candle: Candle) => {
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
            // Étend les lignes basse fréquence aux nouvelles bougies (forward-fill ;
            // les séries journalières/hebdo sont en cache, aucun refetch).
            revenue.onCandles();
            macro.onCandles();
          }
        };

        // Resync post-reconnexion : l'adaptateur re-fetche un lot REST après une
        // coupure ; on le fond au buffer (comble les bougies clôturées manquées) et,
        // SI un trou a réellement été comblé, on ré-applique tout + re-seed complet
        // (CVD, indicateurs, overlays). Sinon on laisse le live continuer sans à-coup.
        const onResync = (fetched: Candle[]) => {
          if (cancelled) return;
          const existing = marketStore.getState().candles;
          const merged = mergeResyncCandles(existing, fetched);
          if (merged.length === existing.length) return; // aucun trou comblé
          marketStore.getState().setCandles(merged);
          chart.applyNewData(merged.map(toKLineData));
          orderflow.onCandles(); // re-seed CVD sur le buffer corrigé
          indicators.recompute(indicatorsStore.getState().indicators, merged);
          compare.onCandles();
          volumeProfile.onCandles();
          revenue.onCandles();
          macro.onCandles();
        };

        // Cast local : IExchangeAdapter (figé) n'expose pas onResync (cf. type ci-dessus).
        const subscribeKline = adapter.subscribeKline as SubscribeKlineAvecResync;
        unsubscribe = subscribeKline(symbol, timeframe, onKline, onResync);
      })
      .catch((err) => {
        console.error("[AXIOM] Échec du backfill Binance", err);
      });

    return () => {
      cancelled = true;
      unsubscribeTheme();
      unsubscribePriceScale();
      unsubscribeIndicators();
      unsubscribeOrderflow();
      unsubscribeCompare();
      unsubscribeVolumeProfile();
      unsubscribeRevenue();
      unsubscribeMacro();
      unsubscribeMacroHistory();
      derivativesChart.dispose(); // désabonne + retire les sous-panes OI/funding AVANT dispose.
      macro.dispose(); // annule les fetchs + retire le sous-pane macro AVANT dispose.
      revenue.dispose(); // annule le fetch + retire le sous-pane revenus AVANT dispose.
      volumeProfile.dispose(); // arrête le rAF + nettoie le canvas profil.
      compare.dispose(); // retire le sous-pane de comparaison AVANT dispose.
      orderflow.dispose(); // ferme le WS aggTrade + retire le pane CVD AVANT dispose.
      if (unsubscribe) unsubscribe();
      unsubscribeFib();
      // Capture le cadrage AVANT dispose : le prochain montage sur la MÊME source le restaure.
      try {
        lastViewport = {
          exchange,
          barSpace: chart.getBarSpace(),
          offsetRight: chart.getOffsetRightDistance(),
        };
      } catch {
        lastViewport = null;
      }
      unbindChart(chart); // détache le pont de dessin avant de détruire l'instance.
      dispose(chart); // détruit panes + indicateurs ; pas de removeIndicator manuel.
    };
  }, [exchange, symbol, timeframe]);

  return (
    // Conteneur relatif : le graphe le remplit (absolute inset-0), le canvas
    // footprint se superpose (pointer-events:none -> pan/zoom passent au graphe).
    <div ref={containerRef} className="relative h-full w-full">
      <div ref={chartRef} className="absolute inset-0" />
      {/* Bandeau symbole (prix / var 24h / H-L 24h / volume / compte à rebours de bougie),
          superposé en haut à gauche du graphe. Écritures DOM impératives (aucun re-render
          sur tick), abonné au ticker + au buffer marché. */}
      <SymbolBanner />
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
