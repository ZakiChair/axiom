/**
 * Treemap « squarified » PUR (algorithme de Bruls, Huizing & van Wijk, 2000).
 *
 * Découpe un rectangle conteneur en tuiles dont l'AIRE est proportionnelle au poids
 * (`value`) de chaque item, en cherchant à garder chaque tuile aussi CARRÉE que
 * possible (rapport largeur/hauteur proche de 1) — bien plus lisible qu'un slice-and-dice
 * naïf. Aucune dépendance, aucun effet de bord, aucune notion de canvas/DOM : ne fait
 * que projeter des valeurs en rectangles. Le rendu (couleurs, labels) est ailleurs.
 *
 * Principe : on empile les items (triés par aire décroissante) dans une « rangée »
 * posée le long du plus PETIT côté du rectangle libre courant, tant que cela améliore
 * (ou ne dégrade pas) le pire rapport d'aspect de la rangée ; sinon on fige la rangée
 * (elle consomme une bande) et on recommence sur le rectangle restant.
 */

/** Rectangle en coordonnées absolues (mêmes unités que le conteneur, ex. pixels). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Une tuile placée : l'item d'origine + son rectangle calculé. */
export interface Tuile<T> {
  item: T;
  rect: Rect;
}

/** Item interne enrichi de son aire cible (px²) le temps du calcul. */
interface ItemAire<T> {
  item: T;
  aire: number;
}

/**
 * Pire rapport d'aspect d'une rangée d'aires, posée le long d'un côté de longueur
 * `cote`. Formule de l'article : max( côté²·max / somme² , somme² / (côté²·min) ).
 * Plus la valeur est BASSE, plus les tuiles de la rangée sont carrées. PURE.
 */
function pireRatio<T>(rangee: readonly ItemAire<T>[], cote: number): number {
  if (rangee.length === 0 || cote <= 0) return Infinity;
  let somme = 0;
  let max = -Infinity;
  let min = Infinity;
  for (const r of rangee) {
    somme += r.aire;
    if (r.aire > max) max = r.aire;
    if (r.aire < min) min = r.aire;
  }
  if (somme <= 0) return Infinity;
  const cote2 = cote * cote;
  const somme2 = somme * somme;
  return Math.max((cote2 * max) / somme2, somme2 / (cote2 * min));
}

/**
 * Fige une rangée le long du plus petit côté du rectangle `libre`, pousse les tuiles
 * dans `sortie` et renvoie le rectangle RESTANT (bande consommée retirée).
 *
 * Si la largeur ≤ hauteur : rangée HORIZONTALE en haut, épaisseur = hauteur de bande ;
 * le restant est en dessous. Sinon : colonne VERTICALE à gauche, épaisseur = largeur ;
 * le restant est à droite. La somme des tuiles remplit exactement le côté long.
 */
function figerRangee<T>(rangee: readonly ItemAire<T>[], libre: Rect, sortie: Tuile<T>[]): Rect {
  let somme = 0;
  for (const r of rangee) somme += r.aire;
  if (somme <= 0) return libre;

  if (libre.w <= libre.h) {
    // Rangée horizontale : épaisseur (hauteur) = aire totale / largeur disponible.
    const epaisseur = somme / libre.w;
    let x = libre.x;
    for (const r of rangee) {
      const w = r.aire / epaisseur; // aire = w · epaisseur
      sortie.push({ item: r.item, rect: { x, y: libre.y, w, h: epaisseur } });
      x += w;
    }
    return { x: libre.x, y: libre.y + epaisseur, w: libre.w, h: libre.h - epaisseur };
  }

  // Colonne verticale : épaisseur (largeur) = aire totale / hauteur disponible.
  const epaisseur = somme / libre.h;
  let y = libre.y;
  for (const r of rangee) {
    const h = r.aire / epaisseur;
    sortie.push({ item: r.item, rect: { x: libre.x, y, w: epaisseur, h } });
    y += h;
  }
  return { x: libre.x + epaisseur, y: libre.y, w: libre.w - epaisseur, h: libre.h };
}

/**
 * Calcule un treemap squarified : chaque item reçoit une tuile d'aire ∝ `poids(item)`,
 * dans les limites de `conteneur`. Fonction PURE (ne mute pas `items`).
 *
 * - Les items de poids non fini ou ≤ 0 sont IGNORÉS (aucune tuile).
 * - Conteneur d'aire nulle/négative → aucune tuile.
 * - L'ordre de sortie suit le tri par poids décroissant (déterministe pour un même
 *   jeu d'entrée ; les ex æquo conservent leur ordre relatif d'origine — tri stable).
 */
export function squarify<T>(
  items: readonly T[],
  poids: (item: T) => number,
  conteneur: Rect,
): Tuile<T>[] {
  const sortie: Tuile<T>[] = [];
  if (conteneur.w <= 0 || conteneur.h <= 0) return sortie;

  // Filtre (poids fini > 0) puis tri décroissant STABLE (index en clé de départage).
  const valides = items
    .map((item, i) => ({ item, poids: poids(item), i }))
    .filter((e) => Number.isFinite(e.poids) && e.poids > 0)
    .sort((a, b) => b.poids - a.poids || a.i - b.i);
  if (valides.length === 0) return sortie;

  // Projection des poids en aires (px²) : Σ aires = aire du conteneur.
  let total = 0;
  for (const e of valides) total += e.poids;
  const echelle = (conteneur.w * conteneur.h) / total;
  const file: ItemAire<T>[] = valides.map((e) => ({ item: e.item, aire: e.poids * echelle }));

  let libre: Rect = { ...conteneur };
  let rangee: ItemAire<T>[] = [];
  let curseur = 0;

  while (curseur < file.length) {
    const prochain = file[curseur];
    if (prochain === undefined) break; // garde noUncheckedIndexedAccess (inatteignable)
    const cote = Math.min(libre.w, libre.h);

    // On ajoute tant que le pire ratio ne se DÉGRADE pas (rangée vide : on ajoute toujours).
    if (rangee.length === 0 || pireRatio([...rangee, prochain], cote) <= pireRatio(rangee, cote)) {
      rangee.push(prochain);
      curseur += 1;
    } else {
      libre = figerRangee(rangee, libre, sortie);
      rangee = [];
    }
  }
  if (rangee.length > 0) figerRangee(rangee, libre, sortie);

  return sortie;
}
