# Lot v1.6 — Clé BGeometrics + on-chain élargi, périodes NETLIQ, EXPY, DIST, cockpit DATA (design)

Date : 2026-07-23 · Statut : périmètre validé par Zaki (AskUser — tout sélectionné + clé/.env et périodes NETLIQ commandés). Cinq branches indépendantes.

## Faits vérifiés live (2026-07-23, clé `<clé — voir apps/web/.env>`)

- Auth bitcoin-data.com : SEUL `Authorization: Bearer <clé>` est reconnu (réponse 429 `RATE_LIMIT_HOUR_EXCEEDED` = quota propre de la clé, ~10 req/h) ; les autres formats (`Authorization` nu — CE QUE LE CODE ACTUEL ENVOIE —, x-api-key, query) retombent sur la limite IP `RATE_LIMIT_DAY_EXCEEDED` 15/j. → le format actuel de `bgeometrics.ts` est INOPÉRANT, à corriger en `Bearer`.
- Endpoints 200 vérifiés : `etf-flow-btc` → `[{d, unixTs: "…", etfFlow: "2738.489…"}]` (CHAÎNES, flux ETF spot BTC quotidien net) ; `hashrate` → `{d, unixTs, hashrate: 9.17e8}` ; `open-interest-futures` → `{d, unixTs, binance: "9045…", bybit: "…", okx: "…", …}` (OI $ par exchange, champs chaînes). 404 : difficulty, funding-rates, miner-revenue. La clé est dans `apps/web/.env` (`BGEOMETRICS_API_KEY`), `.env.example` documenté.

## 1. Clé BGeometrics + on-chain élargi (`feat/bg-cle-onchain`)

- **Proxy `/bgapi`** (patron sosoapi EXACT) : Vite dev + daemon prod routent `/bgapi/*` → `https://bitcoin-data.com/*` en injectant `Authorization: Bearer <BGEOMETRICS_API_KEY>` UNIQUEMENT si le front n'a pas déjà envoyé un header Authorization (clé personnelle des Réglages prioritaire, envoyée en `Bearer` désormais). La clé n'entre jamais dans le bundle.
- `bgeometrics.ts` : BASE → `/bgapi/v1` (même origine, plus d'appel direct) ; clé personnelle envoyée `Bearer <clé>` ; quota affiché : « x/10 h » quand une clé est active (personnelle OU repli .env — présence du repli signalée par un booléen Vite `define`/env `VITE_`, jamais la clé), sinon « x/15 j » ; compteur horaire quand clé (clé de stockage par heure).
- **Nouvelles métriques** (défs + fetch même mécanique, champs vérifiés en T1 avec parsing des CHAÎNES) :
  - `etfFlowBtc` (`etf-flow-btc`) : flux net quotidien des ETF spot BTC (M$ ? unité à vérifier T1 — l'échantillon 2738.489 ressemble à des BTC ou M$, TRANCHER sur pièces). **Usage : section ETF du panneau ON-CHAIN en REPLI quand SoSoValue est indisponible/401** (situation actuelle) : tuile flux du jour + sparkline 90 j + cumul 30 j. SoSoValue reste prioritaire s'il répond.
  - `hashrateBtc` (`hashrate`) : tuile + sparkline 120 j dans le panneau ON-CHAIN (section réseau), en TH/s formaté (« 918 EH/s »).
  - `oiFuturesParExchange` (`open-interest-futures`) : section repliable « OI BTC par exchange » dans la fenêtre DES (DerivativesWindow) : barres horizontales par exchange (dernier jour, $ formatés, part en %), delta vs J-7 teinté. Champs/exchanges découverts dynamiquement (les clés du JSON hors d/unixTs), tri décroissant.
- TTL : métriques quotidiennes → cache 24 h conservé ; les 3 nouvelles idem (données daily). Le quota 10/h absorbe largement le burst d'ouverture (16 métriques max, 1 fois/24 h chacune).
- Dégradation : proxy absent (dev sans vite ? impossible) / clé absente → l'API répond quand même (15/j IP) ; 429 → cache périmé servi (mécanique existante).

## 2. NETLIQ — période sélectionnable (`feat/netliq-periodes`)

- `Segmente` en-tête : `1 a | 2 a | 5 a | 10 a` (défaut 2 a, état persisté localStorage simple `axiom:netliq:fenetre`).
- `fetchSeriesNetliq(nowMs, annees)` : observation_start = nowMs − annees ; store : `fenetreAnnees` + `setFenetre` (change → re-fetch, cache TTL par fenêtre) ; stats delta 4 sem inchangées ; repères min/max = extrêmes de la fenêtre affichée (libellés « min/max fenêtre »).
- Overlay BTC : klines 1d plafonnées à 1000 par appel Binance → pour 5 a/10 a, PAGINER (arrière par endTime, mécanique cbprem) ou plafonner l'overlay à ~2.7 a avec mention — TRANCHER en T1 sur la limite réelle de l'API (limit max 1000) : paginer ≤4 pages est trivial, préférer la pagination.
- NoteSource : fenêtre affichée. Tooltip/étiquettes inchangés (les ticks s'adaptent d'eux-mêmes).

## 3. EXPY — journal de trades & expectancy (`feat/expy-journal`)

**But** : la brique fondatrice de l'axe journal — savoir si le trading de Zaki a une espérance positive, en R.

- **Modèle** (`packages/types` ou local web — local web suffit, mono-consommateur) : `TradeJournal { id, symbol, direction: "long"|"short", entree: number, sortie: number | null (trade ouvert), stopInitial: number, taille: number (unités), ouvertTs, fermeTs: number | null, note?: string, tags: string[] }`. Dérivés PURS : risque initial $ = |entree − stopInitial| × taille ; R réalisé = (sortie − entree) × taille × signe / risque initial (null si ouvert ou risque 0).
- **Stats pures** (`data/expy.ts`, TDD) : sur les trades FERMÉS — expectancy (moyenne des R), win rate, profit factor (ΣR+ / |ΣR−|), moyenne R gagnants/perdants, meilleur/pire R, nombre, équity cumulée en R (série ordonnée par fermeTs), répartition par tag et par symbole (nb + ΣR). Distribution des R : histogramme à buckets fixes ([-3,-2,-1,-0.5,0,0.5,1,2,3,5], bornes ouvertes aux extrêmes).
- **Fenêtre `EXPY`** (id `expy`, mnémonique `EXPY`, patron standard) :
  - En-tête : badges Expectancy (R, teinté ≥0/up <0/down), Win rate, Profit factor, N trades.
  - Corps : tableau des trades (fermés + ouverts, tri fermeTs desc ; colonnes symbole/direction/entrée/sortie/R teinté/tags/date ; ✕ suppression avec confirmation discrète ; clic symbole → chart) ; formulaire de saisie repliable (symbole prérempli avec celui du chart, direction, entrée, stop, taille, sortie optionnelle, tags libres) ; bouton « Clôturer » sur un trade ouvert (sortie préremplie au prix courant du chart si symbole identique).
  - Panes analytiques (canvas patron du repo) : équity cumulée en R + histogramme des R.
  - Export/import JSON (fichier téléchargé / input file), persistance localStorage `axiom:expy:v1` (tolérante).
- Zéro réseau. Pas d'intégration automatique portfolio/backtest en v1 (saisie manuelle assumée — l'import auto est un backlog explicite).

## 4. DIST — VaR en niveaux de prix (`feat/dist-var`)

**But** : « si je tiens ce trade H bougies, quel est mon pire scénario probable » — distribution empirique des rendements projetée en prix.

- **Calc pur** (`data/distVar.ts`, TDD) : à partir des candles du chart maître (celles déjà chargées, ≥ 300 requises) : rendements log 1-bougie ; pour chaque horizon h ∈ {1, 5, 20} : rendements h-bougies GLISSANTS (somme de fenêtres), quantiles empiriques q1/q5/q50/q95/q99 (interpolation linéaire, réutiliser `quantile` de squeezeWindow.util si import propre, sinon dupliquer localement), CVaR 95 (moyenne des rendements ≤ q5) ; projection : niveau = dernierClose × exp(q). Sortie par horizon : { h, niveaux: {p1,p5,p50,p95,p99}, cvar95Niveau, nEchantillons }.
- **Fenêtre `DIST`** (id `dist`, mnémonique `DIST`) : tableau par horizon (niveaux de prix formatés + % vs close, teintés), badge d'en-tête « VaR95 20b : −X % », note honnête (« distribution empirique des N dernières bougies TF <tf> — pas une prévision »), recalcul au changement de symbole/TF du chart (abonnement au store market, patron des fenêtres liées au chart — regarder comment CorrWindow/autres écoutent le symbole) + bouton Rafraîchir.
- **Overlay chart optionnel** (toggle dans la fenêtre, défaut OFF) : lignes horizontales p5/p95 (et p1/p99 plus discrètes) de l'horizon 20 bougies à droite du prix, patron des overlays existants (liquidationEstimates / niveaux) — étiquettes « VaR95 » / « VaR99 ». Si le patron overlay existant ne se prête pas à un ajout simple, v1 = fenêtre seule et overlay consigné backlog (décision au plan après lecture du code).
- Cas limites : < 300 bougies → message « historique insuffisant » ; TF changé → recalcul auto.

## 5. Cockpit DATA — observabilité des sources (`feat/data-cockpit`)

- **Fenêtre `DATA`** (id `data`, mnémonique `DATA`) lisant le `healthStore` EXISTANT (zéro nouvelle collecte) : une ligne par source connue — état (ok/polling/erreur, pastille couleur), dernier message/erreur (tronqué, title complet), fraîcheur (dernierMessageTs relatif), quota (barre utilisé/limite + fenêtre quand publié — ex. BGeometrics x/10 h, Coinalyze…).
- Tri : erreurs d'abord, puis par fraîcheur. En-tête : compteur « N sources · M en erreur » (badge down si M > 0). Rafraîchissement réactif (subscribe au store, pas de polling).
- Section « Caches » si un inventaire simple est lisible (TTL onchain connus) — SEULEMENT si l'info existe déjà sans nouvelle plomberie ; sinon omise (YAGNI, décision au plan).
- La ligne santé de la barre du bas reste inchangée ; la fenêtre est la vue détaillée.

## Contraintes globales

Français ; TDD sur logique pure ; tokens couleur ; paddings partagés ; dégradation gracieuse ; clés jamais dans le bundle ; `git -C` ; vérifications live (formats bitcoin-data, limite klines 1d) en T1 des branches concernées ; gates habituels + gate visuel par fenêtre. Registre indicateurs INCHANGÉ (aucun nouvel indicateur dans ce lot). Ordre : les 5 branches sont indépendantes (B1 toucher bgeometrics.ts/OnchainWindow/DES ; B2 netliq ; B3/B4/B5 fichiers neufs + greffes windowManager — conflits de greffe résolus au merge, ordre de merge B2 → B1 → B5 → B4 → B3 pour étaler les greffes windowManager.test).
