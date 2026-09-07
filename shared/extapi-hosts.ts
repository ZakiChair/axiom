/**
 * Whitelist UNIQUE des hôtes du proxy générique `/extapi/<hote>/…`.
 *
 * Consommateurs (ne plus dupliquer la liste ailleurs) :
 *   1. apps/daemon/src/proxy.ts     — PROD, frontière d’autorité 403
 *   2. apps/web/vite.config.ts      — DEV, une entrée proxy Vite par hôte
 *   3. apps/web/src/data/extapi.ts  — helper front + garde-fou dev
 *
 * Toute modification se fait ICI uniquement.
 */
import { NBS_HOST, NBS_CHEMIN } from "./nbs-series.js";

export const EXTAPI_HOSTS: readonly string[] = [
  NBS_HOST, // Séries mensuelles officielles chinoises : POST de lecture validé
  "www.stat-search.boj.or.jp", // Statistiques BOJ : seul endpoint public de lecture
  "api.mospi.gov.in", // PLFS : chômage national indien, lecture GET
  "www.matteoiacoviello.com", // GPR/TPU : deux documents convertis en JSON uniquement
  "www.newyorkfed.org", // GSCPI : CSV officiel uniquement
  "nfs.faireconomy.media", // ForexFactory JSON (calendrier éco)
  "www.coindesk.com", // RSS news
  "cointelegraph.com", // RSS news
  "www.theblock.co", // RSS news
  "decrypt.co", // RSS news
  "blockworks.com", // RSS news
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
  "home.treasury.gov", // US Treasury Daily Par Yield Curve CSV
  "data-api.ecb.europa.eu", // ECB SDMX (courbe zone euro + taux directeur BCE)
  "stats.bis.org", // BIS SDMX WS_CBPOL (taux directeurs banques centrales)
  "api.imf.org", // IMF SDMX 3.0 IRFCL (réserves d’or par pays)
  "publicreporting.cftc.gov", // CFTC Socrata SODA (rapport COT)
  "cdn.cboe.com", // CBOE delayed quotes (GEX/DEX indices actions)
  "data.sec.gov", // SEC EDGAR (submissions, XBRL companyfacts) — FUND
  "www.sec.gov", // SEC EDGAR (company_tickers.json) — FUND
  "api.gdeltproject.org", // GDELT (recherche news ciblée) — NEWS enrichi
  "www.mof.go.jp", // MOF Japon — CSV JGB
  "www.rba.gov.au", // RBA Australie — CSV F2
  "api.coinbase.com", // Coinbase Advanced Trade (candles REST public — WS reste direct)
  "api.coinmarketcap.com", // historique global public CMC (TOTAL/TOTAL2/TOTAL3)
  "feeds.bloomberg.com", // RSS Bloomberg (news macro)
  "www.bloomberg.com", // destination actuelle de la redirection RSS Bloomberg
  "www.cnbc.com", // RSS CNBC Economy
  // OpenSky /states/all (trafic aérien — globe). CORS restreint à sa propre
  // origine → proxy obligatoire. PortWatch ArcGIS (CORS *) reste en appel direct.
  "opensky-network.org",
];

/** Hôtes spécialisés : aucun accès générique à leurs autres pages. */
export const EXTAPI_HOTES_SPECIALISES: readonly string[] = ["www.matteoiacoviello.com", "www.newyorkfed.org", "www.stat-search.boj.or.jp", "api.mospi.gov.in", NBS_HOST];
export function extapiCheminAutorise(hote: string, chemin: string): boolean {
  if (hote === NBS_HOST) return chemin === NBS_CHEMIN;
  if (hote === "www.stat-search.boj.or.jp") return chemin === "/api/v1/getDataCode";
  if (hote === "api.mospi.gov.in") return chemin === "/api/plfs/getData";
  if (hote === "www.matteoiacoviello.com") return chemin === "/gpr.htm" || chemin === "/tpu.htm";
  if (hote === "www.newyorkfed.org") return chemin === "/medialibrary/research/interactives/data/gscpi/gscpi_interactive_data.csv";
  return true;
}
export function sourceGeoExtraite(url: URL): "gpr" | "tpu" | null {
  if (url.hostname !== "www.matteoiacoviello.com") return null;
  return url.pathname === "/gpr.htm" ? "gpr" : url.pathname === "/tpu.htm" ? "tpu" : null;
}
