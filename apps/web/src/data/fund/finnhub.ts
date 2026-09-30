/**
 * Finnhub — profil société + calendrier de résultats. Appel direct local (CORS confirmé
 * `access-control-allow-origin: *`, vérifié 2026-07-08), proxy sur Vercel. Clé requise.
 *
 * Schémas RÉELS confirmés par curl direct le 2026-07-08 (identiques aux placeholders
 * du plan) : `stock/profile2` → `{ name, finnhubIndustry, marketCapitalization, weburl, ... }` ;
 * `calendar/earnings` → `{ earningsCalendar: [{ symbol, date, epsEstimate, epsActual, ... }] }`.
 */
import { IS_VERCEL } from "../../lib/deployment";
import { ecrireCache, estFrais, lireCache, type CacheEntree } from "../onchain/cache";

const BASE = IS_VERCEL ? "/finnhubapi" : "https://finnhub.io/api/v1";
const TTL_PROFIL_MS = 12 * 60 * 60 * 1000;
const TTL_EARNINGS_MS = 6 * 60 * 60 * 1000;

export interface ProfilFinnhub {
  nom: string;
  secteur: string;
  capitalisation: number | null;
  description: string;
}

/** PURE, défensive. */
export function parseProfilFinnhub(json: unknown): ProfilFinnhub | null {
  if (json === null || typeof json !== "object") return null;
  const obj = json as { name?: unknown; finnhubIndustry?: unknown; marketCapitalization?: unknown; weburl?: unknown };
  if (typeof obj.name !== "string" || obj.name.length === 0) return null;
  const cap = typeof obj.marketCapitalization === "number" ? obj.marketCapitalization : null;
  return {
    nom: obj.name,
    secteur: typeof obj.finnhubIndustry === "string" ? obj.finnhubIndustry : "",
    capitalisation: cap,
    description: typeof obj.weburl === "string" ? obj.weburl : "",
  };
}

/**
 * Résultat d'un chargement Finnhub : distingue l'ÉCHEC (clé invalide, quota 429, réseau)
 * de l'ABSENCE de données. Sans cette distinction, la fenêtre affichait « Profil Finnhub
 * indisponible pour ce ticker » ou « Aucun résultat trimestriel programmé trouvé » — des
 * messages d'absence — pour une cause d'authentification ou de quota.
 */
export type ChargementFinnhub<T> =
  | { ok: true; donnee: T; ts: number; perime: boolean; raison?: string }
  | { ok: false; raison: string; annule?: boolean };

function annulation(): ChargementFinnhub<never> {
  return { ok: false, annule: true, raison: "Chargement annulé." };
}

function repli<T>(cache: CacheEntree<T> | null, raison: string): ChargementFinnhub<T> {
  return cache === null ? { ok: false, raison } : { ok: true, donnee: cache.donnee, ts: cache.ts, perime: true, raison };
}

/** Messages contrôlés : ni réponse amont, ni URL contenant une clé. */
function raisonHttp(statut: number): string {
  if (statut === 401 || statut === 403) return "Finnhub : clé ou accès refusé.";
  if (statut === 429) return "Finnhub : quota atteint.";
  return `Finnhub indisponible (HTTP ${statut}).`;
}

/** Un cache importé ne doit pas figer une date future ni faire planter <time>. */
function cacheDateValide<T>(cache: CacheEntree<T> | null): CacheEntree<T> | null {
  return cache !== null && Number.isFinite(cache.ts) && cache.ts >= 0 && cache.ts <= Date.now()
    ? cache : null;
}

export async function chargerProfilFinnhub(
  ticker: string,
  cle: string | null,
  signal?: AbortSignal,
): Promise<ChargementFinnhub<ProfilFinnhub | null>> {
  const cacheCle = `finnhub:profil:${ticker}`;
  const cache = cacheDateValide(await lireCache<ProfilFinnhub>(cacheCle));
  if (signal?.aborted) return annulation();
  if (estFrais(cache, TTL_PROFIL_MS) && cache !== null) return { ok: true, donnee: cache.donnee, ts: cache.ts, perime: false };

  try {
    const url = `${BASE}/stock/profile2?symbol=${encodeURIComponent(ticker)}${cle ? `&token=${encodeURIComponent(cle)}` : ""}`;
    const res = await fetch(url, { signal });
    if (signal?.aborted) return annulation();
    if (!res.ok) return repli(cache, raisonHttp(res.status));
    const profil = parseProfilFinnhub((await res.json()) as unknown);
    if (signal?.aborted) return annulation();
    if (profil === null && cache !== null) return repli(cache, "Profil non fourni par la dernière réponse Finnhub.");
    const ts = Date.now();
    if (profil !== null) await ecrireCache(cacheCle, profil);
    return { ok: true, donnee: profil, ts, perime: false };
  } catch {
    return signal?.aborted ? annulation() : repli(cache, "Finnhub injoignable ; actualisation impossible.");
  }
}

export interface EarningsEvent {
  ticker: string;
  date: string;
  epsEstime: number | null;
  epsReel: number | null;
}

/** PURE, défensive. */
export function parseEarnings(json: unknown, ticker: string): EarningsEvent[] {
  const cal = (json as { earningsCalendar?: unknown })?.earningsCalendar;
  if (!Array.isArray(cal)) return [];
  const out: EarningsEvent[] = [];
  for (const brut of cal) {
    const it = brut as { date?: unknown; epsEstimate?: unknown; epsActual?: unknown };
    if (typeof it.date !== "string") continue;
    out.push({
      ticker,
      date: it.date,
      epsEstime: typeof it.epsEstimate === "number" ? it.epsEstimate : null,
      epsReel: typeof it.epsActual === "number" ? it.epsActual : null,
    });
  }
  return out;
}

export async function chargerEarnings(
  ticker: string,
  cle: string | null,
  signal?: AbortSignal,
): Promise<ChargementFinnhub<EarningsEvent[]>> {
  const cacheCle = `finnhub:earnings:${ticker}`;
  const cache = cacheDateValide(await lireCache<EarningsEvent[]>(cacheCle));
  if (signal?.aborted) return annulation();
  if (estFrais(cache, TTL_EARNINGS_MS) && cache !== null) return { ok: true, donnee: cache.donnee, ts: cache.ts, perime: false };

  try {
    const dansUnAn = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const url = `${BASE}/calendar/earnings?from=${aujourdhui}&to=${dansUnAn}&symbol=${encodeURIComponent(ticker)}${cle ? `&token=${encodeURIComponent(cle)}` : ""}`;
    const res = await fetch(url, { signal });
    if (signal?.aborted) return annulation();
    if (!res.ok) return repli(cache, raisonHttp(res.status));
    const json: unknown = await res.json();
    if (signal?.aborted) return annulation();
    if (!Array.isArray((json as { earningsCalendar?: unknown } | null)?.earningsCalendar)) {
      return repli(cache, "Calendrier Finnhub invalide.");
    }
    const events = parseEarnings(json, ticker);
    const ts = Date.now();
    await ecrireCache(cacheCle, events);
    return { ok: true, donnee: events, ts, perime: false };
  } catch {
    return signal?.aborted ? annulation() : repli(cache, "Finnhub injoignable ; actualisation impossible.");
  }
}
