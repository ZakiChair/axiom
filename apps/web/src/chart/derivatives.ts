/**
 * Dérivés SUR le chart — superpose l'Open Interest (USD) et le funding rate (%) du
 * perpétuel actif dans deux sous-panes DÉDIÉS, à échelle indépendante (pattern EXACT
 * de chart/macro.ts : un indicateur KLineChart par mesure, valeur lue dans `extendData`
 * via `calc`, aucun recalcul ni re-render React). Les données sont DÉJÀ payées
 * (Coinalyze, cf. fenêtre Dérivés) — les montrer sur le graphe est le gain.
 *
 * Principe :
 *  - Séries BASSE FRÉQUENCE (Coinalyze open-interest-history / funding-rate-history,
 *    interval 1 h, fenêtre glissante ~30 j) → FORWARD-FILL sur les timestamps de
 *    bougie (dernière valeur connue ≤ open time). Escalier en intraday, échantillon
 *    de tendance sur les TF longs.
 *  - Contrôleur AUTONOME : il s'abonne lui-même au store de toggles, au store marché
 *    (garde O(1) : ne reconstruit que si le NOMBRE de bougies ou la dernière bougie
 *    change — pas à chaque tick intra-bougie) ET au store UI des dérivés (le choix
 *    de place perp dans DES recharge les séries). Ainsi le câblage dans Chart.tsx
 *    se limite à construire + disposer (contrainte « 5 lignes max »).
 *  - Le marché suivi est celui de la fenêtre DES : perpétuel résolu par ACTIF
 *    dans le catalogue Coinalyze (`data/marchesPerp.ts`, demande du 5 octobre
 *    2026) — pas seulement Binance. Marché Binance → OI avec repli Binance sans
 *    clé (`histOiUsdAvecRepli`) ; autres places → OI Coinalyze seul.
 *  - Recréé à chaque changement symbole/TF/source par le Chart (symbole capturé à la
 *    construction, comme RevenueController). Dégradation propre : sans données
 *    (actif sans perp, source en panne) → aucun pane.
 */
import { registerIndicator, IndicatorSeries } from "klinecharts";
import type { Chart, IndicatorFigure } from "klinecharts";
import type { FundingRate } from "@axiom/types";
import type { MarketStore } from "../store/market";
import type { PointSerie } from "../lib/referentiel";
import { derivativesChartStore, type DerivativesChartState } from "../store/derivatives-chart";
import { derivativesUiStore } from "../store/derivatives-ui";
import { coinalyzeProvider } from "../data/coinalyze";
// `data/marchesPerp` est chargé à la demande (await import dans resoudreMarche) :
// le catalogue de découverte perp n'est utile qu'au premier pane activé — garder
// le chunk initial sous le budget gzip.
import type { MarchePerp } from "../data/marchesPerp";
import { histOiUsdAvecRepli } from "../data/referentiels";
import { lireTokenCanvas } from "../lib/canvasTokens";

/** Sous-pane Open Interest (notionnel USD). */
const OI_NAME = "AXIOM_DERIV_OI";
const OI_PANE_ID = "axiom_deriv_oi";
// Tokens de série des panes — lus AU RENDU (callback styles) : suivent le thème.
// Côté DerivativesWindow, le lien visuel bouton↔courbe utilise les MÊMES tokens
// via `var(--serie-5)` / `var(--serie-3)` en style inline.
const OI_TOKEN = "--serie-5"; // cyan sur dark (repli : OI_REPLI)
const OI_REPLI = "#22d3ee";
/** Sous-pane funding rate (affiché en %). */
const FUNDING_NAME = "AXIOM_DERIV_FUNDING";
const FUNDING_PANE_ID = "axiom_deriv_funding";
const FUNDING_TOKEN = "--serie-3"; // ambre sur dark (repli : FUNDING_REPLI)
const FUNDING_REPLI = "#f59e0b";

/** Interval Coinalyze des séries dérivées (cadence lente, forward-fill ensuite). */
const DERIV_INTERVAL = "1hour";
/** Fenêtre glissante récupérée (30 j @ 1 h = 720 pts, sous la rétention gratuite ~1500-2000). */
const DERIV_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Mémo module-scope PAR ID COINALYZE DE MARCHÉ (TTL 60 s) : plusieurs slots de
 * grille sur le MÊME symbole (ex. 2× BTCUSDT) ne déclenchent qu'UN seul fetch
 * Coinalyze — protège le quota 40 req/min (`coinalyzeProvider` n'a lui-même aucun
 * cache, cf. data/coinalyze.ts, uniquement un throttle de débit partagé).
 * Nécessaire depuis que `DerivativesChartController` est instancié sur TOUS les
 * slots (plus seulement le maître). La clé est `marche.symbole` (ex.
 * « PUMPFUNUSDT.6 ») : un changement de place change de clé → nouveau fetch.
 */
const DERIV_CACHE_TTL_MS = 60_000;

interface CacheEntry<T> {
  promise: Promise<T>;
  fetchedAt: number;
}

const oiHistoryCache = new Map<string, CacheEntry<PointSerie[]>>();
const fundingHistoryCache = new Map<string, CacheEntry<FundingRate[]>>();

/** Sert la promesse en cache si récente (< TTL), sinon relance et mémorise. Une erreur
 * purge l'entrée immédiatement (pas d'attente du TTL avant de pouvoir réessayer). */
function memoized<T>(cache: Map<string, CacheEntry<T>>, key: string, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.fetchedAt < DERIV_CACHE_TTL_MS) return hit.promise;
  const promise = fetcher();
  cache.set(key, { promise, fetchedAt: now });
  promise.catch(() => cache.delete(key));
  return promise;
}

/** Vide les mémos de séries — réservé aux tests. */
export function _viderCachesPanesDerives(): void {
  oiHistoryCache.clear();
  fundingHistoryCache.clear();
}

interface CandleTime {
  time: number;
}

/** Point d'une série dérivée forward-fillable (valeur déjà mise à l'échelle d'affichage). */
interface DerivPoint {
  time: number;
  value: number;
}

interface DerivPointOut {
  value: number;
}

interface DerivExtend {
  valueByTime: Record<number, number>;
}

/**
 * Forward-fill : chaque bougie reçoit la dernière valeur connue à sa date (≤ open
 * time). `candles` et `series` triés par temps ascendant. PURE & testée (miroir de
 * buildMacroValueByTime, dédié ici pour l'isolation entre agents).
 */
export function forwardFillByTime(candles: CandleTime[], series: DerivPoint[]): Record<number, number> {
  const out: Record<number, number> = {};
  if (candles.length === 0 || series.length === 0) return out;

  if (series.length === 1) {
    const value = series[0]?.value;
    if (typeof value !== "number" || !Number.isFinite(value)) return out;
    for (const c of candles) out[c.time] = value;
    return out;
  }

  let i = 0;
  let last: number | undefined;
  for (const c of candles) {
    while (i < series.length) {
      const point = series[i];
      if (!point || point.time > c.time) break;
      if (Number.isFinite(point.value)) last = point.value;
      i++;
    }
    if (last !== undefined) out[c.time] = last;
  }
  return out;
}

let registered = false;

function ensureRegistered(): void {
  if (registered) return;

  const makeFigures = (
    title: string,
    token: string,
    repli: string
  ): Array<IndicatorFigure<DerivPointOut>> => [
    { key: "value", title, type: "line", styles: () => ({ color: lireTokenCanvas(token, repli), size: 1.5 }) },
  ];

  const calc = (dataList: readonly { timestamp: number }[], indicator: { extendData?: unknown }) => {
    const ext = indicator.extendData as DerivExtend | undefined;
    const byTime = ext?.valueByTime;
    return dataList.map((kd) => {
      const point: DerivPointOut = {} as DerivPointOut;
      if (byTime) {
        const v = byTime[kd.timestamp];
        if (typeof v === "number" && Number.isFinite(v)) point.value = v;
      }
      return point;
    });
  };

  registerIndicator<DerivPointOut>({
    name: OI_NAME,
    shortName: "OI ($)",
    series: IndicatorSeries.Normal,
    // OI en notionnel USD (milliards) : 0 décimale + notation compacte sur l'axe
    // et la légende, au lieu de « 1,100,000,000.0000 » (revue v2, H8).
    precision: 0,
    shouldFormatBigNumber: true,
    figures: makeFigures("OI $: ", OI_TOKEN, OI_REPLI),
    calc,
  });
  registerIndicator<DerivPointOut>({
    name: FUNDING_NAME,
    shortName: "Funding (%)",
    series: IndicatorSeries.Normal,
    precision: 4, // convention funding du standard
    figures: makeFigures("Funding %: ", FUNDING_TOKEN, FUNDING_REPLI),
    calc,
  });

  registered = true;
}

export class DerivativesChartController {
  private readonly chart: Chart;
  private readonly symbol: string;
  private readonly market: MarketStore;
  private readonly unsubStore: () => void;
  private readonly unsubMarket: () => void;
  private readonly unsubPlaces: () => void;

  private state: DerivativesChartState;
  private disposed = false;
  private lastCandleSig = "";
  /**
   * Génération du marché suivi : incrémentée à chaque changement de place perp
   * effective. Un fetch résolu APRÈS une bascule est ignoré (série périmée).
   */
  private generation = 0;
  /** Id Coinalyze du marché dont proviennent les séries courantes (null = aucun). */
  private symboleCharge: string | null = null;

  private oiSeries: DerivPoint[] | null = null;
  private oiFetched = false;
  private oiFetching = false;
  private oiPaneId: string | null = null;

  private fundingSeries: DerivPoint[] | null = null;
  private fundingFetched = false;
  private fundingFetching = false;
  private fundingPaneId: string | null = null;

  constructor(chart: Chart, symbol: string, market: MarketStore) {
    this.chart = chart;
    this.symbol = symbol;
    this.market = market;
    ensureRegistered();
    this.state = derivativesChartStore.getState();
    // Auto-pilotage : toggles + changements de bougies (garde O(1)) + choix de
    // place perp dans DES, sans câblage Chart.tsx.
    this.unsubStore = derivativesChartStore.subscribe((s) => this.onToggle(s));
    this.unsubMarket = this.market.subscribe(() => this.onMarketChange());
    this.unsubPlaces = derivativesUiStore.subscribe((s, prev) => {
      if (s.placesPerp !== prev.placesPerp) void this.onPlacesChange();
    });
    this.onToggle(this.state);
  }

  dispose(): void {
    this.disposed = true;
    this.unsubStore();
    this.unsubMarket();
    this.unsubPlaces();
    this.removePane(OI_NAME, this.oiPaneId);
    this.oiPaneId = null;
    this.removePane(FUNDING_NAME, this.fundingPaneId);
    this.fundingPaneId = null;
  }

  // --- interne ---------------------------------------------------------------

  /**
   * Marché perp suivi : résolution par actif (catalogue Coinalyze), choix de place
   * de l'utilisateur honoré s'il existe encore, Hyperliquid en tête uniquement si
   * l'instrument charté est un perp Hyperliquid. `null` = aucun marché pour l'actif.
   */
  private async resoudreMarche(): Promise<MarchePerp | null> {
    const { resoudreMarchesPerp, marchePerpRetenu } = await import("../data/marchesPerp");
    const r = await resoudreMarchesPerp(this.symbol);
    if (r.etat === "inexploitable") return null;
    const choix = derivativesUiStore.getState().placesPerp[r.actif];
    const prioritaire =
      this.market.getState().exchange === "hyperliquid" ? "hyperliquid" : null;
    const retenu = marchePerpRetenu(r.marches, choix, prioritaire);
    return retenu;
  }

  /**
   * Changement de place dans DES : si le marché retenu a changé d'id Coinalyze,
   * les séries et drapeaux sont abandonnés puis les panes actifs rechargés.
   * Invalide aussi tout fetch encore en vol (génération).
   */
  private async onPlacesChange(): Promise<void> {
    if (this.disposed) return;
    const gen = ++this.generation;
    const m = await this.resoudreMarche();
    if (this.disposed || gen !== this.generation) return;
    const symbole = m?.symbole ?? null;
    if (symbole === this.symboleCharge) return;
    this.symboleCharge = symbole;
    this.oiSeries = null;
    this.oiFetched = false;
    this.fundingSeries = null;
    this.fundingFetched = false;
    if (this.state.oi && !this.oiFetching) void this.loadOi();
    if (this.state.funding && !this.fundingFetching) void this.loadFunding();
    this.rebuild();
  }

  private onToggle(s: DerivativesChartState): void {
    if (this.disposed) return;
    this.state = s;
    if (s.oi && !this.oiFetched && !this.oiFetching) void this.loadOi();
    if (s.funding && !this.fundingFetched && !this.fundingFetching) void this.loadFunding();
    this.rebuild();
  }

  /** Reconstruit uniquement si le buffer de bougies a réellement changé (pas à chaque tick). */
  private onMarketChange(): void {
    if (this.disposed) return;
    const candles = this.market.getState().candles;
    const sig = `${candles.length}:${candles[0]?.time ?? 0}:${candles.at(-1)?.time ?? 0}`;
    if (sig === this.lastCandleSig) return;
    this.lastCandleSig = sig;
    this.rebuild();
  }

  private async loadOi(): Promise<void> {
    this.oiFetching = true;
    const gen = this.generation;
    try {
      const m = await this.resoudreMarche();
      if (this.disposed || gen !== this.generation) {
        // Chargement périmé (bascule de place pendant la résolution) : on laisse
        // `oiFetched` à false pour que la relance ci-dessous refasse le fetch.
      } else {
        this.symboleCharge = m?.symbole ?? null;
        if (m === null) {
          this.oiSeries = null;
          this.oiFetched = true;
        } else {
          // Marché Binance : Coinalyze en primaire, repli Binance openInterestHist
          // (gratuit, sans clé) — cf. `histOiUsdAvecRepli` (data/referentiels.ts).
          // Autres places : Coinalyze seul, sans repli Binance (la série Binance du
          // MÊME actif existe peut-être, mais ce n'est pas le marché affiché).
          const hist = await memoized(oiHistoryCache, m.symbole, () =>
            m.place === "binance"
              ? histOiUsdAvecRepli(m.symboleSurPlace, DERIV_INTERVAL, Date.now() - DERIV_LOOKBACK_MS)
              : coinalyzeProvider
                  .fetchOpenInterestHistory(m.symbole, DERIV_INTERVAL, Date.now() - DERIV_LOOKBACK_MS)
                  .then((pts) =>
                    pts
                      .map((p) => ({ t: p.time, v: p.oiUsd }))
                      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v)),
                  ),
          );
          if (!this.disposed && gen === this.generation) {
            const series = hist.map((p) => ({ time: p.t, value: p.v }));
            this.oiSeries = series.length > 0 ? series : null;
            this.oiFetched = true;
          }
        }
      }
    } catch (err) {
      if (!this.disposed && gen === this.generation) {
        console.error(`[AXIOM] Échec du fetch OI (sous-pane) ${this.symbol}`, err);
        this.oiSeries = null;
        this.oiFetched = true;
      }
    } finally {
      this.oiFetching = false;
    }
    if (this.disposed) return;
    if (this.state.oi && !this.oiFetched) {
      // Une bascule de place a invalidé ce chargement pendant le fetch : relancer
      // sur le nouveau marché plutôt que de laisser le pane vide.
      void this.loadOi();
    } else if (this.state.oi) {
      this.rebuild();
    }
  }

  private async loadFunding(): Promise<void> {
    this.fundingFetching = true;
    const gen = this.generation;
    try {
      const m = await this.resoudreMarche();
      if (this.disposed || gen !== this.generation) {
        // Périmé : fundingFetched reste false → relance ci-dessous.
      } else {
        this.symboleCharge = m?.symbole ?? null;
        if (m === null) {
          this.fundingSeries = null;
          this.fundingFetched = true;
        } else {
          const hist = await memoized(fundingHistoryCache, m.symbole, () =>
            coinalyzeProvider.fetchFundingRateHistory(m.symbole, DERIV_INTERVAL, Date.now() - DERIV_LOOKBACK_MS)
          );
          if (!this.disposed && gen === this.generation) {
            // rate est une fraction (normalisée à la source) → ×100 pour l'affichage en %.
            const series = hist
              .map((p) => ({ time: p.time, value: p.rate * 100 }))
              .filter((p) => Number.isFinite(p.value));
            this.fundingSeries = series.length > 0 ? series : null;
            this.fundingFetched = true;
          }
        }
      }
    } catch (err) {
      if (!this.disposed && gen === this.generation) {
        console.error(`[AXIOM] Échec du fetch funding (sous-pane) ${this.symbol}`, err);
        this.fundingSeries = null;
        this.fundingFetched = true;
      }
    } finally {
      this.fundingFetching = false;
    }
    if (this.disposed) return;
    if (this.state.funding && !this.fundingFetched) {
      void this.loadFunding();
    } else if (this.state.funding) {
      this.rebuild();
    }
  }

  private rebuild(): void {
    if (this.disposed) return;
    const candles = this.market.getState().candles;
    this.oiPaneId = this.syncPane(this.state.oi, this.oiSeries, OI_NAME, OI_PANE_ID, this.oiPaneId, candles);
    this.fundingPaneId = this.syncPane(
      this.state.funding,
      this.fundingSeries,
      FUNDING_NAME,
      FUNDING_PANE_ID,
      this.fundingPaneId,
      candles
    );
  }

  /** Crée/actualise/retire un sous-pane ; renvoie l'id de pane courant (ou null). */
  private syncPane(
    enabled: boolean,
    series: DerivPoint[] | null,
    name: string,
    paneKey: string,
    paneId: string | null,
    candles: CandleTime[]
  ): string | null {
    if (!enabled || !series || series.length === 0 || candles.length === 0) {
      this.removePane(name, paneId);
      return null;
    }
    const valueByTime = forwardFillByTime(candles, series);
    if (Object.keys(valueByTime).length === 0) {
      this.removePane(name, paneId);
      return null;
    }
    const extendData: DerivExtend = { valueByTime };
    if (paneId) {
      this.chart.overrideIndicator({ name, extendData }, paneId);
      return paneId;
    }
    return this.chart.createIndicator({ name, extendData }, false, { id: paneKey }) ?? null;
  }

  private removePane(name: string, paneId: string | null): void {
    if (paneId) this.chart.removeIndicator(paneId, name);
  }
}
