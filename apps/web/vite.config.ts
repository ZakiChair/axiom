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
// Les clés de repli FRED/Coinalyze/Twelve Data sont INJECTÉES ICI
// (voir appendApiKeyIfAbsent) et n'apparaissent jamais dans le bundle navigateur.
// Ces réécritures n'existent qu'en `vite dev` ; Vercel réplique les mêmes préfixes via
// la fonction serverless `api/proxy.ts`, sans clé partagée.
export default defineConfig(({ mode }) => {
  // Clés lues depuis .env (gitignored) — JAMAIS en dur dans le source.
  // Injectées côté proxy → absentes du bundle navigateur. Voir .env.example.
  const TWELVE_DATA_KEY = loadEnv(mode, process.cwd(), "").TWELVE_DATA_KEY ?? "";
  const FRED_API_KEY = loadEnv(mode, process.cwd(), "").FRED_API_KEY ?? "";
  const COINALYZE_API_KEY = loadEnv(mode, process.cwd(), "").COINALYZE_API_KEY ?? "";
  const SOSOVALUE_API_KEY = loadEnv(mode, process.cwd(), "").SOSOVALUE_API_KEY ?? "";
  const ETHERSCAN_API_KEY = loadEnv(mode, process.cwd(), "").ETHERSCAN_API_KEY ?? "";
  const BGEOMETRICS_API_KEY = loadEnv(mode, process.cwd(), "").BGEOMETRICS_API_KEY ?? "";
  const isVercelBuild = process.env.VERCEL === "1";
  const AXIOM_DEPLOYMENT = isVercelBuild ? "vercel" : "local";
  const TWELVE_DATA_API_BASE = isVercelBuild ? "https://api.twelvedata.com" : "/tdapi";

  return {
  plugins: [react()],
  // Expose UNIQUEMENT la PRÉSENCE de la clé .env BGeometrics (booléen), jamais sa valeur :
  // le front bascule alors sur le quota horaire (10 req/h). Voir BG_CLE_ENV_PRESENTE dans
  // data/onchain/bgeometrics.ts ; fixe aussi le déploiement public et la base Twelve Data.
  define: {
    __BG_CLE_ENV__: JSON.stringify(!isVercelBuild && BGEOMETRICS_API_KEY !== ""),
    "import.meta.env.VITE_AXIOM_DEPLOYMENT": JSON.stringify(AXIOM_DEPLOYMENT),
    "import.meta.env.VITE_TWELVE_DATA_API_BASE": JSON.stringify(TWELVE_DATA_API_BASE),
  },
  // DÉCOUPAGE DU BUNDLE — isole les vendeurs STABLES (rendu React, KLineChart, moteur
  // d'indicateurs) hors du chunk d'entrée : une modification du code applicatif ne
  // réinvalide plus leur cache navigateur. Trois groupes seulement — un découpage plus
  // fin multiplierait les requêtes. On ne touche PAS aux dépendances déjà isolées par
  // les imports paresseux (d3-geo/topojson dans GlobeWindow) : les regrouper ici les
  // ferait charger au démarrage.
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (id.includes("/node_modules/klinecharts/")) return "vendor-klinecharts";
          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/scheduler/")
          ) {
            return "vendor-react";
          }
          // Package workspace : pnpm résout le symlink, l'id est le chemin source réel.
          if (id.includes("/packages/indicators/")) return "indicators";
          return undefined;
        },
      },
    },
    // Budget non complaisant : juste au-dessus du plus gros chunk émis après découpage,
    // pour qu'une dérive d'une dizaine de kilo-octets redéclenche l'avertissement.
    chunkSizeWarningLimit: 670,
  },
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
      // La clé personnelle déjà envoyée en query reste prioritaire ; sinon le proxy local
      // injecte TWELVE_DATA_KEY en repli. Sur Vercel, le front appelle directement l'API
      // dont le CORS est ouvert, avec la clé personnelle stockée dans le navigateur.
      "/tdapi": {
        target: "https://api.twelvedata.com",
        changeOrigin: true,
        rewrite: (path) =>
          appendApiKeyIfAbsent(path.replace(/^\/tdapi/, ""), "apikey", TWELVE_DATA_KEY),
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
      "/ccdataapi": {
        target: "https://min-api.cryptocompare.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ccdataapi/, ""),
        timeout: 15_000,
        proxyTimeout: 15_000,
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
