/**
 * Etherscan v2 (API multichain) — réseau ETH : supply totale, nombre de nœuds, gas
 * recommandé. Routé via le proxy /ethscanapi (Vite en dev, daemon en prod) : la clé
 * personnelle des Réglages, si saisie, part en query param `apikey` et reste PRIORITAIRE ;
 * sinon le proxy injecte la clé de repli ETHERSCAN_API_KEY du .env. Sans clé nulle part,
 * l'API répond quand même en mode dégradé (rate-limit 1 req/5 s → widgets partiels).
 * ⚠️ Scope volontairement modeste : les métriques "adresses actives/jour" et "tx/jour"
 * historiques équivalentes à Coin Metrics BTC sont réservées au tier Pro d'Etherscan —
 * PAS disponibles gratuitement (cf. spec Lot E1 §5). Le gas recommandé est le pendant
 * direct du widget "Frais recommandés" déjà affiché côté BTC (mempool.space).
 */
import { healthStore } from "../../store/health";
import { ecrireCache, estFrais, lireCache } from "./cache";

const BASE = "/ethscanapi/v2/api?chainid=1";
const TTL_MS = 10 * 60 * 1000; // gas change vite, mais pas de temps réel non plus
/** Identifiant dans le panneau « Santé sources » (même registre que coinmetrics/mempool). */
const SOURCE_SANTE = "etherscan";

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
  // Clé de cache distincte avec/sans clé API : un résultat PARTIEL obtenu sans clé
  // (mode dégradé 1 req/5 s) ne doit pas court-circuiter pendant 10 min le premier
  // fetch qui suit la saisie d'une clé dans les Réglages.
  const cacheCle = cle !== null ? "eth:reseau" : "eth:reseau:sanscle";
  const cache = await lireCache<ReseauEth>(cacheCle);
  if (estFrais(cache, TTL_MS) && cache !== null) return cache.donnee;

  try {
    // Clé des Réglages en query si présente (prioritaire) ; sinon le proxy injecte
    // la clé de repli .env via appendApiKeyIfAbsent (jamais d'écrasement).
    const q = (params: string) =>
      cle !== null
        ? `${BASE}&${params}&apikey=${encodeURIComponent(cle)}`
        : `${BASE}&${params}`;
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
    // Résultat entièrement dégradé (ex. clé .env invalide → HTTP 200 + status "0" sur
    // les trois appels) : ni cache ni objet tout-null — on renvoie `null` (cache périmé
    // en repli) pour que l'UI affiche le bloc « indisponible » + le CTA clé, au lieu
    // d'une grille de « — » étiquetés live sans issue.
    const toutNul = resultat.supplyEth === null && resultat.nodeCount === null && resultat.gasSafe === null;
    if (toutNul) {
      healthStore
        .getState()
        .marquerErreur(SOURCE_SANTE, "réponse dégradée (clé absente/invalide ou rate-limit)");
      return cache?.donnee ?? null;
    }
    healthStore.getState().setEtat(SOURCE_SANTE, "polling", { dernierMessageTs: Date.now() });
    await ecrireCache(cacheCle, resultat);
    return resultat;
  } catch (e) {
    if (!signal?.aborted) {
      healthStore
        .getState()
        .marquerErreur(SOURCE_SANTE, e instanceof Error ? e.message : "échec");
    }
    return cache?.donnee ?? null;
  }
}
