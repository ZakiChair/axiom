/**
 * mempool.space — état du RÉSEAU Bitcoin (frais, hauteur de bloc, halving) + hashrate 1 an.
 *
 * Tout mempool.space est CORS `*` → appels DIRECTS (aucun proxy, fonctionne sans daemon).
 *   GET /api/v1/fees/recommended     → { fastestFee, halfHourFee, hourFee, economyFee, minimumFee } (sat/vB)
 *   GET /api/blocks/tip/height       → hauteur courante (nombre brut)
 *   GET /api/v1/mining/hashrate/1y   → { hashrates:[{ timestamp(s), avgHashrate }], … }
 *
 * Le compte à rebours du HALVING est CALCULÉ depuis la hauteur (fonction pure `computeHalving`) :
 * pas d'endpoint dédié. On préfère mempool.space à blockchain.info pour le hashrate car
 * l'hôte whitelisté `blockchain.info` renvoie une 302 (seul `api.blockchain.info`, NON
 * whitelisté, sert le JSON) — mempool.space fournit la même série, CORS ouvert, en direct.
 */
import { ecrireCache, estFrais, lireCache } from "./cache";
import { healthStore } from "../../store/health";
import type { PointMetrique, SerieMetrique } from "./coinmetrics";

const BASE = "https://mempool.space/api";
const SOURCE_SANTE = "mempool";
/** TTL réseau (frais/hauteur) : 5 min (change ~1 bloc / 10 min). */
export const MP_TTL_RESEAU_MS = 5 * 60 * 1000;
/** TTL hashrate : 6 h (série daily). */
export const MP_TTL_HASHRATE_MS = 6 * 60 * 60 * 1000;

/** Constantes du protocole Bitcoin (halving tous les 210 000 blocs). */
const BLOCS_PAR_HALVING = 210_000;
const RECOMPENSE_INITIALE = 50;
/** Cadence cible d'un bloc (ms) — pour l'estimation temporelle du halving. */
const MS_PAR_BLOC = 600_000;

/** Frais recommandés (sat/vB). */
export interface FraisRecommandes {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
}

/** Résultat du calcul de halving. */
export interface Halving {
  /** Hauteur du prochain halving (multiple de 210 000). */
  prochainBloc: number;
  /** Blocs restants avant le prochain halving. */
  blocsRestants: number;
  /** Numéro du prochain halving (1 = 210k, 5 = 1,05M…). */
  index: number;
  /** Récompense de bloc APRÈS ce halving (BTC). */
  recompenseApres: number;
  /** Estimation du temps restant (ms, à ~10 min/bloc). */
  msEstimes: number;
}

/** État réseau agrégé. */
export interface MempoolReseau {
  fees: FraisRecommandes;
  hauteur: number;
  halving: Halving;
}

/** Enveloppe de résultat (avec fraîcheur). */
export interface ResultatFrais<T> {
  donnee: T;
  ts: number;
  perime: boolean;
}

/**
 * Calcule le prochain halving à partir de la hauteur courante. Fonction PURE.
 * Ex. hauteur 956 287 → prochain bloc 1 050 000, halving n°5, récompense 1.5625 BTC.
 */
export function computeHalving(hauteur: number): Halving {
  const prochainBloc = (Math.floor(hauteur / BLOCS_PAR_HALVING) + 1) * BLOCS_PAR_HALVING;
  const blocsRestants = prochainBloc - hauteur;
  const index = prochainBloc / BLOCS_PAR_HALVING;
  const recompenseApres = RECOMPENSE_INITIALE / Math.pow(2, index);
  return { prochainBloc, blocsRestants, index, recompenseApres, msEstimes: blocsRestants * MS_PAR_BLOC };
}

/** Coerce en nombre fini, ou NaN (le rendu affichera « — »). */
function nombre(x: unknown): number {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : NaN;
}

/** Parse la réponse /fees/recommended. PURE. */
export function parseFrais(json: unknown): FraisRecommandes {
  const o = (json ?? {}) as Record<string, unknown>;
  return {
    fastestFee: nombre(o["fastestFee"]),
    halfHourFee: nombre(o["halfHourFee"]),
    hourFee: nombre(o["hourFee"]),
    economyFee: nombre(o["economyFee"]),
    minimumFee: nombre(o["minimumFee"]),
  };
}

/** Parse la série hashrate /mining/hashrate/1y (timestamps en SECONDES). PURE. */
export function parseHashrate(json: unknown): SerieMetrique {
  const points: PointMetrique[] = [];
  const arr = (json as { hashrates?: unknown })?.hashrates;
  if (Array.isArray(arr)) {
    for (const brut of arr) {
      const row = brut as { timestamp?: unknown; avgHashrate?: unknown };
      const time = nombre(row.timestamp) * 1000;
      const value = nombre(row.avgHashrate);
      if (!Number.isFinite(time) || !Number.isFinite(value)) continue;
      points.push({ time, value });
    }
  }
  points.sort((a, b) => a.time - b.time);
  return { points, dernier: points.length > 0 ? points[points.length - 1] : undefined };
}

/**
 * Récupère l'état réseau (frais + hauteur + halving), cache 5 min, dégradation gracieuse.
 */
export async function fetchMempoolReseau(
  signal?: AbortSignal,
): Promise<ResultatFrais<MempoolReseau> | null> {
  const cle = "mp:reseau";
  const cache = await lireCache<MempoolReseau>(cle);
  if (estFrais(cache, MP_TTL_RESEAU_MS) && cache !== null) {
    return { donnee: cache.donnee, ts: cache.ts, perime: false };
  }

  try {
    const [resFrais, resHauteur] = await Promise.all([
      fetch(`${BASE}/v1/fees/recommended`, { signal }),
      fetch(`${BASE}/blocks/tip/height`, { signal }),
    ]);
    if (!resFrais.ok || !resHauteur.ok) throw new Error("mempool réseau HTTP");
    const fees = parseFrais((await resFrais.json()) as unknown);
    const hauteur = nombre(await resHauteur.text());
    if (!Number.isFinite(hauteur)) throw new Error("hauteur invalide");
    const donnee: MempoolReseau = { fees, hauteur, halving: computeHalving(hauteur) };
    await ecrireCache(cle, donnee);
    healthStore.getState().setEtat(SOURCE_SANTE, "polling", { dernierMessageTs: Date.now() });
    return { donnee, ts: Date.now(), perime: false };
  } catch (e) {
    if (signal?.aborted) return cache ? { donnee: cache.donnee, ts: cache.ts, perime: true } : null;
    healthStore.getState().marquerErreur(SOURCE_SANTE, e instanceof Error ? e.message : "échec");
    if (cache !== null) return { donnee: cache.donnee, ts: cache.ts, perime: true };
    return null;
  }
}

/** Récupère la série hashrate 1 an (cache 6 h, dégradation gracieuse). */
export async function fetchHashrate(
  signal?: AbortSignal,
): Promise<ResultatFrais<SerieMetrique> | null> {
  const cle = "mp:hashrate";
  const cache = await lireCache<SerieMetrique>(cle);
  if (estFrais(cache, MP_TTL_HASHRATE_MS) && cache !== null) {
    return { donnee: cache.donnee, ts: cache.ts, perime: false };
  }
  try {
    const res = await fetch(`${BASE}/v1/mining/hashrate/1y`, { signal });
    if (!res.ok) throw new Error(`mempool hashrate ${res.status}`);
    const serie = parseHashrate((await res.json()) as unknown);
    await ecrireCache(cle, serie);
    return { donnee: serie, ts: Date.now(), perime: false };
  } catch {
    if (cache !== null) return { donnee: cache.donnee, ts: cache.ts, perime: true };
    return null;
  }
}
