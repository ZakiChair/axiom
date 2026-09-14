/**
 * Open interest des perpétuels DEX — DefiLlama `/overview/open-interest`, catégorie
 * « Derivatives » (Hyperliquid, Aster, Lighter, edgeX…), tous actifs confondus.
 *
 * La courbe totale de DefiLlama mélange les marchés prédictifs, les dérivés de taux et les
 * interfaces : on demande donc la VENTILATION par protocole et on ne somme que les
 * protocoles dont `category === "Derivatives"` (clé inconnue de `protocols` : exclue).
 * Le filtre `&category=` est ignoré côté serveur (sondé le 2026-09-14).
 *
 * Niveau, Δ7j, Δ30j, part d'Hyperliquid et record sont calculés sur la série COMPLÈTE
 * (depuis 2021), puis seulement la série est tronquée pour l'affichage. Appel direct
 * (CORS ouvert, comme l'activité DEX) ; cache du résultat DÉRIVÉ (≈ 5 Ko, jamais le
 * JSON brut de ≈ 0,9 Mo), 1 h ; en échec, cache périmé resservi.
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
const CLE_CACHE = "dex:oi-perps";
const POINTS_SERIE = 120;
const JOUR_MS = 86_400_000;

export interface OiPerpsDex {
  /** USD, dernier point de la catégorie Derivatives. */
  niveau: number;
  /** ms, 00:00 UTC du dernier point (jour en cours, actualisé en continu). */
  observation: number;
  /** En %, signe conservé ; null si le point de base manque. */
  delta7jPct: number | null;
  delta30jPct: number | null;
  /** En % ; null si Hyperliquid Perps est absent du dernier point ou hors catégorie. */
  partHyperliquidPct: number | null;
  /** Maximum historique de la catégorie (premier en cas d'égalité). */
  record: { valeur: number; time: number };
  /** 120 derniers points, time en ms. */
  serie: PointEconomie[];
}

/** Variation (%) du dernier point contre le point daté exactement `jours` plus tôt. PURE. */
export function variationPct(serie: readonly PointEconomie[], jours: number): number | null {
  const dernier = serie.at(-1);
  if (dernier === undefined) return null;
  const cible = dernier.time - jours * JOUR_MS;
  const base = serie.find((p) => p.time === cible);
  if (base === undefined || !(base.value > 0)) return null;
  return (dernier.value / base.value - 1) * 100;
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

  const lignes: Array<PointEconomie & { hyperliquid: number | null }> = [];
  for (const ligne of ventilation) {
    if (!Array.isArray(ligne)) continue;
    const [ts, valeurs] = ligne as [unknown, unknown];
    if (typeof ts !== "number" || !Number.isFinite(ts) || typeof valeurs !== "object" || valeurs === null) continue;
    let somme = 0;
    let comptes = 0;
    for (const [nom, v] of Object.entries(valeurs)) {
      if (perps.has(nom) && typeof v === "number" && Number.isFinite(v)) {
        somme += v;
        comptes++;
      }
    }
    // Jour sans aucune valeur Derivatives : absent, jamais compté à zéro.
    if (comptes === 0) continue;
    const hl = (valeurs as Record<string, unknown>)[NOM_HYPERLIQUID];
    lignes.push({
      time: ts * 1000,
      value: somme,
      hyperliquid: perps.has(NOM_HYPERLIQUID) && typeof hl === "number" && Number.isFinite(hl) ? hl : null,
    });
  }
  lignes.sort((a, b) => a.time - b.time);
  const dernier = lignes.at(-1);
  if (dernier === undefined || dernier.value <= 0) return null;

  // Série COMPLÈTE : record et variations d'abord, troncature d'affichage ensuite.
  const complete: PointEconomie[] = lignes.map(({ time, value }) => ({ time, value }));
  let record = complete[0]!;
  for (const p of complete) if (p.value > record.value) record = p;
  return {
    niveau: dernier.value,
    observation: dernier.time,
    delta7jPct: variationPct(complete, 7),
    delta30jPct: variationPct(complete, 30),
    partHyperliquidPct: dernier.hyperliquid === null ? null : (dernier.hyperliquid / dernier.value) * 100,
    record: { valeur: record.value, time: record.time },
    serie: complete.slice(-POINTS_SERIE),
  };
}

export async function fetchOiPerpsDex(signal?: AbortSignal): Promise<ResultatFrais<OiPerpsDex> | null> {
  const cache = await lireCache<OiPerpsDex>(CLE_CACHE);
  if (estFrais(cache, OI_DEX_TTL_MS) && cache !== null) {
    return { donnee: cache.donnee, ts: cache.ts, perime: false };
  }
  try {
    const res = await fetch(URL_OI_DEX, { signal });
    if (!res.ok) throw new Error(`DefiLlama open-interest ${res.status}`);
    const donnee = parseOiPerpsDex((await res.json()) as unknown);
    if (donnee === null) throw new Error("DefiLlama open-interest inexploitable");
    await ecrireCache(CLE_CACHE, donnee);
    return { donnee, ts: Date.now(), perime: false };
  } catch {
    if (cache !== null) return { donnee: cache.donnee, ts: cache.ts, perime: true };
    return null;
  }
}
