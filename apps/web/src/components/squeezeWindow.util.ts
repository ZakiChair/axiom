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

/** Étiquette candidate : position d'ancrage souhaitée (x centré, y = baseline) + texte. */
export interface LabelCandidat {
  x: number;
  y: number;
  texte: string;
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
