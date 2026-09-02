/**
 * Finnhub — profil société + calendrier de résultats. Appel DIRECT (CORS confirmé
 * `access-control-allow-origin: *`, vérifié 2026-07-08). Clé requise (60 req/min gratuit).
 *
 * Schémas RÉELS confirmés par curl direct le 2026-07-08 (identiques aux placeholders
 * du plan) : `stock/profile2` → `{ name, finnhubIndustry, marketCapitalization, weburl, ... }` ;
 * `calendar/earnings` → `{ earningsCalendar: [{ symbol, date, epsEstimate, epsActual, ... }] }`.
 */
import { ecrireCache, estFrais, lireCache } from "../onchain/cache";

const BASE = "https://finnhub.io/api/v1";
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
export type ChargementFinnhub<T> = { ok: true; donnee: T } | { ok: false };

export async function chargerProfilFinnhub(
  ticker: string,
  cle: string,
  signal?: AbortSignal,
): Promise<ChargementFinnhub<ProfilFinnhub | null>> {
  const cacheCle = `finnhub:profil:${ticker}`;
  const cache = await lireCache<ProfilFinnhub>(cacheCle);
  if (estFrais(cache, TTL_PROFIL_MS) && cache !== null) return { ok: true, donnee: cache.donnee };

  try {
    const url = `${BASE}/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(cle)}`;
    const res = await fetch(url, { signal });
    // Un cache périmé reste préférable à une erreur : dégradation, pas panne.
    if (!res.ok) return cache === null ? { ok: false } : { ok: true, donnee: cache.donnee };
    const profil = parseProfilFinnhub((await res.json()) as unknown);
    if (profil !== null) await ecrireCache(cacheCle, profil);
    return { ok: true, donnee: profil ?? cache?.donnee ?? null };
  } catch {
    return cache === null ? { ok: false } : { ok: true, donnee: cache.donnee };
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
  cle: string,
  signal?: AbortSignal,
): Promise<ChargementFinnhub<EarningsEvent[]>> {
  const cacheCle = `finnhub:earnings:${ticker}`;
  const cache = await lireCache<EarningsEvent[]>(cacheCle);
  if (estFrais(cache, TTL_EARNINGS_MS) && cache !== null) return { ok: true, donnee: cache.donnee };

  try {
    const dansUnAn = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const url = `${BASE}/calendar/earnings?from=${aujourdhui}&to=${dansUnAn}&symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(cle)}`;
    const res = await fetch(url, { signal });
    // Cache périmé servi de préférence à une erreur (cf. chargerProfilFinnhub).
    if (!res.ok) return cache === null ? { ok: false } : { ok: true, donnee: cache.donnee };
    const events = parseEarnings((await res.json()) as unknown, ticker);
    await ecrireCache(cacheCle, events);
    return { ok: true, donnee: events };
  } catch {
    return cache === null ? { ok: false } : { ok: true, donnee: cache.donnee };
  }
}
