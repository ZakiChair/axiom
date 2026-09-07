/**
 * IPPI canadien, Statistique Canada, table 18-10-0265-01, total national.
 * Indice mensuel janvier 2020=100, non désaisonnalisé. Prix des produits fabriqués
 * au Canada, ventes domestiques et exportations. L'a/a est calculé par le chargeur
 * macro commun contre le même mois de l'année précédente (transformation `aa`).
 *
 * WDS GET public avec CORS *, vérifié le 07/09/2026 ; aucun ZIP ni clé nécessaire.
 * https://www.statcan.gc.ca/en/developers/wds/user-guide
 * Les dates sont celles des observations. `releaseTime` n'est pas une vintage
 * historique ; cette série révisable ne constitue pas une archive point-in-time.
 */
import type { MacroPoint, MacroSeries } from "./types";
import { periodeVersMs, trierChrono } from "./harmonisation";

const VECTEUR_IPPI = 1230995983;
const BASE = "https://www150.statcan.gc.ca/t1/wds/rest/getDataFromVectorByReferencePeriodRange";
const QUALITES: Record<number, string> = {
  3: "qualité excellente", 4: "qualité très bonne", 5: "qualité bonne",
  6: "qualité passable", 7: "utiliser avec prudence",
};
function champ(obj: unknown, cle: string): unknown {
  return typeof obj === "object" && obj !== null ? (obj as Record<string, unknown>)[cle] : undefined;
}

/** Parse uniquement le total IPPI attendu ; n'invente ni unité ni valeur absente. */
export function parseStatcanSeries(json: unknown, vectorId: number, depuisMs: number): MacroSeries {
  if (vectorId !== VECTEUR_IPPI || !Array.isArray(json)) throw new Error("StatCan : vecteur IPPI invalide");
  const candidats = json.filter((r) => champ(champ(r, "object"), "vectorId") === vectorId);
  if (candidats.length !== 1 || champ(candidats[0], "status") !== "SUCCESS") throw new Error("StatCan : série IPPI absente");
  const objet = champ(candidats[0], "object");
  if (champ(objet, "responseStatusCode") !== 0 || champ(objet, "productId") !== 18100265) throw new Error("StatCan : réponse invalide");
  const donnees = champ(objet, "vectorDataPoint");
  if (!Array.isArray(donnees)) throw new Error("StatCan : observations absentes");
  const points = new Map<number, MacroPoint>();
  for (const entree of donnees) {
    const periode = champ(entree, "refPer");
    if (typeof periode !== "string" || !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(periode)) continue;
    const time = periodeVersMs(periode.slice(0, 7));
    if (!Number.isFinite(time) || time < depuisMs || champ(entree, "frequencyCode") !== 6) continue;
    const statut = champ(entree, "statusCode");
    if (champ(entree, "securityLevelCode") !== 0 || typeof statut !== "number" || !(statut === 0 || statut in QUALITES)) continue;
    const value = champ(entree, "value");
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
    if (champ(entree, "scalarFactorCode") !== 0) throw new Error("StatCan : échelle IPPI inattendue");
    const symbole = champ(entree, "symbolCode");
    if (symbole !== 0 && symbole !== 1 && symbole !== 3) throw new Error("StatCan : statut statistique inconnu");
    const qualite = [symbole === 1 ? "provisoire" : symbole === 3 ? "révisé" : undefined, QUALITES[statut]].filter(Boolean).join(" ; ");
    const precedent = points.get(time);
    if (precedent && (precedent.value !== value || precedent.qualite !== (qualite || undefined))) throw new Error("StatCan : mois contradictoire");
    points.set(time, { time, value, ...(qualite ? { qualite } : {}) });
  }
  return trierChrono([...points.values()]);
}

/** `depuisMs` inclut déjà les douze mois nécessaires à l'a/a dans le chargeur commun. */
export async function chargerSerieStatcan(vectorId: number, depuisMs: number, signal?: AbortSignal): Promise<MacroSeries> {
  if (vectorId !== VECTEUR_IPPI || !Number.isFinite(depuisMs)) throw new Error("StatCan : demande IPPI invalide");
  const debut = new Date(depuisMs);
  debut.setUTCDate(1);
  const params = new URLSearchParams({ vectorIds: String(vectorId), startRefPeriod: debut.toISOString().slice(0, 10), endReferencePeriod: new Date().toISOString().slice(0, 10) });
  const res = await fetch(`${BASE}?${params}`, { signal });
  if (!res.ok) throw new Error(`StatCan ${res.status} ${res.statusText}`);
  return parseStatcanSeries(await res.json(), vectorId, depuisMs);
}
