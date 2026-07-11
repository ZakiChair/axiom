/**
 * Contrat de types PARTAGÉ de la couche globe (données maritimes + aériennes).
 *
 * Consommé tel quel par l'agent RENDU : ne pas modifier les formes sans
 * synchroniser les deux côtés (producteurs data/globe/* et fenêtre globe).
 */

/** Un chokepoint maritime IMF PortWatch, dernier point hebdomadaire connu. */
export interface Chokepoint {
  id: string; // portid PortWatch
  nom: string; // ex. « Détroit d'Ormuz »
  lat: number;
  lon: number;
  nNavires: number | null; // navires/jour (dernier point)
  nTankers: number | null; // pétroliers/jour (dernier point)
  nCargos: number | null; // cargos/jour si dispo, sinon null
  date: string | null; // ISO du dernier point (fraîcheur ~J-5)
}

/** Un aéronef OpenSky (vecteur d'état instantané). */
export interface Avion {
  icao24: string;
  lat: number;
  lon: number;
  cap: number | null; // degrés, true_track
  altitude: number | null; // m, geo_altitude ?? baro_altitude
  auSol: boolean;
}

export interface EtatOpenSky {
  avions: Avion[];
  horodatage: number; // s epoch renvoyé par l'API
  creditsRestants: number | null; // en-tête x-rate-limit-remaining si présent
}
