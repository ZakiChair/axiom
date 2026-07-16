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

/** Replis RVB des tokens de série (valeurs du thème dark) — contexte sans DOM ou token absent. */
const REPLIS_SERIE = ["#38bdf8", "#a78bfa", "#f59e0b", "#f472b6", "#22d3ee", "#60a5fa"] as const;

/** Index 0-based → index de token 0..5 (modulo positif) — pur, testé. */
export function indexSerie(i: number): number {
  return ((i % 6) + 6) % 6;
}

/** Couleur de la série i (0-based, cycle sur --serie-1…6), lue au moment du dessin. */
export function serieCanvas(i: number, repli?: string): string {
  const n = indexSerie(i);
  return lireTokenCanvas(`--serie-${n + 1}`, repli ?? REPLIS_SERIE[n] ?? "#38bdf8");
}

/** #rgb / #rrggbb → triplet RVB, sinon null — pur, testé. */
export function parseHexRgb(c: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(c.trim());
  if (!m || m[1] === undefined) return null;
  const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** Token couleur résolu en `rgba(r,g,b,alpha)` — remplissages canvas semi-transparents. */
export function rgbaTokenCanvas(nom: string, alpha: number, repli: string): string {
  const brut = lireTokenCanvas(nom, repli);
  const rgb = parseHexRgb(brut) ?? parseHexRgb(repli);
  return rgb ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})` : brut;
}
