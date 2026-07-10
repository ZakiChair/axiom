/**
 * Lecture des tokens CSS du thème courant pour les rendus canvas/SVG.
 *
 * Les canvas ne voient pas les classes Tailwind : ils doivent résoudre les
 * variables CSS ([data-theme] sur <html>) au moment du dessin. Cette pratique
 * existait en trois copies locales (DomWindow.readTokens, VolWindow.lireTokens,
 * MarketMapWindow.readTokens) et était contournée par des hex en dur ailleurs
 * (Options, TermStructure, Derivatives) — d'où des rendus faux sur thème clair.
 *
 * À appeler au moment du dessin (pas au montage) : un changement de thème
 * repeint alors avec les bonnes couleurs au prochain rendu.
 */

/**
 * Résout un lot de variables CSS (`--up`, `--text-dim`…) depuis `<html>`.
 * Renvoie les valeurs brutes trimées (hex ou rgb selon le thème) ; une
 * variable absente renvoie la chaîne vide — fournir un repli au callsite si
 * le token est optionnel.
 */
export function lireTokensCanvas<T extends string>(noms: readonly T[]): Record<T, string> {
  const style = getComputedStyle(document.documentElement);
  const resultat = {} as Record<T, string>;
  for (const nom of noms) {
    resultat[nom] = style.getPropertyValue(nom).trim();
  }
  return resultat;
}

/**
 * Variante à token unique avec repli explicite (pattern VolWindow.lireToken /
 * OptionsWindow.lireToken).
 */
export function lireTokenCanvas(nom: string, repli: string): string {
  const valeur = getComputedStyle(document.documentElement).getPropertyValue(nom).trim();
  return valeur !== "" ? valeur : repli;
}
