/**
 * Funding HORAIRE Hyperliquid — `POST https://api.hyperliquid.xyz/info` avec
 * `{ type: "fundingHistory", coin, startTime }` (appel DIRECT : l'API accepte le CORS,
 * pas de clé requise). Réponse : `[{ coin, fundingRate (chaîne, fraction horaire),
 * premium, time (ms) }]`, au plus ~500 entrées par appel → pagination AVANT
 * (`startTime = dernier time + 1`), bornée à 8 appels.
 *
 * MODULE PARESSEUX : chargé par `import()` depuis `chart/auxProvider.ts` uniquement
 * quand un def consomme la série aux `hlFunding` — rien n'est tiré dans le chunk
 * d'entrée.
 *
 * ⚠️ Unité : `fundingRate` est une FRACTION HORAIRE (ex. 0.0000201 ≈ 0,002 %/h ≈
 * 17,6 % APR). L'annualisation (× 24 × 365 × 100) est faite par les defs
 * (`hlFunding`, `fundingSpreadHl`), pas ici.
 */

/** Point brut prêt pour `alignAux` (instant de RÈGLEMENT horaire = `time` ms). */
export interface PointFundingHl {
  time: number;
  /** Taux de funding de l'heure, en fraction (ex. 0.00002). */
  value: number;
}

/** Taille maximale d'une page `fundingHistory` (mesurée : l'API borne à ~500). */
const PAGE_MAX = 500;
/** Borne de pagination : 8 pages × 500 points ≈ 4 000 h ≈ 5,5 mois — couvre 90 j. */
const PAGES_MAX = 8;

/**
 * Parse la réponse `fundingHistory` : une entrée par heure, `fundingRate` CHAÎNE en
 * fraction horaire, `time` en ms. Entrées non conformes écartées une à une ; tri par
 * time croissant ; doublons de `time` dédupliqués (la pagination repart de
 * `dernier + 1`, un chevauchement resterait sinon possible). PURE.
 */
export function parseFundingHistory(json: unknown): PointFundingHl[] {
  if (!Array.isArray(json)) return [];
  const out: PointFundingHl[] = [];
  const vus = new Set<number>();
  for (const brut of json) {
    if (!brut || typeof brut !== "object") continue;
    const e = brut as Record<string, unknown>;
    const time = typeof e.time === "number" ? e.time : NaN;
    const value = typeof e.fundingRate === "string" ? Number(e.fundingRate) : NaN;
    if (!Number.isFinite(time) || !Number.isFinite(value) || vus.has(time)) continue;
    vus.add(time);
    out.push({ time, value });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

/**
 * Historique du funding horaire d'un coin HL depuis `sinceMs`, paginé en avant
 * (l'API rend la page la plus ANCIENNE ≥ startTime). Échec réseau/HTTP → ce qu'on
 * a déjà (partiel) ou [] — dégradation gracieuse, jamais de throw.
 */
export async function fetchHlFundingHistory(
  coin: string,
  sinceMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<PointFundingHl[]> {
  const out: PointFundingHl[] = [];
  const maintenant = Date.now();
  let start = sinceMs;
  try {
    for (let page = 0; page < PAGES_MAX && start <= maintenant; page++) {
      const res = await fetchImpl("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "fundingHistory", coin, startTime: start }),
      });
      if (!res.ok) break; // partiel OK : on garde les pages déjà lues
      const points = parseFundingHistory(await res.json());
      if (points.length === 0) break;
      out.push(...points);
      const dernier = points[points.length - 1]?.time;
      if (dernier === undefined || dernier >= maintenant || points.length < PAGE_MAX) break;
      start = dernier + 1;
    }
  } catch {
    // Réseau/CORS : on rend les pages déjà collectées (ou []), jamais d'erreur.
  }
  return out;
}
