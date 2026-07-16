/**
 * Historiques publics « à la demande » pour les référentiels (percentiles).
 * Chaque fetcher renvoie PointSerie[] | null (échec → null, jamais bloquant)
 * sous cache module TTL 1 h — les fenêtres consomment, AUCUNE boucle ici.
 */
import type { PointSerie } from "../lib/referentiel";
import { extUrl } from "./extapi";
import { fetchOpenInterestHist, futuresSymbol } from "./binanceFutures";
import { fetchDvolHistory } from "./deribit";
import { fetchFearGreedHistory } from "./marketOverview";
import { liquidationsGet } from "./daemon";

const TTL_MS = 3_600_000;
const H_MS = 3_600_000;
const JOUR_MS = 86_400_000;

const cache = new Map<string, { t: number; data: PointSerie[] }>();

/** Mémoïse les SUCCÈS 1 h ; un échec (null) n'est pas caché (retenté au tick suivant). */
async function memo(
  cle: string,
  loader: () => Promise<PointSerie[] | null>,
): Promise<PointSerie[] | null> {
  const hit = cache.get(cle);
  const now = Date.now();
  if (hit !== undefined && now - hit.t < TTL_MS) return hit.data;
  try {
    const data = await loader();
    if (data === null || data.length === 0) return null;
    cache.set(cle, { t: now, data });
    return data;
  } catch {
    return null;
  }
}

/** Vide le cache (tests). */
export function _viderCacheReferentiels(): void {
  cache.clear();
}

/**
 * Série des variations % sur `fenetreMs` glissants : pour chaque point, variation
 * vs le DERNIER point dont t ≤ t − fenetreMs (référence à 0 ou absente → point omis).
 */
export function deltasFenetre(
  points: readonly PointSerie[],
  fenetreMs: number,
): PointSerie[] {
  const tries = [...points].sort((a, b) => a.t - b.t);
  const out: PointSerie[] = [];
  let j = 0;
  for (let i = 0; i < tries.length; i += 1) {
    const p = tries[i];
    if (p === undefined) continue;
    // Avance la référence : dernier point ≤ p.t − fenetreMs.
    let ref: PointSerie | undefined;
    while (j < tries.length) {
      const cand = tries[j];
      if (cand === undefined || cand.t > p.t - fenetreMs) break;
      ref = cand;
      j += 1;
    }
    // j a pu dépasser : la référence reste valable pour les points suivants.
    if (ref !== undefined) j -= 1;
    if (ref === undefined || ref.v === 0 || !Number.isFinite(ref.v)) continue;
    out.push({ t: p.t, v: (p.v / ref.v - 1) * 100 });
  }
  return out;
}

/** Agrège des événements {t, usd} en buckets d'une heure pleine, heures vides = 0. */
export function bucketsHoraires(
  events: readonly { t: number; usd: number }[],
  now: number,
): PointSerie[] {
  if (events.length === 0) return [];
  let tMin = Number.POSITIVE_INFINITY;
  for (const e of events) if (e.t < tMin) tMin = e.t;
  const debut = Math.floor(tMin / H_MS) * H_MS;
  const fin = Math.floor((now - 1) / H_MS) * H_MS;
  const somme = new Map<number, number>();
  for (const e of events) {
    const b = Math.floor(e.t / H_MS) * H_MS;
    somme.set(b, (somme.get(b) ?? 0) + e.usd);
  }
  const out: PointSerie[] = [];
  for (let b = debut; b <= fin; b += H_MS) out.push({ t: b, v: somme.get(b) ?? 0 });
  return out;
}

/** Funding réglé Binance USDⓈ-M (~90 j à 8 h/règlement), v = fraction. */
export async function histFunding(symbol: string): Promise<PointSerie[] | null> {
  return memo(`funding:${symbol}`, async () => {
    const url = extUrl(
      "fapi.binance.com",
      `fapi/v1/fundingRate?symbol=${encodeURIComponent(futuresSymbol(symbol))}&limit=270`,
    );
    const res = await fetch(url);
    if (!res.ok) return null;
    const brut: unknown = await res.json();
    if (!Array.isArray(brut)) return null;
    const points: PointSerie[] = [];
    for (const item of brut) {
      const o = item as { fundingTime?: unknown; fundingRate?: unknown };
      const t = Number(o.fundingTime);
      const v = Number(o.fundingRate);
      if (Number.isFinite(t) && Number.isFinite(v)) points.push({ t, v });
    }
    points.sort((a, b) => a.t - b.t);
    return points;
  });
}

/** Open Interest notionnel USD 1 h (~20 j), série brute. */
export async function histOiUsd(symbol: string): Promise<PointSerie[] | null> {
  return memo(`oiUsd:${symbol}`, async () => {
    const pts = await fetchOpenInterestHist(symbol, "1h", 500);
    return pts.map((p) => ({ t: p.time, v: p.oiUsd }));
  });
}

/** Variations % d'OI sur `fenetreMs` glissants (défaut 1 h). */
export async function histDeltaOi(
  symbol: string,
  fenetreMs = H_MS,
): Promise<PointSerie[] | null> {
  const brut = await histOiUsd(symbol);
  if (brut === null) return null;
  const deltas = deltasFenetre(brut, fenetreMs);
  return deltas.length > 0 ? deltas : null;
}

/** DVOL Deribit quotidien 90 j (BTC/ETH seulement). */
export async function histDvol(devise: "BTC" | "ETH"): Promise<PointSerie[] | null> {
  return memo(`dvol:${devise}`, async () => {
    const pts = await fetchDvolHistory(devise, 90);
    return pts.map((p) => ({ t: p.time, v: p.value }));
  });
}

/** Fear & Greed Alternative.me, 90 j, v = 0..100. */
export async function histFearGreed(): Promise<PointSerie[] | null> {
  return memo("fearGreed", async () => {
    const pts = await fetchFearGreedHistory(90);
    return pts.map((p) => ({ t: p.time, v: p.value }));
  });
}

/** USD liquidé par heure (daemon 30 j). Null si daemon absent/sans capability. */
export async function histLiqParHeure(symbol: string): Promise<PointSerie[] | null> {
  return memo(`liqHeure:${symbol}`, async () => {
    const now = Date.now();
    const rows = await liquidationsGet(symbol, { depuis: now - 30 * JOUR_MS, limite: 100_000 });
    if (rows === null) return null;
    return bucketsHoraires(rows.map((r) => ({ t: r.t, usd: r.usd })), now);
  });
}
