/**
 * Open interest des perpétuels DEX — DefiLlama `/overview/open-interest`, catégorie
 * « Derivatives » (Hyperliquid, Aster, Lighter, edgeX…), tous actifs confondus.
 *
 * La courbe totale de DefiLlama mélange les marchés prédictifs, les dérivés de taux et les
 * interfaces : on demande donc la VENTILATION par protocole et on ne somme que les
 * protocoles dont `category === "Derivatives"` (clé inconnue de `protocols` : exclue).
 * Le filtre `&category=` est ignoré côté serveur (sondé le 2026-09-14).
 *
 * Niveau, part d'Hyperliquid et record : périmètre courant de chaque jour, sur la série
 * COMPLÈTE (depuis 2021), puis seulement la série est tronquée pour l'affichage. Δ7j et
 * Δ30j à PÉRIMÈTRE CONSTANT : seuls les protocoles présents aux deux dates, avec la part du
 * total courant ainsi exclue (protocoles apparus, ex. edgeX V2 le 2026-08-16). Appel direct
 * (CORS ouvert, comme l'activité DEX) ; cache du résultat DÉRIVÉ (≈ 5 Ko, jamais le
 * JSON brut de ≈ 0,9 Mo), 1 h ; en échec, cache périmé resservi. Observation de plus de
 * 2 jours : périmée, même quand la source répond 200.
 */
import { ecrireCache, estFrais, lireCache } from "./cache";
import type { PointEconomie } from "./economieChaines";
import type { ResultatFrais } from "./mempool";

/** TTL du cache : 1 h (agrégat quotidien actualisé en continu). */
export const OI_DEX_TTL_MS = 60 * 60 * 1000;
/** Ventilation par protocole conservée ; courbe totale (toutes catégories) exclue. */
export const URL_OI_DEX = "https://api.llama.fi/overview/open-interest?excludeTotalDataChart=true";
export const CATEGORIE_PERPS = "Derivatives";
export const NOM_HYPERLIQUID = "Hyperliquid Perps";
/** v2 : Δ à périmètre constant et parts exclues (forme incompatible avec la v1). */
const CLE_CACHE = "dex:oi-perps:v2";
const POINTS_SERIE = 120;
const JOUR_MS = 86_400_000;
/** Au-delà, l'observation la plus récente est périmée. */
export const OI_DEX_OBSERVATION_MAX_MS = 2 * JOUR_MS;

export interface OiPerpsDex {
  /** USD, dernier point de la catégorie Derivatives. */
  niveau: number;
  /**
   * ms, 00:00 UTC du dernier point de la série : jour UTC en cours (actualisé en continu) ou
   * jour antérieur (point du jour absent ou sans valeur Derivatives) ; périmé au-delà de 2 jours
   * (`observationPerimee`).
   */
  observation: number;
  /** En %, signe conservé, à périmètre constant ; null si le point de base manque. */
  delta7jPct: number | null;
  delta30jPct: number | null;
  /** En %, part du niveau exclue du Δ (protocoles sans valeur à la base) ; null avec le Δ. */
  exclu7jPct: number | null;
  exclu30jPct: number | null;
  /** En % ; null si Hyperliquid Perps est absent du dernier point ou hors catégorie. */
  partHyperliquidPct: number | null;
  /** Maximum historique de la catégorie (premier en cas d'égalité). */
  record: { valeur: number; time: number };
  /** 120 derniers points, time en ms. */
  serie: PointEconomie[];
}

type Valeurs = Readonly<Record<string, number>>;

/**
 * Variation (%) à périmètre constant : seuls les protocoles ayant une valeur aux deux dates.
 * `excluPct` = part du total courant hors de ce périmètre. Entrées : valeurs finies des
 * protocoles Derivatives, total courant > 0. PURE.
 */
export function variationPerimetreConstant(
  courant: Valeurs,
  base: Valeurs | undefined,
): { pct: number; excluPct: number } | null {
  if (base === undefined) return null;
  let total = 0;
  let communCourant = 0;
  let communBase = 0;
  for (const [nom, v] of Object.entries(courant)) {
    total += v;
    const b = base[nom];
    if (b !== undefined) {
      communCourant += v;
      communBase += b;
    }
  }
  if (!(communBase > 0)) return null;
  return { pct: (communCourant / communBase - 1) * 100, excluPct: ((total - communCourant) / total) * 100 };
}

/** Observation de plus de 2 jours à l'instant `maintenant` (ms). PURE. */
export function observationPerimee(observation: number, maintenant: number): boolean {
  return maintenant - observation > OI_DEX_OBSERVATION_MAX_MS;
}

/** Parse la réponse avec ventilation (`protocols` + `totalDataChartBreakdown`). PURE. */
export function parseOiPerpsDex(json: unknown): OiPerpsDex | null {
  const o = (json ?? {}) as Record<string, unknown>;
  const protocoles = o["protocols"];
  const ventilation = o["totalDataChartBreakdown"];
  if (!Array.isArray(protocoles) || !Array.isArray(ventilation)) return null;

  const perps = new Set<string>();
  for (const p of protocoles) {
    const { name, category } = (p ?? {}) as { name?: unknown; category?: unknown };
    if (typeof name === "string" && category === CATEGORIE_PERPS) perps.add(name);
  }

  const lignes: Array<PointEconomie & { valeurs: Record<string, number> }> = [];
  for (const ligne of ventilation) {
    if (!Array.isArray(ligne)) continue;
    const [ts, brutes] = ligne as [unknown, unknown];
    if (typeof ts !== "number" || !Number.isFinite(ts) || typeof brutes !== "object" || brutes === null) continue;
    const valeurs: Record<string, number> = {};
    let somme = 0;
    let comptes = 0;
    for (const [nom, v] of Object.entries(brutes)) {
      if (perps.has(nom) && typeof v === "number" && Number.isFinite(v)) {
        valeurs[nom] = v;
        somme += v;
        comptes++;
      }
    }
    // Jour sans aucune valeur Derivatives : absent, jamais compté à zéro.
    if (comptes === 0) continue;
    lignes.push({ time: ts * 1000, value: somme, valeurs });
  }
  lignes.sort((a, b) => a.time - b.time);
  const dernier = lignes.at(-1);
  if (dernier === undefined || dernier.value <= 0) return null;

  // Série COMPLÈTE : record et variations d'abord, troncature d'affichage ensuite.
  const parTemps = new Map(lignes.map((l) => [l.time, l.valeurs]));
  const variation = (jours: number) =>
    variationPerimetreConstant(dernier.valeurs, parTemps.get(dernier.time - jours * JOUR_MS));
  const v7 = variation(7);
  const v30 = variation(30);
  const complete: PointEconomie[] = lignes.map(({ time, value }) => ({ time, value }));
  let record = complete[0]!;
  for (const p of complete) if (p.value > record.value) record = p;
  const hl = dernier.valeurs[NOM_HYPERLIQUID];
  return {
    niveau: dernier.value,
    observation: dernier.time,
    delta7jPct: v7?.pct ?? null,
    delta30jPct: v30?.pct ?? null,
    exclu7jPct: v7?.excluPct ?? null,
    exclu30jPct: v30?.excluPct ?? null,
    partHyperliquidPct: hl === undefined ? null : (hl / dernier.value) * 100,
    record: { valeur: record.value, time: record.time },
    serie: complete.slice(-POINTS_SERIE),
  };
}

export async function fetchOiPerpsDex(signal?: AbortSignal): Promise<ResultatFrais<OiPerpsDex> | null> {
  const cache = await lireCache<OiPerpsDex>(CLE_CACHE);
  if (estFrais(cache, OI_DEX_TTL_MS) && cache !== null) {
    return { donnee: cache.donnee, ts: cache.ts, perime: observationPerimee(cache.donnee.observation, Date.now()) };
  }
  try {
    const res = await fetch(URL_OI_DEX, { signal });
    if (!res.ok) throw new Error(`DefiLlama open-interest ${res.status}`);
    const donnee = parseOiPerpsDex((await res.json()) as unknown);
    if (donnee === null) throw new Error("DefiLlama open-interest inexploitable");
    await ecrireCache(CLE_CACHE, donnee);
    return { donnee, ts: Date.now(), perime: observationPerimee(donnee.observation, Date.now()) };
  } catch {
    if (cache !== null) return { donnee: cache.donnee, ts: cache.ts, perime: true };
    return null;
  }
}
