import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { appendApiKeyIfAbsent } from "./src/data/apiKeyProxy";

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
    },
  },
  };
});
