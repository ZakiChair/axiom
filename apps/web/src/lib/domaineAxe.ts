/**
 * Maths PURES de domaine d'axe pour les graphes canvas — zoom centré sur le curseur,
 * pan clampé, conversions pixel↔valeur, fenêtres de préréglage temporel.
 *
 * Un domaine est un intervalle numérique {min, max} : ms epoch pour les séries
 * temporelles (STBL, CHAIN, VOL, BT), strike (OMON), échéance ms (TERM) ou
 * maturité en années (RATE). Aucune dépendance DOM — testé dans domaineAxe.test.ts.
 * Le branchement gestuel (molette/drag/double-clic) vit dans hooks/useDomaineZoom.ts.
 */

export interface Domaine {
  min: number;
  max: number;
}

/** Largeur minimale d'un domaine zoomé : 1 % de la plage totale (anti zoom infini). */
export const LARGEUR_MIN_FRACTION = 0.01;

const JOUR_MS = 86_400_000;

/** Recadre `d` dans `bornes` en conservant sa largeur (tronquée si plus large). */
export function clampDomaine(d: Domaine, bornes: Domaine): Domaine {
  const largeurBornes = bornes.max - bornes.min;
  const largeur = Math.min(d.max - d.min, largeurBornes);
  let min = d.min;
  if (min < bornes.min) min = bornes.min;
  if (min + largeur > bornes.max) min = bornes.max - largeur;
  return { min, max: min + largeur };
}

/**
 * Zoom autour de `pivot` (valeur d'axe sous le curseur) : facteur > 1 = zoom avant.
 * Le pivot conserve sa position relative dans le domaine ; largeur clampée entre
 * LARGEUR_MIN_FRACTION × bornes et la largeur des bornes.
 */
export function zoomerDomaine(d: Domaine, facteur: number, pivot: number, bornes: Domaine): Domaine {
  const largeurBornes = bornes.max - bornes.min;
  const largeurMin = largeurBornes * LARGEUR_MIN_FRACTION;
  const largeur = Math.min(Math.max((d.max - d.min) / facteur, largeurMin), largeurBornes);
  const part = (pivot - d.min) / Math.max(1e-12, d.max - d.min);
  return clampDomaine({ min: pivot - part * largeur, max: pivot + (1 - part) * largeur }, bornes);
}

/** Translation de `delta` (en valeur d'axe), clampée aux bornes, largeur conservée. */
export function deplacerDomaine(d: Domaine, delta: number, bornes: Domaine): Domaine {
  return clampDomaine({ min: d.min + delta, max: d.max + delta }, bornes);
}

/** Valeur d'axe à la position `xPix` (pixels CSS) pour un tracé de `largeurPix`. */
export function pixelVersValeur(d: Domaine, xPix: number, largeurPix: number): number {
  return d.min + (xPix / Math.max(1, largeurPix)) * (d.max - d.min);
}

/** Position pixel (CSS) d'une valeur d'axe dans un tracé de `largeurPix`. */
export function valeurVersPixel(d: Domaine, valeur: number, largeurPix: number): number {
  return ((valeur - d.min) / Math.max(1e-12, d.max - d.min)) * largeurPix;
}

/**
 * Indices [debut, fin] (inclus) des points à dessiner pour couvrir `d`, avec UN point
 * au-delà de chaque bord pour que les lignes traversent le cadre sans trou.
 * `points` doit être trié croissant selon `valeurDe`. Série vide → {0, -1}.
 */
export function indicesVisibles<T>(
  points: readonly T[],
  valeurDe: (p: T) => number,
  d: Domaine,
): { debut: number; fin: number } {
  if (points.length === 0) return { debut: 0, fin: -1 };
  let debut = 0;
  while (debut < points.length && valeurDe(points[debut]!) < d.min) debut++;
  let fin = points.length - 1;
  while (fin >= 0 && valeurDe(points[fin]!) > d.max) fin--;
  return { debut: Math.max(0, debut - 1), fin: Math.min(points.length - 1, fin + 1) };
}

/** Domaine d'un préréglage « N derniers jours » ancré sur bornes.max ; null = tout. */
export function domainePourPreset(bornes: Domaine, jours: number | null): Domaine {
  if (jours === null) return { ...bornes };
  return clampDomaine({ min: bornes.max - jours * JOUR_MS, max: bornes.max }, bornes);
}
