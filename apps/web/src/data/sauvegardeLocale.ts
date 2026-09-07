/** Périmètre explicite des snapshots : aucune clé API, préférence de thème ou cache. */
export const CLES_TERMINAL = [
  "axiom:chartState:v1", "axiom:watchlist:v1", "axiom:sessionUi:v1",
  "axiom:windowManager:v1", "axiom:synthetic:recents:v1", "axiom:indicatorSets:v1",
] as const;
export const CLES_TRAVAIL_PERSONNEL = [
  "axiom:notes:v1", "axiom:drawings:v1", "axiom:expy:v1",
  "axiom:portfolio:v1", "axiom:alerts:v1", "axiom:workspaces:v1",
] as const;
export const CLES_SNAPSHOT: readonly string[] = [...CLES_TERMINAL, ...CLES_TRAVAIL_PERSONNEL];
/** Les anciens snapshots sans ce marqueur ne couvraient pas le travail personnel. */
export const CLE_PERIMETRE_SNAPSHOT = "@perimetre:v1";

/**
 * localStorage n'a pas de transaction. Écrire avant de supprimer préserve l'ancien
 * état si le stockage refuse toute écriture. Si une écriture ultérieure dépasse le
 * quota, retirer les valeurs modifiées libère la place nécessaire au rollback.
 * Un accès devenu interdit pendant le rollback ne peut pas être réparé par l'API.
 */
export function remplacerClesLocales(
  valeurs: ReadonlyMap<string, string>,
  perimetre: readonly string[],
): boolean {
  const avant = new Map<string, string | null>();
  const modifiees: string[] = [];
  try {
    for (const cle of new Set([...perimetre, ...valeurs.keys()])) avant.set(cle, localStorage.getItem(cle));
    for (const [cle, valeur] of valeurs) {
      if (avant.get(cle) === valeur) continue;
      localStorage.setItem(cle, valeur);
      modifiees.push(cle);
    }
    // Aucune purge avant que toutes les nouvelles valeurs soient inscrites.
    for (const cle of perimetre) {
      if (valeurs.has(cle) || avant.get(cle) === null) continue;
      localStorage.removeItem(cle);
      modifiees.push(cle);
    }
    return true;
  } catch {
    try {
      for (const cle of modifiees) localStorage.removeItem(cle);
      for (const cle of modifiees) {
        const valeur = avant.get(cle);
        if (valeur !== null && valeur !== undefined) localStorage.setItem(cle, valeur);
      }
    } catch { /* accès révoqué : ne jamais annoncer un succès */ }
    return false;
  }
}
