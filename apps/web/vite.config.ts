import { defineConfig, loadEnv } from "vite";
import type { ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import { appendApiKeyIfAbsent } from "./src/data/apiKeyProxy";

// PROXY GÉNÉRIQUE /extapi (Phase 3) — contournement CORS pour APIs sans clé.
// Route `/extapi/<hote>/<chemin…>` → `https://<hote>/<chemin…>` pour les hôtes
// whitelistés (RSS news, calendriers éco, on-chain, Deribit, Binance fapi/dapi…).
// En DEV, Vite ne sait pas router dynamiquement une cible unique (node-http-proxy
// n'a pas d'option `router`) → on génère UNE ENTRÉE PAR HÔTE depuis la whitelist.
// Le vrai contrôle d'autorité (403 hors-liste) vit côté daemon (proxy de PROD).
//
// ⚠️ WHITELIST DUPLIQUÉE dans 3 fichiers (synchronisation MANUELLE) :
//   1. apps/daemon/src/proxy.ts       (EXTAPI_WHITELIST — frontière d'autorité 403)
//   2. apps/web/vite.config.ts        (ici — proxy de DEV, une entrée par hôte)
//   3. apps/web/src/data/extapi.ts    (helper front + constante documentée)
const EXTAPI_HOTES: readonly string[] = [
  "nfs.faireconomy.media",
  "www.coindesk.com",
  "cointelegraph.com",
  "www.theblock.co",
  "decrypt.co",
  "blockworks.co",
  "api.alternative.me",
  "community-api.coinmetrics.io",
  "bitcoin-data.com",
  "api.llama.fi",
  "mempool.space",
  "blockchain.info",
  "www.deribit.com",
  "dapi.binance.com",
  "fapi.binance.com",
  "api.coingecko.com",
  "api.fiscaldata.treasury.gov",
  "data-api.ecb.europa.eu",
  "stats.bis.org",
  "api.imf.org",
  "publicreporting.cftc.gov",
  "cdn.cboe.com",
];

// User-Agent navigateur standard : certains hôtes (RSS, Cloudflare) refusent un UA vide.
const EXTAPI_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Génère les entrées de proxy Vite `/extapi/<hote>` → `https://<hote>` (strip du préfixe,
// UA navigateur, timeout 15 s). Cache : seulement en PROD (daemon) — le proxy de dev ne
// met rien en cache, comme les proxys /fredapi… existants.
const extapiProxy: Record<string, ProxyOptions> = Object.fromEntries(
  EXTAPI_HOTES.map((hote) => [
    `/extapi/${hote}`,
    {
      target: `https://${hote}`,
      changeOrigin: true,
      rewrite: (chemin: string) => chemin.replace(`/extapi/${hote}`, ""),
      headers: { "User-Agent": EXTAPI_USER_AGENT },
      timeout: 15_000,
      proxyTimeout: 15_000,
    },
  ]),
);

// Configuration Vite : plugin React (Fast Refresh + JSX) + proxy de dev.
// La résolution des packages workspace (@axiom/types) passe par les symlinks pnpm.
//
// PROXY DE DÉVELOPPEMENT — contournement CORS (cf. data/coinalyze.ts & data/macro/fred.ts).
// FRED (api.stlouisfed.org) et Coinalyze (api.coinalyze.net) ne renvoient AUCUN
// en-tête CORS → un navigateur bloque les appels directs. On route ces deux APIs en
// SAME-ORIGIN via Vite : `changeOrigin` présente l'amont comme destinataire direct.
// (CoinGecko a un vrai CORS « * » → appelé en direct.)
// Les clés FRED/Coinalyze sont INJECTÉES ICI (voir appendApiKeyIfAbsent) → elles
// restent côté serveur de dev et n'apparaissent jamais dans le bundle navigateur.
// ⚠️ Ces réécritures n'existent qu'en `vite dev` : un build statique nécessiterait
//    un vrai proxy côté serveur (hors périmètre de cet outil mono-utilisateur).
export default defineConfig(({ mode }) => {
  // Clés lues depuis .env (gitignored) — JAMAIS en dur dans le source.
  // Injectées côté proxy → absentes du bundle navigateur. Voir .env.example.
  const TWELVE_DATA_KEY = loadEnv(mode, process.cwd(), "").TWELVE_DATA_KEY ?? "";
  const FRED_API_KEY = loadEnv(mode, process.cwd(), "").FRED_API_KEY ?? "";
  const COINALYZE_API_KEY = loadEnv(mode, process.cwd(), "").COINALYZE_API_KEY ?? "";

  return {
  plugins: [react()],
  server: {
    proxy: {
      // La clé FRED est injectée ici SEULEMENT si le front n'en a pas déjà mis une
      // dans la query (clé personnelle des Réglages) → override utilisateur prioritaire.
      "/fredapi": {
        target: "https://api.stlouisfed.org",
        changeOrigin: true,
        rewrite: (path) =>
          appendApiKeyIfAbsent(path.replace(/^\/fredapi/, ""), "api_key", FRED_API_KEY),
      },
      // Idem Coinalyze : la clé accepte `api_key` en query param (cf. recherche §1) ;
      // injectée ici en repli, écrasée par la clé personnelle si le front en envoie une.
      "/coinalyzeapi": {
        target: "https://api.coinalyze.net",
        changeOrigin: true,
        rewrite: (path) =>
          appendApiKeyIfAbsent(path.replace(/^\/coinalyzeapi/, ""), "api_key", COINALYZE_API_KEY),
      },
      // Marchés traditionnels (actions, forex ; indices/commodités via ETF) — Twelve Data.
      // La clé API est INJECTÉE ICI (rewrite ajoute &apikey=…) → elle reste côté serveur,
      // jamais exposée au navigateur. CORS de Twelve Data est ouvert, mais on proxifie
      // justement pour cacher la clé (même pattern dev-only que FRED/Coinalyze).
      "/tdapi": {
        target: "https://api.twelvedata.com",
        changeOrigin: true,
        rewrite: (path) => {
          const stripped = path.replace(/^\/tdapi/, "");
          const sep = stripped.includes("?") ? "&" : "?";
          return `${stripped}${sep}apikey=${TWELVE_DATA_KEY}`;
        },
      },
      // MEXC (exchange crypto, inclut des ACTIONS TOKENISÉES : AAPLXUSDT, TSLAONUSDT…).
      // API spot v3 compatible Binance, KEYLESS pour les données publiques, mais SANS
      // en-tête CORS → on route en same-origin via le proxy (même pattern que ci-dessus).
      "/mexcapi": {
        target: "https://api.mexc.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/mexcapi/, ""),
      },
      // Proxy générique /extapi (Phase 3) : une entrée par hôte whitelisté (cf. ci-dessus).
      ...extapiProxy,
    },
  },
  };
});
