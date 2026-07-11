/**
 * IMF PortWatch — chokepoints maritimes (28 détroits/canaux stratégiques).
 *
 * API ArcGIS REST publique (Esri FeatureServer, sans clé, `access:"public"`) :
 *   hôte `services9.arcgis.com` — CORS `access-control-allow-origin: *` VÉRIFIÉ en
 *   direct le 2026-07-10 → appels DIRECTS depuis le navigateur (aucun proxy, aucune
 *   entrée whitelist /extapi, fonctionne sans daemon — même pattern que mempool.space).
 *
 * Deux couches croisées (cf. docs/research/07-trafic-maritime-petroliers-live.md §5) :
 *   1. PortWatch_chokepoints_database — RÉFÉRENCE statique : portid, portname, lat, lon.
 *   2. Daily_Chokepoints_Data — série JOURNALIÈRE : date (« YYYY-MM-DD »), n_tanker,
 *      n_cargo, n_total par chokepoint. MAJ HEBDOMADAIRE (mardi 9h ET), dernier point
 *      à ~J-5 → ce n'est PAS du live, l'UI doit l'afficher comme un indice hebdo daté.
 *
 * Stratégie « dernier point » : top-N trié `date DESC` (280 lignes = 28 chokepoints ×
 * 10 jours, vérifié en direct : couvre les 28 portids) puis déduplication côté client
 * en gardant la date max par portid — évite de deviner la date de dernière publication.
 *
 * Cache 6 h : mémo module + localStorage/KV via data/onchain/cache.ts (pattern données
 * lentes réutilisé tel quel — clé préfixée « globe: », pas de collision de namespace).
 * Dégradation gracieuse : échec réseau → cache périmé si présent, sinon [].
 */
import { ecrireCache, estFrais, lireCache, type CacheEntree } from "../onchain/cache";
import type { Chokepoint } from "./types";

const BASE =
  "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services";

/** TTL du cache chokepoints : 6 h (la source est hebdomadaire). */
export const PW_TTL_MS = 6 * 60 * 60 * 1000;
/** Clé de cache (localStorage/KV, préfixe géré par onchain/cache.ts). */
const CLE_CACHE = "globe:chokepoints";
/** Top-N journalier : 28 chokepoints × 10 jours (≥1 point par portid, vérifié en direct). */
const N_LIGNES_JOURNALIER = 280;

/** Noms FRANÇAIS des grands détroits (clé = portname PortWatch) ; les autres gardent le nom source. */
const NOMS_FR: Record<string, string> = {
  "Strait of Hormuz": "Détroit d'Ormuz",
  "Suez Canal": "Canal de Suez",
  "Malacca Strait": "Détroit de Malacca",
  "Panama Canal": "Canal de Panama",
  "Bab el-Mandeb Strait": "Bab-el-Mandeb",
  "Bosporus Strait": "Bosphore",
  "Gibraltar Strait": "Détroit de Gibraltar",
};

/** URL de la requête ArcGIS `query` (réponse JSON `{ features: [{ attributes } ] }`). */
function urlQuery(couche: string, params: Record<string, string>): string {
  const query = new URLSearchParams({ f: "json", returnGeometry: "false", ...params });
  return `${BASE}/${couche}/FeatureServer/0/query?${query.toString()}`;
}

/** Coerce en nombre fini, sinon null. */
function nombreOuNull(x: unknown): number | null {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}

/** Extrait les `attributes` d'une réponse ArcGIS query, ou [] si la forme est inattendue. */
function attributsArcgis(json: unknown): Record<string, unknown>[] {
  const feats = (json as { features?: unknown } | null)?.features;
  if (!Array.isArray(feats)) return [];
  const sorties: Record<string, unknown>[] = [];
  for (const f of feats) {
    const attrs = (f as { attributes?: unknown } | null)?.attributes;
    if (typeof attrs === "object" && attrs !== null) sorties.push(attrs as Record<string, unknown>);
  }
  return sorties;
}

/**
 * Normalise le champ `date` ArcGIS en ISO « YYYY-MM-DD » : la couche renvoie une
 * CHAÎNE (type esriFieldTypeDateOnly, vérifié en direct), mais on tolère un epoch ms
 * (anciens types date Esri). Renvoie null si inexploitable.
 */
function dateIso(x: unknown): string | null {
  if (typeof x === "string" && x.length >= 10) return x.slice(0, 10);
  if (typeof x === "number" && Number.isFinite(x)) {
    const d = new Date(x);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Croise la référence (portid/portname/lat/lon) et le journalier (dernier point par
 * portid = date ISO max, comparaison lexicale valide sur « YYYY-MM-DD »). Fonction PURE.
 * Un chokepoint sans point journalier est conservé (compteurs/date à null) ; une ligne
 * de référence sans portid/lat/lon exploitables est ignorée.
 */
export function parseChokepoints(refJson: unknown, dailyJson: unknown): Chokepoint[] {
  // 1) Dernier point journalier par portid.
  interface Dernier {
    date: string;
    nNavires: number | null;
    nTankers: number | null;
    nCargos: number | null;
  }
  const derniers = new Map<string, Dernier>();
  for (const a of attributsArcgis(dailyJson)) {
    const portid = a["portid"];
    const date = dateIso(a["date"]);
    if (typeof portid !== "string" || portid.length === 0 || date === null) continue;
    const connu = derniers.get(portid);
    if (connu !== undefined && connu.date >= date) continue;
    derniers.set(portid, {
      date,
      nNavires: nombreOuNull(a["n_total"]),
      nTankers: nombreOuNull(a["n_tanker"]),
      nCargos: nombreOuNull(a["n_cargo"]),
    });
  }

  // 2) Référence → contrat Chokepoint (nom français si grand détroit connu).
  const sorties: Chokepoint[] = [];
  for (const a of attributsArcgis(refJson)) {
    const portid = a["portid"];
    const lat = nombreOuNull(a["lat"]);
    const lon = nombreOuNull(a["lon"]);
    if (typeof portid !== "string" || portid.length === 0 || lat === null || lon === null) continue;
    const portname = typeof a["portname"] === "string" ? (a["portname"] as string) : portid;
    const dernier = derniers.get(portid);
    sorties.push({
      id: portid,
      nom: NOMS_FR[portname] ?? portname,
      lat,
      lon,
      nNavires: dernier?.nNavires ?? null,
      nTankers: dernier?.nTankers ?? null,
      nCargos: dernier?.nCargos ?? null,
      date: dernier?.date ?? null,
    });
  }
  return sorties;
}

/** Mémo module (évite localStorage/réseau à chaque appel dans la même session). */
let memo: CacheEntree<Chokepoint[]> | null = null;

/**
 * Charge les 28 chokepoints avec leur dernier point hebdomadaire (2 requêtes ArcGIS
 * en parallèle, cache 6 h). Dégradation gracieuse : cache périmé si présent, sinon [].
 */
export async function chargerChokepoints(signal?: AbortSignal): Promise<Chokepoint[]> {
  if (estFrais(memo, PW_TTL_MS) && memo !== null) return memo.donnee;
  const cache = await lireCache<Chokepoint[]>(CLE_CACHE);
  if (estFrais(cache, PW_TTL_MS) && cache !== null && Array.isArray(cache.donnee)) {
    memo = cache;
    return cache.donnee;
  }

  try {
    const [resRef, resDaily] = await Promise.all([
      fetch(
        urlQuery("PortWatch_chokepoints_database", {
          where: "1=1",
          outFields: "portid,portname,lat,lon",
        }),
        { signal },
      ),
      fetch(
        urlQuery("Daily_Chokepoints_Data", {
          where: "1=1",
          outFields: "date,portid,n_tanker,n_cargo,n_total",
          orderByFields: "date DESC",
          resultRecordCount: String(N_LIGNES_JOURNALIER),
        }),
        { signal },
      ),
    ]);
    if (!resRef.ok || !resDaily.ok) throw new Error("PortWatch HTTP");
    const chokepoints = parseChokepoints(
      (await resRef.json()) as unknown,
      (await resDaily.json()) as unknown,
    );
    if (chokepoints.length === 0) throw new Error("PortWatch : réponse vide/inattendue");
    await ecrireCache(CLE_CACHE, chokepoints);
    memo = { donnee: chokepoints, ts: Date.now() };
    return chokepoints;
  } catch {
    // Dégradation gracieuse : mieux vaut un indice hebdo périmé que rien du tout.
    if (cache !== null && Array.isArray(cache.donnee)) return cache.donnee;
    return [];
  }
}
