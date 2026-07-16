/**
 * Revenus du protocole — superpose l'évolution des revenus on-chain (DefiLlama,
 * dailyRevenue) de l'actif analysé dans un sous-pane DÉDIÉ « Revenus protocole »,
 * à échelle indépendante (USD/jour) pour ne pas écraser l'axe de prix des bougies.
 *
 * Principe (aligné sur CompareController / OrderflowController) :
 *  - UN indicateur KLineChart `AXIOM_REVENUE` (enregistré UNE fois, module-scope)
 *    dessine UNE ligne. La valeur de chaque bougie est lue dans `extendData` via le
 *    `calc` (mapping pur par timestamp — aucune math refaite, aucun re-render React).
 *  - Les revenus sont JOURNALIERS ; les bougies peuvent être de n'importe quel TF.
 *    On fait un FORWARD-FILL : chaque bougie reçoit le dernier revenu journalier
 *    connu à sa date (≤ open time). En infra-jour la ligne est en escalier ; en
 *    supra-jour elle échantillonne la tendance de revenus aux dates de bougie.
 *  - Données : `fetchProtocolRevenue(symbol)` (REST, une fois par symbole ; le
 *    contrôleur est recréé à chaque changement symbole/TF/source par le Chart).
 *    Cache la série → réactivation instantanée. Dégradation propre : actif sans
 *    protocole connu (BTC/ETH/SOL…) ou sans données → AUCUN pane (rien à tracer).
 *  - Cycle de vie : pane créé seulement si activé ET données disponibles ; retiré
 *    sinon ; dispose() nettoie AVANT dispose(chart).
 */
import { registerIndicator, IndicatorSeries } from "klinecharts";
import type { Chart, IndicatorFigure } from "klinecharts";
import { marketStore } from "../store/market";
import { fetchProtocolRevenue, type RevenuePoint } from "../data/protocolRevenue";
import { lireTokenCanvas } from "../lib/canvasTokens";

/** Nom KLineChart de l'indicateur de revenus (préfixe = aucune collision). */
const REVENUE_NAME = "AXIOM_REVENUE";
/** Id du sous-pane dédié (déterministe). */
const REVENUE_PANE_ID = "axiom_revenue";

/** Point de l'indicateur côté KLineChart : revenu (USD/j) forward-fill de la bougie. */
interface RevenuePointOut {
  revenue: number;
}

/** Contenu d'`extendData` lu par `calc` : revenu par open time de bougie. */
interface RevenueExtend {
  valueByTime: Record<number, number>;
}

/** Enregistrement idempotent (module-scope) : survit aux remounts StrictMode. */
let registered = false;

function ensureRegistered(): void {
  if (registered) return;

  const figures: Array<IndicatorFigure<RevenuePointOut>> = [
    {
      key: "revenue",
      title: "Revenus $/j: ",
      type: "line",
      styles: () => ({ color: lireTokenCanvas("--serie-3", "#eab308"), size: 1.5 }),
    },
  ];

  registerIndicator<RevenuePointOut>({
    name: REVENUE_NAME,
    shortName: "Revenus protocole ($/j)",
    series: IndicatorSeries.Normal, // sous-pane à part : n'écrase pas l'axe prix
    // Revenus en USD/j (millions→milliards) : 0 décimale + notation compacte (441K, 1.1B)
    // sur l'axe ET la légende, au lieu de « 1,100,000,000.0000 » (audit #9).
    precision: 0,
    shouldFormatBigNumber: true,
    figures,
    // calc PUR de mapping : relit le revenu forward-fill (extendData) par timestamp.
    calc: (dataList, indicator) => {
      const ext = indicator.extendData as RevenueExtend | undefined;
      const byTime = ext?.valueByTime;
      return dataList.map((kd) => {
        const point: RevenuePointOut = {} as RevenuePointOut;
        if (byTime) {
          const v = byTime[kd.timestamp];
          if (typeof v === "number" && Number.isFinite(v)) point.revenue = v;
        }
        return point;
      });
    },
  });

  registered = true;
}

/**
 * Forward-fill : chaque bougie reçoit le dernier revenu journalier connu à sa date
 * (≤ open time). `candles` et `daily` doivent être triés par temps ascendant.
 */
function fillByCandleTime(
  candles: { time: number }[],
  daily: RevenuePoint[]
): Record<number, number> {
  const out: Record<number, number> = {};
  let i = 0;
  let last: number | undefined;
  for (const c of candles) {
    while (i < daily.length) {
      const point = daily[i];
      if (point === undefined || point.time > c.time) break;
      last = point.value;
      i++;
    }
    if (last !== undefined) out[c.time] = last;
  }
  return out;
}

/**
 * Contrôleur de revenus lié à UNE instance Chart + un symbole (capturé à la
 * construction : recréé à chaque changement symbole/TF/source par le Chart).
 */
export class RevenueController {
  private readonly chart: Chart;
  private readonly symbol: string;

  private enabled = false;
  private disposed = false;
  private paneId: string | null = null;
  /** Série de revenus journaliers (cache) ; null tant que non chargée. */
  private series: RevenuePoint[] | null = null;
  /** Vrai une fois le fetch tenté (évite les fetchs répétés ; couvre le cas « aucune donnée »). */
  private fetched = false;
  private fetching = false;
  private readonly abort = new AbortController();

  constructor(chart: Chart, symbol: string) {
    this.chart = chart;
    this.symbol = symbol;
    ensureRegistered();
  }

  /** Active/désactive la courbe de revenus (toggle « Revenus »). */
  setEnabled(enabled: boolean): void {
    if (this.disposed || enabled === this.enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.removePane();
      return;
    }
    // Activation : lance le fetch si pas encore fait, sinon reconstruit depuis le cache.
    if (this.fetched) this.rebuild();
    else void this.load();
  }

  /** Backfill prêt OU bougie clôturée : réaligne la ligne sur le buffer marché courant. */
  onCandles(): void {
    if (this.enabled) this.rebuild();
  }

  /** Démontage complet (appelé AVANT dispose(chart)). */
  dispose(): void {
    this.disposed = true;
    this.abort.abort();
    this.removePane();
  }

  // --- interne -------------------------------------------------------------

  private async load(): Promise<void> {
    if (this.fetching) return;
    this.fetching = true;
    try {
      const result = await fetchProtocolRevenue(this.symbol, this.abort.signal);
      if (this.disposed) return;
      this.series = result?.series ?? null; // null = actif sans protocole connu
      this.fetched = true;
    } catch (err) {
      if (!this.disposed) {
        console.error(`[AXIOM] Échec du fetch revenus protocole ${this.symbol}`, err);
        this.series = null;
        this.fetched = true; // évite de marteler une source en erreur
      }
    } finally {
      this.fetching = false;
    }
    if (!this.disposed && this.enabled) this.rebuild();
  }

  private rebuild(): void {
    if (this.disposed || !this.enabled) return;
    const daily = this.series;
    // Pas de données (actif sans protocole, ou série vide) → pas de pane.
    if (!daily || daily.length === 0) {
      this.removePane();
      return;
    }
    const candles = marketStore.getState().candles;
    if (candles.length === 0) return; // backfill pas encore là : onCandles() relancera

    const valueByTime = fillByCandleTime(candles, daily);
    if (Object.keys(valueByTime).length === 0) {
      // Aucun chevauchement temporel (ex. backfill plus ancien que les revenus) → rien à tracer.
      this.removePane();
      return;
    }

    // extendData NEUF à chaque fois (KLineChart compare par RÉFÉRENCE pour recalc).
    const extendData: RevenueExtend = { valueByTime };
    if (this.paneId) {
      this.chart.overrideIndicator({ name: REVENUE_NAME, extendData }, this.paneId);
    } else {
      const id = this.chart.createIndicator(
        { name: REVENUE_NAME, extendData },
        false, // sous-pane dédié et isolé
        { id: REVENUE_PANE_ID }
      );
      this.paneId = id ?? null;
    }
  }

  private removePane(): void {
    if (!this.paneId) return;
    this.chart.removeIndicator(this.paneId, REVENUE_NAME);
    this.paneId = null;
  }
}
