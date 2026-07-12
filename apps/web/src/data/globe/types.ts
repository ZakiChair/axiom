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

/** Catégorie d'un événement géopolitique (COPIE VERBATIM de apps/daemon/src/gdelt.ts —
 *  interdiction d'import cross-package ; source de vérité = ce commentaire). */
export type CategorieEvenement = "materiel" | "coercition" | "protestation";

/** Cellule GDELT agrégée par le daemon (grille 0,5°, COPIE VERBATIM idem). */
export interface CelluleEvenements {
  lat: number;
  lon: number;
  categorie: CategorieEvenement;
  n: number;
  /** max de |GoldsteinScale| borné [0, 10] sur la cellule. */
  intensite: number;
  mentions: number;
  dernierMs: number;
}

/** Réponse de GET /globe/evenements. */
export interface EtatEvenements {
  cellules: CelluleEvenements[];
  /** Dernière ingestion daemon (epoch ms), null si base vide. */
  majA: number | null;
  /** Fenêtre réellement couverte par les données servies. */
  couverture: { deMs: number; aMs: number } | null;
}

/** Un événement du panneau détail (GET /globe/evenements/zone). */
export interface EvenementDetail {
  dateMs: number;
  categorie: CategorieEvenement;
  codeCameo: string;
  goldstein: number;
  mentions: number;
  acteur1: string | null;
  acteur2: string | null;
  url: string | null;
}

/** Zone UCDP agrégée (COPIE VERBATIM de apps/daemon/src/ucdp.ts). */
export interface ZoneConflitUcdp {
  lat: number;
  lon: number;
  morts: number;
  n: number;
  sideA: string | null;
  sideB: string | null;
  dernierMs: number;
}

/** Réponse de GET /globe/conflits-ucdp. */
export interface EtatConflitsUcdp {
  zones: ZoneConflitUcdp[];
  majA: number;
  fichier: string;
}

/** Front Ukraine ISW : FeatureCollection GeoJSON opaque côté data (assertion côté rendu, pattern TERRES). */
export interface FrontUkraine {
  collection: unknown;
  /** EditDate ArcGIS le plus récent (epoch ms), null si absent. */
  majMs: number | null;
  n: number;
}
