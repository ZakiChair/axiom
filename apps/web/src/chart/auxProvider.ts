/**
 * AuxProvider — fetch, alignement, cache et notification des séries AUXILIAIRES
 * (OI, funding, mark, stablecoins, NVT, MVRV) consommées par les indicateurs dérivés.
 *
 * Vit dans `apps/web` — la couche AUTORISÉE à fetcher — par opposition au moteur
 * `@axiom/indicators` qui reste pur/synchrone. L'AuxProvider récupère la donnée
 * brute puis rend à l'appelant des séries DÉJÀ alignées sur les bougies via
 * `alignAux` (contrat Task 11) ; le moteur ne fait, lui, jamais de réseau.
 *
 * Principes de cache :
 *   - le FETCH brut est mémoïsé par clé `(id, symbole)` avec TTL (60 s pour les
 *     dérivés OI/funding, 1 h pour les séries quotidiennes stablecoins/NVT/MVRV) ;
 *   - un échec de fetch est mémorisé 30 s (anti retry-tempête) ;
 *   - un seul fetch en vol par clé (SINGLE-FLIGHT) : les appels concurrents
 *     partagent la même promesse et sont tous notifiés à sa résolution ;
 *   - l'ALIGNEMENT (`alignAux`) est recalculé à CHAQUE `getAligned` car il dépend
 *     de `candleTimes` (propre à chaque graphe/appel) ; seul le fetch est mémoïsé.
 *
 * Choix de clé : `(id, symbole)` suffit pour la plupart des séries — l'`exchange`
 * et le `timeframe` de la requête n'entrent PAS dans la clé. Les fetchs sous-jacents
 * ne dépendent pas de l'exchange (Coinalyze cible toujours le perp Binance ; Coin
 * Metrics/DefiLlama sont mono-source) ni du timeframe du graphe (granularité brute
 * fixée : "1hour" / quotidien) ; l'écart de timeframe est absorbé par `alignAux` à la
 * lecture. EXCEPTIONS à la clé `(id, symbole)` :
 *   - `mark` est fetché au timeframe du graphe et apparié EXACTEMENT par ouverture :
 *     comparer les clôtures spot/perp exige le même intervalle, sans report entre barres.
 *   - `perpDelta` est un FLUX (delta agresseur par bougie), pas un niveau — il DOIT être
 *     fetché à l'interval du chart (un LOCF sur un flux fabrique un flux faux). Sa clé
 *     intègre donc le timeframe (`perpDelta:${symbole}:${tf}`).
 *   - `refClose` est un NIVEAU (close du symbole de référence) — le LOCF d'`alignAux` le
 *     rééchantillonne sans le fausser ; il est néanmoins fetché à l'interval du chart et
 *     keyé par timeframe par CHOIX (appariement 1:1 propre avec les autres jambes des
 *     indicateurs statistiques), non par nécessité de correction comme perpDelta. Sa clé
 *     porte de plus sur le symbole de RÉFÉRENCE (refSymbolStore), pas celui du chart :
 *     `refClose:${refSymbol}:${tf}`.
 * Les autres séries de niveaux gardent la clé `(id, symbole)` inchangée.
 */
import { alignAux } from "@axiom/indicators";
import type { AuxSeries, AuxSeriesId, ExchangeId, Timeframe } from "@axiom/types";
import { coinalyzeProvider, fetchLiquidationHistory } from "../data/coinalyze";
import type { CoinalyzeInterval, LiquidationHistPoint } from "../data/coinalyze";
import { hlLiqHeatGet } from "../data/daemon";
import { basePerp, hyperliquidCoin } from "../data/symbol";
import { dureeTimeframeMs } from "../data/backtestData";
import { histFunding, histOiUsd } from "../data/referentiels";
import { stablecoinsSupplyProvider } from "../data/macro/stablecoins";
import { fetchNvtHistory } from "../data/onchain/blockchainNvt";
import { fetchCoinMetrics } from "../data/onchain/coinmetrics";
import { fetchQuarterlyBasisHistory } from "../data/binanceDapi";
import { fetchLsAccountRatio, fetchLsTopTraderRatio, fetchTakerRatio } from "../data/positioning";
import { fetchFearGreedHistory } from "../data/marketOverview";
import { deltaDepuisKlinesPerp, timeframeToFapiInterval } from "../data/binanceFutures";
import { binanceAdapter } from "../data/binance";
import { coinalyzeKeyStore } from "../store/coinalyze";
import { refSymbolStore } from "../store/refSymbol";
import { getBgeometricsKey } from "../store/onchain";
import { extUrl } from "../data/extapi";
import { normaliserIdentiteFunding } from "../data/fundingIdentity";

/** État renvoyé par `getAligned` pour l'ensemble des `ids` demandés. */
export type AuxStatus =
  | { status: "ready"; aux: AuxSeries }
  | { status: "pending" }
  | { status: "error"; message: string };

/** Requête d'alignement d'un lot de séries auxiliaires sur un jeu de bougies. */
export interface AuxRequest {
  exchange: ExchangeId;
  symbol: string;
  timeframe: Timeframe;
  ids: AuxSeriesId[];
  candleTimes: number[];
}

/** Point brut prêt pour `alignAux` (time ms epoch, croissant). */
interface AuxPoint {
  time: number;
  value: number;
  /** Funding Binance : expiration exclusive de la cadence observée. */
  validUntil?: number | undefined;
}

/** TTL du cache BRUT par série (ms). */
const TTL_MS: Record<AuxSeriesId, number> = {
  oi: 60_000,
  oiDebutLiqUsd: 60_000,
  funding: 60_000,
  mark: 60_000, // mark price perp (Binance fapi markPriceKlines)
  perpDelta: 60_000, // delta agresseur perp par bougie (Binance fapi klines)
  refClose: 60_000, // close du symbole de référence, fetch à l'interval du chart (câblage : Task 2)
  refCloseStrict: 60_000,
  stablecoins: 60 * 60_000,
  nvt: 60 * 60_000,
  mvrv: 60 * 60_000,
  marketcap: 60 * 60_000, // CapMrktCurUSD (Coin Metrics, journalier — BTC only en community)
  // Cycle on-chain BTC (bitcoin-data.com, journalier) : le vrai anti-tempête est le
  // cache 24h + quota interne de fetchBgeometricMetrique ; ce TTL aux évite juste des
  // ré-alignements trop fréquents.
  nupl: 60 * 60_000,
  puell: 60 * 60_000,
  sopr: 60 * 60_000,
  reserveRisk: 60 * 60_000,
  mvrvZ: 60 * 60_000, // vrai MVRV Z-Score (realized-cap, bitcoin-data)
  realizedPrice: 60 * 60_000, // prix on-chain moyen (bitcoin-data)
  asopr: 60 * 60_000,
  sthSopr: 60 * 60_000,
  lthSopr: 60 * 60_000,
  rhodl: 60 * 60_000,
  cvdd: 60 * 60_000,
  balancedPrice: 60 * 60_000,
  btcDominance: 60 * 60_000, // dominance BTC globale (bitcoin-data)
  quarterlyBasis: 5 * 60_000, // basis future trimestriel (klines 1h Binance COIN-M)
  lsAccount: 5 * 60_000, // ratio comptes long/short (Binance futures)
  lsTopTrader: 5 * 60_000, // ratio positions top traders
  lsTaker: 5 * 60_000, // ratio taker acheteur/vendeur
  fearGreed: 60 * 60_000, // Fear & Greed global (Alternative.me, journalier)
  // Flux de liquidations par bougie (Coinalyze, à l'interval du chart) — cadence flux.
  liqLongUsd: 60_000,
  liqShortUsd: 60_000,
  // Hashrate réseau BTC (mempool.space, journalier — le client a son propre cache 6 h).
  hashrate: 60 * 60_000,
  // Métriques de cycle BGeometrics (journalier ; cache 24 h + quota interne en primaire).
  sthMvrv: 60 * 60_000,
  lthMvrv: 60 * 60_000,
  nrplUsd: 60 * 60_000,
  vddMultiple: 60 * 60_000,
  aviv: 60 * 60_000,
  supplyProfit: 60 * 60_000,
  supplyLoss: 60 * 60_000,
  // Funding horaire Hyperliquid + positionnement net des gros comptes HL (daemon) —
  // cadence proche temps réel, comme `funding`.
  hlFunding: 60_000,
  binanceFundingHourly: 60_000,
  fundingHistBinance: 60_000,
  fundingHistBybit: 60_000,
  fundingHistOkx: 60_000,
  fundingHistHl: 60_000,
  hlWhalesNet: 60_000,
};
/** Durée de mémorisation d'un échec de fetch (anti retry-tempête). */
const ERROR_TTL_MS = 30_000;
/** Profondeur d'historique demandée aux fournisseurs (90 jours). */
const LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;
/**
 * Profondeur d'un fetch `refClose` en UN appel (patron cbprem/derivatives). Un niveau :
 * `binanceAdapter.fetchKlines` sans borne temporelle rend les `limit` bougies les plus
 * RÉCENTES (atteint `now` sans pagination), 720 couvrant la vue initiale (backfill 500).
 * Au-delà (scroll historique) les bougies plus anciennes restent `undefined` (LOCF sans
 * antériorité) — dégradation gracieuse cohérente avec la clé sans composante de plage.
 */
const REFCLOSE_LIMIT = 720;
/** Intervalle d'agrégation Coinalyze pour OI/funding (cf. COINALYZE_INTERVALS). */
const COINALYZE_INTERVAL = "1hour";
/** Durée du bucket `COINALYZE_INTERVAL`, en ms. */
const COINALYZE_BUCKET_MS = 60 * 60_000;
/**
 * Séries dont les points portent l'INSTANT OÙ LEUR VALEUR EST CONNUE → alignées sur la
 * CLÔTURE de bougie (cf. la convention en tête d'`alignAux`). Les autres restent sur
 * l'ouverture : appariées 1:1 (`perpDelta`, `refClose`) ou horodatées au début de leur
 * période (séries quotidiennes), le mode clôture leur ferait lire la période suivante.
 */
const AUX_SUR_CLOTURE: ReadonlySet<AuxSeriesId> = new Set<AuxSeriesId>([
  "oi",
  "funding",
  // `hlFunding` porte l'instant de règlement horaire ; `hlWhalesNet` l'instant de
  // l'instantané daemon — tous deux connus À leur ts → alignés sur la clôture.
  "hlFunding",
  "hlWhalesNet",
]);

/**
 * Timeframe du chart → intervalle Coinalyze `liquidation-history` + durée du bucket.
 * Un tf sans équivalent Coinalyze (1w, 1M, 3m, sous-minute…) → absent → série vide.
 */
const INTERVALLE_LIQ: Partial<Record<Timeframe, { interval: CoinalyzeInterval; ms: number }>> = {
  "1m": { interval: "1min", ms: 60_000 },
  "5m": { interval: "5min", ms: 300_000 },
  "15m": { interval: "15min", ms: 900_000 },
  "30m": { interval: "30min", ms: 1_800_000 },
  "1h": { interval: "1hour", ms: 3_600_000 },
  "2h": { interval: "2hour", ms: 7_200_000 },
  "4h": { interval: "4hour", ms: 14_400_000 },
  "6h": { interval: "6hour", ms: 21_600_000 },
  "12h": { interval: "12hour", ms: 43_200_000 },
  "1d": { interval: "daily", ms: 86_400_000 },
};
/**
 * Plafond de points MESURÉ sur `liquidation-history` (sonde réelle 2026-09-22 via le
 * proxy : 30 j en `5min` → 2 545 points ≈ 8,8 j effectifs ; 14 j → 2 468 ; 3 j en
 * `1min` → 1 271 ; 90 j → 0). La fenêtre `since` est donc bornée à
 * `LIQ_POINTS_MAX × durée du bucket` — au-delà l'API tronque la tête de la série.
 */
const LIQ_POINTS_MAX = 2500;

/**
 * Promesse partagée du fetch `liquidation-history` : `liqLongUsd` ET `liqShortUsd`
 * (def `liqParBougie`) consomment LA MÊME série — une seule requête par (symbole, tf),
 * purgée à la résolution (le TTL `Entry` prend ensuite le relais).
 */
const liqFluxEnVol = new Map<string, Promise<LiquidationHistPoint[]>>();

function fetchLiqFlux(
  symbol: string,
  timeframe: Timeframe,
  depuis: number,
  interval: CoinalyzeInterval,
): Promise<LiquidationHistPoint[]> {
  const key = `${symbol}:${timeframe}`;
  let p = liqFluxEnVol.get(key);
  if (p === undefined) {
    p = fetchLiquidationHistory(symbol, depuis, interval);
    liqFluxEnVol.set(key, p);
    void p.finally(() => {
      if (liqFluxEnVol.get(key) === p) liqFluxEnVol.delete(key);
    });
  }
  return p;
}

/** Entrée de cache pour une clé `(id, symbole)`. */
type Entry =
  | { state: "pending"; onReadys: Array<() => void> }
  | { state: "ready"; points: AuxPoint[]; expires: number }
  | { state: "error"; message: string; expires: number };

/**
 * Réhorodate un point d'historique Coinalyze à l'instant où sa valeur est CONNUE.
 * VÉRIFIÉ sur l'API le 2026-09-02 : `t` est le DÉBUT du bucket et la valeur retenue est
 * sa clôture (`c`) — le point 1 min `t=08:05` portait la valeur du snapshot
 * `/open-interest` relevé à 08:05:42, et la clôture du bucket 1 h `t=07:00` égalait
 * celle du bucket 1 min `07:59`. Datée à `t`, cette valeur est donc FUTURE d'un bucket.
 * Le bucket EN COURS, lui, n'a pas atteint sa fin : sa clôture est la dernière valeur
 * OBSERVÉE, d'où la borne à `Date.now()` (sans quoi la bougie live perdrait jusqu'à
 * une heure de fraîcheur).
 */
function instantConnuCoinalyze(t: number): number {
  return Math.min(t + COINALYZE_BUCKET_MS, Date.now());
}

/** Nettoie une série brute pour `alignAux` : écarte le non-fini, trie par time croissant. */
function toPoints(raw: AuxPoint[]): AuxPoint[] {
  return raw
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value))
    .sort((a, b) => a.time - b.time);
}

/** Pas de chart non couverts par le helper de durée du backtest. */
const PAS_FIXES_HORS_BT: Partial<Record<Timeframe, number>> = {
  "1s": 1_000, "5s": 5_000, "15s": 15_000, "3m": 180_000,
};
const MOIS_PAR_TIMEFRAME: Partial<Record<Timeframe, number>> = {
  "1M": 1, "3M": 3, "6M": 6, "12M": 12,
};

/** Vraie clôture prévue en UTC, même si des bougies suivantes sont absentes. */
function clotureTheoriqueFunding(t: number, timeframe: Timeframe): number | null {
  const pasFixe = dureeTimeframeMs(timeframe) ?? PAS_FIXES_HORS_BT[timeframe];
  if (pasFixe !== undefined && pasFixe !== null) return t + pasFixe;
  const mois = MOIS_PAR_TIMEFRAME[timeframe];
  if (mois === undefined) return null;
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + mois, 1);
}

/** Alignement à la clôture du funding Binance, sans LOCF au-delà du prochain règlement attendu. */
function alignerFundingBinance(candleTimes: number[], points: AuxPoint[], timeframe: Timeframe): Array<number | undefined> {
  const out = new Array<number | undefined>(candleTimes.length).fill(undefined);
  let j = 0;
  let courant: AuxPoint | undefined;
  for (let i = 0; i < candleTimes.length; i++) {
    const t = candleTimes[i]!;
    const prochain = candleTimes[i + 1];
    const theorique = clotureTheoriqueFunding(t, timeframe);
    if (theorique === null || !Number.isFinite(theorique)) continue;
    const cloture = Math.min(theorique, prochain ?? Infinity);
    const borne = prochain === undefined ? Math.min(cloture, Date.now()) : cloture;
    while (j < points.length && points[j]!.time <= borne) courant = points[j++];
    if (courant !== undefined && Number.isFinite(courant.value) && courant.validUntil !== undefined && borne < courant.validUntil) {
      out[i] = courant.value;
    }
  }
  return out;
}

/**
 * Dérive l'asset Coin Metrics d'un symbole de trading (BTCUSDT→btc) : retire le
 * quote courant et minusculise la base. ⚠️ Coin Metrics community ne couvre en
 * pratique que BTC (cf. `coinmetrics.ts`) → les autres assets rendent des séries
 * vides (dégradation gracieuse, jamais d'erreur).
 */
function symbolToAsset(symbol: string): string {
  const actif = basePerp(symbol);
  if (actif !== null) return actif.toLowerCase();
  const s = symbol.trim().toUpperCase();
  const base = s.replace(/(USDT|USDC|FDUSD|BUSD|USD)$/, "");
  return (base.length > 0 ? base : s).toLowerCase();
}

/** Symbole fapi (perp USDT) à partir d'un symbole chart (BTCUSDT, BTCUSDT_PERP…). */
function toFuturesSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/_PERP$/i, "").replace(/PERP$/i, "");
}

/**
 * Historique mark au PAS DU GRAPHE via Binance fapi. Pagination arrière, 4500 dernières
 * barres maximum. Chaque close reste attaché à sa propre bougie ; le bar live contient
 * uniquement la dernière observation disponible. L'alignement exact interdit tout report
 * vers une bougie de clôture différente, notamment à travers un trou de données.
 * PURE côté parse ; réseau dans cette fonction uniquement (couche web autorisée).
 */
async function fetchMarkPriceHistory(symbol: string, since: number, interval: string): Promise<AuxPoint[]> {
  const sym = toFuturesSymbol(symbol);
  const out: AuxPoint[] = [];
  const now = Date.now();
  let endTime = now;
  for (let page = 0; page < 3; page++) {
    const q = new URLSearchParams({
      symbol: sym,
      interval,
      endTime: String(endTime),
      limit: "1500",
    });
    const res = await fetch(extUrl("fapi.binance.com", `fapi/v1/markPriceKlines?${q}`));
    if (!res.ok) {
      if (out.length > 0) break; // partiel OK
      throw new Error(`markPriceKlines HTTP ${res.status}`);
    }
    const raw: unknown = await res.json();
    if (!Array.isArray(raw) || raw.length === 0) break;
    let firstT = Infinity;
    for (const row of raw) {
      if (!Array.isArray(row) || row.length < 5) continue;
      const t = Number(row[0]);
      const close = Number(row[4]); // close = mark à la fin de la bougie
      if (!Number.isFinite(t) || !Number.isFinite(close) || close <= 0 || t > now) continue;
      out.push({ time: t, value: close });
      firstT = Math.min(firstT, t);
    }
    if (!Number.isFinite(firstT) || firstT <= since || firstT > endTime || raw.length < 1500) break;
    endTime = firstT - 1;
  }
  return toPoints(out.filter((p) => p.time >= since));
}

/**
 * Historique du delta agresseur perp par bougie via Binance fapi klines (proxy
 * /extapi). Fetché À L'INTERVAL DU CHART (`interval`, dérivé du timeframe courant) :
 * un flux ≠ un niveau — le fetcher en 1h fixe puis LOCF fabriquerait un flux faux
 * (delta horaire jeté en 1d, répété/cumulé en 1m). À interval identique, l'alignement
 * `alignAux` tombe 1:1 (mêmes openTime UTC pour les klines spot et perp Binance).
 * Pagination ARRIÈRE (via `endTime`, ≠ `fetchMarkPriceHistory` qui pagine en avant
 * mais reste épinglé à 1h) : le flux se lit près de `now`, donc on récupère les
 * bougies RÉCENTES d'abord. `startTime`-seul renverrait au contraire les plus VIEILLES
 * de la fenêtre → sur interval fin, le plafond de 3 pages n'atteindrait jamais `now`
 * et un LOCF fabriquerait un flux constant sur toute la vue récente. Parse via
 * `deltaDepuisKlinesPerp` (PURE, testée) : delta = 2 × takerBuyBase − volume.
 * 3 pages (limit 1500) : couvre 90 j en ≥30m ; en interval plus fin, couvre les ~4500
 * DERNIÈRES bougies (couverture partielle du début tolérée par l'ancrage commun du def).
 * Dégradation gracieuse propre à cette série (contrat Task 1) : pas de perp / symbole
 * non listé en futures / échec réseau → SÉRIE VIDE (jamais de throw ni d'état `error`),
 * de sorte que la jambe perp du def `cvdSpotPerp` disparaisse sans masquer le CVD spot.
 */
async function fetchPerpDeltaHistory(
  symbol: string,
  since: number,
  interval: string
): Promise<AuxPoint[]> {
  const sym = toFuturesSymbol(symbol);
  const out: AuxPoint[] = [];
  let endTime = Date.now();
  try {
    for (let page = 0; page < 3; page++) {
      const q = new URLSearchParams({
        symbol: sym,
        interval,
        endTime: String(endTime), // borne HAUTE : Binance rend les `limit` plus récentes ≤ endTime.
        limit: "1500",
      });
      const res = await fetch(extUrl("fapi.binance.com", `fapi/v1/klines?${q}`));
      if (!res.ok) break; // partiel OK ; symbole non listé / échec → vide.
      const raw: unknown = await res.json();
      if (!Array.isArray(raw) || raw.length === 0) break;
      const points = deltaDepuisKlinesPerp(raw as unknown[][]);
      for (const p of points) out.push({ time: p.t, value: p.delta });
      const firstT = points.length > 0 ? points[0]?.t : undefined;
      if (firstT === undefined) break;
      if (firstT <= since) break; // début de la fenêtre 90 j atteint
      endTime = firstT - 1; // page suivante = bloc plus ancien, juste avant.
      if (raw.length < 1500) break;
    }
  } catch {
    // Réseau/CORS/blocage régional : jambe perp absente, dégradation → série vide.
    return [];
  }
  // Borne basse 90 j (les pages arrière peuvent déborder sous `since`) ; toPoints trie.
  return toPoints(out.filter((p) => p.time >= since));
}

/**
 * Récupère la série brute d'une famille auxiliaire pour un symbole, normalisée en
 * `AuxPoint[]` triés. Une exception (source injoignable) remonte → cache `error`.
 * `timeframe` est utilisé par `mark`, `perpDelta` (flux) et `refClose` (niveau apparié),
 * tous deux fetchés à l'interval du chart ; les autres séries de niveaux gardent leur
 * granularité brute fixe et l'ignorent.
 */
async function rawFetch(id: AuxSeriesId, symbol: string, timeframe: Timeframe, exchange: ExchangeId): Promise<AuxPoint[]> {
  const since = Date.now() - LOOKBACK_MS;
  switch (id) {
    case "oi": {
      // Coinalyze en primaire (points RÉHORODATÉS, cf. instantConnuCoinalyze), repli
      // Binance `openInterestHist` sinon — MÊME arbitrage que `histOiUsdAvecRepli`,
      // déplié ici (patron `funding` ci-dessous) parce que seuls les points Coinalyze
      // doivent être décalés : ceux du repli portent déjà leur instant de relevé.
      if (coinalyzeKeyStore.getState().hasKey) {
        try {
          const h = await coinalyzeProvider.fetchOpenInterestHistory(symbol, COINALYZE_INTERVAL, since);
          const points = toPoints(
            h.map((p) => ({ time: instantConnuCoinalyze(p.time), value: p.oiUsd }))
          );
          if (points.length > 0) return points;
        } catch {}
      }
      const h = await histOiUsd(symbol);
      return toPoints((h ?? []).map((p) => ({ time: p.t, value: p.v })));
    }
    case "oiDebutLiqUsd": {
      if (!coinalyzeKeyStore.getState().hasKey) return [];
      const m = INTERVALLE_LIQ[timeframe];
      if (m === undefined) return [];
      // La clôture du bucket précédent devient l'OI connu à l'ouverture suivante.
      // Appariement exact seulement : une lacune ne propage jamais le dernier OI.
      const depuis = Math.max(since, Date.now() - (LIQ_POINTS_MAX + 1) * m.ms);
      const h = await coinalyzeProvider.fetchOpenInterestHistory(symbol, m.interval, depuis);
      const now = Date.now();
      return toPoints(h.filter((p) => p.time + m.ms <= now)
        .map((p) => ({ time: p.time + m.ms, value: p.oiUsd })));
    }
    case "funding": {
      if (coinalyzeKeyStore.getState().hasKey) {
        try {
          const h = await coinalyzeProvider.fetchFundingRateHistory(symbol, COINALYZE_INTERVAL, since);
          const points = toPoints(
            h.map((f) => ({ time: instantConnuCoinalyze(f.time), value: f.rate }))
          );
          if (points.length > 0) return points;
        } catch {}
      }
      // Repli : `fundingRate` Binance porte l'instant de RÈGLEMENT — déjà l'instant connu.
      const h = await histFunding(symbol);
      return toPoints((h ?? []).map((p) => ({ time: p.t, value: p.v })));
    }
    case "mark": {
      const interval = timeframeToFapiInterval(timeframe);
      return interval === undefined ? [] : fetchMarkPriceHistory(symbol, since, interval);
    }
    case "perpDelta": {
      // Delta agresseur perp par bougie (gratuit, fapi klines à l'interval du chart) —
      // jambe perp du CVD spot vs perp. Toujours ciblé Binance USDT-M. Timeframe non
      // supporté par fapi (sous-minute, 3M/6M/12M) → série vide ; échec/pas de perp → vide.
      const interval = timeframeToFapiInterval(timeframe);
      if (interval === undefined) return [];
      return fetchPerpDeltaHistory(symbol, since, interval);
    }
    case "refClose":
    case "refCloseStrict": {
      // Close du symbole de RÉFÉRENCE (refSymbolStore) — jambe « croisée » des indicateurs
      // statistiques (corrélation/bêta/spread z-score vs référence). NIVEAU (≠ flux
      // perpDelta) : le LOCF d'`alignAux` le rééchantillonne sans le fausser. On le fetch
      // néanmoins à l'interval du chart (klines SPOT Binance, `binanceAdapter.fetchKlines`
      // existant) pour un appariement 1:1 propre ; `timeframeToFapiInterval` sert ici de
      // simple GARDE de support (sous-minute / 3M-6M-12M → série vide, comme perpDelta).
      // `symbol` porte déjà le refSymbol (résolu dans getAligned, cohérent avec la clé).
      // Dégradation gracieuse (patron perpDelta) : refSymbol invalide (HTTP 4xx → throw de
      // fetchKlines) / échec réseau → série VIDE, jamais d'état `error` qui masquerait les
      // autres séries de la requête.
      if (timeframeToFapiInterval(timeframe) === undefined) return [];
      try {
        const candles = await binanceAdapter.fetchKlines(symbol, timeframe, {
          limit: REFCLOSE_LIMIT,
        });
        return toPoints(candles.map((c) => ({ time: c.time, value: c.close })));
      } catch {
        return [];
      }
    }
    case "stablecoins": {
      const s = await stablecoinsSupplyProvider.fetchSeries({ start: since });
      return toPoints(s.map((p) => ({ time: p.time, value: p.value })));
    }
    case "nvt":
      return toPoints(await fetchNvtHistory(since));
    case "mvrv": {
      // MVRV = CapMVRVCur, disponible dans Coin Metrics Community (BTC).
      const r = await fetchCoinMetrics(symbolToAsset(symbol));
      const serie = r?.series.CapMVRVCur;
      return toPoints((serie?.points ?? []).map((p) => ({ time: p.time, value: p.value })));
    }
    case "marketcap": {
      // Capitalisation USD (CapMrktCurUSD) — déjà dans CM_METRIQUES. BTC only en community.
      const r = await fetchCoinMetrics(symbolToAsset(symbol));
      const serie = r?.series.CapMrktCurUSD;
      return toPoints((serie?.points ?? []).map((p) => ({ time: p.time, value: p.value })));
    }
    case "nupl":
    case "puell":
    case "sopr":
    case "reserveRisk":
    case "mvrvZ":
    case "realizedPrice":
    case "asopr":
    case "sthSopr":
    case "lthSopr":
    case "rhodl":
    case "cvdd":
    case "balancedPrice":
    case "sthMvrv":
    case "lthMvrv":
    case "nrplUsd":
    case "vddMultiple":
    case "aviv":
    case "supplyProfit":
    case "supplyLoss": {
      // Métriques on-chain BTC (bitcoin-data.com). Réutilise le fetch dédié (cache 24h +
      // quota partagés avec OnchainWindow → aucun appel réseau dupliqué). BTC uniquement :
      // les autres actifs restent vides (dégradation gracieuse).
      if (symbolToAsset(symbol) !== "btc") return [];
      const bg = await chargerClientBg();
      const def = bg[BG_DEF_PAR_AUX[id]];
      const r = await bg.fetchBgeometricMetrique(def, getBgeometricsKey());
      return toPoints((r?.serie.points ?? []).map((p) => ({ time: p.time, value: p.value })));
    }
    case "quarterlyBasis": {
      // Basis annualisé du future trimestriel courant — BTC/ETH uniquement (COIN-M).
      const asset = symbolToAsset(symbol);
      if (asset !== "btc" && asset !== "eth") return [];
      const pts = await fetchQuarterlyBasisHistory(asset === "btc" ? "BTC" : "ETH", since);
      return toPoints(pts);
    }
    case "lsAccount":
      return toPoints(await fetchLsAccountRatio(symbol));
    case "lsTopTrader":
      return toPoints(await fetchLsTopTraderRatio(symbol));
    case "lsTaker":
      return toPoints(await fetchTakerRatio(symbol));
    case "fearGreed":
      // Sentiment GLOBAL crypto (pas par actif) — même série pour tous les symboles.
      return toPoints(await fetchFearGreedHistory(120));
    case "btcDominance": {
      // Dominance BTC GLOBALE (non gatée sur l'actif) — pertinente sur tout chart.
      const bg = await chargerClientBg();
      const r = await bg.fetchBgeometricMetrique(bg.BG_BTC_DOMINANCE, getBgeometricsKey());
      return toPoints((r?.serie.points ?? []).map((p) => ({ time: p.time, value: p.value })));
    }
    case "liqLongUsd":
    case "liqShortUsd": {
      // Flux de liquidations EXÉCUTÉES par bougie (≠ niveau) : fetché à l'intervalle
      // du chart et apparié 1:1 (clé `id:symbole:tf`, patron `perpDelta`). Sans clé
      // Coinalyze → [] ; tf non mappable → []. Les deux ids partagent UN seul fetch
      // (`fetchLiqFlux`). `pt.time` = DÉBUT du bucket (openTime) → alignement ouverture.
      if (!coinalyzeKeyStore.getState().hasKey) return [];
      const m = INTERVALLE_LIQ[timeframe];
      if (m === undefined) return [];
      const depuis = Math.max(since, Date.now() - LIQ_POINTS_MAX * m.ms);
      const pts = await fetchLiqFlux(symbol, timeframe, depuis, m.interval);
      return toPoints(
        pts.map((p) => ({ time: p.time, value: id === "liqLongUsd" ? p.longUsd : p.shortUsd })),
      );
    }
    case "hashrate": {
      // Hashrate réseau BTC (mempool.space /mining/hashrate/1y, cache 6 h interne).
      // Module PARESSEUX : chargé au premier besoin (patron `chargerClientBg`).
      if (symbolToAsset(symbol) !== "btc") return [];
      const mp = await chargerMempool();
      const r = await mp.fetchHashrate();
      return toPoints((r?.donnee.points ?? []).map((p) => ({ time: p.time, value: p.value })));
    }
    case "hlFunding": {
      // Funding HORAIRE Hyperliquid (fraction) — appel direct api.hyperliquid.xyz,
      // module paresseux `data/hyperliquidFunding`. Coin de base du symbole (BTC…).
      const coin = basePerp(symbol);
      if (coin === null) return [];
      const mod = await chargerHlFunding();
      return toPoints(await mod.fetchHlFundingHistory(hyperliquidCoin(`${coin}-PERP`), since));
    }
    case "binanceFundingHourly": {
      const sym = toFuturesSymbol(symbol);
      const mod = await chargerBinanceFunding();
      const points = await mod.fetchBinanceFundingHourly(sym, since);
      // NaN interne = règlement connu dont le taux/cadence est inconnu ; le point doit
      // rester présent pour interrompre l'alignement, sans passer par `toPoints`.
      return points.map((p) => ({ time: p.time, value: p.value ?? Number.NaN, validUntil: p.validUntil }));
    }
    case "fundingHistBinance":
    case "fundingHistBybit":
    case "fundingHistOkx":
    case "fundingHistHl": {
      const venue = id === "fundingHistBinance" ? "binance"
        : id === "fundingHistBybit" ? "bybit"
          : id === "fundingHistOkx" ? "okx" : "hyperliquid";
      const mod = await import("../data/fundingHistory");
      const historique = await mod.chargerFundingVenue(venue, symbol, 90, fetch, exchange);
      // Les erreurs restent propres à la venue : le moteur affiche des trous
      // (0/4…3/4) et FUNDX expose l'erreur détaillée via ce même client.
      if (historique.status === "error") return [];
      return historique.points.map((p) => ({ time: p.time, value: p.value ?? Number.NaN, validUntil: p.validUntil }));
    }
    case "hlWhalesNet": {
      // Positionnement net des gros comptes HL : 100 × (long − short) / (long + short)
      // par instantané du collecteur daemon (`/hl/liqheat`). ÉCHANTILLON du leaderboard,
      // jamais le marché entier. Pas ≥ 5 min (cadence de collecte) → clé avec tf.
      const coin = basePerp(symbol);
      if (coin === null) return [];
      const pas = Math.max(5 * 60_000, dureeTimeframeMs(timeframe) ?? 0);
      const brut = await hlLiqHeatGet(coin, {
        depuis: Date.now() - 14 * 24 * 3_600_000,
        pas,
      });
      if (brut === null) return [];
      const mod = await import("../data/hyperliquidHeat");
      const rep = mod.mapperReponseHeat(brut);
      if (rep === null) return [];
      const pts: AuxPoint[] = [];
      for (const s of rep.instantanes) {
        const total = s.longUsd + s.shortUsd;
        if (total <= 0) continue;
        pts.push({ time: s.ts, value: (100 * (s.longUsd - s.shortUsd)) / total });
      }
      return toPoints(pts);
    }
  }
}

let clientBg: Promise<typeof import("../data/onchain/bgeometrics")> | undefined;
function chargerClientBg(): Promise<typeof import("../data/onchain/bgeometrics")> {
  return clientBg ??= import("../data/onchain/bgeometrics").catch((err) => {
    clientBg = undefined;
    throw err;
  });
}

/** Aux id on-chain → définition BGeometrics correspondante. */
// Noms d'exports uniquement : le client à quota n'est chargé qu'au premier besoin.
const BG_DEF_PAR_AUX = {
  nupl: "BG_NUPL",
  puell: "BG_PUELL",
  sopr: "BG_SOPR",
  reserveRisk: "BG_RESERVE_RISK",
  mvrvZ: "BG_MVRV",
  realizedPrice: "BG_REALIZED_PRICE",
  asopr: "BG_ASOPR",
  sthSopr: "BG_STH_SOPR",
  lthSopr: "BG_LTH_SOPR",
  rhodl: "BG_RHODL",
  cvdd: "BG_CVDD",
  balancedPrice: "BG_BALANCED_PRICE",
  sthMvrv: "BG_STH_MVRV",
  lthMvrv: "BG_LTH_MVRV",
  nrplUsd: "BG_NRPL_USD",
  vddMultiple: "BG_VDD_MULTIPLE",
  aviv: "BG_AVIV",
  supplyProfit: "BG_SUPPLY_PROFIT",
  supplyLoss: "BG_SUPPLY_LOSS",
} as const satisfies Record<string, keyof typeof import("../data/onchain/bgeometrics")>;

let clientMempool: Promise<typeof import("../data/onchain/mempool")> | undefined;
/** Client mempool.space (hashrate) — paresseux : hors du chunk d'entrée (patron ci-dessus). */
function chargerMempool(): Promise<typeof import("../data/onchain/mempool")> {
  return clientMempool ??= import("../data/onchain/mempool").catch((err) => {
    clientMempool = undefined;
    throw err;
  });
}

let clientHlFunding: Promise<typeof import("../data/hyperliquidFunding")> | undefined;
/** Funding horaire HL — paresseux : hors du chunk d'entrée. */
function chargerHlFunding(): Promise<typeof import("../data/hyperliquidFunding")> {
  return clientHlFunding ??= import("../data/hyperliquidFunding").catch((err) => {
    clientHlFunding = undefined;
    throw err;
  });
}

let clientBinanceFunding: Promise<typeof import("../data/binanceFunding")> | undefined;
/** Funding historique Binance — paresseux : hors du chunk d'entrée. */
function chargerBinanceFunding(): Promise<typeof import("../data/binanceFunding")> {
  return clientBinanceFunding ??= import("../data/binanceFunding").catch((err) => {
    clientBinanceFunding = undefined;
    throw err;
  });
}

export class AuxProvider {
  /** Cache brut partagé (singleton) : clé `${id}:${symbole}` → entrée. */
  private readonly cache = new Map<string, Entry>();

  /**
   * Retourne l'état courant des `ids` demandés, alignés sur `candleTimes`. Déclenche
   * les fetchs manquants/expirés et rappelle `onReady` quand ils aboutissent.
   * Précédence de l'état global : `error` (≥ 1 série en échec) > `pending` (≥ 1 en
   * vol) > `ready` (toutes prêtes).
   */
  getAligned(req: AuxRequest, onReady: () => void): AuxStatus {
    const now = Date.now();
    const aux: AuxSeries = {};
    let errorMessage: string | undefined;
    let pending = false;

    for (const id of req.ids) {
      // `mark`, `perpDelta` (flux) et `refClose` sont fetchés à l'intervalle du
      // chart → leur clé intègre le timeframe. `refClose` porte de plus sur le symbole de
      // RÉFÉRENCE (refSymbolStore), pas celui du chart : le fetch ET la clé utilisent
      // `refSymbol` (lu UNE fois ici → cohérence clé/fetch). Changer de refSymbol produit
      // une clé différente → miss → refetch (l'ancienne entrée reste dans la Map jusqu'à ce
      // que ce refSymbol soit re-sélectionné, puis purgée-si-expirée). Niveaux : inchangés.
      const fetchSymbol = id === "refClose" || id === "refCloseStrict" ? refSymbolStore.getState().refSymbol : req.symbol;
      // Séries dont le fetch dépend de l'intervalle du chart : `mark`/`refClose`
      // (appariement 1:1 par ouverture), `perpDelta`/`liqLongUsd`/`liqShortUsd`
      // (FLUX — un LOCF les fausserait), `hlWhalesNet` (le `pas` dépend du tf).
      const cacheId = id === "refCloseStrict" ? "refClose" : id;
      const fundingBase = FUNDING_HIST_IDS.has(id) ? normaliserIdentiteFunding(req.exchange, req.symbol)?.base : undefined;
      const key = FUNDING_HIST_IDS.has(id)
        ? `${id}:${fundingBase ?? `${req.exchange}:${req.symbol}`}`
        : CLE_AVEC_TF.has(id)
        ? `${cacheId}:${fetchSymbol}:${req.timeframe}`
        : `${id}:${req.symbol}`;
      let entry = this.cache.get(key);

      // Purge d'une entrée ready/error expirée → force un re-fetch au besoin.
      if (entry !== undefined && entry.state !== "pending" && entry.expires <= now) {
        this.cache.delete(key);
        entry = undefined;
      }

      if (entry === undefined) {
        this.startFetch(id, fetchSymbol, req.timeframe, req.exchange, key, onReady);
        pending = true;
        continue;
      }
      if (entry.state === "pending") {
        entry.onReadys.push(onReady); // rejoint le fetch en vol (single-flight).
        pending = true;
        continue;
      }
      if (entry.state === "error") {
        errorMessage = entry.message;
        continue;
      }
      if (id === "mark" || id === "refCloseStrict" || id === "oiDebutLiqUsd") {
        const parOuverture = new Map(entry.points.map((p) => [p.time, p.value]));
        aux[id] = req.candleTimes.map((t) => parOuverture.get(t));
      } else if (id === "binanceFundingHourly" || id === "fundingHistBinance" || id === "fundingHistBybit" || id === "fundingHistOkx" || id === "fundingHistHl") {
        aux[id] = alignerFundingBinance(req.candleTimes, entry.points, req.timeframe);
      } else {
        aux[id] = alignAux(req.candleTimes, entry.points, AUX_SUR_CLOTURE.has(id));
      }
    }

    if (errorMessage !== undefined) return { status: "error", message: errorMessage };
    if (pending) return { status: "pending" };
    return { status: "ready", aux };
  }

  /** Lance un unique fetch pour `key` et notifie tous les `onReady` à sa résolution. */
  private startFetch(
    id: AuxSeriesId,
    symbol: string,
    timeframe: Timeframe,
    exchange: ExchangeId,
    key: string,
    onReady: () => void
  ): void {
    const entry: Entry = { state: "pending", onReadys: [onReady] };
    this.cache.set(key, entry);
    void rawFetch(id, symbol, timeframe, exchange).then(
      (points) => {
        this.cache.set(key, { state: "ready", points, expires: Date.now() + TTL_MS[id] });
        for (const cb of entry.onReadys) cb();
      },
      (err: unknown) => {
        const message = err instanceof Error ? err.message : "échec du fetch auxiliaire";
        this.cache.set(key, { state: "error", message, expires: Date.now() + ERROR_TTL_MS });
        for (const cb of entry.onReadys) cb();
      }
    );
  }
}

/**
 * Séries fetchées À L'INTERVALLE DU CHART → leur clé de cache porte le timeframe
 * (cf. en-tête : flux `perpDelta`/`liq*Usd`, appariements `mark`/`refClose`, et
 * `hlWhalesNet` dont le `pas` daemon dépend du tf).
 */
const CLE_AVEC_TF: ReadonlySet<AuxSeriesId> = new Set<AuxSeriesId>([
  "mark",
  "perpDelta",
  "refClose",
  "refCloseStrict",
  "oiDebutLiqUsd",
  "liqLongUsd",
  "liqShortUsd",
  "hlWhalesNet",
]);
const FUNDING_HIST_IDS: ReadonlySet<AuxSeriesId> = new Set<AuxSeriesId>([
  "fundingHistBinance", "fundingHistBybit", "fundingHistOkx", "fundingHistHl",
]);

/** Singleton module : cache brut partagé entre tous les slots/graphes. */
export const auxProvider = new AuxProvider();
