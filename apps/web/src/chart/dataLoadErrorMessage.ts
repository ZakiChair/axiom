/**
 * Message de l'overlay « Données indisponibles » quand le backfill des bougies échoue.
 *
 * Volontairement STABLE et sans détail technique (le détail reste dans la console et
 * le panneau Santé), SAUF quand l'opérateur peut agir lui-même : HTTP 451 = la source
 * refuse la région, ou Twelve Data signale une clé invalide ou un abonnement requis. La sélection
 * de source est automatique ; aucune suggestion de changer manuellement de fournisseur.
 *
 * Fonction PURE — `ChartInstance.tsx` n'est pas testable sans stub DOM lourd.
 */
export function dataLoadErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") return "Chargement annulé.";
  if (error instanceof Error && error.name === "ErreurCcData") return error.message;
  if (error instanceof Error && /Twelve Data/i.test(error.message)) {
    // Ces messages fixes n'exposent ni clé, ni URL, ni corps fournisseur arbitraire.
    // Une restriction de plan peut aussi mentionner l'API key sans qu'elle soit invalide.
    if (/\bavailable\s+starting\s+with\s+(?:the\s+)?Grow\s+or\s+Venture\s+plan\b/i.test(error.message)) {
      return "Cet historique nécessite un abonnement Twelve Data Grow ou Venture.";
    }
    if (/\b(?:subscription|plan|abonnement)\s+(?:is\s+|est\s+)?(?:required|requis)\b|\brequires?\s+(?:an?\s+)?(?:paid\s+|higher\s+)?(?:subscription|plan)\b|\bavailable\s+starting\s+with\b.{1,80}\bplan\b/i.test(error.message)) {
      return "Cet historique nécessite un abonnement Twelve Data incluant cet actif.";
    }
    if (/api\s*key|clé/i.test(error.message)) {
      return "Twelve Data nécessite une clé personnelle valide. Vérifiez-la dans les Réglages.";
    }
  }
  // Adaptateur Binance : `Binance REST ${status} ${statusText}` — statusText VIDE en
  // HTTP/2, d'où les frontières de mot plutôt qu'un motif « 451 Unavailable… ».
  if (error instanceof Error && /\b451\b/.test(error.message)) {
    return (
      "Cette source refuse les connexions depuis votre région (HTTP 451). " +
      "Aucune autre source compatible n’a pu fournir cet historique."
    );
  }
  if (error instanceof Error && /timeout|timed out|délai/i.test(error.message)) {
    return "La source n’a pas répondu dans le délai prévu.";
  }
  return "La source n’a pas pu fournir l’historique demandé.";
}
