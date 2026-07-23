/**
 * Utilitaires PURS de la fenêtre « Radar de squeeze » (SQZ) : calcul du domaine des
 * axes et projection des points funding×ΔOI en coordonnées pixel. Séparés du composant
 * pour rester testables hors navigateur (convention repo : le canvas/DOM n'est pas
 * testé unitairement, la géométrie pure l'est).
 *
 * Convention d'axes : funding % sur X (négatif à gauche, positif à droite), ΔOI % sur Y
 * mais INVERSÉ à l'écran (ΔOI positif en haut, y pixel petit) — les coordonnées pixel
 * sont exprimées en CSS px (le composant dessine sous `setTransform(dpr,…)`, donc en
 * CSS px ; le hit-testing partage donc le même repère).
 */

import { SEUIL_DOI_PCT, SEUIL_FUNDING_PCT, type QuadrantSqueeze } from "../data/squeeze";

/** Coordonnée d'entrée : seules les deux valeurs d'axe importent pour la géométrie. */
export interface CoordRadar {
  fundingPct: number;
  dOiPct: number;
}

/** Demi-étendues des axes ; le domaine est [-fMax, fMax] × [-oMax, oMax], centré sur 0. */
export interface DomaineAxes {
  fMax: number;
  oMax: number;
}

/** Point projeté en pixels (CSS px). */
export interface PointPixel {
  x: number;
  y: number;
}

/** Étiquette candidate : position d'ancrage souhaitée (x centré, y = baseline) + texte. */
export interface LabelCandidat {
  x: number;
  y: number;
  texte: string;
}

/**
 * Projette chaque point (funding, ΔOI) dans la zone de tracé [pad, w−pad] × [pad, h−pad].
 * Mapping linéaire : funding −fMax→gauche / +fMax→droite ; ΔOI +oMax→haut / −oMax→bas
 * (Y inversé pour l'écran). L'inverse analytique retrouve exactement les données
 * (aller-retour cohérent). PURE.
 */
export function projeterEnPixels(
  points: readonly CoordRadar[],
  domaine: DomaineAxes,
  w: number,
  h: number,
  pad: number,
): PointPixel[] {
  const innerW = w - 2 * pad;
  const innerH = h - 2 * pad;
  const { fMax, oMax } = domaine;
  return points.map((p) => ({
    x: pad + ((p.fundingPct + fMax) / (2 * fMax)) * innerW,
    y: pad + ((oMax - p.dOiPct) / (2 * oMax)) * innerH,
  }));
}

/** Hauteur approximative d'un label 9px (baseline en bas) — sert de rect et de pas. */
const LABEL_HAUTEUR = 11;

/**
 * Placement anti-collision des étiquettes. Chaque label est ancré centré en X, baseline
 * en Y ; son rect couvre [x−w/2, x+w/2] × [y−H, y]. Placement GLOUTON, déterministe : les
 * candidats sont traités dans l'ordre reçu (priorité au premier), et un label qui chevauche
 * un label déjà posé descend en cascade d'un pas (LABEL_HAUTEUR) jusqu'à se dégager, puis
 * est clampé aux bords du canvas. Chevauchement STRICT (bords jointifs ≠ collision) : chaque
 * cascade dégage exactement un cran, ce qui garantit la terminaison. Cas motivant : marché
 * calme, tous les points groupés vers (0,0) → sans ce placement les 8 labels s'empilent.
 * PURE — pas d'algorithme de force, aucune dépendance au DOM.
 */
export function placerLabels(
  candidats: readonly LabelCandidat[],
  largeurTexte: (t: string) => number,
  w: number,
  h: number,
): LabelCandidat[] {
  const poses: Array<{ x1: number; x2: number; y1: number; y2: number }> = [];
  const resultat: LabelCandidat[] = [];

  for (const c of candidats) {
    const demiL = largeurTexte(c.texte) / 2;
    let y = c.y;
    // Cascade vers le bas tant qu'un chevauchement subsiste. Garde-fou : au plus un cran
    // par label déjà posé (+1) — impossible à saturer avec un chevauchement strict.
    let gardes = poses.length + 1;
    while (gardes-- > 0 && poses.some((r) => chevauchent(c.x, y, demiL, r))) {
      y += LABEL_HAUTEUR;
    }
    // Clamp aux bords : rect entièrement dans [0, w] × [0, h].
    const x = Math.min(Math.max(c.x, demiL), w - demiL);
    y = Math.min(Math.max(y, LABEL_HAUTEUR), h);
    poses.push({ x1: x - demiL, x2: x + demiL, y1: y - LABEL_HAUTEUR, y2: y });
    resultat.push({ x, y, texte: c.texte });
  }
  return resultat;
}

/** Chevauchement STRICT du rect d'un label (centre x, demi-largeur demiL, baseline y) avec r. */
function chevauchent(
  x: number,
  y: number,
  demiL: number,
  r: { x1: number; x2: number; y1: number; y2: number },
): boolean {
  const x1 = x - demiL;
  const x2 = x + demiL;
  const y1 = y - LABEL_HAUTEUR;
  const y2 = y;
  return x1 < r.x2 && x2 > r.x1 && y1 < r.y2 && y2 > r.y1;
}

// ─────────────────────── Statistiques robustes (winsorisation) ───────────────────────

/**
 * Quantile `q` (∈ [0,1]) par interpolation linéaire, convention « type 7 » (défaut de
 * R/numpy) : position = q·(n−1) sur les valeurs FINIES triées croissant, interpolation
 * entre les deux voisins. Les valeurs non finies sont exclues ; liste finie vide →
 * undefined (le domaine retombera alors sur son plancher). PURE.
 */
export function quantile(valeurs: readonly number[], q: number): number | undefined {
  const finis = valeurs.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = finis.length;
  if (n === 0) return undefined;
  if (n === 1) return finis[0];
  const pos = q * (n - 1);
  const bas = Math.floor(pos);
  const haut = Math.ceil(pos);
  const frac = pos - bas;
  return finis[bas]! + (finis[haut]! - finis[bas]!) * frac;
}

/**
 * Domaine d'axes ROBUSTE aux valeurs extrêmes (winsorisation) : par axe, borne =
 * max(|q2 %|, |q98 %|), symétrisée autour de 0, avec un plancher à 2× le seuil de
 * neutralité de l'axe (SEUIL_FUNDING_PCT / SEUIL_DOI_PCT). Un outlier isolé au-delà du
 * 98ᵉ centile n'étire donc pas l'échelle ; sur un nuage calme, l'axe reste au plancher
 * (la zone neutre ±seuil occupe alors la moitié de la demi-étendue). PURE.
 */
export function domaineAxesRobuste(points: readonly CoordRadar[]): DomaineAxes {
  const fundings = points.map((p) => p.fundingPct);
  const ois = points.map((p) => p.dOiPct);
  const borne = (valeurs: number[], plancher: number): number => {
    const q2 = quantile(valeurs, 0.02);
    const q98 = quantile(valeurs, 0.98);
    if (q2 === undefined || q98 === undefined) return plancher;
    return Math.max(plancher, Math.abs(q2), Math.abs(q98));
  };
  return {
    fMax: borne(fundings, 2 * SEUIL_FUNDING_PCT),
    oMax: borne(ois, 2 * SEUIL_DOI_PCT),
  };
}

/** Contraint `v` à l'intervalle [−borne, +borne]. */
function clamp(v: number, borne: number): number {
  return Math.min(borne, Math.max(-borne, v));
}

/**
 * Score d'intensité de squeeze ∈ [0, √2]. Nul pour un point « neutre » (bruit). Sinon,
 * distance euclidienne normalisée √((f/bF)² + (oi/bOi)²) où f et oi sont CLAMPÉS aux
 * bornes du domaine — un point écrêté au coin plafonne donc à √2, sans dominer l'échelle.
 * Sert au classement du panneau Top candidats (T3) et au choix des étiquettes (T2). PURE.
 */
export function scoreSqueeze(
  p: { fundingPct: number; dOiPct: number; quadrant: QuadrantSqueeze },
  d: DomaineAxes,
): number {
  if (p.quadrant === "neutre") return 0;
  const rf = clamp(p.fundingPct, d.fMax) / d.fMax;
  const ro = clamp(p.dOiPct, d.oMax) / d.oMax;
  return Math.sqrt(rf * rf + ro * ro);
}

/** Vrai si le point sort du domaine sur AU MOINS un axe (comparaison stricte). PURE. */
export function estEcrete(p: CoordRadar, d: DomaineAxes): boolean {
  return Math.abs(p.fundingPct) > d.fMax || Math.abs(p.dOiPct) > d.oMax;
}

/** Pas « ronds » candidats à l'intérieur d'une décade (mantisses 1/2/5). */
const MANTISSES_TICK = [1, 2, 5] as const;

/**
 * Graduations « rondes » couvrant [min, max]. Le pas est de la forme 1/2/5×10^k, choisi
 * pour approcher `n` graduations (typiquement 4-6). Les graduations sont des multiples du
 * pas → 0 est inclus dès qu'il appartient à l'intervalle. La première est ≥ min et la
 * dernière ≤ max (couverture à moins d'un pas des bornes). PURE.
 *
 * Note : certains domaines symétriques (p. ex. le plancher ΔOI ±6) n'admettent aucun pas
 * 1/2/5 donnant exactement 4-6 crans ; on retient alors le pas dont le nombre de crans est
 * le plus proche de `n` (à égalité, le plus dense, pour garantir la couverture).
 */
export function genTicks(min: number, max: number, n: number): number[] {
  if (!(max > min) || !(n >= 2)) return [min];
  const span = max - min;
  const kBase = Math.floor(Math.log10(span / n));
  let meilleurPas = 0;
  let meilleurEcart = Infinity;
  // Balaye quelques décades autour de l'ordre de grandeur de span/n × {1,2,5}.
  for (let k = kBase - 1; k <= kBase + 1; k++) {
    for (const m of MANTISSES_TICK) {
      const pas = m * Math.pow(10, k);
      const nb = Math.floor(max / pas) - Math.ceil(min / pas) + 1;
      if (nb < 2) continue;
      // Écart au nombre cible ; à égalité on préfère le pas le plus fin (nb plus grand).
      const ecart = Math.abs(nb - n);
      if (ecart < meilleurEcart || (ecart === meilleurEcart && pas < meilleurPas)) {
        meilleurEcart = ecart;
        meilleurPas = pas;
      }
    }
  }
  const pas = meilleurPas;
  const decimales = Math.max(0, -Math.floor(Math.log10(pas)));
  const debut = Math.ceil(min / pas) * pas;
  const eps = pas * 1e-9;
  const ticks: number[] = [];
  for (let v = debut; v <= max + eps; v += pas) {
    // Arrondi à la précision du pas pour effacer le bruit flottant (0.30000000004…).
    ticks.push(Number(v.toFixed(decimales)));
  }
  return ticks;
}
