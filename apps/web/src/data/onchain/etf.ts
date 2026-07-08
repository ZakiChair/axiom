/**
 * Flux ETF spot BTC/ETH/SOL — SoSoValue (openapi.sosovalue.com).
 *
 * Remplace l'ancien module DefiLlama (mort : tous les endpoints `/overview/etfs`
 * renvoient 404/500, vérifié 2026-07-02). SoSoValue couvre BTC + ETH + SOL avec un
 * seul provider (ETF spot Solana actifs depuis approbation SEC 10/2025).
 *
 * ⚠️ Endpoint RÉEL confirmé par curl direct le 2026-07-08 (la doc gitbook n'a pas pu
 * être lue automatiquement) :
 *   POST https://openapi.sosovalue.com/openapi/v2/etf/currentEtfDataMetrics
 *   Headers : x-soso-api-key: <clé>, Content-Type: application/json
 *   Body    : { "type": "us-btc-spot" | "us-eth-spot" | "us-sol-spot" }
 *   → GET sur ce chemin renvoie 405 Method Not Allowed ; POST obligatoire.
 *   Réponse : { code, msg, traceId, data: { dailyNetInflow:{value,lastUpdateDate,status},
 *     …, list: [ { ticker, institute, dailyNetInflow:{value,lastUpdateDate,status}, … } ] } }
 *   (`historicalInflowChart` existe aussi — historique multi-jours — mais
 *   `currentEtfDataMetrics` suffit pour le flux du jour par émetteur voulu ici.)
 * CORS confirmé ouvert (OPTIONS renvoie `access-control-allow-origin` + POST autorisé
 * avec `x-soso-api-key`/`content-type`) → appel DIRECT, pas de proxy.
 * Clé OBLIGATOIRE (plan Demo/Beta gratuit, 20 req/min, sosovalue.com/developer).
 */
import { ecrireCache, estFrais, lireCache } from "./cache";

export type ActifEtf = "btc" | "eth" | "sol";

const BASE = "https://openapi.sosovalue.com/openapi/v2/etf/currentEtfDataMetrics";
export const ETF_TTL_MS = 6 * 60 * 60 * 1000;

export interface FluxEmetteur {
  emetteur: string;
  flux: number;
}

export interface EtfResultat {
  disponible: boolean;
  raison?: string;
  jour?: string;
  parEmetteur?: FluxEmetteur[];
  total?: number;
}

/** Lit un champ `{ value }` SoSoValue (chaîne décimale) en nombre fini, sinon `undefined`. */
function lireValeur(champ: unknown): number | undefined {
  if (champ === null || typeof champ !== "object") return undefined;
  const v = (champ as { value?: unknown }).value;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Parse une réponse SoSoValue `currentEtfDataMetrics` en flux par émetteur. PURE, défensive. */
export function parseEtfFlows(json: unknown): EtfResultat {
  const indisponible: EtfResultat = { disponible: false, raison: "Réponse SoSoValue non reconnue." };
  if (json === null || typeof json !== "object") return indisponible;

  const data = (json as { data?: unknown }).data;
  if (data === null || typeof data !== "object") return indisponible;
  const { list, dailyNetInflow } = data as { list?: unknown; dailyNetInflow?: unknown };
  if (!Array.isArray(list) || list.length === 0) return indisponible;

  const parEmetteur: FluxEmetteur[] = [];
  for (const brut of list) {
    const it = brut as { ticker?: unknown; dailyNetInflow?: unknown };
    const emetteur = typeof it.ticker === "string" ? it.ticker : undefined;
    const flux = lireValeur(it.dailyNetInflow);
    if (emetteur === undefined || flux === undefined) continue;
    parEmetteur.push({ emetteur, flux });
  }
  if (parEmetteur.length === 0) return indisponible;

  const jourGlobal =
    dailyNetInflow !== null && typeof dailyNetInflow === "object"
      ? (dailyNetInflow as { lastUpdateDate?: unknown }).lastUpdateDate
      : undefined;

  return {
    disponible: true,
    jour: typeof jourGlobal === "string" ? jourGlobal : undefined,
    parEmetteur,
    total: parEmetteur.reduce((s, e) => s + e.flux, 0),
  };
}

/**
 * Récupère les flux ETF pour un actif, avec cache 6 h et dégradation gracieuse.
 * Renvoie `disponible:false` immédiatement (sans appel réseau) si aucune clé n'est
 * configurée — la clé est OBLIGATOIRE chez SoSoValue, contrairement à BGeometrics.
 */
export async function fetchEtfFlows(
  actif: ActifEtf,
  cle: string | null,
  signal?: AbortSignal,
): Promise<EtfResultat> {
  if (cle === null) {
    return { disponible: false, raison: "Clé SoSoValue non configurée (Réglages)." };
  }

  const cacheCle = `etf:${actif}`;
  const cache = await lireCache<EtfResultat>(cacheCle);
  if (estFrais(cache, ETF_TTL_MS) && cache !== null) return cache.donnee;

  let resultat: EtfResultat;
  try {
    const res = await fetch(BASE, {
      method: "POST",
      headers: { "x-soso-api-key": cle, "Content-Type": "application/json" },
      body: JSON.stringify({ type: `us-${actif}-spot` }),
      signal,
    });
    resultat = res.ok
      ? parseEtfFlows((await res.json()) as unknown)
      : { disponible: false, raison: `SoSoValue indisponible (HTTP ${res.status}).` };
  } catch {
    resultat = { disponible: false, raison: "SoSoValue injoignable." };
  }
  await ecrireCache(cacheCle, resultat);
  return resultat;
}
