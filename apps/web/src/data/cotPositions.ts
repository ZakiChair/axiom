import type { LigneCot } from "./cot";

/** Une absence/valeur invalide ne devient jamais un stock nul. */
function stockCot(valeur: number | undefined): number | null {
  return valeur !== undefined && Number.isFinite(valeur) && valeur >= 0 ? valeur : null;
}

/**
 * Différence des deux derniers instantanés, PAS nombre brut d'ouvertures/clôtures.
 * La comparaison exige des dates distinctes et le dernier rapport de la ligne.
 * Les anciennes séries net/OI restent utilisables, sans stocks reconstruits.
 */
export function positionsCot(ligne: LigneCot) {
  const longs = stockCot(ligne.longs);
  const shorts = stockCot(ligne.shorts);
  const dernier = ligne.serie[ligne.serie.length - 1];
  const precedent = ligne.serie[ligne.serie.length - 2];
  const comparable = dernier !== undefined && precedent !== undefined &&
    Number.isFinite(dernier.t) && Number.isFinite(precedent.t) &&
    dernier.t === ligne.dateRapport && precedent.t < dernier.t;
  const avantLongs = comparable ? stockCot(precedent.longs) : null;
  const avantShorts = comparable ? stockCot(precedent.shorts) : null;
  return {
    longs,
    shorts,
    deltaLongs: longs !== null && avantLongs !== null ? longs - avantLongs : null,
    deltaShorts: shorts !== null && avantShorts !== null ? shorts - avantShorts : null,
    datePrecedente: comparable ? precedent.t : null,
  };
}

export function libelleMouvementCot(delta: number | null): string {
  if (delta === null || !Number.isFinite(delta)) return "Variation indisponible";
  return delta > 0 ? "Ajouts nets" : delta < 0 ? "Réductions nettes" : "Inchangé";
}
