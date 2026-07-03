/**
 * Helper front du proxy générique /extapi (Phase 3).
 *
 * Beaucoup d'APIs de la Phase 3 (RSS news, calendriers éco, on-chain, Deribit,
 * Binance fapi/dapi…) n'ont PAS d'en-tête CORS : un appel direct depuis le
 * navigateur est bloqué. On les route en SAME-ORIGIN via un proxy générique
 * `/extapi/<hote>/<chemin…>` → `https://<hote>/<chemin…>` :
 *   - en DEV  : le proxy de Vite (vite.config.ts) réécrit (une entrée par hôte) ;
 *   - en PROD : le daemon `axiomd` réécrit ET met en cache (TTL 120 s / 30 s dérivés).
 * Une URL RELATIVE suffit dans les deux cas (même origine que le front) — comme
 * les proxys /fredapi… existants. Le front reste donc fonctionnel SANS daemon en dev.
 *
 * ⚠️ WHITELIST DUPLIQUÉE dans 3 fichiers (synchronisation MANUELLE) :
 *   1. apps/daemon/src/proxy.ts       (EXTAPI_WHITELIST — frontière d'autorité 403)
 *   2. apps/web/vite.config.ts        (proxy de DEV, une entrée par hôte)
 *   3. apps/web/src/data/extapi.ts    (ici — helper front + constante documentée)
 * Toute modification ici DOIT être répercutée dans les deux autres.
 *
 * Un hôte hors whitelist renvoie 403 côté daemon (et n'a pas d'entrée côté Vite).
 */

/** Hôtes autorisés par le proxy /extapi (voir commentaire croisé ci-dessus). */
export const EXTAPI_WHITELIST: readonly string[] = [
  "nfs.faireconomy.media", // ForexFactory JSON (calendrier éco)
  "www.coindesk.com", // RSS news
  "cointelegraph.com", // RSS news
  "www.theblock.co", // RSS news
  "decrypt.co", // RSS news
  "blockworks.co", // RSS news
  "api.alternative.me", // Fear & Greed Index
  "community-api.coinmetrics.io", // Coin Metrics Community (on-chain)
  "bitcoin-data.com", // BGeometrics (MVRV-Z, SOPR, NUPL)
  "api.llama.fi", // DefiLlama (ETF flows, TVL, fees)
  "mempool.space", // mempool / frais on-chain
  "blockchain.info", // stats on-chain
  "www.deribit.com", // options / term structure (public, sans clé)
  "dapi.binance.com", // Binance COIN-M (term structure)
  "fapi.binance.com", // Binance USD-M (dérivés : funding, top trader L/S)
  "api.coingecko.com", // CoinGecko (treemap, catégories)
  "api.fiscaldata.treasury.gov", // US Treasury Fiscal Data (rendements souverains US)
  "data-api.ecb.europa.eu", // ECB SDMX (courbe zone euro + taux directeur BCE)
  "stats.bis.org", // BIS SDMX WS_CBPOL (taux directeurs banques centrales)
  "api.imf.org", // IMF SDMX 3.0 IRFCL (réserves d'or par pays)
  "publicreporting.cftc.gov", // CFTC Socrata SODA (rapport COT)
  "cdn.cboe.com", // CBOE delayed quotes (GEX/DEX indices actions)
];

/** L'hôte est-il autorisé par le proxy /extapi ? (garde-fou dev côté appelant). */
export function estHoteExtapiAutorise(hote: string): boolean {
  return EXTAPI_WHITELIST.includes(hote);
}

/**
 * Construit l'URL relative same-origin `/extapi/<hote>/<chemin>`.
 * `chemin` peut inclure un query string (`fng/?limit=10`) — passé tel quel (le
 * caller construit son query via URLSearchParams si besoin). Un `/` en tête de
 * `chemin` est absorbé pour éviter un double slash.
 *
 * NB : ne valide PAS l'hôte (le daemon renvoie 403 si hors whitelist) — utiliser
 * `estHoteExtapiAutorise` en amont si un garde-fou explicite est souhaité.
 */
export function extUrl(hote: string, chemin: string): string {
  const cheminNettoye = chemin.startsWith("/") ? chemin.slice(1) : chemin;
  return `/extapi/${hote}/${cheminNettoye}`;
}
