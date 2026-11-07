/**
 * Régime transversal du marché crypto (calcul PUR client) — onglet « Régime » de CORR et
 * ligne du BRIEF (chantier du 2026-11-07, SUG-42 volet transversal).
 *
 * POURQUOI : dire si le marché est mené par un facteur commun (BTC) — auquel cas la
 * sélection d'alts pèse peu — ou dispersé. Quatre mesures descriptives sur les log-
 * rendements JOURNALIERS clos d'un univers d'alts (watchlist ou top N figé), BTC en
 * référence :
 *   1. dispersion transversale : écart-type POPULATION des rendements du jour entre les
 *      alts (≥ MIN_ACTIFS), lissée par moyenne sur 7 jours (fenêtre complète exigée) ;
 *   2. médiane des corrélations alts/BTC sur 30 jours (Pearson, ≥ 20 rendements communs
 *      par alt, cf. SEUIL_POINTS_FIABLES de corr.ts) ;
 *   3. corrélation moyenne par paire sur 60 jours (moyenne hors diagonale de la matrice
 *      de corrélation des alts) ;
 *   4. ratio d'absorption sur 60 jours : part de variance du PREMIER facteur, λ₁ / n, sur
 *      la matrice de CORRÉLATION (rendements standardisés — sur la covariance, les alts les
 *      plus volatils écraseraient la mesure), λ₁ par itération de puissance.
 * Les mesures 3 et 4 n'emploient que les alts dont les 60 rendements de la fenêtre sont
 * TOUS présents (matrice cohérente, semi-définie positive) : l'effectif réel est affiché.
 *
 * PLANCHER DU BRUIT : sur des rendements indépendants, λ₁/n n'est pas ≈ 1/n mais proche du
 * bord de Marchenko-Pastur (1 + √(n/T))² / n — ≈ 0,07 pour n = 50, T = 60 (simulation de
 * l'étude du 2026-11-06 : 0,068). Ce plancher est publié à côté de la valeur.
 *
 * CAUSALITÉ : calendrier maître = jours clos de BTC ; la bougie du jour UTC courant est
 * écartée (`nowMs` injecté). Chaque valeur du jour t ne lit que des rendements ≤ t
 * (fenêtres arrière) : ajouter des jours ne modifie aucune valeur passée (testé par
 * préfixe). Un rendement n'existe que si les clôtures des jours d et d−1 sont présentes.
 * Donnée absente ou effectif insuffisant ⇒ null (« non mesuré »), jamais 0.
 *
 * Dans un marché à facteur BTC dominant, les mesures 2 à 4 se recoupent largement
 * (redondance relevée par l'étude) ; la dispersion est l'information complémentaire.
 * Aucun seuil n'est validé : lecture DESCRIPTIVE. Biais d'univers : top N du jour appliqué
 * au passé, une seule place (Binance spot USDT pour le top N).
 *
 * UNIVERS : alts COTÉS EN DOLLAR seulement (cf. `classerUniversTransversal` de
 * rotationRelative.ts) — des rendements de ETHBTC ou d'une paire en EUR ne se mêlent pas à
 * des rendements en USD. La garde est rejouée dans le calcul : un symbole non USD reçu est
 * écarté et listé (`exclus`), une paire de base BTC (BTC-PERP compris) est la référence.
 */
import {
  bucketJour,
  chargerSeries,
  exclureJourCourant,
  SEUIL_POINTS_FIABLES,
  topPairesUnivers,
  type SerieCloture,
} from "./corr";
import { fetchMarketOverview } from "./marketOverview";
import { fetchPairs } from "./pairs";
import {
  classerPaireTransversale,
  classerUniversTransversal,
  REFERENCE_ROTATION,
  type NonPlace,
} from "./rotationRelative";

// ─────────────────────────── Paramètres (figés, documentés) ───────────────────────────

/** Lissage de la dispersion transversale (jours). */
export const LISSAGE_DISPERSION = 7;
/** Fenêtre des corrélations alts/BTC (rendements). */
export const FENETRE_CORR_BTC = 30;
/** Fenêtre de la matrice de corrélation (corrélation moyenne, ratio d'absorption). */
export const FENETRE_FACTEUR = 60;
/** Effectif minimal d'alts pour publier une mesure transversale. */
export const MIN_ACTIFS_TRANSVERSAL = 5;
/** Rendements communs minimaux pour une corrélation alt/BTC (seuil de fiabilité CORR). */
export const MIN_POINTS_CORR_BTC = SEUIL_POINTS_FIABLES;

// ─────────────────────────── Types ───────────────────────────

/** Série d'une mesure alignée sur le calendrier (`null` = non mesuré ce jour-là). */
export interface SerieMesure {
  valeurs: (number | null)[];
  /** Effectif d'alts ayant servi au calcul du jour (0 si non mesuré). */
  nActifs: number[];
}

/** Valeur du DERNIER jour clos, située dans l'historique chargé de la mesure. */
export interface DerniereMesure {
  valeur: number;
  nActifs: number;
  /** Part (%) des valeurs de l'historique chargé ≤ la valeur du jour (descriptif). */
  centile: number;
  /** Nombre de jours mesurés dans l'historique chargé. */
  nHistorique: number;
}

/** Résultat du régime transversal sur un univers. */
export interface ResultatRegime {
  /** Calendrier maître : numéros de jour UTC clos de la référence, chronologiques. */
  jours: number[];
  dispersion7j: SerieMesure;
  medianeCorrBtc30j: SerieMesure;
  corrMoyenne60j: SerieMesure;
  absorption60j: SerieMesure;
  /** Plancher de bruit Marchenko-Pastur de l'absorption, pour l'effectif du jour. */
  plancherBruit60j: (number | null)[];
  derniers: {
    dispersion7j: DerniereMesure | null;
    medianeCorrBtc30j: DerniereMesure | null;
    corrMoyenne60j: DerniereMesure | null;
    absorption60j: DerniereMesure | null;
    plancherBruit60j: number | null;
  };
  /** Alts de l'univers (référence exclue) avec une série chargée non vide. */
  nAlts: number;
  /** Alts de l'univers sans série (échec de chargement). */
  altsSansSerie: string[];
  /** Symboles reçus écartés du calcul avec leur raison (cotation non USD ou inconnue). */
  exclus: NonPlace[];
  refDisponible: boolean;
  /** Dernier jour clos du calendrier (numéro UTC), null si la référence manque. */
  dernierJour: number | null;
}

// ─────────────────────────── Briques numériques (pures) ───────────────────────────

/** Médiane d'un tableau non vide (moyenne des deux centrales si pair). PURE. */
export function mediane(valeurs: readonly number[]): number | null {
  if (valeurs.length === 0) return null;
  const tri = [...valeurs].sort((a, b) => a - b);
  const m = Math.floor(tri.length / 2);
  return tri.length % 2 === 1 ? (tri[m] as number) : ((tri[m - 1] as number) + (tri[m] as number)) / 2;
}

/** Norme euclidienne d'un vecteur typé. */
function norme2(v: Float64Array): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += (v[i] as number) * (v[i] as number);
  return Math.sqrt(s);
}

/**
 * Itération de puissance sur une matrice symétrique semi-définie positive n × n stockée à
 * plat (ligne par ligne) : renvoie λ₁ (quotient de Rayleigh) et le vecteur propre associé
 * (normé). Arrêt à variation relative de λ < 1e-8 (bien en deçà des deux décimales
 * affichées) ou 300 itérations. `depart` : vecteur initial (démarrage à chaud depuis la
 * fenêtre de la veille) ; à défaut, vecteur NON uniforme (un départ (1,…,1) est orthogonal
 * au vecteur propre dominant de deux blocs anti-corrélés). PURE.
 */
function iterationPuissance(
  matrice: Float64Array,
  n: number,
  depart?: Float64Array,
): { lambda: number; vecteur: Float64Array } {
  if (n === 0) return { lambda: 0, vecteur: new Float64Array(0) };
  let v = new Float64Array(n);
  if (depart !== undefined && depart.length === n) v.set(depart);
  let norme = norme2(v);
  if (!(norme > 0)) {
    for (let i = 0; i < n; i++) v[i] = 1 + 0.1 * Math.sin(i + 1);
    norme = norme2(v);
  }
  for (let i = 0; i < n; i++) v[i] = (v[i] as number) / norme;
  let w = new Float64Array(n);
  let lambda = Number.NaN;
  for (let iter = 0; iter < 300; iter++) {
    for (let i = 0; i < n; i++) {
      let s = 0;
      const base = i * n;
      for (let j = 0; j < n; j++) s += (matrice[base + j] as number) * (v[j] as number);
      w[i] = s;
    }
    let rayleigh = 0;
    for (let i = 0; i < n; i++) rayleigh += (v[i] as number) * (w[i] as number);
    norme = norme2(w);
    if (norme === 0) return { lambda: 0, vecteur: v };
    for (let i = 0; i < n; i++) w[i] = (w[i] as number) / norme;
    [v, w] = [w, v];
    if (Math.abs(rayleigh - lambda) <= 1e-8 * Math.max(1, Math.abs(rayleigh))) return { lambda: rayleigh, vecteur: v };
    lambda = rayleigh;
  }
  return { lambda, vecteur: v };
}

/** Plus grande valeur propre d'une matrice symétrique semi-définie positive (lignes). PURE. */
export function valeurPropreMax(matrice: readonly (readonly number[])[]): number {
  const n = matrice.length;
  const plat = new Float64Array(n * n);
  matrice.forEach((ligne, i) => ligne.forEach((x, j) => (plat[i * n + j] = x)));
  return iterationPuissance(plat, n).lambda;
}

/**
 * Pearson sur la fenêtre [debut .. fin] de deux séries alignées, SANS allocation : même
 * convention que `pearson` de corr.ts (suppression par paire des valeurs non finies, null
 * si variance nulle, borné à [−1, 1]), plus un effectif minimal de couples. La version
 * de corr.ts alloue un tableau de couples par appel ; ici ~18 000 appels par calcul
 * (49 alts × ~370 jours). Équivalence vérifiée en test. PURE.
 */
export function pearsonFenetre(
  xs: readonly number[],
  ys: readonly number[],
  debut: number,
  fin: number,
  minCouples: number,
): number | null {
  let m = 0;
  let sx = 0;
  let sy = 0;
  for (let k = debut; k <= fin; k++) {
    const x = xs[k];
    const y = ys[k];
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    m += 1;
    sx += x;
    sy += y;
  }
  if (m < Math.max(2, minCouples)) return null;
  const mx = sx / m;
  const my = sy / m;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let k = debut; k <= fin; k++) {
    const x = xs[k];
    const y = ys[k];
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    const dx = x - mx;
    const dy = y - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx <= 0 || vy <= 0) return null;
  return Math.max(-1, Math.min(1, cov / Math.sqrt(vx * vy)));
}

/** Bord de Marchenko-Pastur de λ₁/n pour n actifs et T observations (plancher du bruit). PURE. */
export function plancherBruitAbsorption(n: number, t: number): number | null {
  if (n <= 0 || t <= 0) return null;
  return (1 + Math.sqrt(n / t)) ** 2 / n;
}

/** Part (%) des valeurs définies ≤ la dernière, et effectif ; null si la dernière manque. PURE. */
export function derniereMesure(serie: SerieMesure): DerniereMesure | null {
  const n = serie.valeurs.length;
  const valeur = serie.valeurs[n - 1];
  if (valeur === null || valeur === undefined) return null;
  const definies = serie.valeurs.filter((v): v is number => v !== null);
  const inferieures = definies.filter((v) => v <= valeur).length;
  return {
    valeur,
    nActifs: serie.nActifs[n - 1] ?? 0,
    centile: (100 * inferieures) / definies.length,
    nHistorique: definies.length,
  };
}

// ─────────────────────────── Panneau de rendements (pur) ───────────────────────────

/** Log-rendements journaliers d'une série sur un calendrier de jours (NaN si absent). */
function rendementsSurCalendrier(serie: SerieCloture[], jours: readonly number[]): number[] {
  const parJour = new Map<number, number>();
  for (const p of serie) {
    if (Number.isFinite(p.time) && Number.isFinite(p.close) && p.close > 0) parJour.set(bucketJour(p.time), p.close);
  }
  return jours.map((j) => {
    const c = parJour.get(j);
    const avant = parJour.get(j - 1);
    return c === undefined || avant === undefined ? NaN : Math.log(c / avant);
  });
}

// ─────────────────────────── Régime transversal (pur) ───────────────────────────

/** Série vide d'une longueur donnée (tout « non mesuré »). */
function serieVide(n: number): SerieMesure {
  return { valeurs: new Array<number | null>(n).fill(null), nActifs: new Array<number>(n).fill(0) };
}

/**
 * Calcule les quatre mesures transversales sur un univers d'alts contre la référence BTC.
 * `alts` peut contenir une paire de base BTC (BTCUSDT, BTC-PERP…) : elle est écartée en
 * silence (c'est la référence) ; une paire non cotée en dollar est écartée ET listée dans
 * `exclus` (découpage Binance, la place de la référence). `nowMs` sert UNIQUEMENT à écarter
 * la bougie du jour UTC courant. Fonction PURE.
 */
export function calculerRegimeTransversal(
  series: ReadonlyMap<string, SerieCloture[]>,
  alts: readonly string[],
  ref: SerieCloture[],
  nowMs: number,
): ResultatRegime {
  const membres: string[] = [];
  const exclus: NonPlace[] = [];
  for (const symbole of alts) {
    const classe = classerPaireTransversale(symbole, "binance");
    if (classe.type === "alt") membres.push(symbole);
    else if (classe.type === "exclu") exclus.push({ symbole, raison: classe.raison });
  }
  const altsSansSerie = membres.filter((s) => (series.get(s) ?? []).length === 0);
  const charges = membres.filter((s) => (series.get(s) ?? []).length > 0);
  const refClose = exclureJourCourant(ref, nowMs);
  const jours = [...new Set(refClose.map((p) => bucketJour(p.time)))].sort((a, b) => a - b);
  const T = jours.length;
  const vide: ResultatRegime = {
    jours,
    dispersion7j: serieVide(T),
    medianeCorrBtc30j: serieVide(T),
    corrMoyenne60j: serieVide(T),
    absorption60j: serieVide(T),
    plancherBruit60j: new Array<number | null>(T).fill(null),
    derniers: {
      dispersion7j: null,
      medianeCorrBtc30j: null,
      corrMoyenne60j: null,
      absorption60j: null,
      plancherBruit60j: null,
    },
    nAlts: charges.length,
    altsSansSerie,
    exclus,
    refDisponible: T > 0,
    dernierJour: T > 0 ? (jours[T - 1] as number) : null,
  };
  if (T === 0) return vide;

  const rRef = rendementsSurCalendrier(refClose, jours);
  const r = charges.map((s) => rendementsSurCalendrier(exclureJourCourant(series.get(s) ?? [], nowMs), jours));

  // 1) Dispersion transversale brute puis lissée (fenêtre complète de 7 jours exigée).
  const dispBrute: (number | null)[] = new Array<number | null>(T).fill(null);
  const nDispBrute = new Array<number>(T).fill(0);
  for (let t = 0; t < T; t++) {
    const vals: number[] = [];
    for (const ri of r) {
      const v = ri[t];
      if (v !== undefined && Number.isFinite(v)) vals.push(v);
    }
    if (vals.length < MIN_ACTIFS_TRANSVERSAL) continue;
    const moy = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, v) => a + (v - moy) * (v - moy), 0) / vals.length;
    dispBrute[t] = Math.sqrt(variance);
    nDispBrute[t] = vals.length;
  }
  const dispersion7j = serieVide(T);
  for (let t = LISSAGE_DISPERSION - 1; t < T; t++) {
    let somme = 0;
    let nMin = Infinity;
    let complet = true;
    for (let k = t - LISSAGE_DISPERSION + 1; k <= t; k++) {
      const v = dispBrute[k];
      if (v === null || v === undefined) {
        complet = false;
        break;
      }
      somme += v;
      nMin = Math.min(nMin, nDispBrute[k] ?? 0);
    }
    if (!complet) continue;
    dispersion7j.valeurs[t] = somme / LISSAGE_DISPERSION;
    dispersion7j.nActifs[t] = nMin; // effectif le plus faible de la fenêtre (prudent)
  }

  // 2) Médiane des corrélations alts/BTC sur 30 jours.
  const medianeCorrBtc30j = serieVide(T);
  for (let t = FENETRE_CORR_BTC - 1; t < T; t++) {
    const rhos: number[] = [];
    for (const ri of r) {
      const rho = pearsonFenetre(ri, rRef, t - FENETRE_CORR_BTC + 1, t, MIN_POINTS_CORR_BTC);
      if (rho !== null) rhos.push(rho);
    }
    if (rhos.length < MIN_ACTIFS_TRANSVERSAL) continue;
    medianeCorrBtc30j.valeurs[t] = mediane(rhos);
    medianeCorrBtc30j.nActifs[t] = rhos.length;
  }

  // 3-4) Matrice de corrélation 60 j (alts à fenêtre COMPLÈTE) : moyenne hors diagonale
  // et ratio d'absorption λ₁/n.
  const corrMoyenne60j = serieVide(T);
  const absorption60j = serieVide(T);
  const plancherBruit60j = new Array<number | null>(T).fill(null);
  const F = FENETRE_FACTEUR;
  // Composante de chaque alt (par index) dans le vecteur propre de la veille : démarrage à
  // chaud de l'itération de puissance (deux fenêtres consécutives ne diffèrent que d'un jour).
  let vecteurVeille = new Map<number, number>();
  // Tampons typés réutilisés (l'historique compte ~340 fenêtres de 60 jours × n² paires).
  const z = new Float64Array(r.length * F); // rendements standardisés des membres, à plat
  const matrice = new Float64Array(r.length * r.length);
  for (let t = F - 1; t < T; t++) {
    const indices: number[] = [];
    for (let idx = 0; idx < r.length; idx++) {
      const ri = r[idx] as number[];
      let somme = 0;
      let complet = true;
      for (let k = t - F + 1; k <= t; k++) {
        const v = ri[k] as number;
        if (!Number.isFinite(v)) {
          complet = false;
          break;
        }
        somme += v;
      }
      if (!complet) continue;
      const moy = somme / F;
      let carres = 0;
      for (let k = t - F + 1; k <= t; k++) carres += ((ri[k] as number) - moy) ** 2;
      const ecart = Math.sqrt(carres / F);
      if (!(ecart > 0)) continue; // série plate : corrélation indéfinie
      const base = indices.length * F;
      for (let k = 0; k < F; k++) z[base + k] = ((ri[t - F + 1 + k] as number) - moy) / ecart;
      indices.push(idx);
    }
    const n = indices.length;
    if (n < MIN_ACTIFS_TRANSVERSAL) continue;
    let sommeHorsDiag = 0;
    for (let i = 0; i < n; i++) {
      matrice[i * n + i] = 1;
      for (let j = i + 1; j < n; j++) {
        let s = 0;
        const bi = i * F;
        const bj = j * F;
        for (let k = 0; k < F; k++) s += (z[bi + k] as number) * (z[bj + k] as number);
        const c = Math.max(-1, Math.min(1, s / F));
        matrice[i * n + j] = c;
        matrice[j * n + i] = c;
        sommeHorsDiag += 2 * c;
      }
    }
    corrMoyenne60j.valeurs[t] = sommeHorsDiag / (n * (n - 1));
    corrMoyenne60j.nActifs[t] = n;
    const depart = indices.every((idx) => vecteurVeille.has(idx))
      ? Float64Array.from(indices, (idx) => vecteurVeille.get(idx) as number)
      : undefined;
    const { lambda, vecteur } = iterationPuissance(matrice.subarray(0, n * n), n, depart);
    vecteurVeille = new Map(indices.map((idx, k) => [idx, vecteur[k] as number]));
    absorption60j.valeurs[t] = Math.max(0, Math.min(1, lambda / n));
    absorption60j.nActifs[t] = n;
    plancherBruit60j[t] = plancherBruitAbsorption(n, F);
  }

  return {
    ...vide,
    dispersion7j,
    medianeCorrBtc30j,
    corrMoyenne60j,
    absorption60j,
    plancherBruit60j,
    derniers: {
      dispersion7j: derniereMesure(dispersion7j),
      medianeCorrBtc30j: derniereMesure(medianeCorrBtc30j),
      corrMoyenne60j: derniereMesure(corrMoyenne60j),
      absorption60j: derniereMesure(absorption60j),
      plancherBruit60j: plancherBruit60j[T - 1] ?? null,
    },
  };
}

// ─────────────────────────── Résumé pour le BRIEF (pur) ───────────────────────────

/** Instantané du dernier jour, persisté pour la ligne du BRIEF (`axiom:corr:regime:v1`). */
export interface ResumeRegime {
  /** ms epoch du calcul. */
  calculeA: number;
  /** Dernier jour clos mesuré (numéro de jour UTC). */
  jour: number;
  /** Libellé de l'univers (ex. « Top 50 cap. CoinGecko (paires Binance USDT) »). */
  univers: string;
  /** Alts attendus (univers hors BTC) et alts chargés. */
  nAttendus: number;
  nAlts: number;
  dispersion7j: DerniereMesure | null;
  medianeCorrBtc30j: DerniereMesure | null;
  corrMoyenne60j: DerniereMesure | null;
  absorption60j: DerniereMesure | null;
  plancherBruit60j: number | null;
}

/** Résumé d'un résultat (null si aucun jour clos mesurable : référence absente). PURE. */
export function resumerRegime(
  res: ResultatRegime,
  meta: { calculeA: number; univers: string; nAttendus: number },
): ResumeRegime | null {
  if (res.dernierJour === null) return null;
  return {
    calculeA: meta.calculeA,
    jour: res.dernierJour,
    univers: meta.univers,
    nAttendus: meta.nAttendus,
    nAlts: res.nAlts,
    dispersion7j: res.derniers.dispersion7j,
    medianeCorrBtc30j: res.derniers.medianeCorrBtc30j,
    corrMoyenne60j: res.derniers.corrMoyenne60j,
    absorption60j: res.derniers.absorption60j,
    plancherBruit60j: res.derniers.plancherBruit60j,
  };
}

const estFini = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Valide une DerniereMesure persistée (null si absente ou malformée). */
function hydraterDerniere(raw: unknown): DerniereMesure | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (!estFini(o.valeur) || !estFini(o.nActifs) || !estFini(o.centile) || !estFini(o.nHistorique)) return null;
  return { valeur: o.valeur, nActifs: o.nActifs, centile: o.centile, nHistorique: o.nHistorique };
}

/** Hydrate un résumé persisté INCONNU (JSON parsé) ; null si malformé — ne jette jamais. PURE. */
export function hydraterResumeRegime(raw: unknown): ResumeRegime | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!estFini(o.calculeA) || !estFini(o.jour) || typeof o.univers !== "string") return null;
  if (!estFini(o.nAttendus) || !estFini(o.nAlts)) return null;
  return {
    calculeA: o.calculeA,
    jour: o.jour,
    univers: o.univers,
    nAttendus: o.nAttendus,
    nAlts: o.nAlts,
    dispersion7j: hydraterDerniere(o.dispersion7j),
    medianeCorrBtc30j: hydraterDerniere(o.medianeCorrBtc30j),
    corrMoyenne60j: hydraterDerniere(o.corrMoyenne60j),
    absorption60j: hydraterDerniere(o.absorption60j),
    plancherBruit60j: estFini(o.plancherBruit60j) ? o.plancherBruit60j : null,
  };
}

/** Durée de validité maximale du résumé pour le BRIEF (même TTL que la largeur de marché). */
export const TTL_RESUME_REGIME_MS = 12 * 60 * 60 * 1000;

/**
 * Résumé utilisable sans recalcul : calculé il y a moins de 12 h (pas dans le futur) ET
 * portant sur la DERNIÈRE clôture journalière disponible (la veille UTC de `nowMs`) — un
 * résumé de 23 h UTC est périmé dès qu'une nouvelle bougie 1d s'est close. PURE.
 */
export function resumeRegimeFrais(resume: ResumeRegime, nowMs: number): boolean {
  const age = nowMs - resume.calculeA;
  return age >= 0 && age < TTL_RESUME_REGIME_MS && resume.jour === bucketJour(nowMs) - 1;
}

/** Au moins une mesure publiée (un résumé tout « non mesuré » n'est pas persisté). PURE. */
export function resumeRegimeUtile(resume: ResumeRegime): boolean {
  return (
    resume.dispersion7j !== null ||
    resume.medianeCorrBtc30j !== null ||
    resume.corrMoyenne60j !== null ||
    resume.absorption60j !== null
  );
}

// ─────────────── Persistance et mesure autonome (impur, pour le BRIEF) ───────────────

/** Clé localStorage du dernier résumé TOP 50 (écrit par CORR › Régime et par le BRIEF). */
export const CLE_RESUME_REGIME = "axiom:corr:regime:v1";

/** Univers de référence du BRIEF : top 50 par capitalisation, paires Binance USDT réelles. */
export const TAILLE_UNIVERS_BRIEF = 50;
export const LIBELLE_UNIVERS_TOP50 = "Top 50 cap. CoinGecko (paires Binance USDT)";

/** Lecture tolérante du résumé persisté (stockage indisponible / corrompu → null). */
export function lireResumeRegime(): ResumeRegime | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const brut = localStorage.getItem(CLE_RESUME_REGIME);
    return brut === null ? null : hydraterResumeRegime(JSON.parse(brut));
  } catch {
    return null;
  }
}

/** Écriture best-effort du résumé (quota / mode privé : non bloquant). */
export function ecrireResumeRegime(resume: ResumeRegime): void {
  try {
    localStorage.setItem(CLE_RESUME_REGIME, JSON.stringify(resume));
  } catch {
    /* best-effort : la ligne du BRIEF se recalculera à la prochaine ouverture */
  }
}

/**
 * Compose l'univers top N comme CORR : top 250 CoinGecko (cache 5 min de
 * fetchMarketOverview), stablecoins et emballés exclus, paires filtrées contre le catalogue
 * Binance réel (`null` = catalogue indisponible : composition sans filtre).
 */
export async function composerUniversTop(n: number): Promise<string[]> {
  const apercu = await fetchMarketOverview();
  if (apercu.coins.length === 0) throw new Error("Catalogue CoinGecko indisponible");
  let paires: ReadonlySet<string> | null = null;
  try {
    const liste = await fetchPairs("binance");
    paires = liste.length > 0 ? new Set(liste) : null;
  } catch {
    paires = null;
  }
  return topPairesUnivers(apercu.coins, n, paires);
}

/**
 * Persiste un résultat calculé sur l'univers TOP 50 (CORR › Régime ou BRIEF) s'il publie au
 * moins une mesure ; renvoie le résumé (ou null si la référence manque).
 */
export function persisterRegimeTop50(res: ResultatRegime, calculeA: number, nAttendus: number): ResumeRegime | null {
  const resume = resumerRegime(res, { calculeA, univers: LIBELLE_UNIVERS_TOP50, nAttendus });
  if (resume !== null && resumeRegimeUtile(resume)) ecrireResumeRegime(resume);
  return resume;
}

/**
 * Mesure autonome du BRIEF : univers top 50 figé à cet instant, séries 1d via le cache de
 * session de CORR (aucun doublon si CORR les a déjà chargées), calcul, persistance. Jette si
 * la référence BTC manque (le BRIEF affiche alors « non mesuré »).
 *
 * Collecte PROPRE (top 50 par capitalisation, ~400 j) distincte de celle de BREADTH (top 50
 * par volume, 210 bougies) : breadth.ts est hors du lot E2, la réconciliation (panneau
 * commun ou maintien documenté) relève de l'intégration avec le lot E1.
 */
export async function mesurerRegimeTop50(nowMs: number): Promise<ResumeRegime> {
  const univers = await composerUniversTop(TAILLE_UNIVERS_BRIEF);
  // Paires Binance USDT : même classement que CORR (BTC = référence, une paire par actif).
  const { alts } = classerUniversTransversal(univers, () => "binance");
  const series = await chargerSeries([...alts, REFERENCE_ROTATION]);
  const res = calculerRegimeTransversal(series, alts, series.get(REFERENCE_ROTATION) ?? [], nowMs);
  const resume = persisterRegimeTop50(res, nowMs, alts.length);
  if (resume === null) throw new Error("Régime non mesurable : référence BTC indisponible");
  return resume;
}
