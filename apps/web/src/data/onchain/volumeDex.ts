/**
 * Activité DEX — volume DEX 24 h (DefiLlama overview, tous protocoles) rapporté au volume
 * total 24 h du marché crypto (CoinGecko global, CEX + DEX) : part de l'activité qui passe
 * on-chain, lue comme indicateur de régime.
 *
 * Aucun historique du total sans clé → la part est une valeur COURANTE ; la série 90 j ne
 * concerne que le volume DEX. Les deux hôtes répondent en CORS ouvert (appels directs,
 * comme l'économie des chaînes et le réseau Solana). Cache 1 h (clé `dex:activite`),
 * dégradation gracieuse ; CoinGecko en échec laisse le total null (part non calculée),
 * DefiLlama en échec ressert le cache périmé.
 */
import { ecrireCache, estFrais, lireCache } from "./cache";
import { parseSerieDefiLlama, type PointEconomie } from "./economieChaines";
import type { ResultatFrais } from "./mempool";

/** TTL du cache : 1 h (agrégat quotidien, actualisé en continu par DefiLlama). */
export const DEX_TTL_MS = 60 * 60 * 1000;
/** Sans ventilation par protocole : la réponse reste lourde (liste des protocoles) mais lisible. */
const URL_DEX = "https://api.llama.fi/overview/dexs?excludeTotalDataChartBreakdown=true";
const URL_GLOBAL = "https://api.coingecko.com/api/v3/global";
const POINTS_SERIE = 90;

export interface OverviewDex {
  dex24h: number | null;
  dex7d: number | null;
  change7dPct: number | null;
  /** Volume DEX quotidien, 90 derniers jours. */
  serie: PointEconomie[];
}

export interface ActiviteDex extends OverviewDex {
  /** Volume total 24 h CEX + DEX (CoinGecko), null si indisponible. */
  totalVolume24h: number | null;
}

function nombre(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Part du volume DEX dans le volume total (%). PURE. */
export function calculerPartDex(dex24h: number | null, total24h: number | null): number | null {
  if (dex24h === null || total24h === null || !Number.isFinite(dex24h) || total24h <= 0) return null;
  return (dex24h / total24h) * 100;
}

/** Parse `/overview/dexs` (totaux + `totalDataChart` [[s, usd], …]). PURE. */
export function parseOverviewDex(json: unknown): OverviewDex {
  const o = (json ?? {}) as Record<string, unknown>;
  return {
    dex24h: nombre(o["total24h"]),
    dex7d: nombre(o["total7d"]),
    change7dPct: nombre(o["change_7d"]),
    serie: parseSerieDefiLlama(o["totalDataChart"]).slice(-POINTS_SERIE),
  };
}

export async function fetchActiviteDex(signal?: AbortSignal): Promise<ResultatFrais<ActiviteDex> | null> {
  const cle = "dex:activite";
  const cache = await lireCache<ActiviteDex>(cle);
  if (estFrais(cache, DEX_TTL_MS) && cache !== null) {
    return { donnee: cache.donnee, ts: cache.ts, perime: false };
  }
  try {
    const [overview, totalVolume24h] = await Promise.all([
      fetch(URL_DEX, { signal }).then(async (res) => {
        if (!res.ok) throw new Error(`DefiLlama dexs ${res.status}`);
        return parseOverviewDex((await res.json()) as unknown);
      }),
      fetch(URL_GLOBAL, { signal })
        .then(async (res) => {
          if (!res.ok) return null;
          const j = (await res.json()) as { data?: { total_volume?: { usd?: unknown } } };
          return nombre(j?.data?.total_volume?.usd);
        })
        .catch(() => null),
    ]);
    if (overview.dex24h === null) throw new Error("DefiLlama dexs sans total24h");
    const donnee: ActiviteDex = { ...overview, totalVolume24h };
    await ecrireCache(cle, donnee);
    return { donnee, ts: Date.now(), perime: false };
  } catch {
    if (cache !== null) return { donnee: cache.donnee, ts: cache.ts, perime: true };
    return null;
  }
}
