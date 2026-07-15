/**
 * Accumulation de klines HISTORIQUES pour le backtest (BT).
 *
 * Stratégie : cache daemon d'abord (candlesGet), puis complément par PAGINATION REST
 * Binance (1000 bougies/req, boucle sur `endTime` vers le passé) via l'adaptateur
 * `binanceAdapter.fetchKlines` (mapping OHLCV + drapeau `closed` déjà géré). Les nouvelles
 * bougies sont repoussées au daemon (candlesPush, best-effort) pour accélérer les runs
 * suivants. Repli mémoire pur si le daemon est absent (front 100 % fonctionnel sans lui).
 *
 * Bornes : plafond de CAP_BOUGIES (50 000) ; on ne conserve que les bougies CLÔTURÉES
 * (la bougie en formation, `closed === false`, est écartée — invariant « bougies
 * clôturées » du moteur). Progression rapportée au fil de l'eau.
 *
 * Audit profondeur (G100 C3) :
 *  - Chart : backfill 500, loadMore 500/req jusqu'à 20 000 bougies.
 *  - BT : pagination jusqu'à CAP_BOUGIES (50 k) ; plages UI jusqu'à 2 ans.
 *  - Daemon SQLite : GET limite max 50 k (store passif, pas de fetch autonome).
 *  - Acceptation : BTCUSDT 1d ≥ 500 barres → couvert par plage 2a (~730 j) +
 *    `precharger2ans1d` (pas d'endpoint daemon fetch dédié : profondeur déjà suffisante).
 *
 * Ce module vit sur le THREAD PRINCIPAL (il touche au daemon, comme le reste de data/) :
 * il produit le tableau de bougies, que le store transmet ensuite au worker du moteur.
 */
import type { Candle, Timeframe } from "@axiom/types";
import { binanceAdapter } from "./binance";
import { candlesGet, candlesPush, daemonSupporte, detectDaemon } from "./daemon";

/** Plafond dur de bougies accumulées (protège mémoire + temps de run). */
export const CAP_BOUGIES = 50_000;
/**
 * Seuil d'acceptation G100 C3 / profondeur « utile » pour un BT journalier
 * (BTCUSDT 1d ≥ 500 barres en local avec daemon). En dessous : message UI +
 * invitation à précharger 2 ans 1d.
 */
export const SEUIL_PROFONDEUR_BT = 500;
/** Durée de la plage « 2 ans » (ms) — alignée sur PLAGES du store backtest. */
export const DEUX_ANS_MS = 730 * 86_400_000;
/** Bougies par requête REST Binance (maximum autorisé). */
const MAX_PAR_REQ = 1000;
/** Intervalle mini entre deux requêtes (~8 req/s, marge sous les limites Binance). */
const REQ_INTERVAL_MS = 120;
/** Source de cache daemon (backtest crypto = Binance uniquement, cf. BUILD-CONTRACT). */
const SOURCE = "binance";

/**
 * Timeframes NATIFS Binance proposés au backtest (pas d'agrégation client 3M/6M/12M :
 * hors périmètre BT). Ordre = ordre du sélecteur.
 */
export const BACKTEST_TIMEFRAMES: Timeframe[] = [
  "1m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d", "3d", "1w",
];

/** Durée approximative d'une bougie (ms) — pour estimer la cible de progression. */
const TF_MS: Partial<Record<Timeframe, number>> = {
  "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "6h": 21_600_000,
  "12h": 43_200_000, "1d": 86_400_000, "3d": 259_200_000, "1w": 604_800_000,
};

/** Progression d'une accumulation (bougies obtenues / cible estimée). */
export interface ProgressionAccumulation {
  recuperees: number;
  cible: number;
}

/** Options d'accumulation (source de cache, callback progression, annulation). */
export interface OptionsAccumulation {
  onProgress?: (p: ProgressionAccumulation) => void;
  signal?: AbortSignal;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Lève une AbortError si le signal est déclenché (annulation coopérative). */
function verifierAnnulation(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Accumulation annulée", "AbortError");
}

/**
 * Dédoublonne par temps d'ouverture, trie chronologiquement, écarte la bougie non
 * clôturée et applique le plafond (on garde les plus RÉCENTES) et la plage demandée.
 */
function finaliser(brutes: Candle[], depuis: number, jusqua: number): Candle[] {
  const parTemps = new Map<number, Candle>();
  for (const c of brutes) parTemps.set(c.time, c);
  let arr = [...parTemps.values()].sort((a, b) => a.time - b.time);
  arr = arr.filter((c) => c.time >= depuis && c.time <= jusqua && c.closed !== false);
  if (arr.length > CAP_BOUGIES) arr = arr.slice(arr.length - CAP_BOUGIES);
  return arr;
}

/**
 * Accumule les bougies clôturées de `symbol`/`tf` sur la plage [depuis, jusqua].
 * Renvoie un tableau chronologique, dédoublonné et plafonné à CAP_BOUGIES.
 */
export async function accumulerKlines(
  symbol: string,
  tf: Timeframe,
  depuis: number,
  jusqua: number,
  opts: OptionsAccumulation = {},
): Promise<Candle[]> {
  const { onProgress, signal } = opts;
  const parMs = TF_MS[tf] ?? 60_000;
  const cible = Math.min(CAP_BOUGIES, Math.max(1, Math.ceil((jusqua - depuis) / parMs)));
  const rapporter = (recuperees: number): void =>
    onProgress?.({ recuperees: Math.min(recuperees, cible), cible });

  // 1) Cache daemon (best-effort). Peut couvrir tout ou partie de la plage.
  let cache: Candle[] = [];
  if (await detectDaemon("candles")) {
    const c = await candlesGet(SOURCE, symbol, tf, { depuis, jusqua, limite: CAP_BOUGIES });
    if (c) cache = c;
  }
  verifierAnnulation(signal);
  rapporter(cache.length);

  // Court-circuit : le cache couvre déjà la plage (bord ancien atteint + assez dense).
  const plusAncien = cache[0]?.time ?? Number.POSITIVE_INFINITY;
  const plusRecent = cache[cache.length - 1]?.time ?? Number.NEGATIVE_INFINITY;
  const couvreDebut = plusAncien <= depuis + parMs;
  const couvreFin = plusRecent >= jusqua - parMs * 3;
  const assezDense = cache.length >= cible * 0.98;
  if (cache.length > 0 && couvreDebut && couvreFin && assezDense) {
    return finaliser(cache, depuis, jusqua);
  }

  // 2) Pagination REST vers le passé (endTime décroissant) jusqu'à `depuis` ou au plafond.
  const nouvelles: Candle[] = [];
  let endTime = jusqua;
  while (nouvelles.length + cache.length < CAP_BOUGIES) {
    verifierAnnulation(signal);
    let lot: Candle[];
    try {
      lot = await binanceAdapter.fetchKlines(symbol, tf, { limit: MAX_PAR_REQ, endTime });
    } catch {
      // Panne réseau : on s'arrête avec ce qu'on a (dégradation gracieuse, pas de boucle).
      break;
    }
    if (lot.length === 0) break;

    for (const c of lot) if (c.time >= depuis && c.time <= jusqua) nouvelles.push(c);
    rapporter(cache.length + nouvelles.length);

    const plusAncienLot = lot[0]?.time; // Binance renvoie en ordre croissant
    if (plusAncienLot === undefined || plusAncienLot <= depuis) break;
    if (lot.length < MAX_PAR_REQ) break; // plus d'historique disponible en amont
    endTime = plusAncienLot - 1;
    await sleep(REQ_INTERVAL_MS);
  }

  // 3) Repousser les bougies fraîches au daemon (best-effort, ne bloque pas).
  if (daemonSupporte("candles") && nouvelles.length > 0) {
    void candlesPush(SOURCE, symbol, tf, nouvelles);
  }

  const resultat = finaliser([...cache, ...nouvelles], depuis, jusqua);
  rapporter(resultat.length);
  return resultat;
}

/**
 * Précharge ~2 ans de bougies journalières pour `symbol` (cache daemon + pagination
 * REST Binance). Réutilise `accumulerKlines` — pas d'endpoint daemon dédié : la
 * profondeur max (50 k / pagination 1000) suffit déjà pour ≥ 500 barres 1d.
 * Les bougies fraîches sont repoussées au daemon (best-effort) pour les runs suivants.
 */
export async function precharger2ans1d(
  symbol: string,
  opts: OptionsAccumulation = {},
): Promise<Candle[]> {
  const jusqua = Date.now();
  return accumulerKlines(symbol, "1d", jusqua - DEUX_ANS_MS, jusqua, opts);
}
