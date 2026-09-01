/**
 * Orderflow — cœur de CALCUL PUR (CVD, footprint), extrait de orderflow.ts.
 *
 * Aucune dépendance à KLineChart, au DOM, ni aux stores : uniquement des fonctions
 * déterministes sur des données (OHLCV, ticks agrégés). La frontière pur/impur est
 * ainsi une frontière de fichier — `orderflow.ts` conserve le contrôleur de rendu
 * (Canvas + sync viewport) et importe ces helpers. Testé dans orderflow.calc.test.ts.
 */
import type { Candle, ExchangeId, FootprintBar, FootprintRow } from "@axiom/types";
import type { CvdBucket } from "./cvdSpotPerp";

/** Accumulateur buy/sell d'un niveau de prix (clé = index de bucket au tickSize). */
export interface FpCell {
  buy: number;
  sell: number;
}

/**
 * CVD par index de bougie : somme cumulée de (buyVolume − sellVolume).
 * Aligné index-par-index sur `candles` (donc sur la dataList de KLineChart).
 */
export function computeCvd(candles: Candle[]): number[] {
  const out = new Array<number>(candles.length);
  let acc = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (c !== undefined) {
      const buy = c.buyVolume ?? 0;
      const sell = c.sellVolume ?? (c.buyVolume === undefined ? 0 : c.volume - buy);
      acc += buy - sell;
    }
    out[i] = acc;
  }
  return out;
}

/**
 * Vrai si la source fournit le split volume acheteur/vendeur (`buyVolume`/`sellVolume`)
 * sur TOUT l'historique de bougies — condition d'un CVD honnête. Seul Binance le porte
 * (REST k[9] « taker buy base volume » + WS `V`) ; les mappers Kraken/OKX/Bybit/
 * Hyperliquid n'en posent aucun, et le backfill REST Coinbase non plus (seules ses
 * bougies agrégées en LIVE l'ont). Plutôt qu'afficher une droite −Σvolume, on NE CRÉE
 * PAS le pane CVD (contrat « jamais de pane muet » : pas de pane vaut mieux qu'un pane
 * mensonger) — même patron de gate que wantCvdSpotPerp côté contrôleur.
 */
export function sourceFournitCvd(exchange: ExchangeId): boolean {
  return exchange === "binance";
}

/**
 * Construit la série de buckets CVD spot vs perp (Task 17), RE-BASÉE à 0 sur la
 * première bougie ayant reçu de l'activité perp (origine commune). Le CVD spot est
 * dérivé des agrégats de bougie (`buyVolume`/`sellVolume`, complet & historique) ;
 * le CVD perp est le cumul des deltas WS accumulés par bougie (post-souscription).
 *
 * Re-baser les DEUX séries à 0 au même point rend les courbes comparables à
 * l'écran (le perp ne démarre qu'à la souscription, le spot est illimité). Le
 * détecteur (`detectCvdDivergences`) ne travaille que sur des DIFFÉRENCES sur
 * `lookback`, donc l'offset de base n'affecte jamais la détection — c'est un choix
 * de RENDU. PURE : aucune dépendance KLineChart.
 */
export function buildCvdSpotPerpBuckets(
  candles: Candle[],
  perpDeltaByTime: Map<number, number>
): CvdBucket[] {
  // Origine = première bougie avec un delta perp connu.
  let startIdx = -1;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (c !== undefined && perpDeltaByTime.has(c.time)) {
      startIdx = i;
      break;
    }
  }
  if (startIdx < 0) return [];

  const buckets: CvdBucket[] = [];
  let spot = 0;
  let perp = 0;
  for (let i = startIdx; i < candles.length; i++) {
    const c = candles[i];
    if (c === undefined) continue;
    const buy = c.buyVolume ?? 0;
    const sell = c.sellVolume ?? c.volume - buy;
    spot += buy - sell;
    perp += perpDeltaByTime.get(c.time) ?? 0;
    buckets.push({ time: c.time, spot, perp });
  }
  return buckets;
}

/**
 * Construit un FootprintBar depuis la carte de niveaux d'une bougie :
 * delta, POC (niveau au volume total max) et zone de valeur 70 % (VAH/VAL par
 * expansion gloutonne autour du POC).
 */
export function buildFootprintBar(
  time: number,
  cells: Map<number, FpCell>,
  bucketSize: number
): FootprintBar {
  const rows: FootprintRow[] = [];
  let delta = 0;
  for (const [idx, cell] of cells) {
    rows.push({ price: idx * bucketSize, buyVol: cell.buy, sellVol: cell.sell });
    delta += cell.buy - cell.sell;
  }
  rows.sort((a, b) => a.price - b.price);

  // POC + index du POC dans `rows`.
  let pocIdx = 0;
  let pocVol = -1;
  let total = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r === undefined) continue;
    const t = r.buyVol + r.sellVol;
    total += t;
    if (t > pocVol) {
      pocVol = t;
      pocIdx = i;
    }
  }
  const pocRow = rows[pocIdx];
  const poc = pocRow?.price ?? 0;

  // Zone de valeur 70 % : on étend depuis le POC vers le voisin le plus volumineux.
  const target = total * 0.7;
  let lo = pocIdx;
  let hi = pocIdx;
  let acc = pocVol > 0 ? pocVol : 0;
  while (acc < target && (lo > 0 || hi < rows.length - 1)) {
    const up = hi + 1 <= rows.length - 1 ? rows[hi + 1] : undefined;
    const dn = lo - 1 >= 0 ? rows[lo - 1] : undefined;
    const upVol = up ? up.buyVol + up.sellVol : -1;
    const dnVol = dn ? dn.buyVol + dn.sellVol : -1;
    if (up !== undefined && upVol >= dnVol) {
      hi += 1;
      acc += upVol;
    } else if (dn !== undefined) {
      lo -= 1;
      acc += dnVol;
    } else {
      break;
    }
  }
  const val = rows[lo]?.price ?? poc;
  const vah = rows[hi]?.price ?? poc;

  return { time, rows, poc, vah, val, delta };
}

/** Repli tickSize selon la magnitude du prix (si /exchangeInfo échoue). */
export function fallbackTick(price: number): number {
  if (price >= 1000) return 0.1;
  if (price >= 100) return 0.01;
  if (price >= 1) return 0.001;
  return 0.00001;
}

/** Format compact d'un volume (base) pour le texte du footprint. */
export function fmtVol(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  if (v >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

/** Format signé d'un delta. */
export function fmtDelta(v: number): string {
  return `${v >= 0 ? "+" : "−"}${fmtVol(Math.abs(v))}`;
}
