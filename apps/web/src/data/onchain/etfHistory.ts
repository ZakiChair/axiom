import { dateOnchain, nombreOnchain } from "./cohorts";
import { ecrireCache, estFrais, lireCache } from "./cache";
import { type ActifEtf, ETF_TTL_MS, RAISON_CLE_SOSOVALUE, sosoUnusableWithoutKey } from "./etf";
import { IS_VERCEL } from "../../lib/deployment";
import { referentiel, type Referentiel } from "../../lib/referentiel";
export interface JourEtf { time: number; fluxUsd: number | null; encoursUsd: number | null }
export interface HistoriqueEtf { points: JourEtf[]; ts: number; perime: boolean; repli?: boolean; raison?: string }
/** GET API actuelle : /openapi/v1/etfs/summary-history, dernier mois, séances publiées. */
export function parseEtfHistory(json: unknown): JourEtf[] {
  if (!json || typeof json !== "object") return [];
  const enveloppe = json as { code?: unknown; data?: unknown };
  if (enveloppe.code !== undefined && enveloppe.code !== 0 && enveloppe.code !== "0") return [];
  const lignes = Array.isArray(json) ? json : enveloppe.data;
  if (!Array.isArray(lignes)) return [];
  const jours = new Map<number, JourEtf>();
  for (const row of lignes.slice(0, 300)) {
    if (!row || typeof row !== "object") continue;
    const time = dateOnchain(row.date);
    if (time === null) continue;
    const actifs = nombreOnchain(row.total_net_assets);
    jours.set(time, { time, fluxUsd: nombreOnchain(row.total_net_inflow), encoursUsd: actifs !== null && actifs >= 0 ? actifs : null });
  }
  return [...jours.values()].sort((a, b) => a.time - b.time);
}
export function resumerEtfHistory(points: readonly JourEtf[]) {
  const cumul = (n: number) => points.length >= n && points.slice(-n).every((p) => p.fluxUsd !== null)
    ? points.slice(-n).reduce((s, p) => s + p.fluxUsd!, 0) : null;
  const dernier = points.at(-1);
  return { cumul5: cumul(5), cumul20: cumul(20), observations: points.length,
    ratioJourPct: dernier?.fluxUsd !== null && dernier?.fluxUsd !== undefined && dernier.encoursUsd && dernier.encoursUsd > 0
      ? dernier.fluxUsd / dernier.encoursUsd * 100 : null };
}

export interface HistoriqueRatiosEtf {
  points: Array<{ time: number; value: number }>;
  referentiel: Referentiel | null;
}

/** Ratios journaliers strictement calculés avec flux et encours publiés sur la même ligne. */
export function historiqueRatiosEtf(points: readonly JourEtf[], now = Date.now()): HistoriqueRatiosEtf {
  const uniques = new Map<number, { time: number; value: number }>();
  for (const point of points) {
    if (!Number.isFinite(point.time) || point.time > now || point.fluxUsd === null || point.encoursUsd === null ||
      !Number.isFinite(point.fluxUsd) || !Number.isFinite(point.encoursUsd) || point.encoursUsd <= 0) continue;
    uniques.set(point.time, { time: point.time, value: point.fluxUsd / point.encoursUsd * 100 });
  }
  const ratios = [...uniques.values()].sort((a, b) => a.time - b.time);
  const dernier = ratios.at(-1);
  return {
    points: ratios,
    referentiel: dernier ? referentiel(ratios.map((p) => ({ t: p.time, v: p.value })), dernier.value, now, {
      minObservations: 20,
      cadenceAttendueMs: undefined,
      ageMaxMs: 5 * 86_400_000,
    }) : null,
  };
}
export async function fetchEtfHistory(actif: ActifEtf, cle: string | null, signal?: AbortSignal): Promise<HistoriqueEtf> {
  if (sosoUnusableWithoutKey(IS_VERCEL, cle)) return { points: [], ts: 0, perime: false, raison: RAISON_CLE_SOSOVALUE };
  const cacheCle = `etf:history-v1:${actif}`;
  const cache = await lireCache<JourEtf[]>(cacheCle);
  const resultat = (points: JourEtf[], ts: number, raison?: string, repli = false): HistoriqueEtf => ({ points, ts, raison, repli,
    perime: Boolean(raison) || Date.now() - (points.at(-1)?.time ?? 0) > 5 * 86_400_000 });
  if (cache && estFrais(cache, ETF_TTL_MS)) return resultat(cache.donnee, cache.ts, undefined, true);
  try {
    const query = new URLSearchParams({ symbol: actif.toUpperCase(), country_code: "US", limit: "300" });
    const response = await fetch(`/sosoapi/openapi/v1/etfs/summary-history?${query}`, {
      headers: cle ? { "x-soso-api-key": cle } : {},
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? RAISON_CLE_SOSOVALUE : `SoSoValue HTTP ${response.status}`);
    const points = parseEtfHistory(await response.json());
    if (!points.length) throw new Error("Historique ETF non fourni pour cet actif ou cet accès.");
    signal?.throwIfAborted();
    await ecrireCache(cacheCle, points);
    return resultat(points, Date.now());
  } catch (e) {
    const raison = e instanceof Error ? e.message : "Historique SoSoValue injoignable";
    return resultat(cache?.donnee ?? [], cache?.ts ?? 0, raison, cache !== null);
  }
}
