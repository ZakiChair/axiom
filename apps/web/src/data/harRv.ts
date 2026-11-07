/**
 * HAR-RV (Corsi 2009) sur la variance de Garman-Klass quotidienne — module PUR, hors du chemin
 * initial (chargé avec les bandes RV, chart/niveaux/bandesRv.ts, et par `import()` depuis la règle).
 *
 * PROXY : σ²_GK = 0,5·ln(H/L)² − (2 ln 2 − 1)·ln(C/O)² par bougie 1d close (formule de l'indicateur
 * `garmanKlassVol`). C'est une variance OUVERTURE → CLÔTURE, celle des bandes ancrées sur
 * l'ouverture du jour ou du lundi UTC. Limites connues : biaisée par les sauts, dépendante de la place.
 *
 * MODÈLE (projection directe par horizon h = 1 j ou 7 j) :
 *   Σ_{k=1..h} v(t+k) = β0 + βd·v(t) + βw·moyenne5(t) + βm·moyenne22(t)
 * OLS sur les FENETRE_HAR (500) dernières lignes dont la cible est CONNUE à l'origine, réestimé à
 * chaque origine (fenêtre glissante). Prévision non positive ou système singulier : repli sur
 * h × moyenne22, signalé (`filtre`).
 *
 * CALIBRAGE DES QUEUES ÉPAISSES, HORS ÉCHANTILLON : z = ln(C fin / O début)/σ̂. Les multiplicateurs
 * k₁ et k₂ des bandes « ±1σ » et « ±2σ » sont les quantiles 68,27 % et 95,45 % des |z| des
 * CALIBRAGE (250) dernières origines dont l'issue était connue AVANT l'origine courante. La
 * couverture compte, origine par origine, si |z| ≤ k(origine) : aucun k n'a vu l'issue qu'il juge
 * et aucun k n'est réglé sur cette couverture. Amplitude attendue = médiane passée de
 * ln(H/L de l'horizon)/σ̂, multipliée par σ̂ (même calibrage causal).
 */
import type { Candle } from "@axiom/types";
import { rma, trueRange } from "@axiom/indicators";

const JOUR_MS = 86_400_000;
const DEUX_LN2_MOINS_1 = 2 * Math.LN2 - 1;
/** Lignes de la régression glissante (jours). */
export const FENETRE_HAR = 500;
/** Origines passées servant au calibrage de k et de l'amplitude. */
export const CALIBRAGE = 250;
/** En deçà, aucun calibrage : la bande n'est pas tracée. */
export const CALIBRAGE_MIN = 100;
/** Couvertures nominales gaussiennes des bandes « ±1σ » et « ±2σ ». */
export const NOMINAL_1 = 0.6827;
export const NOMINAL_2 = 0.9545;

/** PURE — variance de Garman-Klass (log²) d'une bougie ; null si l'OHLC est absent ou incohérent. */
export function varianceGarmanKlass(c: Candle): number | null {
  const prix = [c.open, c.high, c.low, c.close];
  if (!prix.every((p) => Number.isFinite(p) && p > 0) || c.high < c.low) return null;
  const hl = Math.log(c.high / c.low);
  const co = Math.log(c.close / c.open);
  return Math.max(0, 0.5 * hl * hl - DEUX_LN2_MOINS_1 * co * co);
}

/**
 * PURE — plus longue suite FINALE de bougies closes (ordre croissant), consécutives au jour près et
 * valides : un trou (panne de place) ou une bougie incohérente coupe l'historique, jamais comblé.
 */
export function segmentContigu(bougies: readonly Candle[]): Candle[] {
  const closes = bougies.filter((b) => b.closed !== false);
  let debut = closes.length;
  while (debut > 0) {
    const b = closes[debut - 1]!;
    if (varianceGarmanKlass(b) === null) break;
    if (debut < closes.length && closes[debut]!.time - b.time !== JOUR_MS) break;
    debut--;
  }
  return closes.slice(debut);
}

/** Sommes cumulées : cumul[t] = Σ v[0..t−1]. */
function cumuler(v: readonly number[]): number[] {
  const cumul = [0];
  for (let t = 0; t < v.length; t++) cumul.push(cumul[t]! + v[t]!);
  return cumul;
}

/** Régresseurs HAR à t (t ≥ 21) : [1, v(t), moyenne 5 j, moyenne 22 j]. */
function regresseurs(v: readonly number[], cumul: readonly number[], t: number): number[] {
  return [1, v[t]!, (cumul[t + 1]! - cumul[t - 4]!) / 5, (cumul[t + 1]! - cumul[t - 21]!) / 22];
}

/** Système linéaire n×n (matrice à plat), pivot partiel ; null si singulier. */
function resoudre(a: number[], b: number[], seuil: number): number[] | null {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r * n + c]!) > Math.abs(a[p * n + c]!)) p = r;
    if (!(Math.abs(a[p * n + c]!) > seuil)) return null;
    for (let k = 0; k < n; k++) [a[c * n + k], a[p * n + k]] = [a[p * n + k]!, a[c * n + k]!];
    [b[c], b[p]] = [b[p]!, b[c]!];
    for (let r = c + 1; r < n; r++) {
      const f = a[r * n + c]! / a[c * n + c]!;
      for (let k = c; k < n; k++) a[r * n + k]! -= f * a[c * n + k]!;
      b[r]! -= f * b[c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]!;
    for (let k = r + 1; k < n; k++) s -= a[r * n + k]! * x[k]!;
    x[r] = s / a[r * n + r]!;
  }
  return x;
}

/**
 * PURE — coefficients HAR [β0, βd, βw, βm] estimés par OLS sur les lignes t ∈ [fin − fenetre + 1,
 * fin], cible Σ v(t+1..t+h) ; null si la fenêtre déborde de la série ou si le système est singulier.
 * Variances ramenées à leur moyenne avant le calcul (meilleur conditionnement, pentes invariantes).
 */
export function ajusterHar(v: readonly number[], fin: number, fenetre: number, h: number, cumul = cumuler(v)): number[] | null {
  const debut = fin - fenetre + 1;
  if (debut < 21 || fin + h >= v.length) return null;
  const echelle = (cumul[fin + 1]! - cumul[debut]!) / fenetre;
  if (!(echelle > 0)) return null;
  const a = new Array<number>(16).fill(0);
  const b = new Array<number>(4).fill(0);
  const x = [1, 0, 0, 0];
  for (let t = debut; t <= fin; t++) {
    // Boucle chaude (une régression par origine) : aucune allocation par ligne.
    x[1] = v[t]! / echelle;
    x[2] = (cumul[t + 1]! - cumul[t - 4]!) / (5 * echelle);
    x[3] = (cumul[t + 1]! - cumul[t - 21]!) / (22 * echelle);
    const y = (cumul[t + h + 1]! - cumul[t + 1]!) / echelle;
    for (let i = 0; i < 4; i++) {
      b[i]! += x[i]! * y;
      for (let j = 0; j < 4; j++) a[i * 4 + j]! += x[i]! * x[j]!;
    }
  }
  const beta = resoudre(a, b, 1e-9 * fenetre);
  if (beta === null) return null;
  beta[0] = beta[0]! * echelle;
  return beta;
}

/**
 * PURE — variance prévue de l'horizon h à l'origine T (après la clôture du jour T), estimée sur les
 * seules lignes dont la cible est connue en T. null tant que l'historique ne couvre pas la fenêtre.
 */
export function prevoirHar(
  v: readonly number[],
  T: number,
  h: number,
  fenetre = FENETRE_HAR,
  cumul = cumuler(v),
): { variance: number; filtre: boolean } | null {
  if (T >= v.length || T - h - fenetre + 1 < 21) return null;
  const x = regresseurs(v, cumul, T);
  const beta = ajusterHar(v, T - h, fenetre, h, cumul);
  const prevue = beta === null ? Number.NaN : beta.reduce((s, bi, i) => s + bi * x[i]!, 0);
  if (Number.isFinite(prevue) && prevue > 0) return { variance: prevue, filtre: false };
  const repli = h * x[3]!;
  return repli > 0 ? { variance: repli, filtre: true } : null;
}

/** Quantile à interpolation linéaire (type 7) ; `valeurs` est trié sur place. */
function quantile(valeurs: number[], p: number): number {
  valeurs.sort((x, y) => x - y);
  const pos = (valeurs.length - 1) * p;
  const bas = Math.floor(pos);
  const haut = valeurs[Math.min(bas + 1, valeurs.length - 1)]!;
  return valeurs[bas]! + (haut - valeurs[bas]!) * (pos - bas);
}

/** Couverture hors échantillon : origines jugées et issues dans ±1σ / ±2σ calibrés. */
export interface Couverture {
  n: number;
  dans1: number;
  dans2: number;
}

export interface PrevisionHorizon {
  h: number;
  /** σ prévu (log) de l'horizon, depuis l'ouverture qui suit l'origine. */
  sigma: number;
  /** Multiplicateurs calibrés des bandes « ±1σ » et « ±2σ ». */
  k1: number;
  k2: number;
  /** Amplitude haut − bas attendue sur l'horizon (log). */
  amplitude: number;
  /** Prévision remplacée par h × moyenne 22 j (non positive ou système singulier). */
  filtre: boolean;
  couverture: Couverture;
}

/** Jours contigus requis pour une bande d'horizon h prévue sur le dernier jour clos. */
export function historiqueRequis(h: number): number {
  return FENETRE_HAR + 2 * h + 20 + CALIBRAGE_MIN;
}

/**
 * PURE — prévision HAR de l'horizon h à l'origine `origine` (index dans `segment`, suite contiguë
 * de bougies 1d closes) avec ses k calibrés sur les issues connues à cette origine, et la
 * couverture hors échantillon mesurée sur toutes les origines dont l'issue est connue.
 * null si l'historique ne permet pas de prévoir ou de calibrer à cette origine.
 */
export function evaluerHorizon(segment: readonly Candle[], h: number, origine: number, fenetre = FENETRE_HAR): PrevisionHorizon | null {
  const n = segment.length;
  const v = segment.map((b) => varianceGarmanKlass(b) ?? Number.NaN);
  if (origine >= n || v.some((x) => Number.isNaN(x))) return null;
  const t0 = fenetre + h + 20;
  const cumul = cumuler(v);
  const sigma: number[] = [];
  const filtre: boolean[] = [];
  const z: Array<number | undefined> = [];
  const ratio: number[] = [];
  for (let T = t0; T < n; T++) {
    const p = prevoirHar(v, T, h, fenetre, cumul);
    const s = p === null ? Number.NaN : Math.sqrt(p.variance);
    sigma[T] = s;
    filtre[T] = p?.filtre ?? false;
    if (T + h >= n || !(s > 0)) continue;
    let haut = 0;
    let bas = Number.POSITIVE_INFINITY;
    for (let k = 1; k <= h; k++) {
      haut = Math.max(haut, segment[T + k]!.high);
      bas = Math.min(bas, segment[T + k]!.low);
    }
    z[T] = Math.log(segment[T + h]!.close / segment[T + 1]!.open) / s;
    ratio[T] = Math.log(haut / bas) / s;
  }
  /** Calibrage à l'origine T : seules les issues connues en T (origine + h ≤ T). */
  const calibrer = (T: number): { k1: number; k2: number; a: number } | null => {
    const zs: number[] = [];
    const rs: number[] = [];
    for (let s = T - h; s >= t0 && zs.length < CALIBRAGE; s--) {
      const zi = z[s];
      if (zi !== undefined) {
        zs.push(Math.abs(zi));
        rs.push(ratio[s]!);
      }
    }
    if (zs.length < CALIBRAGE_MIN) return null;
    return { k1: quantile(zs, NOMINAL_1), k2: quantile([...zs], NOMINAL_2), a: quantile(rs, 0.5) };
  };
  const couverture: Couverture = { n: 0, dans1: 0, dans2: 0 };
  for (let T = t0; T + h < n; T++) {
    const zi = z[T];
    const cal = zi === undefined ? null : calibrer(T);
    if (zi === undefined || cal === null) continue;
    couverture.n++;
    if (Math.abs(zi) <= cal.k1) couverture.dans1++;
    if (Math.abs(zi) <= cal.k2) couverture.dans2++;
  }
  const s = sigma[origine];
  const cal = origine >= t0 ? calibrer(origine) : null;
  if (s === undefined || !(s > 0) || cal === null) return null;
  return { h, sigma: s, k1: cal.k1, k2: cal.k2, amplitude: cal.a * s, filtre: filtre[origine] ?? false, couverture };
}

/** Volatilité locale au point de départ d'une mesure (règle). */
export interface VolatiliteBougies {
  /** ATR(14) de Wilder, en prix. */
  atr: number | null;
  /** Écart-type population des log-rendements par bougie (100 au plus, 20 au moins). */
  sigma: number | null;
}

/** Champs lus par la règle (bougies du chart, `KLineData` compris). */
type BougiePrix = Pick<Candle, "high" | "low" | "close">;

/**
 * PURE — ATR(14) et σ par bougie calculés sur les bougies [0, fin] seulement : la mesure exprime un
 * déplacement dans la volatilité connue à son départ (aucune bougie postérieure n'y entre).
 */
export function volatiliteAvant(bougies: readonly BougiePrix[], fin: number): VolatiliteBougies {
  if (!(fin >= 1) || fin >= bougies.length) return { atr: null, sigma: null };
  // `trueRange` ne lit que high, low et close.
  const atr = rma(trueRange(bougies.slice(0, fin + 1) as Candle[]), 14)[fin];
  const r: number[] = [];
  for (let i = Math.max(1, fin - 99); i <= fin; i++) {
    const a = bougies[i - 1]!.close;
    const b = bougies[i]!.close;
    if (a > 0 && b > 0) r.push(Math.log(b / a));
  }
  let sigma: number | null = null;
  if (r.length >= 20) {
    const m = r.reduce((s, x) => s + x, 0) / r.length;
    sigma = Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / r.length);
  }
  return { atr: atr !== undefined && atr > 0 ? atr : null, sigma: sigma !== null && sigma > 0 ? sigma : null };
}

/**
 * PURE — étiquette de la règle : |Δ prix| en ATR(14) et |ln(fin/début)| en σ de l'horizon
 * (σ par bougie × √nombre de bougies, marche aléatoire supposée). « — » quand non mesuré.
 */
export function mesureEnVolatilite(vol: VolatiliteBougies, debut: number, fin: number, nBougies: number): string {
  const atr = vol.atr === null || !Number.isFinite(fin - debut) ? "— ATR" : `${(Math.abs(fin - debut) / vol.atr).toFixed(1)} ATR`;
  const sigma =
    vol.sigma === null || !(nBougies > 0) || !(debut > 0 && fin > 0)
      ? "— σ"
      : `${(Math.abs(Math.log(fin / debut)) / (vol.sigma * Math.sqrt(nBougies))).toFixed(1)}σ`;
  return `${atr} · ${sigma}`;
}
