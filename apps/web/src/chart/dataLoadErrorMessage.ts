/**
 * Message de l'overlay « Données indisponibles » quand le backfill des bougies échoue.
 *
 * Volontairement STABLE et sans détail technique (le détail reste dans la console et
 * le panneau Santé), SAUF quand l'opérateur peut agir lui-même : HTTP 451 = la source
 * refuse la région (Binance depuis les États-Unis…), et « Réessayer » n'y changera rien.
 * La parade est le menu « Source » de l'en-tête ; Coinbase et Kraken ont été vérifiés
 * accessibles sous ce blocage en production (2026-09-14).
 *
 * Fonction PURE — `ChartInstance.tsx` n'est pas testable sans stub DOM lourd.
 */
export function dataLoadErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") return "Chargement annulé.";
  if (error instanceof Error && error.name === "ErreurCcData") return error.message;
  // Adaptateur Binance : `Binance REST ${status} ${statusText}` — statusText VIDE en
  // HTTP/2, d'où les frontières de mot plutôt qu'un motif « 451 Unavailable… ».
  if (error instanceof Error && /\b451\b/.test(error.message)) {
    return (
      "Cette source refuse les connexions depuis votre région (HTTP 451). " +
      "Changez de source dans l’en-tête (menu « Source ») : Coinbase ou Kraken restent accessibles."
    );
  }
  if (error instanceof Error && /timeout|timed out|délai/i.test(error.message)) {
    return "La source n’a pas répondu dans le délai prévu.";
  }
  return "La source n’a pas pu fournir l’historique demandé.";
}
