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
 * 3 430). Milliers en-US, sans décimales au-delà de 1 000 ; sous 1 000, jusqu'à deux
 * décimales pour les strikes fractionnaires (ETF : 44,5 et 45 restent distincts).
 */
export function formatUsdExact(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const decimales = Math.abs(v) < 1000 && !Number.isInteger(v) ? 2 : 0;
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: decimales })}`;
}

/** Écart en points d'IV signé (« +1.25 pt », « −0.40 pt »), « — » si absent. */
export function formatPointsIv(v: number | null | undefined, dec = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const signe = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${signe}${Math.abs(v).toFixed(dec)} pt`;
}

/** Date et heure UTC compactes « 06/11 09:12 UTC » (instantanés quotidiens), « — » si absent. */
export function formatDateHeureUtc(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  const iso = new Date(ms).toISOString();
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)} UTC`;
}

/** Jour UTC « AAAA-MM-JJ » → « 06/11 ». */
export function formatJourUtc(jour: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(jour) ? `${jour.slice(8, 10)}/${jour.slice(5, 7)}` : "—";
}
