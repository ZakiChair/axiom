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

/** Marge multiplicative autour du point le plus extrême (respiration des bulles). */
const PAD_DOMAINE = 1.15;
/** Demi-étendue minimale de l'axe funding (%/8 h) — garde 0 centré même sans donnée. */
const F_DEMI_MIN = 0.02;
/** Demi-étendue minimale de l'axe ΔOI (%) — idem, échelle lisible par défaut. */
const O_DEMI_MIN = 5;

/**
 * Domaine symétrique autour de 0 englobant tous les points, avec padding. Renvoie une
 * demi-étendue strictement positive par axe (fMax, oMax > 0) : 0 reste donc toujours au
 * centre, donc visible. Sans point (ou coordonnées non finies), retombe sur les minima.
 * PURE.
 */
export function domaineAxes(points: readonly CoordRadar[]): DomaineAxes {
  let fm = 0;
  let om = 0;
  for (const p of points) {
    if (Number.isFinite(p.fundingPct)) fm = Math.max(fm, Math.abs(p.fundingPct));
    if (Number.isFinite(p.dOiPct)) om = Math.max(om, Math.abs(p.dOiPct));
  }
  return {
    fMax: Math.max(F_DEMI_MIN, fm * PAD_DOMAINE),
    oMax: Math.max(O_DEMI_MIN, om * PAD_DOMAINE),
  };
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
