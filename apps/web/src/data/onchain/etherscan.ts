/**
 * Etherscan v2 (API multichain) — réseau ETH : supply totale, nombre de nœuds, gas
 * recommandé. Appel DIRECT (CORS confirmé `*`, vérifié 2026-07-08). Clé requise.
 * ⚠️ Scope volontairement modeste : les métriques "adresses actives/jour" et "tx/jour"
 * historiques équivalentes à Coin Metrics BTC sont réservées au tier Pro d'Etherscan —
 * PAS disponibles gratuitement (cf. spec Lot E1 §5). Le gas recommandé est le pendant
 * direct du widget "Frais recommandés" déjà affiché côté BTC (mempool.space).
 */
import { ecrireCache, estFrais, lireCache } from "./cache";

const BASE = "https://api.etherscan.io/v2/api?chainid=1";
const TTL_MS = 10 * 60 * 1000; // gas change vite, mais pas de temps réel non plus

export function parseEthSupply(json: unknown): number | null {
  const obj = json as { status?: unknown; result?: unknown };
  if (obj.status !== "1" || typeof obj.result !== "string") return null;
  const wei = Number(obj.result);
  return Number.isFinite(wei) ? wei / 1e18 : null;
}

export function parseGasOracle(json: unknown): { safe: number; propose: number; fast: number } | null {
  const obj = json as { status?: unknown; result?: unknown };
  if (obj.status !== "1" || obj.result === null || typeof obj.result !== "object") return null;
  const r = obj.result as { SafeGasPrice?: unknown; ProposeGasPrice?: unknown; FastGasPrice?: unknown };
  const safe = Number(r.SafeGasPrice);
  const propose = Number(r.ProposeGasPrice);
  const fast = Number(r.FastGasPrice);
  if (![safe, propose, fast].every(Number.isFinite)) return null;
  return { safe, propose, fast };
}

export function parseNodeCount(json: unknown): number | null {
  const obj = json as { status?: unknown; result?: unknown };
  if (obj.status !== "1" || obj.result === null || typeof obj.result !== "object") return null;
  const n = Number((obj.result as { TotalNodeCount?: unknown }).TotalNodeCount);
  return Number.isFinite(n) ? n : null;
}

export interface ReseauEth {
  supplyEth: number | null;
  nodeCount: number | null;
  gasSafe: number | null;
  gasPropose: number | null;
  gasFast: number | null;
}

export async function fetchReseauEth(cle: string | null, signal?: AbortSignal): Promise<ReseauEth | null> {
  if (cle === null) return null;
  const cacheCle = "eth:reseau";
  const cache = await lireCache<ReseauEth>(cacheCle);
  if (estFrais(cache, TTL_MS) && cache !== null) return cache.donnee;

  try {
    const q = (params: string) => `${BASE}&${params}&apikey=${encodeURIComponent(cle)}`;
    const [supplyRes, gasRes, nodeRes] = await Promise.all([
      fetch(q("module=stats&action=ethsupply"), { signal }),
      fetch(q("module=gastracker&action=gasoracle"), { signal }),
      fetch(q("module=stats&action=nodecount"), { signal }),
    ]);
    const [supplyJson, gasJson, nodeJson] = await Promise.all([supplyRes.json(), gasRes.json(), nodeRes.json()]);
    const gas = parseGasOracle(gasJson);
    const resultat: ReseauEth = {
      supplyEth: parseEthSupply(supplyJson),
      nodeCount: parseNodeCount(nodeJson),
      gasSafe: gas?.safe ?? null,
      gasPropose: gas?.propose ?? null,
      gasFast: gas?.fast ?? null,
    };
    await ecrireCache(cacheCle, resultat);
    return resultat;
  } catch {
    return cache?.donnee ?? null;
  }
}
