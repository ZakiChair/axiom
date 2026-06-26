# AXIOM — Contrat de build (à lire par CHAQUE agent avant d'écrire du code)

Ce fichier est la **source de vérité** des conventions et du périmètre. Il prime sur toute supposition.
Référence critique complète : `~/AXIOM-revue-critique-2026-06-26.md`.

## Décisions verrouillées (branche PERSO mono-utilisateur)
- **Cible** : terminal pour UN utilisateur (ses propres clés). PAS de multi-tenant, PAS d'auth réseau, PAS de SaaS. Crypto d'abord (spot + perp) ; tradfi/commodités plus tard.
- **Renderer-first** : le premier livrable à valeur est un graphe live à l'écran. **AUCUN backend / Docker / TimescaleDB / Redis pour le MVP.** Le front parle directement aux WS publics des exchanges (mode mono-utilisateur assumé).
- **Chart** : **KLineChart** figé (pas de lightweight-charts, pas d'abstraction `IChartRenderer` « swap de moteur »). L'overlay orderflow se synchronise sur le viewport de KLineChart.
- **Indicateurs** : **TS pur**, package `@axiom/indicators` = source de vérité unique. PAS de WASM, PAS de service Python. `pandas-ta-classic` peut servir d'oracle de référence en commentaire de test, mais AUCUNE dépendance runtime Python.
- **Données dérivées (OI/funding/L-S/liquidations)** : **ACHETER** via un `IDerivedDataProvider` (Coinalyze gratuit visé en M6) — NE PAS construire d'AggregationEngine multi-exchange.
- **Trading** : hors MVP (paper plus tard). Ne rien implémenter qui touche à des clés de trading.

## Conventions
- **TypeScript strict** partout (voir `tsconfig.base.json`, `noUncheckedIndexedAccess` activé).
- **Langue** : commentaires et docs en **français** (préférence utilisateur).
- **Modules** : ESM (`"type": "module"`). Imports des types via `@axiom/types`, indicateurs via `@axiom/indicators`.
- **Aucune dépendance nouvelle** sans nécessité ; ne PAS modifier les `package.json` (les deps sont figées et déjà installées). Si une dep manque réellement, la signaler dans le retour plutôt que de l'ajouter à l'aveugle.
- **Pas de re-render React du canvas** : les données tick/live vivent dans un store vanilla (Zustand hors render-loop) ; le moteur de rendu a sa propre boucle. Aucune donnée haute fréquence dans le state React.
- Vérifier l'API exacte de KLineChart via le MCP context7 (`resolve-library-id` puis `query-docs` sur "klinecharts") avant de coder l'intégration — la version est `^9.8.x`.

## Propriété des fichiers (éviter les conflits entre agents)
- **@axiom/types** (`packages/types/`) : FIGÉ par l'orchestrateur. Ne pas modifier ; si un type manque, le signaler.
- **Moteur d'indicateurs** (`packages/indicators/src/engine.ts`, `registry.ts`, `index.ts`, `utils.ts`) : agent « engine ».
- **Chaque indicateur** : un fichier dédié `packages/indicators/src/<category>/<id>.ts` + son test `<id>.test.ts`. Un agent par indicateur, n'écrit QUE ses 2 fichiers.
- **App web** (`apps/web/src/**`, `apps/web/vite.config.ts`, `index.html`, `tailwind.config.js`, `postcss.config.js`, `src/index.css`, `src/main.tsx`) : agent « chart » (M1). Crée toute la config Vite/Tailwind manquante lui-même.
- **registry.ts** n'est wiré qu'une fois, par l'agent « wire » final (après que tous les indicateurs existent) — évite les écritures concurrentes.

## Spec des jalons MVP
- **M1 — Chart live** (`apps/web`) : Vite+React+TS+Tailwind ; client WS Binance (`@<symbol>@kline_<tf>`) + backfill REST initial (`/api/v3/klines` spot ou `/fapi/v1/klines` futures) ; rendu KLineChart candlestick live ; sélecteur symbole + timeframe ; crosshair. Store marché vanilla. **Vérif : `pnpm --filter @axiom/web build` passe et l'app affiche un graphe.**
- **M2 — Moteur + 7 indicateurs** (`packages/indicators`) : `IndicatorDef`/`engine.ts` (calcul, helpers SMA/EMA/RMA réutilisables dans `utils.ts`) ; les 7 indicateurs **SMA, EMA, RSI, MACD, Bollinger Bands, Volume, VWAP** chacun en `IndicatorDef`, avec test unitaire vs valeurs de référence connues (Wilder pour RSI). **Vérif : `pnpm --filter @axiom/indicators test` vert.**
- M3 watchlist+persistance locale, M4 spike sync WebGL, M5 CVD+footprint (aggTrade), M6 `IDerivedDataProvider`→Coinalyze : jalons suivants (pas dans ce premier workflow).

## Anti-objectifs (NE PAS faire)
- Ne pas créer de backend, de docker-compose, de schéma DB.
- Ne pas implémenter plus de 7 indicateurs dans ce lot.
- Ne pas ajouter d'exchanges autres que Binance.
- Ne pas « améliorer » `@axiom/types` ni les configs racine.
