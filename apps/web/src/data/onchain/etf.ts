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
 * CORS ouvert, mais on route via le proxy /sosoapi (Vite en dev, daemon en prod) pour
 * bénéficier de la clé de REPLI lue dans apps/web/.env (SOSOVALUE_API_KEY) : la clé
 * personnelle des Réglages, si saisie, est envoyée en en-tête et reste PRIORITAIRE
 * (le proxy n'écrase jamais un x-soso-api-key déjà présent). Sans clé nulle part,
 * l'amont répond 401 → raison explicite affichée dans le panneau.
 * Plan Demo/Beta gratuit, 20 req/min : sosovalue.com/developer.
 */
import { healthStore } from "../../store/health";
import { IS_VERCEL } from "../../lib/deployment";
import { ecrireCache, estFrais, lireCache } from "./cache";

export type ActifEtf = "btc" | "eth" | "sol";

const BASE = "/sosoapi/openapi/v2/etf/currentEtfDataMetrics";
export const ETF_TTL_MS = 6 * 60 * 60 * 1000;
/** Identifiant dans le panneau « Santé sources » (même registre que coinmetrics/mempool). */
const SOURCE_SANTE = "sosovalue";
/**
 * Raison renvoyée sur 401/403 — exportée pour que l'UI ne propose le CTA « clé
 * SoSoValue ⚙ » QUE sur un échec effectivement lié à la clé (pas sur un 5xx/réseau).
 */
export const RAISON_CLE_SOSOVALUE =
  "Clé SoSoValue absente ou invalide (Réglages ⚙).";

export function sosoUnusableWithoutKey(isVercel: boolean, cle: string | null): boolean {
  return isVercel && (cle?.trim().length ?? 0) === 0;
}

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

  // Tri par |flux du jour| décroissant : les émetteurs qui bougent le plus (entrées OU
  // sorties) remontent en tête — la dispersion est le signal. Départage par ticker (ordre
  // stable et déterministe sous noUncheckedIndexedAccess, tests reproductibles).
  parEmetteur.sort((a, b) => {
    const diff = Math.abs(b.flux) - Math.abs(a.flux);
    return diff !== 0 ? diff : a.emetteur.localeCompare(b.emetteur);
  });

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
 * La clé des Réglages est envoyée en en-tête si présente. En local, le proxy peut injecter
 * SOSOVALUE_API_KEY ; sur Vercel, l'absence de clé personnelle est rejetée sans appel réseau.
 */
export async function fetchEtfFlows(
  actif: ActifEtf,
  cle: string | null,
  signal?: AbortSignal,
): Promise<EtfResultat> {
  if (sosoUnusableWithoutKey(IS_VERCEL, cle)) {
    return { disponible: false, raison: RAISON_CLE_SOSOVALUE };
  }
  const cacheCle = `etf:${actif}`;
  const cache = await lireCache<EtfResultat>(cacheCle);
  if (estFrais(cache, ETF_TTL_MS) && cache !== null) return cache.donnee;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cle !== null) headers["x-soso-api-key"] = cle;

  let resultat: EtfResultat;
  try {
    const res = await fetch(BASE, {
      method: "POST",
      headers,
      body: JSON.stringify({ type: `us-${actif}-spot` }),
      signal,
    });
    if (res.ok) {
      resultat = parseEtfFlows((await res.json()) as unknown);
    } else if (res.status === 401 || res.status === 403) {
      resultat = { disponible: false, raison: RAISON_CLE_SOSOVALUE };
    } else {
      resultat = { disponible: false, raison: `SoSoValue indisponible (HTTP ${res.status}).` };
    }
  } catch {
    resultat = { disponible: false, raison: "SoSoValue injoignable." };
  }
  // Ne jamais mettre en cache un échec (429/HTTP/réseau) : un rate-limit transitoire
  // ne doit pas geler la donnée à "indisponible" pendant tout le TTL de 6 h.
  if (resultat.disponible) await ecrireCache(cacheCle, resultat);
  return resultat;
}

/**
 * Rapporte la santé « sosovalue » pour UN cycle de chargement (les 3 actifs).
 * Une seule écriture par cycle — les 3 fetch parallèles écrivaient chacun le même id,
 * et l'état final dépendait de l'ordre d'achèvement (dernier écrivain gagne). Règle :
 * au moins un actif disponible → « polling » ; tous en échec → erreur (1re raison).
 */
export function rapporterSanteEtf(resultats: readonly EtfResultat[]): void {
  if (resultats.length === 0) return;
  const disponible = resultats.some((r) => r.disponible);
  if (disponible) {
    healthStore.getState().setEtat(SOURCE_SANTE, "polling", { dernierMessageTs: Date.now() });
  } else {
    healthStore.getState().marquerErreur(SOURCE_SANTE, resultats[0]?.raison ?? "échec");
  }
}
