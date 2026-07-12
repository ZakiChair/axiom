/**
 * Front Ukraine ISW/CTP — couche ArcGIS FeatureServer publique découverte via la
 * story map officielle (reverse-engineering, cf. docs/research/08 §4) : source
 * NON CONTRACTUELLE, même classe de risque que l'endpoint CBOE GEX — toujours
 * dégradable, jamais bloquante. CORS `*` vérifié → appel DIRECT navigateur,
 * pattern PortWatch (PAS d'entrée whitelist /extapi). Les deux paramètres de
 * simplification sont OBLIGATOIRES : sans eux la réponse fait 2 Mo / 57 000
 * sommets ; avec, 11,6 Ko / ~650 sommets (mesuré le 2026-07-12) — invisible à
 * l'échelle d'un globe. Cache 6 h (mémo module + localStorage/KV), dégradation
 * vers le périmé puis null.
 */
import { ecrireCache, estFrais, lireCache, type CacheEntree } from "../onchain/cache";
import type { FrontUkraine } from "./types";

export const ISW_TTL_MS = 6 * 60 * 60 * 1000;
const CLE_CACHE = "globe:isw-front";
const URL_ISW =
  "https://services5.arcgis.com/SaBe5HMtmnbqSWlu/arcgis/rest/services/VIEW_RussiaCoTinUkraine_V3/FeatureServer/49/query" +
  "?where=1%3D1&outFields=EditDate&f=geojson&geometryPrecision=3&maxAllowableOffset=0.01";

let memo: CacheEntree<FrontUkraine> | null = null;

/** Parse défensif d'une FeatureCollection ArcGIS ; null si vide ou inattendue. */
export function parseFrontIsw(json: unknown): FrontUkraine | null {
  if (typeof json !== "object" || json === null) return null;
  const r = json as Record<string, unknown>;
  if (r.type !== "FeatureCollection" || !Array.isArray(r.features) || r.features.length === 0) return null;
  let majMs: number | null = null;
  for (const brut of r.features) {
    if (typeof brut !== "object" || brut === null) continue;
    const props = (brut as Record<string, unknown>).properties;
    if (typeof props !== "object" || props === null) continue;
    const editDate = (props as Record<string, unknown>).EditDate;
    if (typeof editDate === "number" && Number.isFinite(editDate)) majMs = Math.max(majMs ?? 0, editDate);
  }
  return { collection: json, majMs, n: r.features.length };
}

/**
 * Garde une lecture de cache : lireCache ne valide que l'ENVELOPPE {donnee, ts},
 * pas la forme de `donnee` — un enregistrement corrompu (donnee null, collection
 * absente…) ne doit produire aucun TypeError. Renvoie la donnée validée ou null.
 */
export function frontDepuisCache(cache: CacheEntree<FrontUkraine> | null): FrontUkraine | null {
  if (typeof cache?.donnee !== "object" || cache.donnee === null) return null;
  if (parseFrontIsw((cache.donnee as { collection?: unknown }).collection) === null) return null;
  return cache.donnee;
}

/** Charge le front (cache 6 h → périmé → null). Jamais d'exception. */
export async function chargerFrontIsw(signal?: AbortSignal): Promise<FrontUkraine | null> {
  if (memo !== null && estFrais(memo, ISW_TTL_MS)) return memo.donnee;
  const cache = await lireCache<FrontUkraine>(CLE_CACHE);
  if (cache !== null && estFrais(cache, ISW_TTL_MS)) {
    const front = frontDepuisCache(cache);
    if (front !== null) {
      memo = cache;
      return front;
    }
  }
  try {
    const res = await fetch(URL_ISW, { signal });
    if (!res.ok) throw new Error(`ISW HTTP ${res.status}`);
    const front = parseFrontIsw((await res.json()) as unknown);
    if (front === null) throw new Error("ISW : réponse vide/inattendue");
    await ecrireCache(CLE_CACHE, front);
    memo = { donnee: front, ts: Date.now() };
    return front;
  } catch {
    return frontDepuisCache(cache); // périmé accepté ; null si cache absent/corrompu
  }
}
