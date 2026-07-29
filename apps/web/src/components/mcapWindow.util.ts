/**
 * Helpers PURS de la fenêtre CAP (testés) : domaine vertical, projections index ⇄ pixel,
 * ticks et fenêtrage. Isolés du composant pour être GELÉS contre la régression
 * silencieuse — un réticule décalé d'un jour ou une courbe écrasée contre le cadre
 * n'échoue ni au build ni au rendu.
 *
 * ⚠️ RÉCIPROCITÉ projX ⇄ indexDepuisX : le dessin et le hit-testing du survol DOIVENT
 * partager cette géométrie (mêmes marges, même projection). C'est la leçon HEATMAP :
 * deux jeux de littéraux séparés dérivent, et l'infobulle finit par annoncer la valeur
 * d'un jour voisin de celui que le trait du curseur désigne.
 */
import { formatDateCourte } from "../lib/format";

/** Marges internes du cadre de tracé, en pixels CSS. */
export const MARGES = { g: 56, d: 10, h: 12, b: 18 } as const;

/** Largeur cible d'une étiquette de l'axe des temps (px) — fixe la densité des ticks. */
const LARGEUR_ETIQUETTE_PX = 70;

/**
 * Domaine vertical couvrant TOUTES les séries, trous ignorés, élargi de `marge`
 * (fraction, ex. 0,04 = 4 %) de part et d'autre.
 *
 * Le domaine n'est JAMAIS forcé à contenir 0 : un niveau élevé (2,3 T$) qui varie de
 * quelques pourcents s'écraserait contre le haut du cadre. Divergence assumée, déjà
 * retenue pour NETLIQ.
 */
export function domaineValeurs(
  series: ReadonlyArray<ReadonlyArray<number | null>>,
  marge = 0.04
): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const serie of series) {
    for (const v of serie) {
      if (v === null || !Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };

  if (max === min) {
    // Domaine dégénéré : ±1 % (ou ±1 si la valeur est nulle) pour garder une échelle.
    const demi = Math.abs(min) * 0.01 || 1;
    return { min: min - demi, max: max + demi };
  }
  const delta = (max - min) * marge;
  return { min: min - delta, max: max + delta };
}

/** Abscisse (px CSS) du point d'index `i` parmi `n`, marges comprises. */
export function projX(i: number, n: number, largeur: number): number {
  const utile = largeur - MARGES.g - MARGES.d;
  if (n <= 1 || utile <= 0) return MARGES.g;
  return MARGES.g + (i / (n - 1)) * utile;
}

/** Ordonnée (px CSS) de la valeur `v` dans le domaine `[min, max]`. */
export function projY(v: number, min: number, max: number, hauteur: number): number {
  const utile = hauteur - MARGES.h - MARGES.b;
  if (!(max > min) || utile <= 0) return MARGES.h + utile / 2;
  return MARGES.h + (1 - (v - min) / (max - min)) * utile;
}

/** Index du point le plus proche de l'abscisse `xPix`, clampé dans `[0, n-1]`. */
export function indexDepuisX(xPix: number, n: number, largeur: number): number {
  const utile = largeur - MARGES.g - MARGES.d;
  if (n <= 1 || utile <= 0) return 0;
  const brut = Math.round(((xPix - MARGES.g) / utile) * (n - 1));
  return Math.min(n - 1, Math.max(0, brut));
}

/** Mantisses « rondes » acceptées pour le pas des ticks. */
const MANTISSES = [1, 2, 2.5, 5, 10] as const;

/**
 * Ticks ronds contenus dans `[min, max]`, en visant ~`nb` graduations. Générique :
 * fonctionne aussi bien sur des pourcentages (0–60) que sur des milliers de milliards
 * de dollars — le pas est cherché en puissances de 10 × {1 ; 2 ; 2,5 ; 5}.
 */
export function ticksValeurs(min: number, max: number, nb: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min || nb <= 0) return [];

  const brut = (max - min) / nb;
  const base = 10 ** Math.floor(Math.log10(brut));
  const pas = (MANTISSES.find((m) => m * base >= brut) ?? 10) * base;

  const ticks: number[] = [];
  for (let v = Math.ceil(min / pas) * pas; v <= max; v += pas) {
    // Le cumul de flottants dérive : on arrondit sur le pas pour des libellés propres.
    ticks.push(Math.round(v / pas) * pas);
  }
  return ticks;
}

/**
 * Étiquettes de l'axe des temps : index régulièrement espacés selon la largeur
 * disponible, libellés « JJ/MM ».
 */
export function ticksTemps(
  grille: readonly number[],
  largeur: number
): { i: number; label: string }[] {
  const n = grille.length;
  if (n === 0) return [];
  const utile = Math.max(0, largeur - MARGES.g - MARGES.d);
  const cible = Math.max(2, Math.floor(utile / LARGEUR_ETIQUETTE_PX));
  const pas = Math.max(1, Math.ceil(n / cible));

  const ticks: { i: number; label: string }[] = [];
  for (let i = 0; i < n; i += pas) {
    const t = grille[i];
    if (t === undefined) continue;
    ticks.push({ i, label: formatDateCourte(t) });
  }
  return ticks;
}

/**
 * Derniers `jours` points d'une série journalière (`null` = tout). La grille étant
 * journalière, un nombre de jours est un nombre de points.
 */
export function fenetrer<T>(serie: readonly T[], jours: number | null): T[] {
  if (jours === null || jours >= serie.length) return [...serie];
  return serie.slice(-jours);
}
