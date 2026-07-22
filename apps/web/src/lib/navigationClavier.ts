/**
 * Helpers PURES de navigation au clavier — watchlist, timeframe, historique symbole.
 *
 * Tout est pur (aucun store, aucun DOM) : le câblage clavier vit dans
 * commands/hotkeys.ts, qui applique le résultat via `navigateTo` (bus lib/navigation).
 *
 * Deux sémantiques DIFFÉRENTES, volontairement :
 * - la watchlist BOUCLE (liste circulaire : on scanne en continu) ;
 * - les timeframes ne bouclent PAS (échelle ordonnée : passer de 1 j à 1 m d'un
 *   coup de touche serait un accident, jamais une intention).
 */
import type { Timeframe } from "@axiom/types";

/** Borne de la pile d'historique (au-delà, on oublie les plus anciens). */
const MAX_HISTORIQUE = 50;

/**
 * Symbole voisin dans la watchlist : dir=+1 (suivant) / -1 (précédent), CIRCULAIRE.
 *
 * Si `courant` n'est pas dans la liste (on charte un symbole hors watchlist), on
 * entre dans la liste par son extrémité naturelle : premier en descente, dernier
 * en montée. Null si la navigation n'a pas de sens (liste vide, ou liste réduite
 * au seul symbole déjà affiché). PURE.
 */
export function symboleVoisin(
  symboles: readonly string[],
  courant: string,
  dir: -1 | 1,
): string | null {
  if (symboles.length === 0) return null;
  const cible = courant.trim().toUpperCase();
  const i = symboles.findIndex((s) => s.toUpperCase() === cible);
  if (i < 0) return (dir === 1 ? symboles[0] : symboles[symboles.length - 1]) ?? null;
  if (symboles.length === 1) return null; // déjà dessus : rien à faire
  const j = (i + dir + symboles.length) % symboles.length;
  return symboles[j] ?? null;
}

/**
 * Timeframe voisin dans la liste SUPPORTÉE par la source courante : dir=+1 (plus
 * haut) / -1 (plus bas). NON circulaire — null aux bornes et si `courant` n'est
 * pas supporté. PURE.
 */
export function timeframeVoisin(
  supportes: readonly Timeframe[],
  courant: Timeframe,
  dir: -1 | 1,
): Timeframe | null {
  const i = supportes.indexOf(courant);
  if (i < 0) return null;
  const j = i + dir;
  if (j < 0 || j >= supportes.length) return null;
  return supportes[j] ?? null;
}

// ─────────────────────────── Historique de symboles ───────────────────────────

/**
 * Pile de navigation entre symboles, sémantique NAVIGATEUR : `index` désigne la
 * position courante ; empiler après un retour arrière tronque la branche avant.
 */
export interface EtatHistorique {
  /** Symboles visités, du plus ancien au plus récent. */
  pile: readonly string[];
  /** Position courante dans `pile` (-1 si vide). */
  index: number;
}

/** Historique initial (aucun symbole visité). */
export const HISTORIQUE_VIDE: EtatHistorique = { pile: [], index: -1 };

/** Vrai s'il existe un symbole antérieur. PURE. */
export function peutReculer(etat: EtatHistorique): boolean {
  return etat.index > 0;
}

/** Vrai s'il existe un symbole postérieur (après un retour arrière). PURE. */
export function peutAvancer(etat: EtatHistorique): boolean {
  return etat.index >= 0 && etat.index < etat.pile.length - 1;
}

/**
 * Empile un symbole visité. No-op s'il est déjà le courant (on ne veut pas de
 * doublons consécutifs quand un panneau renavigue vers le même symbole). Tronque
 * la branche avant, puis borne la pile à MAX_HISTORIQUE. PURE.
 */
export function pousserSymbole(etat: EtatHistorique, symbole: string): EtatHistorique {
  const s = symbole.trim().toUpperCase();
  if (s.length === 0) return etat;
  if (etat.index >= 0 && etat.pile[etat.index] === s) return etat;
  const tronquee = [...etat.pile.slice(0, etat.index + 1), s];
  const debordement = Math.max(0, tronquee.length - MAX_HISTORIQUE);
  const pile = tronquee.slice(debordement);
  return { pile, index: pile.length - 1 };
}

/** Recule d'un cran. `symbole` null (et état inchangé) s'il n'y a rien avant. PURE. */
export function reculer(etat: EtatHistorique): { etat: EtatHistorique; symbole: string | null } {
  if (!peutReculer(etat)) return { etat, symbole: null };
  const index = etat.index - 1;
  return { etat: { ...etat, index }, symbole: etat.pile[index] ?? null };
}

/** Avance d'un cran. `symbole` null (et état inchangé) s'il n'y a rien après. PURE. */
export function avancer(etat: EtatHistorique): { etat: EtatHistorique; symbole: string | null } {
  if (!peutAvancer(etat)) return { etat, symbole: null };
  const index = etat.index + 1;
  return { etat: { ...etat, index }, symbole: etat.pile[index] ?? null };
}
