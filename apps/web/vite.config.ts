import { defineConfig, loadEnv } from "vite";
import type { ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import { EXTAPI_HOSTS } from "../../shared/extapi-hosts";
import { appendApiKeyIfAbsent } from "./src/data/apiKeyProxy";

// PROXY GÉNÉRIQUE /extapi (Phase 3) — contournement CORS pour APIs sans clé.
// Route `/extapi/<hote>/<chemin…>` → `https://<hote>/<chemin…>` pour les hôtes
// whitelistés. Source unique : shared/extapi-hosts.ts (daemon + extapi.ts + ici).
// En DEV, une entrée proxy Vite par hôte ; l'autorité 403 vit côté daemon en PROD.
const EXTAPI_HOTES: readonly string[] = EXTAPI_HOSTS;

// User-Agent navigateur standard : certains hôtes (RSS, Cloudflare) refusent un UA vide.
const EXTAPI_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Hôtes exigeant un User-Agent CONFORME (identifiant + contact avec "@"), pas le UA navigateur
// générique : la politique d'accès équitable de la SEC bloque/liste noire les UA sans
// token de contact (@). Le UA DOIT inclure un identifiant de contact (ex: email) pour
// passer le contrôle d'accès équitable de SEC. COPIE VERBATIM de apps/daemon/src/proxy.ts
// (interdiction d'import cross-package apps/daemon → apps/web ; source de vérité = ce commentaire).
const EXTAPI_USER_AGENT_SEC = "AxiomTerminal/1.0 (contact: axiom-terminal@example.com)";
const EXTAPI_USER_AGENT_HOTES: Record<string, string> = {
  "data.sec.gov": EXTAPI_USER_AGENT_SEC,
  "www.sec.gov": EXTAPI_USER_AGENT_SEC,
};

// Génère les entrées de proxy Vite `/extapi/<hote>` → `https://<hote>` (strip du préfixe,
// UA navigateur ou SEC-conforme par hôte, timeout 15 s). Cache : seulement en PROD (daemon) —
// le proxy de dev ne met rien en cache, comme les proxys /fredapi… existants.
const extapiProxy: Record<string, ProxyOptions> = Object.fromEntries(
  EXTAPI_HOTES.map((hote) => [
    `/extapi/${hote}`,
    {
      target: `https://${hote}`,
      changeOrigin: true,
      rewrite: (chemin: string) => chemin.replace(`/extapi/${hote}`, ""),
      headers: { "User-Agent": EXTAPI_USER_AGENT_HOTES[hote] ?? EXTAPI_USER_AGENT },
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
  const SOSOVALUE_API_KEY = loadEnv(mode, process.cwd(), "").SOSOVALUE_API_KEY ?? "";
  const ETHERSCAN_API_KEY = loadEnv(mode, process.cwd(), "").ETHERSCAN_API_KEY ?? "";
  const BGEOMETRICS_API_KEY = loadEnv(mode, process.cwd(), "").BGEOMETRICS_API_KEY ?? "";

  return {
  plugins: [react()],
  // Expose UNIQUEMENT la PRÉSENCE de la clé .env BGeometrics (booléen), jamais sa valeur :
  // le front bascule alors sur le quota horaire (10 req/h) même sans clé personnelle. Voir
  // BG_CLE_ENV_PRESENTE dans data/onchain/bgeometrics.ts.
  define: { __BG_CLE_ENV__: JSON.stringify(BGEOMETRICS_API_KEY !== "") },
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
      // SoSoValue (flux ETF spot BTC/ETH/SOL — panneau ON-CHAIN). CORS ouvert, mais on
      // proxifie pour fournir la clé de repli .env : SoSoValue s'authentifie par EN-TÊTE
      // (x-soso-api-key), pas par query param → injection via l'évènement proxyReq,
      // UNIQUEMENT si le front n'a pas déjà envoyé sa clé personnelle (Réglages).
      "/sosoapi": {
        target: "https://openapi.sosovalue.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/sosoapi/, ""),
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            if (SOSOVALUE_API_KEY.length > 0 && !proxyReq.getHeader("x-soso-api-key")) {
              proxyReq.setHeader("x-soso-api-key", SOSOVALUE_API_KEY);
            }
          });
        },
      },
      // BGeometrics (bitcoin-data.com — valorisation BTC, flux ETF, hashrate, OI). SANS
      // en-tête CORS pour l'auth par clé → même-origine via ce proxy. bitcoin-data.com
      // n'accepte QUE `Authorization: Bearer <clé>` (les autres formats retombent sur le
      // quota IP). La clé de repli .env est injectée via proxyReq (comme /sosoapi),
      // UNIQUEMENT si le front n'a pas déjà envoyé sa clé personnelle (Réglages).
      "/bgapi": {
        target: "https://bitcoin-data.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/bgapi/, ""),
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            if (BGEOMETRICS_API_KEY.length > 0 && !proxyReq.getHeader("authorization")) {
              proxyReq.setHeader("Authorization", `Bearer ${BGEOMETRICS_API_KEY}`);
            }
          });
        },
      },
      // Etherscan v2 (réseau ETH — panneau ON-CHAIN). CORS ouvert, mais on proxifie pour
      // la clé de repli .env (query param apikey) ; clé personnelle du front prioritaire.
      "/ethscanapi": {
        target: "https://api.etherscan.io",
        changeOrigin: true,
        rewrite: (path) =>
          appendApiKeyIfAbsent(path.replace(/^\/ethscanapi/, ""), "apikey", ETHERSCAN_API_KEY),
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
