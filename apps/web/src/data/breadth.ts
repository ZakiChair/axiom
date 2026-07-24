/**
 * BREADTH — largeur de marché (« régime ») pour la section Régime du BRIEF.
 *
 * POURQUOI : donner en un coup d'œil la santé du marché crypto — quelle part de
 * l'univers liquide se tient au-dessus de ses moyennes mobiles longues (MM50/MM200),
 * l'avance/déclin (A/D) du jour, et la TENDANCE de la MM50 vs le calcul précédent.
 *
 * UNIVERS (décisions du contrôleur, mêmes requêtes que le screener/Signaux/Squeeze) :
 *   - Ticker 24 h Binance (`TICKER_24H_URL`, CORS *) → paires *USDT uniquement.
 *   - EXCLUSIONS (documentées, cf. `estSymboleExclu`) :
 *       • tokens à levier — suffixes UP/DOWN/BULL/BEAR (BTCUPUSDT, ETHDOWNUSDT, …),
 *         AVEC un carve-out des vrais tokens qui percutent le suffixe UP
 *         (JUPUSDT/Jupiter, SYRUPUSDT/Maple — volume réel, pas à levier) ;
 *       • stable-contre-stable (USDCUSDT, FDUSDUSDT, TUSDUSDT). EURUSDT est du forex
 *         réel : on le GARDE (ce n'est pas une paire stable-vs-stable).
 *   - A/D : sur l'univers USDT COMPLET post-exclusions (Δ24 h signé).
 *   - MM50/MM200 : sur le TOP 50 par volume (selectCandidates) — klines 1d limit 210,
 *     pool de concurrence 6, échecs tolérés et comptés (le symbole en échec ne compte pas).
 *
 * La bougie du jour EN COURS (dernière renvoyée par /klines) est ÉCARTÉE : les MM sont
 * calculées sur clôtures fermées uniquement → un calcul reproductible dans la fenêtre 12 h.
 *
 * CACHE localStorage `axiom:breadth:v1`, TTL 12 h : une ouverture du BRIEF dans la fenêtre
 * de fraîcheur ne déclenche AUCUN appel. Échec ticker → cache périmé si présent, sinon null.
 *
 * Séparation testable : tout le calcul est PUR (calculerAuDessusMm, estSymboleExclu,
 * filtrerUnivers, calculerAd, resumerBreadth, cacheEstFrais), testé avec fixtures inline ;
 * seul `fetchBreadth` fait des effets (fetch/localStorage) et n'est pas testé sur le réseau.
 */
import {
  parseTicker24h,
  selectCandidates,
  type ScreenerRow,
} from "./screener";
import { mapPool, TICKER_24H_URL } from "./screenerRun";

// ─────────────────────────── Type de sortie (consommé par T2) ───────────────────────────

/** Instantané de largeur de marché servi à la section Régime du BRIEF. */
export interface ResumBreadth {
  /** Nombre de symboles du top 50 pour lesquels des klines ont été obtenues. */
  nUnivers: number;
  /** % des symboles au-dessus de leur MM50 (dénominateur = symboles à ≥50 clôtures). */
  pctAuDessusMm50: number;
  /** % des symboles au-dessus de leur MM200 (dénominateur = symboles à ≥200 clôtures). */
  pctAuDessusMm200: number;
  /** Avance/déclin du jour sur l'univers USDT complet (Δ24 h signé). */
  adJour: { hausses: number; baisses: number };
  /** Valeur `pctAuDessusMm50` du cache précédent (tendance) — null au premier calcul. */
  pctMm50Prec: number | null;
  /** ms epoch du calcul. */
  ts: number;
}

// ─────────────────────────── Constantes ───────────────────────────

const CACHE_KEY = "axiom:breadth:v1";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 h
/** Taille de l'univers MM (top liquides). */
const TOP_N = 50;
/** Longueurs des moyennes mobiles suivies. */
const MM_COURTE = 50;
const MM_LONGUE = 200;
/**
 * Klines 1d demandées par symbole : 200 (MM200) + marge pour absorber l'écart de la
 * bougie du jour en cours et d'éventuels trous. La dernière (en cours) est écartée.
 */
const KLINE_LIMIT = 210;
/** Concurrence du pool klines (1 requête/symbole, budget << limites Binance). */
const CONCURRENCY = 6;
const KLINES_URL = "https://api.binance.com/api/v3/klines";

/**
 * Vrais tokens (volume réel, PAS à levier) dont le symbole percute le suffixe `UPUSDT` :
 *  - JUPUSDT  → Jupiter
 *  - SYRUPUSDT → Maple (SYRUP)
 * Carve-out documenté : sans lui, la règle de suffixe les exclurait à tort de l'univers.
 */
const CARVE_OUT_LEVIER = new Set(["JUPUSDT", "SYRUPUSDT"]);

/**
 * Paires stable-contre-stable exclues (leur Δ24 h ≈ 0 fausserait A/D et MM).
 * Liste COURTE et explicite. EURUSDT est ABSENT à dessein : c'est du forex réel.
 */
const STABLES_VS_STABLE = new Set(["USDCUSDT", "FDUSDUSDT", "TUSDUSDT"]);

// ─────────────────────────── Exclusions (PURES) ───────────────────────────

/** Suffixes des tokens à effet de levier Binance. */
const SUFFIXES_LEVIER = /(UP|DOWN|BULL|BEAR)USDT$/;

/**
 * true si le symbole doit être exclu de l'univers breadth : token à levier (hors
 * carve-out des vrais tokens) ou paire stable-contre-stable listée. PURE.
 */
export function estSymboleExclu(symbol: string): boolean {
  if (STABLES_VS_STABLE.has(symbol)) return true;
  if (CARVE_OUT_LEVIER.has(symbol)) return false;
  return SUFFIXES_LEVIER.test(symbol);
}

/** Retire de l'univers les symboles exclus (levier / stable-vs-stable). PURE. */
export function filtrerUnivers(rows: readonly ScreenerRow[]): ScreenerRow[] {
  return rows.filter((r) => !estSymboleExclu(r.symbol));
}

// ─────────────────────────── A/D (PURE) ───────────────────────────

/**
 * Avance/déclin : compte les hausses (Δ24 h > 0) et baisses (Δ24 h < 0).
 * L'inchangé (Δ = 0) n'est ni l'un ni l'autre. PURE.
 */
export function calculerAd(rows: readonly ScreenerRow[]): { hausses: number; baisses: number } {
  let hausses = 0;
  let baisses = 0;
  for (const r of rows) {
    if (r.priceChangePct24h > 0) hausses++;
    else if (r.priceChangePct24h < 0) baisses++;
  }
  return { hausses, baisses };
}

// ─────────────────────────── Moyenne mobile (PURE) ───────────────────────────

/**
 * true si la dernière clôture est STRICTEMENT au-dessus de la SMA simple des `longueur`
 * dernières clôtures ; false sinon ; null si moins de `longueur` clôtures disponibles. PURE.
 */
export function calculerAuDessusMm(closes: readonly number[], longueur: number): boolean | null {
  if (closes.length < longueur) return null;
  const fenetre = closes.slice(closes.length - longueur);
  const somme = fenetre.reduce((acc, v) => acc + v, 0);
  const sma = somme / longueur;
  const derniere = closes[closes.length - 1];
  return derniere !== undefined && derniere > sma;
}

// ─────────────────────────── Résumé (PURE) ───────────────────────────

/**
 * Assemble le résumé breadth à partir des clôtures par symbole (top 50), de l'A/D
 * (univers complet) et de la valeur MM50 précédente (tendance). Les dénominateurs des
 * pourcentages excluent les symboles où la MM n'est pas calculable (null) — et sont
 * SÉPARÉS pour MM50 et MM200 (un symbole à 60 clôtures compte en MM50, pas en MM200).
 * Dénominateur nul → 0 % (jamais NaN). PURE.
 */
export function resumerBreadth(
  parSymbole: readonly { closes: number[] }[],
  ad: { hausses: number; baisses: number },
  prec: number | null,
  nowMs: number,
): ResumBreadth {
  let denom50 = 0;
  let num50 = 0;
  let denom200 = 0;
  let num200 = 0;
  for (const { closes } of parSymbole) {
    const mm50 = calculerAuDessusMm(closes, MM_COURTE);
    if (mm50 !== null) {
      denom50++;
      if (mm50) num50++;
    }
    const mm200 = calculerAuDessusMm(closes, MM_LONGUE);
    if (mm200 !== null) {
      denom200++;
      if (mm200) num200++;
    }
  }
  return {
    nUnivers: parSymbole.length,
    pctAuDessusMm50: denom50 > 0 ? (num50 / denom50) * 100 : 0,
    pctAuDessusMm200: denom200 > 0 ? (num200 / denom200) * 100 : 0,
    adJour: { hausses: ad.hausses, baisses: ad.baisses },
    pctMm50Prec: prec,
    ts: nowMs,
  };
}

// ─────────────────────────── Cache (fraîcheur PURE + IO tolérant) ───────────────────────────

/** true si le cache est présent, non forcé et daté de moins de 12 h. PURE. */
export function cacheEstFrais(
  cached: ResumBreadth | null,
  nowMs: number,
  force: boolean,
): boolean {
  if (cached === null || force) return false;
  return nowMs - cached.ts < CACHE_TTL_MS;
}

/** Lecture tolérante du cache (localStorage absent/corrompu → null). */
function lireCache(): ResumBreadth | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as ResumBreadth) : null;
  } catch {
    return null;
  }
}

/** Écriture tolérante (quota / mode privé → silencieux). */
function ecrireCache(value: ResumBreadth): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(CACHE_KEY, JSON.stringify(value));
  } catch {
    /* best-effort */
  }
}

// ─────────────────────────── IO ───────────────────────────

/**
 * Récupère les clôtures 1d fermées d'un symbole (dernière bougie en cours ÉCARTÉE).
 * Rejette sur !ok — l'appelant tolère l'échec via Promise.allSettled.
 */
async function fetchCloturesJour(symbol: string): Promise<number[]> {
  const url = `${KLINES_URL}?symbol=${encodeURIComponent(symbol)}&interval=1d&limit=${KLINE_LIMIT}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`klines ${res.status}`);
  const raw: unknown = await res.json();
  if (!Array.isArray(raw)) return [];
  const closes: number[] = [];
  for (const k of raw) {
    if (!Array.isArray(k)) continue;
    const close = Number(k[4]);
    if (Number.isFinite(close)) closes.push(close);
  }
  // Écarte la bougie du jour en cours (dernière) → MM sur clôtures fermées.
  return closes.slice(0, -1);
}

/**
 * Point d'entrée breadth. Cache 12 h : retourné tel quel si frais et !force. Sinon :
 *   1. ticker 24 h → univers USDT post-exclusions (A/D) ;
 *   2. top 50 par volume → klines 1d (pool 6), échecs tolérés/comptés ;
 *   3. résumé + tendance (pctMm50Prec = pctAuDessusMm50 du cache AVANT écrasement) ;
 *   4. écriture du cache.
 * Échec du ticker → cache PÉRIMÉ si présent, sinon null.
 */
export async function fetchBreadth(force = false): Promise<ResumBreadth | null> {
  const cached = lireCache();
  if (cacheEstFrais(cached, Date.now(), force)) return cached;

  // 1. Univers USDT (post-exclusions). Échec → repli sur cache périmé, sinon null.
  let univers: ScreenerRow[];
  try {
    const res = await fetch(TICKER_24H_URL);
    if (!res.ok) throw new Error(`ticker24h ${res.status}`);
    univers = filtrerUnivers(parseTicker24h(await res.json(), ["USDT"]));
  } catch {
    return cached; // périmé si présent, sinon null
  }

  const ad = calculerAd(univers);

  // 2. Top 50 liquides → klines 1d en pool (échecs tolérés : le symbole n'est pas compté).
  const top = selectCandidates(univers, TOP_N);
  const resultats = await mapPool(top, CONCURRENCY, (row) =>
    fetchCloturesJour(row.symbol).then(
      (closes) => ({ closes }),
      () => null,
    ),
  );
  const parSymbole = resultats.filter((r): r is { closes: number[] } => r !== null);

  // 3. Résumé + tendance (valeur MM50 du cache précédent AVANT écrasement).
  const resume = resumerBreadth(parSymbole, ad, cached?.pctAuDessusMm50 ?? null, Date.now());

  // 4. Cache.
  ecrireCache(resume);
  return resume;
}
