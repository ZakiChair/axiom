/**
 * Helper de formatage propre à la fenêtre « Options » (OMON) — extrait d'OptionsWindow.tsx.
 *
 * `formatUsdExact` est partagé par les vues Smile, GEX/DEX et Heatmap : couper-coller à
 * l'identique, signature inchangée. Ce module NE dépend PAS d'OptionsWindow (imports
 * uni-directionnels, pas de cycle).
 */

/**
 * Montant USD EXACT (« $68,432 ») pour les strikes et prix spot des tuiles : un
 * strike est un identifiant de contrat, pas un ordre de grandeur — le compactage
 * K/M de formatUsd rendrait indistincts deux strikes voisins (ex. 3 425 vs
 * 3 430). Milliers en-US, sans décimales (grilles de strikes entières).
 */
export function formatUsdExact(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
