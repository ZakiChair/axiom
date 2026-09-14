/** Horizons communs au chargement, au cache et au filtrage des séries macro. */
export type HorizonMacro = 1 | 5 | 10 | 30 | 60 | "max";

export function debutHorizonMacro(horizon: HorizonMacro, ancre = Date.now()): number {
  // Le crédit historique commence avant l'époque Unix : ne pas borner à 1970.
  if (horizon === "max") return Date.UTC(1900, 0, 1);
  const date = new Date(ancre);
  return Date.UTC(date.getUTCFullYear() - horizon, date.getUTCMonth(), 1);
}
