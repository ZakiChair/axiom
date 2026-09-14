/**
 * Mémoire du refus d'abonnement BGeometrics (403 sur les données d'exchanges) — module SANS
 * dépendance : importé statiquement par `store/onchain` (bundle initial) sans y faire entrer le
 * client BGeometrics, chargé à la demande.
 *
 * Ne contient jamais la valeur d'une clé : la mémoire porte une échéance et un TYPE d'accès ;
 * la génération est un simple compteur, incrémenté à chaque effacement, qui permet d'ignorer
 * un 403 obtenu avec une clé remplacée entre-temps (autre onglet). Les deux restent propres au
 * poste : exclues de la sauvegarde JSON (cf. `store/persist`).
 */
export const CLE_REFUS_ABONNEMENT = "axiom:onchain:bg:abonnement-refuse";
export const CLE_GENERATION_ABONNEMENT = "axiom:onchain:bg:abonnement-generation";

/** Génération courante de la mémoire (best-effort, 0 par défaut). */
export function generationRefusAbonnementBg(): number {
  try {
    return Number(localStorage.getItem(CLE_GENERATION_ABONNEMENT)) || 0;
  } catch {
    return 0;
  }
}

/** Efface la mémoire du refus d'abonnement (appelé au changement ou retrait de clé). */
export function oublierRefusAbonnementBg(): void {
  try {
    // Génération d'abord : un 403 de l'ancienne clé qui arrive entre les deux écritures n'est plus mémorisé.
    localStorage.setItem(CLE_GENERATION_ABONNEMENT, String(generationRefusAbonnementBg() + 1));
    localStorage.removeItem(CLE_REFUS_ABONNEMENT);
  } catch {
    /* best-effort */
  }
}
