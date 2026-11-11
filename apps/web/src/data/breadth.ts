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
 *   - MM50/MM200 : sur le TOP 50 par volume (selectCandidates) — klines 1d limit 400,
 *     pool de concurrence 6, échecs tolérés et comptés (le symbole en échec ne compte pas).
 *
 * La bougie du jour EN COURS est ÉCARTÉE (heure de clôture Binance ≥ maintenant, cf.
 * `parserKlinesFermees`) : les MM sont calculées sur clôtures fermées uniquement → un calcul
 * reproductible dans la fenêtre 12 h.
 *
 * HISTORIQUE (SUG-41, phase 1) — mêmes 50 requêtes, `KLINE_LIMIT` porté à 400 (une requête par
 * symbole, Binance plafonne à 1 000) : séries journalières PURES sur la grille des clôtures
 * fermées (`calculerHistoriqueLargeur`), descriptives :
 *   - % > MM50 et % > MM200 (k au-dessus sur n symboles à ≥ 50 / ≥ 200 clôtures ce jour-là) ;
 *   - solde des nouveaux plus hauts − plus bas de clôture sur 20 et 55 j (k = hauts − bas) ;
 *   - A/D TOP 50 (clôture vs clôture précédente ; k = hausses − baisses), sa ligne cumulée
 *     (base 0 au début de la fenêtre) et un oscillateur type McClellan (EMA 19 − EMA 39 du
 *     solde A/D en % des éligibles, convention transposée à 50 titres : bruitée) — à NE PAS
 *     confondre avec l'A/D du jour, calculé sur l'univers USDT complet depuis le ticker ;
 *   - part des alts qui battent BTC sur 90 j et 30 j (`data/saisonAlts.ts`).
 * Chaque point du jour D ne lit que des clôtures ≤ D (causalité par préfixe, testée). Un jour
 * sans symbole mesurable vaut n = 0 (« non mesuré »), jamais 0 %. ⚠️ Biais du survivant :
 * l'univers est le top 50 du JOUR appliqué au passé (affiché dans le BRIEF).
 *
 * CACHE localStorage `axiom:breadth:v1`, TTL 12 h : une ouverture du BRIEF dans la fenêtre
 * de fraîcheur ne déclenche AUCUN appel. Échec ticker → cache périmé si présent, sinon null.
 * Seules les séries DÉRIVÉES sont stockées (comptes entiers k/n et McClellan au dixième sur les
 * 200 derniers jours : 9 037 octets mesurés pour 50 symboles), jamais les 50 × 400 clôtures
 * (≈ 200 Ko). Un cache antérieur à l'historique (sans champ `historique`) est traité comme
 * périmé : un seul recalcul, tendance MM50 conservée.
 *
 * Séparation testable : tout le calcul est PUR (calculerAuDessusMm, estSymboleExclu,
 * filtrerUnivers, calculerAd, resumerBreadth, parserKlinesFermees, calculerHistoriqueLargeur,
 * conserverDerniersJours, partsSerie, ligneAdCumulee, cacheEstFrais), testé avec fixtures
 * inline ; seul `fetchBreadth` fait des effets (fetch/localStorage) et n'est pas testé sur le
 * réseau.
 */
import { ema } from "@axiom/indicators";
import {
  parseTicker24h,
  selectCandidates,
  type ScreenerRow,
} from "./screener";
import { mapPool, TICKER_24H_URL } from "./screenerRun";
import { calculerSaisonAlts, HORIZON_SAISON_COURT_JOURS, HORIZON_SAISON_JOURS } from "./saisonAlts";

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
  /**
   * Séries journalières des `JOURS_HISTORIQUE` derniers jours clôturés — null si aucune
   * clôture n'a pu être lue. (Absent d'un cache antérieur : traité comme périmé.)
   */
  historique: HistoriqueLargeur | null;
}

/** Clôtures 1d FERMÉES d'un symbole, datées du minuit UTC d'ouverture de chaque bougie. */
export interface CloturesDatees {
  symbol: string;
  /** Minuit UTC (ms) de chaque bougie, strictement croissant. */
  t: number[];
  closes: number[];
}

/**
 * Compte « k sur n » par jour : la part vaut 100·k/n ; n = 0 → non mesuré (null, jamais 0 %).
 * Entiers uniquement : forme compacte et exacte pour le cache.
 */
export interface SerieDenombree {
  k: number[];
  n: number[];
}

/** Séries de largeur sur une grille journalière contiguë (pas d'un jour, minuit UTC). */
export interface HistoriqueLargeur {
  /** Minuit UTC (ms) du premier jour ; le dernier est le dernier jour clôturé. */
  debut: number;
  /** k = symboles au-dessus de leur MM50, n = symboles à ≥ 50 clôtures ce jour-là. */
  mm50: SerieDenombree;
  /** k = symboles au-dessus de leur MM200, n = symboles à ≥ 200 clôtures ce jour-là. */
  mm200: SerieDenombree;
  /** k = nouveaux plus hauts − nouveaux plus bas de clôture sur 20 j, n = symboles à ≥ 21 clôtures. */
  hb20: SerieDenombree;
  /** Idem sur 55 j (n = symboles à ≥ 56 clôtures). */
  hb55: SerieDenombree;
  /** A/D top 50 : k = hausses − baisses (clôture vs précédente), n = symboles à ≥ 2 clôtures. */
  ad: SerieDenombree;
  /** Oscillateur type McClellan : EMA 19 − EMA 39 du solde A/D en % (0,1 près) ; null en amorce. */
  mcClellan: (number | null)[];
  /** k = alts battant BTC sur 90 j, n = alts à clôture en D et D − 90 (cf. saisonAlts). */
  saison90: SerieDenombree;
  /** Variante 30 j. */
  saison30: SerieDenombree;
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
 * Klines 1d demandées par symbole : 400 (≈ 200 jours de % > MM200 historisé, une requête par
 * symbole — Binance plafonne à 1 000). La bougie en cours est écartée.
 */
const KLINE_LIMIT = 400;
/** Une journée en millisecondes (grille des séries historisées). */
const JOUR_MS = 86_400_000;
/** Jours conservés et mis en cache des séries historisées (≈ profondeur de % > MM200). */
export const JOURS_HISTORIQUE = 200;
/** Fenêtres des nouveaux plus hauts / plus bas de clôture. */
const FENETRE_HB_COURTE = 20;
const FENETRE_HB_LONGUE = 55;
/** Longueurs EMA de l'oscillateur type McClellan (k = 0,10 et 0,05). */
const MCCLELLAN_RAPIDE = 19;
const MCCLELLAN_LENTE = 39;
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
 * true si la clôture d'index `i` est STRICTEMENT au-dessus de la SMA des `longueur` clôtures
 * qui finissent en `i` (incluse) ; null s'il y en a moins de `longueur`. Ne lit que les
 * clôtures ≤ i. Même ordre de sommation que l'instantané : le dernier point de l'historique
 * et `calculerAuDessusMm` donnent exactement le même résultat. PURE.
 */
function auDessusMmA(closes: readonly number[], i: number, longueur: number): boolean | null {
  if (i + 1 < longueur || i >= closes.length) return null;
  let somme = 0;
  for (let j = i - longueur + 1; j <= i; j++) somme += closes[j] ?? Number.NaN;
  const cloture = closes[i];
  return cloture !== undefined && cloture > somme / longueur;
}

/**
 * true si la dernière clôture est STRICTEMENT au-dessus de la SMA simple des `longueur`
 * dernières clôtures ; false sinon ; null si moins de `longueur` clôtures disponibles. PURE.
 */
export function calculerAuDessusMm(closes: readonly number[], longueur: number): boolean | null {
  return auDessusMmA(closes, closes.length - 1, longueur);
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
  historique: HistoriqueLargeur | null = null,
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
    historique,
  };
}

// ─────────────────────────── Historique (PUR) ───────────────────────────

/**
 * Arrondi au dixième (séries mises en cache : valeurs identiques en frais et relues ; −0, que
 * JSON écrit 0, est ramené à 0).
 */
function arrondi1(v: number): number {
  const r = Math.round(v * 10) / 10;
  return r === 0 ? 0 : r;
}

/**
 * Clôtures 1d FERMÉES d'une réponse /klines : une bougie n'est retenue que si son heure de
 * clôture (k[6], ouverture + 1 j − 1 ms) est PASSÉE — la bougie du jour en cours est donc
 * écartée, comme toute bougie non close ; sans k[6], ouverture + 1 j − 1 ms. Instant ramené au
 * minuit UTC ; entrée invalide, clôture non finie ou ≤ 0, jour non croissant : ignorés. PURE.
 */
export function parserKlinesFermees(raw: unknown, nowMs: number): { t: number[]; closes: number[] } {
  const t: number[] = [];
  const closes: number[] = [];
  if (!Array.isArray(raw)) return { t, closes };
  for (const k of raw) {
    if (!Array.isArray(k)) continue;
    const ouverture = Number(k[0]);
    const close = Number(k[4]);
    if (!Number.isFinite(ouverture) || !Number.isFinite(close) || close <= 0) continue;
    const clotureBrute = k[6] === null || k[6] === undefined ? Number.NaN : Number(k[6]);
    const heureCloture = Number.isFinite(clotureBrute) ? clotureBrute : ouverture + JOUR_MS - 1;
    if (heureCloture >= nowMs) continue; // bougie en cours (ou future) : jamais lue
    const jour = Math.floor(ouverture / JOUR_MS) * JOUR_MS;
    const precedent = t[t.length - 1];
    if (precedent !== undefined && jour <= precedent) continue;
    t.push(jour);
    closes.push(close);
  }
  return { t, closes };
}

/**
 * +1 si la clôture d'index `i` dépasse STRICTEMENT le plus haut des `fenetre` clôtures
 * précédentes (nouveau plus haut), −1 si elle passe sous leur plus bas, 0 sinon ; null s'il y
 * a moins de `fenetre` clôtures antérieures. Ne lit que les clôtures ≤ i. PURE.
 */
function hautOuBas(closes: readonly number[], i: number, fenetre: number): number | null {
  const cloture = closes[i];
  if (i < fenetre || cloture === undefined) return null;
  let plusHaut = Number.NEGATIVE_INFINITY;
  let plusBas = Number.POSITIVE_INFINITY;
  for (let j = i - fenetre; j < i; j++) {
    const v = closes[j] ?? Number.NaN;
    if (v > plusHaut) plusHaut = v;
    if (v < plusBas) plusBas = v;
  }
  if (cloture > plusHaut) return 1;
  return cloture < plusBas ? -1 : 0;
}

/** Signe de la variation clôture vs clôture précédente ; null sans clôture précédente. PURE. */
function sensVariation(closes: readonly number[], i: number): number | null {
  const cloture = closes[i];
  const precedente = closes[i - 1];
  if (cloture === undefined || precedente === undefined) return null;
  return Math.sign(cloture - precedente);
}

/** Ajoute une observation (`valeur` null : symbole non mesurable ce jour-là). */
function compter(serie: SerieDenombree, g: number, valeur: number | boolean | null): void {
  if (valeur === null) return;
  serie.n[g] = (serie.n[g] ?? 0) + 1;
  serie.k[g] = (serie.k[g] ?? 0) + (valeur === true ? 1 : valeur === false ? 0 : valeur);
}

/**
 * Oscillateur type McClellan : EMA 19 − EMA 39 (`ema` d'@axiom/indicators, amorce SMA) du solde
 * A/D en % des éligibles, sur les seuls jours mesurés (n > 0) ; null pendant l'amorce et les
 * jours non mesurés. La valeur du jour D ne dépend que des jours ≤ D. PURE.
 */
function oscillateurMcClellan(ad: SerieDenombree): (number | null)[] {
  const longueur = ad.n.length;
  const jours: number[] = [];
  const soldes: number[] = [];
  for (let g = 0; g < longueur; g++) {
    const n = ad.n[g] ?? 0;
    if (n > 0) {
      jours.push(g);
      soldes.push((100 * (ad.k[g] ?? 0)) / n);
    }
  }
  const rapide = ema(soldes, MCCLELLAN_RAPIDE);
  const lente = ema(soldes, MCCLELLAN_LENTE);
  const sortie: (number | null)[] = new Array<number | null>(longueur).fill(null);
  jours.forEach((g, j) => {
    const r = rapide[j];
    const l = lente[j];
    if (r !== undefined && l !== undefined) sortie[g] = arrondi1(r - l);
  });
  return sortie;
}

/**
 * Séries de largeur jour par jour sur la grille contiguë des clôtures fermées (du premier au
 * dernier jour vu, tous symboles confondus). Pour chaque jour D, un symbole ne compte que s'il a
 * une clôture à D et assez d'historique pour la mesure : les dénominateurs varient et sont
 * exposés (`n`). Aucune lecture après D : le résultat sur les N premiers jours ne change pas
 * quand on ajoute des clôtures (causalité par préfixe). null si aucune clôture. PURE.
 */
export function calculerHistoriqueLargeur(series: readonly CloturesDatees[]): HistoriqueLargeur | null {
  let debut = Number.POSITIVE_INFINITY;
  let fin = Number.NEGATIVE_INFINITY;
  for (const s of series) {
    const premier = s.t[0];
    const dernier = s.t[s.t.length - 1];
    if (premier !== undefined && premier < debut) debut = premier;
    if (dernier !== undefined && dernier > fin) fin = dernier;
  }
  if (!Number.isFinite(debut) || !Number.isFinite(fin)) return null;
  const n = Math.round((fin - debut) / JOUR_MS) + 1;
  const vide = (): SerieDenombree => ({ k: new Array<number>(n).fill(0), n: new Array<number>(n).fill(0) });
  const mm50 = vide();
  const mm200 = vide();
  const hb20 = vide();
  const hb55 = vide();
  const ad = vide();
  for (const s of series) {
    s.t.forEach((jour, i) => {
      const g = Math.round((jour - debut) / JOUR_MS);
      if (g < 0 || g >= n) return;
      compter(mm50, g, auDessusMmA(s.closes, i, MM_COURTE));
      compter(mm200, g, auDessusMmA(s.closes, i, MM_LONGUE));
      compter(hb20, g, hautOuBas(s.closes, i, FENETRE_HB_COURTE));
      compter(hb55, g, hautOuBas(s.closes, i, FENETRE_HB_LONGUE));
      compter(ad, g, sensVariation(s.closes, i));
    });
  }
  return {
    debut,
    mm50,
    mm200,
    hb20,
    hb55,
    ad,
    mcClellan: oscillateurMcClellan(ad),
    saison90: calculerSaisonAlts(series, debut, n, HORIZON_SAISON_JOURS),
    saison30: calculerSaisonAlts(series, debut, n, HORIZON_SAISON_COURT_JOURS),
  };
}

/**
 * Garde les `jours` derniers jours de chaque série (APRÈS le calcul sur toute la profondeur :
 * l'amorce des MM et des EMA reste juste) ; `debut` suit. PURE.
 */
export function conserverDerniersJours(h: HistoriqueLargeur, jours: number): HistoriqueLargeur {
  const retire = Math.max(0, h.mcClellan.length - Math.max(0, Math.floor(jours)));
  const couper = (s: SerieDenombree): SerieDenombree => ({ k: s.k.slice(retire), n: s.n.slice(retire) });
  return {
    debut: h.debut + retire * JOUR_MS,
    mm50: couper(h.mm50),
    mm200: couper(h.mm200),
    hb20: couper(h.hb20),
    hb55: couper(h.hb55),
    ad: couper(h.ad),
    mcClellan: h.mcClellan.slice(retire),
    saison90: couper(h.saison90),
    saison30: couper(h.saison30),
  };
}

/** Parts en % (100·k/n) ; null les jours non mesurés (n = 0), jamais 0 %. PURE. */
export function partsSerie(s: SerieDenombree): (number | null)[] {
  return s.n.map((n, i) => (n > 0 ? (100 * (s.k[i] ?? 0)) / n : null));
}

/**
 * Ligne A/D top 50 : cumul de (hausses − baisses) depuis le premier jour de la fenêtre (son
 * niveau n'a pas de sens, seule sa pente en a) ; null les jours non mesurés. PURE.
 */
export function ligneAdCumulee(ad: SerieDenombree): (number | null)[] {
  let cumul = 0;
  return ad.n.map((n, i) => {
    if (n <= 0) return null;
    cumul += ad.k[i] ?? 0;
    return cumul;
  });
}

// ─────────────────────────── Cache (fraîcheur PURE + IO tolérant) ───────────────────────────

/**
 * true si le cache est présent, non forcé, daté de moins de 12 h ET porte le champ
 * `historique` (un cache antérieur à l'historisation est périmé). PURE.
 */
export function cacheEstFrais(
  cached: ResumBreadth | null,
  nowMs: number,
  force: boolean,
): boolean {
  if (cached === null || force || cached.historique === undefined) return false;
  return nowMs - cached.ts < CACHE_TTL_MS;
}

const CLES_SERIES_DENOMBREES = ["mm50", "mm200", "hb20", "hb55", "ad", "saison90", "saison30"] as const;

/** Forme d'historique relue du cache : longueurs égales, comptes entiers, McClellan fini ou null. */
function historiqueValide(valeur: unknown): valeur is HistoriqueLargeur {
  if (valeur === null || typeof valeur !== "object") return false;
  const h = valeur as Record<string, unknown>;
  if (typeof h.debut !== "number" || !Number.isFinite(h.debut) || !Array.isArray(h.mcClellan)) return false;
  const mcClellan: unknown[] = h.mcClellan;
  const entiers = (v: unknown): boolean =>
    Array.isArray(v) && v.length === mcClellan.length && v.every((e) => Number.isInteger(e));
  return (
    mcClellan.every((v) => v === null || (typeof v === "number" && Number.isFinite(v))) &&
    CLES_SERIES_DENOMBREES.every((cle) => {
      const serie = h[cle];
      if (serie === null || typeof serie !== "object") return false;
      const { k, n } = serie as { k?: unknown; n?: unknown };
      return entiers(k) && entiers(n);
    })
  );
}

/**
 * Lecture tolérante du cache (localStorage absent/corrompu → null). Un historique de forme
 * invalide est retiré (champ absent → cache périmé, recalculé au prochain appel).
 */
function lireCache(): ResumBreadth | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw) as ResumBreadth;
    if (cache.historique !== null && cache.historique !== undefined && !historiqueValide(cache.historique)) {
      delete (cache as Partial<ResumBreadth>).historique;
    }
    return cache;
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
 * Récupère les clôtures 1d FERMÉES et datées d'un symbole (bougie en cours ÉCARTÉE).
 * Sans endTime, /klines renvoie TOUJOURS la bougie en cours en dernier : elle est écartée quelle
 * que soit l'horloge locale (une horloge en avance la ferait passer pour close), puis le filtre
 * k[6] < maintenant s'applique au reste. Rejette sur !ok — l'appelant tolère l'échec (le symbole
 * n'est pas compté).
 */
async function fetchCloturesJour(symbol: string, nowMs: number): Promise<CloturesDatees> {
  const url = `${KLINES_URL}?symbol=${encodeURIComponent(symbol)}&interval=1d&limit=${KLINE_LIMIT}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`klines ${res.status}`);
  const brut: unknown = await res.json();
  return { symbol, ...parserKlinesFermees(Array.isArray(brut) ? brut.slice(0, -1) : brut, nowMs) };
}

/**
 * Point d'entrée breadth. Cache 12 h : retourné tel quel si frais et !force. Sinon :
 *   1. ticker 24 h → univers USDT post-exclusions (A/D du jour) ;
 *   2. top 50 par volume → klines 1d (pool 6, 400 bougies), échecs tolérés/comptés ;
 *   3. résumé + tendance (pctMm50Prec = pctAuDessusMm50 du cache AVANT écrasement) +
 *      historique des 200 derniers jours (séries dérivées seulement) ;
 *   4. écriture du cache.
 * Échec du ticker → cache PÉRIMÉ si présent (historique absent → null), sinon null.
 */
export async function fetchBreadth(force = false): Promise<ResumBreadth | null> {
  const cached = lireCache();
  if (cacheEstFrais(cached, Date.now(), force)) return cached;
  const secours = cached === null ? null : { ...cached, historique: cached.historique ?? null };

  // 1. Univers USDT (post-exclusions). Échec → repli sur cache périmé, sinon null.
  let univers: ScreenerRow[];
  try {
    const res = await fetch(TICKER_24H_URL);
    if (!res.ok) throw new Error(`ticker24h ${res.status}`);
    univers = filtrerUnivers(parseTicker24h(await res.json(), ["USDT"]));
  } catch {
    return secours; // périmé si présent, sinon null
  }

  const ad = calculerAd(univers);

  // 2. Top 50 liquides → klines 1d en pool (échecs tolérés : le symbole n'est pas compté).
  const top = selectCandidates(univers, TOP_N);
  const maintenant = Date.now();
  const resultats = await mapPool(top, CONCURRENCY, (row) =>
    fetchCloturesJour(row.symbol, maintenant).then(
      (serie): CloturesDatees | null => serie,
      () => null,
    ),
  );
  const parSymbole = resultats.filter((r): r is CloturesDatees => r !== null);

  // 3. Résumé + tendance (valeur MM50 du cache précédent AVANT écrasement) + historique.
  const historique = calculerHistoriqueLargeur(parSymbole);
  const resume = resumerBreadth(
    parSymbole,
    ad,
    cached?.pctAuDessusMm50 ?? null,
    Date.now(),
    historique === null ? null : conserverDerniersJours(historique, JOURS_HISTORIQUE),
  );

  // 4. Cache (séries dérivées uniquement : jamais les clôtures).
  ecrireCache(resume);
  return resume;
}
