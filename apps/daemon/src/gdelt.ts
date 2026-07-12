/**
 * GDELT Event Database 2.0 — parse des tranches 15 min (CSV tabulé, 61 colonnes
 * SANS en-tête, indices vérifiés empiriquement le 2026-07-12 sur une vraie
 * tranche), filtre « tension géopolitique » (racines CAMEO 14-20 : protestations,
 * posture de force, réduction de relations, coercition, assauts, combats,
 * violence de masse — les racines 01-13, coopération et conflit verbal
 * diplomatique, sont du bruit pour une carte) et agrégation sur grille 0,5°.
 * Module PUR : aucune E/S, tout est testable sans réseau ni disque.
 */

/** Catégorie de rendu d'un événement (regroupement de racines CAMEO). */
export type CategorieEvenement = "materiel" | "coercition" | "protestation";

/** Événement GDELT filtré et géolocalisé. */
export interface EvenementGdelt {
  idGdelt: string;
  dateMs: number;
  lat: number;
  lon: number;
  codeCameo: string;
  racine: string;
  quadClass: number;
  goldstein: number;
  mentions: number;
  acteur1: string | null;
  acteur2: string | null;
  url: string | null;
  categorie: CategorieEvenement;
}

/** 14 = protestation ; 15-17 = coercition/posture ; 18-20 = conflit matériel ; reste = écarté. */
export function categoriePourRacine(racine: string): CategorieEvenement | null {
  if (racine === "14") return "protestation";
  if (racine === "15" || racine === "16" || racine === "17") return "coercition";
  if (racine === "18" || racine === "19" || racine === "20") return "materiel";
  return null;
}

/** `YYYYMMDDHHMMSS` (UTC, colonne DATEADDED) → epoch ms, null si malformé. */
export function parseDateGdelt(brut: string): number | null {
  if (!/^\d{14}$/.test(brut)) return null;
  return Date.UTC(
    Number(brut.slice(0, 4)),
    Number(brut.slice(4, 6)) - 1,
    Number(brut.slice(6, 8)),
    Number(brut.slice(8, 10)),
    Number(brut.slice(10, 12)),
    Number(brut.slice(12, 14)),
  );
}

/** Chaîne vide → null (les colonnes GDELT absentes sont des chaînes vides). */
function ouNull(v: string | undefined): string | null {
  return v === undefined || v === "" ? null : v;
}

/** Parse une ligne 61 colonnes ; null si hors filtre ou malformée. */
export function parseLigneGdelt(ligne: string): EvenementGdelt | null {
  const c = ligne.split("\t");
  if (c.length !== 61) return null;
  const racine = c[28] ?? "";
  const categorie = categoriePourRacine(racine);
  if (categorie === null) return null;
  const latBrut = c[56] ?? "";
  const lonBrut = c[57] ?? "";
  if (latBrut === "" || lonBrut === "") return null;
  const lat = Number(latBrut);
  const lon = Number(lonBrut);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const dateMs = parseDateGdelt(c[59] ?? "");
  if (dateMs === null) return null;
  const goldstein = Number(c[30]);
  const mentions = Number(c[31]);
  return {
    idGdelt: c[0] ?? "",
    dateMs,
    lat,
    lon,
    codeCameo: c[26] ?? "",
    racine,
    quadClass: Number(c[29]) || 0,
    goldstein: Number.isFinite(goldstein) ? goldstein : 0,
    mentions: Number.isFinite(mentions) && mentions > 0 ? Math.trunc(mentions) : 0,
    acteur1: ouNull(c[6]),
    acteur2: ouNull(c[16]),
    url: ouNull(c[60]),
    categorie,
  };
}

/** Parse une tranche complète (tolère \r\n et lignes vides). */
export function parseTrancheGdelt(tsv: string): EvenementGdelt[] {
  const evenements: EvenementGdelt[] = [];
  for (const brute of tsv.split("\n")) {
    const ligne = brute.endsWith("\r") ? brute.slice(0, -1) : brute;
    if (ligne === "") continue;
    const evt = parseLigneGdelt(ligne);
    if (evt !== null) evenements.push(evt);
  }
  return evenements;
}

/** Pas de la grille d'agrégation (degrés). Partagé avec l'agrégation UCDP. */
export const GRILLE_DEG = 0.5;

/** Arrondit une coordonnée au pas de grille. */
export function cleGrille(v: number): number {
  return Math.round(v / GRILLE_DEG) * GRILLE_DEG;
}

/** Cellule agrégée servie au front (COPIE VERBATIM côté web : data/globe/types.ts). */
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

/** Agrège par (cellule 0,5°, catégorie). Ordre de sortie stable (clé croissante). */
export function agregerEvenements(evenements: readonly EvenementGdelt[]): CelluleEvenements[] {
  const cellules = new Map<string, CelluleEvenements>();
  for (const e of evenements) {
    const lat = cleGrille(e.lat);
    const lon = cleGrille(e.lon);
    const cle = `${lat}|${lon}|${e.categorie}`;
    const intensite = Math.min(10, Math.abs(e.goldstein));
    const existante = cellules.get(cle);
    if (existante === undefined) {
      cellules.set(cle, { lat, lon, categorie: e.categorie, n: 1, intensite, mentions: e.mentions, dernierMs: e.dateMs });
    } else {
      existante.n += 1;
      existante.mentions += e.mentions;
      existante.intensite = Math.max(existante.intensite, intensite);
      existante.dernierMs = Math.max(existante.dernierMs, e.dateMs);
    }
  }
  return [...cellules.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, v]) => v);
}
