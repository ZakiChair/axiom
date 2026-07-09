/**
 * Réseau SOL — époque, TPS, inflation, validateurs (RPC public) + supply (CoinGecko).
 * Appels DIRECTS sans clé : un POST batch JSON-RPC de 4 méthodes + un GET CoinGecko.
 *
 * ⚠️ Historique : la spec Lot E1 avait ÉCARTÉ cette source (403 sur `api.mainnet-beta.
 * solana.com` et `rpc.ankr.com/solana`, testés 2026-07-08 depuis un sandbox datacenter).
 * Re-vérifié 2026-07-09 depuis le réseau résidentiel, EN NAVIGATEUR RÉEL :
 * - `solana-rpc.publicnode.com` (Allnodes) : 200 avec en-tête `Origin`, CORS `*` →
 *   SEUL endpoint RPC viable en navigateur, donc PRIMAIRE. Le batch des 4 méthodes
 *   retenues répond en < 0,2 s (y compris getVoteAccounts et ses ~310 Ko).
 * - `api.mainnet-beta.solana.com` : 200 en curl nu, mais 403 dès que la requête porte
 *   un `Origin` (le preflight CORS passe, le POST est rejeté) → inutilisable en
 *   navigateur ; gardé en dernier recours pour les contextes sans Origin (tests, daemon).
 * - `getSupply` : ÉCARTÉ — throttlé côté PublicNode (mesuré 2026-07-09 : 9 s à 60 s+,
 *   jusqu'au timeout, alors que les 4 autres méthodes répondent en < 0,2 s). La supply
 *   circulante vient de CoinGecko `/coins/markets` (keyless, CORS ouvert — déjà appelé
 *   en direct ailleurs dans l'app —, ~0,2 s, valeur IDENTIQUE au `getSupply` on-chain).
 * - Ankr et dRPC : morts sans clé payante (403 / « not available on freetier »).
 *
 * Précision : les montants en lamports (1 SOL = 1e9) dépassent 2^53 — JSON.parse les
 * arrondit en double (ULP ≈ 128 lamports sur ~5.8e17), soit < 1e-6 SOL d'erreur :
 * négligeable pour de l'affichage agrégé.
 */
import { ecrireCache, estFrais, lireCache } from "./cache";
import type { ResultatFrais } from "./mempool";

/** Primaire = PublicNode (seul RPC qui accepte l'Origin navigateur, cf. en-tête) ;
 * le RPC officiel reste en dernier recours pour les contextes sans Origin. */
const ENDPOINTS = ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com"];
const TTL_MS = 10 * 60 * 1000; // même cadence que le réseau ETH (TPS/époque bougent vite)

const LAMPORTS_PAR_SOL = 1e9;

/** Supply circulante SOL (cf. en-tête : `getSupply` RPC écarté car throttlé). */
const URL_SUPPLY_COINGECKO = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=solana";

/** Batch envoyé tel quel — les ids servent à réassocier les réponses (ordre non garanti). */
const REQUETES_BATCH = [
  { jsonrpc: "2.0", id: 1, method: "getEpochInfo" },
  { jsonrpc: "2.0", id: 2, method: "getRecentPerformanceSamples", params: [10] },
  { jsonrpc: "2.0", id: 3, method: "getInflationRate" },
  { jsonrpc: "2.0", id: 4, method: "getVoteAccounts", params: [{ keepUnstakedDelinquents: false }] },
] as const;

/** Réassocie chaque réponse d'un batch JSON-RPC à son id (map vide si erreur globale). */
export function indexerBatch(json: unknown): Map<number, unknown> {
  const map = new Map<number, unknown>();
  if (!Array.isArray(json)) return map;
  for (const rep of json) {
    const id = (rep as { id?: unknown } | null)?.id;
    if (typeof id === "number") map.set(id, rep);
  }
  return map;
}

/** Extrait `result` d'une réponse JSON-RPC unitaire (null si `error` ou forme inconnue). */
function resultatDe(json: unknown): unknown {
  const obj = json as { result?: unknown; error?: unknown } | null;
  if (obj === null || typeof obj !== "object" || obj.error !== undefined) return null;
  return obj.result ?? null;
}

export function parseEpochInfo(json: unknown): { epoque: number; progression: number } | null {
  const r = resultatDe(json) as { epoch?: unknown; slotIndex?: unknown; slotsInEpoch?: unknown } | null;
  if (r === null) return null;
  const epoque = Number(r.epoch);
  const slotIndex = Number(r.slotIndex);
  const slotsInEpoch = Number(r.slotsInEpoch);
  if (![epoque, slotIndex, slotsInEpoch].every(Number.isFinite) || slotsInEpoch <= 0) return null;
  return { epoque, progression: slotIndex / slotsInEpoch };
}

export function parsePerfSamples(json: unknown): { tps: number; tpsHorsVotes: number } | null {
  const r = resultatDe(json);
  if (!Array.isArray(r)) return null;
  let tx = 0;
  let txHorsVotes = 0;
  let secondes = 0;
  for (const ech of r) {
    const e = ech as { numTransactions?: unknown; numNonVoteTransactions?: unknown; samplePeriodSecs?: unknown };
    const n = Number(e.numTransactions);
    const nv = Number(e.numNonVoteTransactions);
    const s = Number(e.samplePeriodSecs);
    if (![n, nv, s].every(Number.isFinite)) continue; // échantillon malformé : on l'ignore
    tx += n;
    txHorsVotes += nv;
    secondes += s;
  }
  if (secondes <= 0) return null;
  return { tps: tx / secondes, tpsHorsVotes: txHorsVotes / secondes };
}

/** Supply circulante depuis CoinGecko `/coins/markets` (tableau d'un seul élément).
 * Check de type strict : CoinGecko émet `null` sur les trous de données (Number(null)
 * vaudrait 0 — même précaution que parseEthSupply côté Etherscan). */
export function parseSupplyCoinGecko(json: unknown): number | null {
  if (!Array.isArray(json) || json.length === 0) return null;
  const brut = (json[0] as { circulating_supply?: unknown }).circulating_supply;
  return typeof brut === "number" && Number.isFinite(brut) ? brut : null;
}

export function parseInflation(json: unknown): number | null {
  const r = resultatDe(json) as { total?: unknown } | null;
  const taux = Number(r?.total);
  return Number.isFinite(taux) ? taux : null;
}

export function parseVoteAccounts(
  json: unknown,
): { actifs: number; delinquants: number; stakeSol: number } | null {
  const r = resultatDe(json) as { current?: unknown; delinquent?: unknown } | null;
  if (r === null || !Array.isArray(r.current) || !Array.isArray(r.delinquent)) return null;
  let lamports = 0;
  for (const v of r.current) {
    const s = Number((v as { activatedStake?: unknown }).activatedStake);
    if (Number.isFinite(s)) lamports += s;
  }
  return { actifs: r.current.length, delinquants: r.delinquent.length, stakeSol: lamports / LAMPORTS_PAR_SOL };
}

export interface ReseauSol {
  epoque: number | null;
  progressionEpoque: number | null; // 0..1
  tps: number | null;
  tpsHorsVotes: number | null; // le chiffre honnête (les votes gonflent le TPS total)
  supplySol: number | null; // SOL circulants
  inflation: number | null; // taux annuel total (ex. 0.0375)
  validateursActifs: number | null;
  validateursDelinquants: number | null;
  stakeSol: number | null; // stake actif (validateurs courants uniquement)
}

/**
 * Fusionne un résultat frais avec l'ancien cache : chaque champ null (source en échec
 * sur CE passage) est comblé par la dernière valeur connue. PURE. Sans elle, un demi-
 * échec (ex. CoinGecko 429 mais RPC OK) écraserait l'entrée de cache complète par des
 * trous figés toute la TTL — les deux sources étant indépendantes, le cas est courant.
 */
export function fusionnerAvecCache(frais: ReseauSol, ancien: ReseauSol | undefined): ReseauSol {
  if (ancien === undefined) return frais;
  const fusion = { ...frais };
  for (const k of Object.keys(fusion) as Array<keyof ReseauSol>) {
    if (fusion[k] === null) fusion[k] = ancien[k];
  }
  return fusion;
}

export async function fetchReseauSol(signal?: AbortSignal): Promise<ResultatFrais<ReseauSol> | null> {
  const cacheCle = "sol:reseau";
  const cache = await lireCache<ReseauSol>(cacheCle);
  if (estFrais(cache, TTL_MS) && cache !== null) {
    return { donnee: cache.donnee, ts: cache.ts, perime: false };
  }

  try {
    // Deux sources indépendantes en parallèle : l'échec de l'une ne prive pas de l'autre.
    const [json, supplyJson] = await Promise.all([
      fetchBatchRpc(signal),
      fetch(URL_SUPPLY_COINGECKO, { signal })
        .then((res) => (res.ok ? (res.json() as Promise<unknown>) : null))
        .catch((e) => {
          if (signal?.aborted) throw e;
          return null;
        }),
    ]);

    const parId = indexerBatch(json);
    const epoch = parseEpochInfo(parId.get(1));
    const debit = parsePerfSamples(parId.get(2));
    const validateurs = parseVoteAccounts(parId.get(4));
    const resultat: ReseauSol = {
      epoque: epoch?.epoque ?? null,
      progressionEpoque: epoch?.progression ?? null,
      tps: debit?.tps ?? null,
      tpsHorsVotes: debit?.tpsHorsVotes ?? null,
      supplySol: parseSupplyCoinGecko(supplyJson),
      inflation: parseInflation(parId.get(3)),
      validateursActifs: validateurs?.actifs ?? null,
      validateursDelinquants: validateurs?.delinquants ?? null,
      stakeSol: validateurs?.stakeSol ?? null,
    };
    // Même règle que le réseau ETH : ne pas mettre en cache un résultat entièrement
    // dégradé (toutes les sources en échec), autant resservir le cache périmé étiqueté.
    const toutNul = Object.values(resultat).every((v) => v === null);
    if (toutNul) return cache !== null ? { donnee: cache.donnee, ts: cache.ts, perime: true } : null;
    // Demi-échec : les trous sont comblés par la dernière valeur connue (champ à champ)
    // avant écriture — l'entrée de cache reste donc toujours la plus complète possible.
    const fusionne = fusionnerAvecCache(resultat, cache?.donnee);
    await ecrireCache(cacheCle, fusionne);
    return { donnee: fusionne, ts: Date.now(), perime: false };
  } catch {
    return cache !== null ? { donnee: cache.donnee, ts: cache.ts, perime: true } : null;
  }
}

/** POST du batch RPC sur le primaire, puis repli (cf. ENDPOINTS) ; null si tout échoue. */
async function fetchBatchRpc(signal?: AbortSignal): Promise<unknown> {
  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(REQUETES_BATCH),
        signal,
      });
      if (!res.ok) continue; // rate-limit ou indispo → repli sur l'endpoint suivant
      return (await res.json()) as unknown;
    } catch (e) {
      if (signal?.aborted) throw e; // l'abandon utilisateur n'est pas un échec d'endpoint
    }
  }
  return null;
}
