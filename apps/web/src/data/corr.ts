/**
 * CORR — matrice de corrélation des rendements journaliers (calcul PUR client).
 *
 * Aucune source de données nouvelle : on réutilise les klines 1d des adaptateurs
 * existants (crypto via la source d'origine du symbole dans la watchlist ; tradfi via
 * Twelve Data). Toute la logique de corrélation est PURE et testée (corr.test.ts) ;
 * seule la récupération des klines touche le réseau (cache SESSION pour éviter tout
 * refetch à la réouverture du panneau).
 *
 * Méthode :
 *  1. aligner deux séries de clôtures par JOUR calendaire UTC commun (gère les
 *     calendriers différents : crypto 7j/7 vs tradfi 5j/7 — jours de bourse seulement) ;
 *  2. calculer les log-rendements journaliers sur les clôtures alignées ;
 *  3. corrélation de PEARSON (linéaire) OU de SPEARMAN (rangs, robuste aux valeurs
 *     extrêmes / relations monotones non linéaires) sur ces rendements.
 */
import type { Candle } from "@axiom/types";
import { getAdapter } from "./adapters";
import { resolveTickerSource } from "./ticker";
import { watchlistStore } from "../store/watchlist";

/** Une clôture journalière horodatée (ms epoch de l'ouverture de bougie). */
export interface SerieCloture {
  time: number;
  close: number;
}

/** Méthode de corrélation proposée à l'UI. */
export type MethodeCorr = "pearson" | "spearman";

/** Nombre de millisecondes dans une journée (bucket calendaire UTC). */
const JOUR_MS = 86_400_000;

/** Jours d'historique quotidien récupérés (couvre 180 j de fenêtre + week-ends écartés). */
export const MAX_JOURS = 260;

/** Fenêtres de calcul proposées à l'UI (en jours calendaires). */
export const FENETRES_CORR: readonly number[] = [30, 90, 180];

// ─────────────────────────── Références tradfi curées ───────────────────────────

/** Référence tradfi préréglée de la matrice (libellé honnête sur les proxys ETF). */
export interface ReferenceCorr {
  /** Ticker curé du catalogue Twelve Data — `chargerSerie` le route déjà vers twelvedata. */
  symbole: string;
  libelle: string;
}

/**
 * Références croisées curées : indices actions via ETF, or via GLD, dollar via UUP
 * (le vrai DXY et l'or spot XAU ne sont pas au plan gratuit Twelve Data — proxys
 * ASSUMÉS et étiquetés), plus deux paires forex majeures. Chaque activation coûte
 * 1 crédit Twelve Data par recalcul (cache session ensuite).
 */
export const REFERENCES_CORR: readonly ReferenceCorr[] = [
  { symbole: "SPY", libelle: "S&P 500 (SPY)" },
  { symbole: "QQQ", libelle: "Nasdaq 100 (QQQ)" },
  { symbole: "GLD", libelle: "Or (GLD)" },
  { symbole: "UUP", libelle: "Dollar (UUP — proxy DXY)" },
  { symbole: "EUR/USD", libelle: "EUR/USD" },
  { symbole: "USD/JPY", libelle: "USD/JPY" },
];

// ─────────────────────────── Alignement (pur) ───────────────────────────

/** Numéro de jour calendaire UTC d'un horodatage ms (bucket d'alignement). */
function bucketJour(ms: number): number {
  return Math.floor(ms / JOUR_MS);
}

/**
 * Aligne deux séries de clôtures sur leurs JOURS calendaires UTC COMMUNS, en ordre
 * chronologique. Deux bougies tombant le même jour UTC (rare : calendriers d'exchange
 * décalés) sont réduites à la DERNIÈRE clôture rencontrée pour ce jour. Renvoie deux
 * vecteurs de MÊME longueur (clôtures des jours communs). Fonction PURE.
 */
export function alignerSeries(a: SerieCloture[], b: SerieCloture[]): { a: number[]; b: number[] } {
  const mapA = new Map<number, number>();
  for (const p of a) {
    if (Number.isFinite(p.time) && Number.isFinite(p.close)) mapA.set(bucketJour(p.time), p.close);
  }
  const mapB = new Map<number, number>();
  for (const p of b) {
    if (Number.isFinite(p.time) && Number.isFinite(p.close)) mapB.set(bucketJour(p.time), p.close);
  }
  const joursCommuns = [...mapA.keys()].filter((j) => mapB.has(j)).sort((x, y) => x - y);
  const ax: number[] = [];
  const bx: number[] = [];
  for (const j of joursCommuns) {
    const va = mapA.get(j);
    const vb = mapB.get(j);
    if (va === undefined || vb === undefined) continue;
    ax.push(va);
    bx.push(vb);
  }
  return { a: ax, b: bx };
}

/**
 * Restreint une série aux `jours` derniers jours calendaires (relativement à la DERNIÈRE
 * bougie disponible, pas à « maintenant » : robuste si la donnée a un léger retard).
 * Filtre PUR.
 */
export function fenetrer(serie: SerieCloture[], jours: number): SerieCloture[] {
  const dernier = serie[serie.length - 1];
  if (dernier === undefined) return serie;
  const seuil = dernier.time - jours * JOUR_MS;
  return serie.filter((p) => p.time >= seuil);
}

/**
 * Écarte le point du jour calendaire UTC COURANT d'une série (et tout point postérieur —
 * horloge locale en avance) : la dernière bougie journalière est PARTIELLE, côté crypto
 * (jour UTC en cours) comme côté Twelve Data (`closed:false`), et fausserait le dernier
 * rendement. `nowMs` est injecté par l'appelant (jamais de Date.now() ici). Fonction PURE.
 */
export function exclureJourCourant(serie: SerieCloture[], nowMs: number): SerieCloture[] {
  const jourCourant = bucketJour(nowMs);
  return serie.filter((p) => bucketJour(p.time) < jourCourant);
}

// ─────────────────────────── Log-rendements (pur) ───────────────────────────

/**
 * Log-rendements journaliers r_t = ln(close_t / close_{t-1}) d'un vecteur de clôtures
 * (déjà aligné/chronologique). Longueur = n-1. Un couple à clôture ≤ 0 (donnée douteuse)
 * produit NaN, écarté ensuite par les corrélations (suppression par paire). Fonction PURE.
 */
export function logRendements(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const cur = closes[i];
    if (prev === undefined || cur === undefined || prev <= 0 || cur <= 0) {
      out.push(NaN);
    } else {
      out.push(Math.log(cur / prev));
    }
  }
  return out;
}

// ─────────────────────────── Corrélations (pur) ───────────────────────────

/** Couples (x,y) finis alignés par index (suppression PAR PAIRE des NaN/absents). */
function pairesFinies(xs: number[], ys: number[]): [number, number][] {
  const n = Math.min(xs.length, ys.length);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const xi = xs[i];
    const yi = ys[i];
    if (xi === undefined || yi === undefined) continue;
    if (!Number.isFinite(xi) || !Number.isFinite(yi)) continue;
    out.push([xi, yi]);
  }
  return out;
}

/**
 * Corrélation de PEARSON (linéaire) entre deux séries alignées. Renvoie null si moins de
 * 2 couples finis ou si l'une des séries est constante (variance nulle → corrélation
 * indéfinie). Résultat borné à [-1, 1]. Fonction PURE.
 */
export function pearson(xs: number[], ys: number[]): number | null {
  const pairs = pairesFinies(xs, ys);
  const m = pairs.length;
  if (m < 2) return null;
  let sx = 0;
  let sy = 0;
  for (const [x, y] of pairs) {
    sx += x;
    sy += y;
  }
  const mx = sx / m;
  const my = sy / m;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (const [x, y] of pairs) {
    const dx = x - mx;
    const dy = y - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx <= 0 || vy <= 0) return null;
  return Math.max(-1, Math.min(1, cov / Math.sqrt(vx * vy)));
}

/** Rangs MOYENS (ties → moyenne des rangs concernés), 1-based. Fonction PURE. */
function rangsMoyens(v: number[]): number[] {
  const ordre = v.map((val, i) => ({ val, i })).sort((a, b) => a.val - b.val);
  const rangs = new Array<number>(v.length).fill(0);
  let i = 0;
  while (i < ordre.length) {
    const courant = ordre[i];
    if (courant === undefined) break;
    let j = i;
    while (j + 1 < ordre.length) {
      const suivant = ordre[j + 1];
      if (suivant === undefined || suivant.val !== courant.val) break;
      j += 1;
    }
    const rangMoyen = (i + j) / 2 + 1; // moyenne des rangs [i..j], 1-based
    for (let k = i; k <= j; k++) {
      const e = ordre[k];
      if (e !== undefined) rangs[e.i] = rangMoyen;
    }
    i = j + 1;
  }
  return rangs;
}

/**
 * Corrélation de SPEARMAN = Pearson sur les RANGS (ties traités par rangs moyens).
 * null si moins de 2 couples finis. Fonction PURE.
 */
export function spearman(xs: number[], ys: number[]): number | null {
  const pairs = pairesFinies(xs, ys);
  if (pairs.length < 2) return null;
  const px = pairs.map((p) => p[0]);
  const py = pairs.map((p) => p[1]);
  return pearson(rangsMoyens(px), rangsMoyens(py));
}

/** Aiguille vers Pearson ou Spearman selon `methode`. Fonction PURE. */
export function correlation(methode: MethodeCorr, xs: number[], ys: number[]): number | null {
  return methode === "spearman" ? spearman(xs, ys) : pearson(xs, ys);
}

/**
 * Corrélation GLISSANTE sur une fenêtre de `fenetre` rendements (sparkline du mini-détail).
 * À chaque position, corrélation des `fenetre` derniers couples. Renvoie une valeur par
 * fenêtre complète (null quand indéfinie). Vide si l'historique est plus court que la
 * fenêtre. Fonction PURE.
 */
export function correlationGlissante(
  methode: MethodeCorr,
  xs: number[],
  ys: number[],
  fenetre: number
): (number | null)[] {
  const n = Math.min(xs.length, ys.length);
  const out: (number | null)[] = [];
  if (fenetre < 2 || n < fenetre) return out;
  for (let fin = fenetre; fin <= n; fin++) {
    out.push(correlation(methode, xs.slice(fin - fenetre, fin), ys.slice(fin - fenetre, fin)));
  }
  return out;
}

// ─────────────────────────── Matrice N×N (pur) ───────────────────────────

/** Résultat de corrélation d'un couple : valeur + taille d'échantillon (rendements communs). */
export interface CelluleCorr {
  valeur: number | null;
  /** Nombre de rendements communs ayant servi au calcul (indicateur de fiabilité). */
  points: number;
}

/** Matrice N×N de corrélations sur un ensemble de symboles. */
export interface MatriceCorr {
  symbols: string[];
  methode: MethodeCorr;
  fenetreJours: number;
  /** `cellules[i][j]` = corrélation du symbole i avec le symbole j (symétrique, diagonale = 1). */
  cellules: CelluleCorr[][];
}

/**
 * Calcule la matrice N×N à partir des séries déjà chargées. Pour chaque couple :
 * fenêtrage → alignement par jours communs → log-rendements → corrélation. Diagonale = 1.
 * Symétrique (chaque couple calculé une fois). Un symbole sans série donne des cellules
 * nulles. Fonction PURE.
 */
export function calculerMatrice(
  seriesParSymbole: Map<string, SerieCloture[]>,
  symbols: string[],
  methode: MethodeCorr,
  fenetreJours: number
): MatriceCorr {
  const series = symbols.map((s) => fenetrer(seriesParSymbole.get(s) ?? [], fenetreJours));
  const n = symbols.length;
  const cellules: CelluleCorr[][] = symbols.map(() =>
    symbols.map(() => ({ valeur: null, points: 0 }))
  );
  for (let i = 0; i < n; i++) {
    const li = cellules[i];
    const si = series[i];
    if (li === undefined) continue;
    li[i] = { valeur: si && si.length >= 2 ? 1 : null, points: Math.max(0, (si?.length ?? 0) - 1) };
    for (let j = i + 1; j < n; j++) {
      const sj = series[j];
      if (si === undefined || sj === undefined) continue;
      const { a, b } = alignerSeries(si, sj);
      const ra = logRendements(a);
      const rb = logRendements(b);
      const cellule: CelluleCorr = {
        valeur: correlation(methode, ra, rb),
        points: pairesFinies(ra, rb).length,
      };
      li[j] = cellule;
      const lj = cellules[j];
      if (lj !== undefined) lj[i] = cellule;
    }
  }
  return { symbols, methode, fenetreJours, cellules };
}

// ─────────────────────────── Fiabilité (pur) ───────────────────────────

/**
 * Seuil de fiabilité d'une cellule : en dessous de 20 rendements communs, la corrélation
 * est trop bruitée pour être lue seule (l'alignement jours UTC communs écarte les
 * week-ends tradfi : ~62 points communs sur 90 j — une fenêtre courte croisée tradfi
 * tombe vite sous ce seuil). L'UI atténue ces cellules.
 */
export const SEUIL_POINTS_FIABLES = 20;

/** Vrai si le nombre de rendements communs atteint le seuil de fiabilité. Fonction PURE. */
export function pointsFiables(points: number): boolean {
  return points >= SEUIL_POINTS_FIABLES;
}

/**
 * Symboles dont la série chargée est ABSENTE ou VIDE (convention `chargerSerie` : échec
 * réseau/source → série vide) — remontés à l'UI en chips d'erreur au lieu de cellules
 * vides silencieuses. Ordre d'entrée conservé. Fonction PURE.
 */
export function symbolesEnEchec(series: Map<string, SerieCloture[]>, symbols: string[]): string[] {
  return symbols.filter((s) => (series.get(s) ?? []).length === 0);
}

// ─────────────────────────── Réglages persistés (pur) ───────────────────────────

/** Réglages de la fenêtre CORR persistés sous `axiom:corr:v1` (jamais l'état `open`). */
export interface ReglagesCorr {
  methode: MethodeCorr;
  fenetreJours: number;
  /** Symboles ajoutés à la main (normalisés trim + MAJUSCULES, dédoublonnés). */
  extras: string[];
  /** Symboles des références tradfi actives (⊆ REFERENCES_CORR). */
  referencesActives: string[];
}

/** Plafond d'extras restaurés (garde-fou quota : chaque symbole tradfi = 1 crédit). */
const MAX_EXTRAS_RESTAURES = 24;

/** Normalise un tableau brut de symboles : chaînes non vides trim+MAJUSCULES, dédoublonnées. */
function symbolesValides(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const vus = new Set<string>();
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const s = v.trim().toUpperCase();
    if (s.length > 0) vus.add(s);
  }
  return [...vus];
}

/**
 * Hydrate les réglages CORR depuis une valeur persistée INCONNUE (localStorage parsé ou
 * n'importe quoi) : validation champ par champ, valeur inconnue → défaut du champ, ne
 * jette JAMAIS. Fenêtre restreinte à FENETRES_CORR, références restreintes au catalogue
 * REFERENCES_CORR. Fonction PURE.
 */
export function hydraterReglagesCorr(raw: unknown): ReglagesCorr {
  const defauts: ReglagesCorr = { methode: "pearson", fenetreJours: 90, extras: [], referencesActives: [] };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return defauts;
  const o = raw as Record<string, unknown>;
  const methode: MethodeCorr =
    o.methode === "pearson" || o.methode === "spearman" ? o.methode : defauts.methode;
  const fenetreJours =
    typeof o.fenetreJours === "number" && FENETRES_CORR.includes(o.fenetreJours)
      ? o.fenetreJours
      : defauts.fenetreJours;
  const extras = symbolesValides(o.extras).slice(0, MAX_EXTRAS_RESTAURES);
  const connues = new Set(REFERENCES_CORR.map((r) => r.symbole));
  const referencesActives = symbolesValides(o.referencesActives).filter((s) => connues.has(s));
  return { methode, fenetreJours, extras, referencesActives };
}

// ─────────────── Chargement des klines (impur, cache SESSION) ───────────────

/** Cache SESSION des séries journalières par symbole (évite tout refetch à la réouverture). */
const cacheSeries = new Map<string, SerieCloture[]>();

/**
 * Charge (ou ressert du cache session) la série journalière d'un symbole via l'adaptateur
 * de sa source d'origine (résolue comme pour le ticker : source explicite de la watchlist
 * sinon inférence crypto/tradfi). En cas d'échec réseau/source, renvoie une série vide
 * SANS la cacher (dégradation gracieuse : cellules vides + réessai possible), plutôt qu'une
 * exception qui casserait toute la matrice.
 */
export async function chargerSerie(symbol: string): Promise<SerieCloture[]> {
  const cached = cacheSeries.get(symbol);
  if (cached !== undefined) return cached;
  try {
    const source = resolveTickerSource(symbol, watchlistStore.getState().sources[symbol]);
    const candles: Candle[] = await getAdapter(source).fetchKlines(symbol, "1d", { limit: MAX_JOURS });
    const serie = candles
      .filter((c) => Number.isFinite(c.time) && Number.isFinite(c.close) && c.close > 0)
      .map((c) => ({ time: c.time, close: c.close }))
      .sort((x, y) => x.time - y.time);
    cacheSeries.set(symbol, serie);
    return serie;
  } catch {
    return [];
  }
}

/**
 * Charge toutes les séries requises (en parallèle, cache partagé) et renvoie la map prête
 * pour calculerMatrice. Symboles normalisés (trim + MAJUSCULES) et dédoublonnés.
 */
export async function chargerSeries(symbols: string[]): Promise<Map<string, SerieCloture[]>> {
  const uniques = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter((s) => s.length > 0))];
  const resultats = await Promise.all(uniques.map((s) => chargerSerie(s)));
  const map = new Map<string, SerieCloture[]>();
  uniques.forEach((s, i) => map.set(s, resultats[i] ?? []));
  return map;
}

/** Vide le cache session des séries (bouton « recalculer » = re-fetch forcé). */
export function viderCacheSeries(): void {
  cacheSeries.clear();
}
