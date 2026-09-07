# AXIOM — Contrat de build (à lire par CHAQUE agent avant d'écrire du code)

Ce fichier est la **source de vérité** des conventions et du périmètre. Il prime sur toute supposition.
Référence critique complète : `~/AXIOM-revue-critique-2026-06-26.md`.

> **Routage multi-modèles** : avant d'agir, lire aussi `.devin/provider-rules.md`
> (matrice action → provider : Fable orchestre, Opus revoit, GPT-sol/DeepSeek
> implémentent sur brief).

## Décisions verrouillées (branche PERSO mono-utilisateur)
- **Cible** : terminal pour UN utilisateur (ses propres clés). PAS de multi-tenant, PAS d'auth réseau, PAS de SaaS. Crypto d'abord (spot + perp) ; tradfi/commodités en complément.
- **Renderer-first** : le premier livrable à valeur est un graphe live à l'écran. **AUCUN backend réseau/multi-tenant (Docker/TimescaleDB/Redis interdits). Un daemon localhost mono-process (`apps/daemon`, Bun + SQLite, port 8787) est autorisé depuis la Phase 2 — proxy/cache/persistance/alertes UNIQUEMENT, jamais sur le chemin chaud du renderer (les WS de marché du front restent directs).** Le front parle directement aux WS publics des exchanges (mode mono-utilisateur assumé) et reste **100 % fonctionnel SANS daemon** (feature-detect `/health` + repli localStorage/proxy Vite). Déviation assumée vs roadmap E1 : les proxys Vite restent en dev (dev sans daemon), le daemon est le chemin de PROD + services additionnels.
- **Chart** : **KLineChart** figé (pas de lightweight-charts, pas d'abstraction `IChartRenderer` « swap de moteur »). L'overlay orderflow se synchronise sur le viewport de KLineChart. Multi-chart 2×2 : un store par slot ; les overlays doivent être scellés au slot (voir plan 2026-08-24, Lot 3).
- **Indicateurs** : **TS pur**, package `@axiom/indicators` = source de vérité unique (**189 indicateurs**). PAS de WASM, PAS de service Python. `pandas-ta-classic` peut servir d'oracle de référence en commentaire de test, mais AUCUNE dépendance runtime Python.
- **Données dérivées (OI/funding/L-S/liquidations)** : **ACHETER** via un `IDerivedDataProvider` (Coinalyze **câblé**, M6 atteint) — NE PAS construire d'AggregationEngine multi-exchange. Trois couches de liquidations distinctes et étiquetées : heatmap *exécutée*, niveaux **EST.** (modèle levier), niveaux **HL réels** (Hyperliquid, non exhaustif).
- **Trading** : **PAS d'exécution d'ordres** — aucune clé de trading. Le paper trading (`PAPER`) est une simulation locale (hors gate G100/K8). Ne rien implémenter qui touche à des clés de trading réelles.
- **Sources** : **9 identifiants** (`EXCHANGE_IDS` dans `@axiom/types`) — Binance, Bybit, OKX, Hyperliquid, Coinbase, Kraken, Twelve Data, MEXC, synthetic. Ne pas en ajouter sans nécessité démontrée (non-objectif avant G100).
- **Fournisseurs de capitalisation (exception ACTÉE le 2026-09-01, même statut que WHALES)** : l'historique TOTAL/TOTAL2/TOTAL3 et la fenêtre BPL sont servis par l'endpoint public `api.coinmarketcap.com/data-api` (sans clé, via `/extapi`), avec repli CryptoCompare/CCData `min-api.cryptocompare.com` (clé personnelle navigateur, route dédiée `/ccdataapi` daemon + Vercel) puis CoinGecko local. `EXCHANGE_IDS` reste à 9 (l'adaptateur de capitalisation est de source `synthetic`). Aucun autre fournisseur sans amendement du contrat.
- **Fournisseurs statistiques publics (exception ACTÉE le 2026-09-06, même statut que les fournisseurs de capitalisation)** : trois sources publiques sans clé API — OCDE (`sdmx.oecd.org`), Eurostat (`ec.europa.eu`), ONS (`www.ons.gov.uk`) — admis en appel DIRECT avec vérification des en-têtes CORS, sans ajout à `shared/extapi-hosts.ts`. Remplacent des miroirs FRED internationaux défaillants (CPI zone euro arrêté en 2023, CPI japonais en 2021, M2 chinois en 2019) avec des `last_updated` trompeurs. `EXCHANGE_IDS` reste à 9 (aucun adaptateur marché n'est impliqué). Cf. `docs/superpowers/specs/2026-09-06-indicateurs-macro-mondiaux-design.md`.

## Conventions

**Exceptions ACTÉES le 2026-09-04 — corrections demandées par le propriétaire, plan validé par Fable 5 :**

- Les `package.json` et le lockfile peuvent être modifiés pour corriger les avis de sécurité de l'outillage : Vite **6.4.3**, Vitest **3.2.7**, plugin React **4.7.0**, PostCSS **8.5.28**, résolutions transitives nanoid **3.3.18** et browserslist **4.28.9**. Aucune nouvelle dépendance runtime.
- La migration **Vite 5 → 6** est autorisée pour ce correctif de sécurité malgré le gel des migrations majeures avant G100. Les autres migrations restent soumises au gel.
- Le lot local positionnement/orderflow est conservé et corrigé : **8 indicateurs supplémentaires**, soit **187 indicateurs / 30 stratégies**, et le playbook **PLAY-POS**. Cette exception de catalogue ne clôt pas le verdict manuel G100.

- **TypeScript strict** partout (voir `tsconfig.base.json`, `noUncheckedIndexedAccess` activé).
- **Langue** : commentaires et docs en **français** (préférence utilisateur).
- **Modules** : ESM (`"type": "module"`). Imports des types via `@axiom/types`, indicateurs via `@axiom/indicators`.
- **Aucune dépendance nouvelle** sans nécessité ; ne PAS modifier les `package.json` hors exception de maintenance actée ci-dessus (les deps sont figées et déjà installées). Si une dep manque réellement, la signaler dans le retour plutôt que de l'ajouter à l'aveugle.
- **Pas de re-render React du canvas** : les données tick/live vivent dans un store vanilla (Zustand hors render-loop) ; le moteur de rendu a sa propre boucle. Aucune donnée haute fréquence dans le state React.
- Vérifier l'API exacte de KLineChart via le MCP context7 (`resolve-library-id` puis `query-docs` sur "klinecharts") avant de coder l'intégration — la version est `^9.8.x`.

## Propriété des fichiers (éviter les conflits entre agents)
- **@axiom/types** (`packages/types/`) : FIGÉ par l'orchestrateur. Ne pas modifier ; si un type manque, le signaler.
- **Moteur d'indicateurs** (`packages/indicators/src/engine.ts`, `registry.ts`, `index.ts`, `utils.ts`) : agent « engine ».
- **Chaque indicateur** : un fichier dédié `packages/indicators/src/<category>/<id>.ts` + son test `<id>.test.ts`. Un agent par indicateur, n'écrit QUE ses 2 fichiers.
- **App web** (`apps/web/src/**`, `apps/web/vite.config.ts`, `index.html`, `tailwind.config.js`, `postcss.config.js`, `src/index.css`, `src/main.tsx`) : agent « chart » (M1). Crée toute la config Vite/Tailwind manquante lui-même.
- **registry.ts** n'est wiré qu'une fois, par l'agent « wire » final (après que tous les indicateurs existent) — évite les écritures concurrentes.

## État actuel (2026-09-04)
- **Chart** live multi-exchange (spot + perp), multi-grille 1/2h/2v/2×2, orderflow/CVD/footprint, volume profile, fibo, dessins.
- **189 indicateurs** TS purs dans `@axiom/indicators` (dont 30 stratégies étiquetées « non validé ») ; **4 golden tests** pandas-ta (ADX, SuperTrend, Ichimoku, PSAR) — le reste est couvert par tests unitaires/structurels.
- **39 fenêtres** à mnémonique (`WINDOW_REGISTRY`) — dont WHALES (mouvements baleines on-chain + positions top comptes Hyperliquid), ajoutée le 2026-08-25 sur décision utilisateur, et BPL (Bitcoin Power Law), ajoutée le 2026-09-01 avec les séries TOTAL/TOTAL2/TOTAL3 chartables (chantier CAP/BPL) : **écarts ASSUMÉS** au gel « aucune nouvelle fenêtre avant le verdict G100 » (§ ci-dessous).
- **Daemon** `axiomd` : proxy+cache SQLite, KV/snapshots, candles, alertes (macOS + Telegram), replay dumps Binance, couches GDELT/UCDP, LIQHL Hyperliquid paresseux, collecteur whales (blocs confirmés blockchain.info + Etherscan stables, table `whale_moves`, rétention 30 j). Bind `127.0.0.1:8787`, whitelist `/extapi`, garde Host/Origin/DNS-rebinding.
- **Vercel** : front + proxy serverless sans secret partagé, whitelist/MIME/DNS durcis. Les clés personnelles restent dans le navigateur. Toute fonction strictement locale est marquée `UNUSABLE`, toute fenêtre partielle `PARTIAL` ; jamais de pane muet.
- **Paper trading** (`PAPER`) : moteur de simulation locale présent, hors gate G100.
- **Gate G100** : code-complete, e2e partiellement automatisés, **verdict manuel ouvert** (voir `docs/superpowers/plans/2026-07-22-gate-g100-qa.md` et plan d'action 2026-08-24). **Aucune nouvelle fenêtre ni fonctionnalité de surface avant le verdict** — cinq exceptions ACTÉES : le 2026-08-25 (fenêtre WHALES + alerte `whale-flux`, demande utilisateur explicite), le 2026-09-01 (fenêtre BPL + séries TOTAL/TOTAL2/TOTAL3 chartables, chantier CAP/BPL demandé par l'utilisateur) le 2026-09-02 (lot v2.7 « Décider » : alerte composite, backtest en R, coût d'exécution DOM — aucune fenêtre, aucun fournisseur, aucun indicateur, spec `docs/superpowers/specs/2026-09-02-lot-v27-decider-design.md`) et le 2026-09-04 (catalogue positionnement/orderflow et PLAY-POS, cf. Conventions), et le 2026-09-06 (onglet « Indicateurs » de la fenêtre RATE + trois fournisseurs statistiques publics sans clé — OCDE, Eurostat, ONS — au titre du remplacement des miroirs FRED internationaux démantelés ; spec `docs/superpowers/specs/2026-09-06-indicateurs-macro-mondiaux-design.md`) ; le gel reste la règle pour toute autre surface.

## Jalons historiques (atteints — ne pas rejouer, ne pas prendre comme périmètre actuel)
- **M1 — Chart live** (`apps/web`) : Vite+React+TS+Tailwind ; client WS Binance + backfill REST ; rendu KLineChart live ; sélecteur symbole + timeframe ; crosshair. Store marché vanilla. **Atteint.**
- **M2 — Moteur + 7 indicateurs** (`packages/indicators`) : `IndicatorDef`/`engine.ts` (calcul, helpers SMA/EMA/RMA dans `utils.ts`) ; SMA, EMA, RSI, MACD, Bollinger Bands, Volume, VWAP avec tests vs valeurs de référence (Wilder pour RSI). **Atteint et dépassé** (le catalogue est à 189).
- M3 watchlist+persistance locale, M4 spike sync WebGL, M5 CVD+footprint (aggTrade), M6 `IDerivedDataProvider`→Coinalyze : **tous atteints.**

## Anti-objectifs (NE PAS faire)
- Ne pas créer de backend **réseau/multi-tenant**, de docker-compose, de schéma DB serveur (le daemon localhost mono-process de la Phase 2 est la SEULE exception, cf. Décisions verrouillées).
- **Avant le verdict G100** : pas de nouvelle fenêtre, pas de nouveau fournisseur sans remplacement direct d'une source défaillante (exceptions ACTÉES : fournisseurs de capitalisation CMC/CCData, et fournisseurs statistiques publics OCDE/Eurostat/ONS le 2026-09-06 — cf. Décisions verrouillées), pas de migration React/Vite/Zustand/KLineChart majeure (plan 2026-08-24, §12).
- Ne pas « améliorer » `@axiom/types` ni les configs racine.
- Ne pas étendre le catalogue d'indicateurs sans nécessité démontrée (le contrat est à 189, pas « plus de 7 » — l'ancien jalon M2 est historique, cf. ci-dessus).

### Garde-fous reportés de la roadmap (docs/research/03, §Anti-recommandations)
Les anti-recommandations #2 (Docker/Redis/TimescaleDB), #3 (proxifier les WS via le daemon) et #6 (abstraction de moteur de chart) sont déjà couvertes ci-dessus et dans les Décisions verrouillées. Les 6 restantes, à respecter tout autant :
- Ne pas empaqueter en **Electron** (150 Mo pour rien). Multi-fenêtres = `BroadcastChannel` + mode `--app` de Chrome ; Tauri seulement si un besoin est prouvé après usage.
- Ne pas mutualiser les WS via un **SharedWorker** (complexité pour économiser des connexions non contraintes).
- Ne pas construire de **recorder tick 24/7** multi-exchange (ce serait l'AggregationEngine interdit déguisé ; le replay télécharge les dumps `data.binance.vision` à la demande).
- Ne pas **reconstruire maison la liquidation heatmap** (modèle propriétaire, gaté 699 $/mois chez CoinGlass → renoncer ou étiqueter toute estimation comme telle).
- Ne pas intégrer **LunarCrush** (240 $/mois) ni **Santiment free** (données J-30).
- Ne pas implémenter un **scripting Pine-like** complet.

## Extension demandée le 7 septembre 2026

La reprise demandée par l'utilisateur étend les surfaces existantes MACRO/RATE,
ECO/BRIEF, GLOBE, CHAIN et DOM. **39 fenêtres, 9 identifiants de marché, aucun
nouveau backend.** Deux indicateurs OHLCV portent le catalogue à **189** ; les
**30 stratégies demeurent non validées**. RVOL saisonnier H1 : restriction commune
au chart, aux alertes (y compris composites/importées) et au backtest.

Les nouveaux fournisseurs statistiques complètent les sources défaillantes. NBS
utilise un POST de lecture, validé sur catalogue/indicateur/zone/période, dans le
proxy existant ; la limite réelle de corps est de 64 Kio. BOJ et les sources géo
sont confinés à leurs chemins de données. Les documents GPR/TPU sont convertis en
JSON après extraction des seules séries attendues ; aucun HTML amont n'est servi.

Les timestamps d'observation, périodes glissantes, unités, estimations et dates de
récupération sont distincts. Pas de remplissage d'une absence par zéro, de cumul
ETF inventé depuis un snapshot, ni d'interprétation mint/burn du changement de
stock USD STBL. NETLIQ décrit un proxy de liquidité Fed à fréquences mélangées.

Durabilité : écritures KV ordonnées par clé ; imports avec rollback local et
restauration du périmètre déclaré (configuration et travail personnel). Le daemon
conserve un snapshot de secours avant restauration. Une panne du stockage
navigateur peut encore empêcher la réapplication locale : l'opération ne rapporte
alors pas un succès. Aucun secret/API key n'entre dans le périmètre snapshot.

Vérification et limites : voir [le rapport de revue du 7 septembre](docs/revue-2026-09-07.md). Le protocole
G100 reste le registre du verdict manuel. Fable 5 n'a pas pu procéder à sa revue
(quota HTTP 429) ; la revue indépendante GPT n'est pas un visa Fable.
