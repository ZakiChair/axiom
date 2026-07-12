/**
 * UCDP Candidate GED — le CSV mensuel (https://ucdp.uu.se/downloads/candidateged/)
 * porte un nom VERSIONNÉ (GEDEvent_v26_0_5.csv…) découvert en scrapant la page
 * d'index. Champs quotés RFC 4180 (virgules, "" échappés, retours ligne DANS
 * les champs source_article — vérifié empiriquement le 2026-07-12, 1686
 * enregistrements × 49 colonnes). Colonnes résolues PAR NOM d'en-tête.
 * Agrégation sur la même grille 0,5° que GDELT. Module PUR.
 */
import { cleGrille } from "./gdelt";

/** Parseur CSV RFC 4180 minimal (état : dans/hors guillemets). */
export function parseCsv(texte: string): string[][] {
  const lignes: string[][] = [];
  let ligne: string[] = [];
  let champ = "";
  let dansGuillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const ch = texte[i];
    if (dansGuillemets) {
      if (ch === '"') {
        if (texte[i + 1] === '"') { champ += '"'; i++; } else dansGuillemets = false;
      } else champ += ch;
    } else if (ch === '"') {
      dansGuillemets = true;
    } else if (ch === ",") {
      ligne.push(champ); champ = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && texte[i + 1] === "\n") i++;
      ligne.push(champ); champ = "";
      lignes.push(ligne); ligne = [];
    } else champ += ch;
  }
  if (champ !== "" || ligne.length > 0) { ligne.push(champ); lignes.push(ligne); }
  return lignes;
}

/**
 * Repère le fichier candidat mensuel le plus récent dans le HTML de la page
 * d'index. Motif à 3 nombres (v<année>_<x>_<mois>) ; les fichiers trimestriels
 * consolidés à 4 nombres (GEDEvent_v26_01_26_03.csv) ne matchent pas ce motif.
 */
export function choisirFichierCandidat(html: string): string | null {
  const motif = /candidateged\/(GEDEvent_v(\d+)_(\d+)_(\d+)\.csv)/g;
  let meilleur: { nom: string; score: number } | null = null;
  for (const m of html.matchAll(motif)) {
    const score = Number(m[2]) * 1_000_000 + Number(m[3]) * 1_000 + Number(m[4]);
    if (meilleur === null || score > meilleur.score) meilleur = { nom: m[1] ?? "", score };
  }
  return meilleur?.nom ?? null;
}

/** Zone de conflit agrégée (COPIE VERBATIM côté web : data/globe/types.ts). */
export interface ZoneConflitUcdp {
  lat: number;
  lon: number;
  morts: number;
  n: number;
  sideA: string | null;
  sideB: string | null;
  dernierMs: number;
}

/** `2026-05-05 00:00:00.000` → epoch ms UTC, null si malformé. */
function parseDateUcdp(brut: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(brut);
  if (m === null) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Agrège les enregistrements (1ʳᵉ ligne = en-tête) par cellule 0,5°. */
export function agregerUcdp(lignes: readonly string[][]): ZoneConflitUcdp[] {
  const entete = lignes[0];
  if (entete === undefined) return [];
  const iLat = entete.indexOf("latitude");
  const iLon = entete.indexOf("longitude");
  const iMorts = entete.indexOf("best");
  const iSideA = entete.indexOf("side_a");
  const iSideB = entete.indexOf("side_b");
  const iDate = entete.indexOf("date_start");
  if (iLat < 0 || iLon < 0 || iMorts < 0) return [];
  const zones = new Map<string, ZoneConflitUcdp & { pireMorts: number }>();
  for (const l of lignes.slice(1)) {
    const lat = Number(l[iLat]);
    const lon = Number(l[iLon]);
    if (l[iLat] === "" || l[iLon] === "" || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const morts = Math.max(0, Math.trunc(Number(l[iMorts]) || 0));
    const dateMs = parseDateUcdp(l[iDate] ?? "") ?? 0;
    const cLat = cleGrille(lat);
    const cLon = cleGrille(lon);
    const cle = `${cLat}|${cLon}`;
    const sideA = (l[iSideA] ?? "") === "" ? null : (l[iSideA] as string);
    const sideB = (l[iSideB] ?? "") === "" ? null : (l[iSideB] as string);
    const z = zones.get(cle);
    if (z === undefined) {
      zones.set(cle, { lat: cLat, lon: cLon, morts, n: 1, sideA, sideB, dernierMs: dateMs, pireMorts: morts });
    } else {
      z.morts += morts;
      z.n += 1;
      z.dernierMs = Math.max(z.dernierMs, dateMs);
      if (morts >= z.pireMorts) { z.pireMorts = morts; z.sideA = sideA; z.sideB = sideB; }
    }
  }
  return [...zones.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, { pireMorts: _p, ...zone }]) => zone);
}
