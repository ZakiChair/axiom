/**
 * Thermocap multiple — capitalisation BTC ÷ « thermocap » (émission cumulée valorisée au
 * prix du jour : IssTotUSD Coin Metrics community, subvention de bloc HORS frais).
 *
 * Repère de cycle : la capitalisation rapportée au capital que les mineurs ont réellement
 * encaissé pour sécuriser le réseau. L'historique Coin Metrics débute le 2010-07-18 ;
 * l'émission antérieure (2009 – mi-2010, prix quasi nul) est négligée en USD.
 *
 * Calcul PUR (`calculerThermocap`, testé) + fetch DÉDIÉ (cache 24 h, clé
 * `cm:thermocap:full`, série dérivée seule en cache), indépendant du fetch CHAIN à 200 jours
 * et de l'historique de prix de CYCLE.
 */
import { latestPointByUtcDay, utcDay } from "./blockchainNvt";
import { ecrireCache, estFrais, lireCache } from "./cache";
import {
  chargerLignesCoinMetrics,
  parseCoinMetrics,
  type PointMetrique,
  type SerieMetrique,
} from "./coinmetrics";
import type { ResultatFrais } from "./mempool";
import { healthStore } from "../../store/health";

/** TTL du cache : 24 h (un point par jour). */
export const CM_TTL_THERMOCAP_MS = 24 * 60 * 60 * 1000;
const METRIQUES = ["IssTotUSD", "CapMrktCurUSD"] as const;

/** Capitalisation ÷ émission cumulée, par jour UTC. PURE. */
export function calculerThermocap(
  issUsd: readonly PointMetrique[],
  capUsd: readonly PointMetrique[],
): SerieMetrique {
  const issParJour = latestPointByUtcDay(issUsd);
  const capParJour = latestPointByUtcDay(capUsd);
  const jours = [...new Set([...issParJour.keys(), ...capParJour.keys()])].sort((a, b) => a - b);
  let cumul = 0;
  const points: PointMetrique[] = [];
  for (const jour of jours) {
    const iss = issParJour.get(jour);
    if (iss !== undefined && Number.isFinite(iss.value)) cumul += iss.value;
    const cap = capParJour.get(jour);
    if (cap === undefined || cumul <= 0) continue;
    const value = cap.value / cumul;
    if (Number.isFinite(value)) points.push({ time: utcDay(jour), value });
  }
  return { points, dernier: points.length > 0 ? points[points.length - 1] : undefined };
}

/** Série complète du thermocap multiple (cache 24 h, dégradation gracieuse). */
export async function fetchThermocap(
  signal?: AbortSignal,
): Promise<ResultatFrais<SerieMetrique> | null> {
  const cle = "cm:thermocap:full";
  const cache = await lireCache<SerieMetrique>(cle);
  if (estFrais(cache, CM_TTL_THERMOCAP_MS) && cache !== null) {
    return { donnee: cache.donnee, ts: cache.ts, perime: false };
  }
  try {
    const lignes = await chargerLignesCoinMetrics(METRIQUES, signal);
    const series = parseCoinMetrics({ data: lignes }, "btc", METRIQUES);
    const serie = calculerThermocap(
      series["IssTotUSD"]?.points ?? [],
      series["CapMrktCurUSD"]?.points ?? [],
    );
    if (serie.points.length === 0) throw new Error("Coin Metrics thermocap vide");
    await ecrireCache(cle, serie);
    return { donnee: serie, ts: Date.now(), perime: false };
  } catch (e) {
    if (signal?.aborted) return cache ? { donnee: cache.donnee, ts: cache.ts, perime: true } : null;
    healthStore.getState().marquerErreur("coinmetrics", e instanceof Error ? e.message : "échec");
    if (cache !== null) return { donnee: cache.donnee, ts: cache.ts, perime: true };
    return null;
  }
}
