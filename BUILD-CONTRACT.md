# AXIOM — Contrat de build (à lire par CHAQUE agent avant d'écrire du code)

Ce fichier est la **source de vérité** des conventions et du périmètre. Il prime sur toute supposition.
Référence critique complète : `~/AXIOM-revue-critique-2026-06-26.md`.

> **Routage multi-modèles** : avant d'agir, lire aussi `.devin/provider-rules.md`
> (rôles d’orchestration, développement et revue indépendante ; aucun modèle
> exclusif ni visa Fable requis).

## Décisions verrouillées (branche PERSO mono-utilisateur)
- **Cible** : terminal pour UN utilisateur (ses propres clés). PAS de multi-tenant, PAS d'auth réseau, PAS de SaaS. Crypto d'abord (spot + perp) ; tradfi/commodités en complément.
- **Renderer-first** : le premier livrable à valeur est un graphe live à l'écran. **AUCUN backend réseau/multi-tenant (Docker/TimescaleDB/Redis interdits). Un daemon localhost mono-process (`apps/daemon`, Bun + SQLite, port 8787) est autorisé depuis la Phase 2 — proxy/cache/persistance/alertes UNIQUEMENT, jamais sur le chemin chaud du renderer (les WS de marché du front restent directs).** Le front parle directement aux WS publics des exchanges (mode mono-utilisateur assumé) et reste **100 % fonctionnel SANS daemon** (feature-detect `/health` + repli localStorage/proxy Vite). Déviation assumée vs roadmap E1 : les proxys Vite restent en dev (dev sans daemon), le daemon est le chemin de PROD + services additionnels.
- **Chart** : **KLineChart** figé (pas de lightweight-charts, pas d'abstraction `IChartRenderer` « swap de moteur »). L'overlay orderflow se synchronise sur le viewport de KLineChart. Multi-chart 2×2 : un store par slot ; les overlays doivent être scellés au slot (voir plan 2026-08-24, Lot 3).
- **Indicateurs** : **TS pur**, package `@axiom/indicators` = source de vérité unique (**200 indicateurs**). PAS de WASM, PAS de service Python. `pandas-ta-classic` peut servir d'oracle de référence en commentaire de test, mais AUCUNE dépendance runtime Python.
- **Données dérivées (OI/funding/L-S/liquidations)** : **ACHETER** via un `IDerivedDataProvider` (Coinalyze **câblé**, M6 atteint) — NE PAS construire d'AggregationEngine multi-exchange. Trois couches de liquidations distinctes et étiquetées : heatmap *exécutée*, niveaux **EST.** (modèle levier), niveaux **HL réels** (Hyperliquid, non exhaustif).
- **Trading** : **PAS d'exécution d'ordres** — aucune clé de trading. Le paper trading (`PAPER`) est une simulation locale (hors gate G100/K8). Ne rien implémenter qui touche à des clés de trading réelles.
- **Sources** : **9 identifiants** (`EXCHANGE_IDS` dans `@axiom/types`) — Binance, Bybit, OKX, Hyperliquid, Coinbase, Kraken, Twelve Data, MEXC, synthetic. Ne pas en ajouter sans nécessité démontrée (non-objectif avant G100).
- **Fournisseurs de capitalisation (exception ACTÉE le 2026-09-01, même statut que WHALES)** : l'historique TOTAL/TOTAL2/TOTAL3 et la fenêtre BPL sont servis par l'endpoint public `api.coinmarketcap.com/data-api` (sans clé, via `/extapi`), avec repli CryptoCompare/CCData `min-api.cryptocompare.com` (clé personnelle navigateur, route dédiée `/ccdataapi` daemon + Vercel) puis CoinGecko local. `EXCHANGE_IDS` reste à 9 (l'adaptateur de capitalisation est de source `synthetic`). Aucun autre fournisseur sans amendement du contrat (amendements : fournisseurs statistiques publics le 2026-09-06, CryptoQuant BASIC le 2026-09-16 — cf. « Extension autorisée le 16 septembre 2026 »).
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
- **200 indicateurs** TS purs dans `@axiom/indicators` (dont 30 stratégies étiquetées « non validé ») ; **4 golden tests** pandas-ta (ADX, SuperTrend, Ichimoku, PSAR) — le reste est couvert par tests unitaires/structurels.
- **39 fenêtres** à mnémonique (`WINDOW_REGISTRY`) — dont WHALES (mouvements baleines on-chain + positions top comptes Hyperliquid), ajoutée le 2026-08-25 sur décision utilisateur, et BPL (Bitcoin Power Law), ajoutée le 2026-09-01 avec les séries TOTAL/TOTAL2/TOTAL3 chartables (chantier CAP/BPL) : **écarts ASSUMÉS** au gel « aucune nouvelle fenêtre avant le verdict G100 » (§ ci-dessous).
- **Daemon** `axiomd` : proxy+cache SQLite, KV/snapshots, candles, alertes (macOS + Telegram), replay dumps Binance, couches GDELT/UCDP, LIQHL Hyperliquid paresseux, collecteur whales (blocs confirmés blockchain.info + Etherscan stables, table `whale_moves`, rétention 30 j). Bind `127.0.0.1:8787`, whitelist `/extapi`, garde Host/Origin/DNS-rebinding.
- **Vercel** : front + proxy serverless sans secret partagé, whitelist/MIME/DNS durcis. Les clés personnelles restent dans le navigateur. **Exception ACTÉE le 2026-09-14** (demande utilisateur, test communautaire) : une seule variable serveur, `BGEOMETRICS_API_KEY`, portée par `api/proxy.ts` vers bitcoin-data.com quand le client n'envoie aucune clé — clé gratuite et révocable, plafonds de l'offre gratuite (10 req/heure et 15 req/jour) partagés par les visiteurs, jamais exposée au navigateur ; toute autre clé reste personnelle (test structurel `apps/daemon/src/vercelProxy.test.ts`). Toute fonction strictement locale est marquée `UNUSABLE`, toute fenêtre partielle `PARTIAL` ; jamais de pane muet. La clé CryptoQuant (2026-09-16) relève de cette règle : personnelle, saisie dans les Réglages, repli `.env` pour le proxy Vite et le daemon `127.0.0.1` uniquement, JAMAIS de variable serveur sur Vercel (le test structurel continue d'exiger exactement une lecture d'environnement).
- **Paper trading** (`PAPER`) : moteur de simulation locale présent, hors gate G100.
- **Gate G100** : code-complete, e2e partiellement automatisés, **verdict manuel ouvert** (voir `docs/superpowers/plans/2026-07-22-gate-g100-qa.md` et plan d'action 2026-08-24). **Aucune nouvelle fenêtre ni fonctionnalité de surface avant le verdict** — des exceptions ACTÉES : le 2026-08-25 (fenêtre WHALES + alerte `whale-flux`, demande utilisateur explicite), le 2026-09-01 (fenêtre BPL + séries TOTAL/TOTAL2/TOTAL3 chartables, chantier CAP/BPL demandé par l'utilisateur) le 2026-09-02 (lot v2.7 « Décider » : alerte composite, backtest en R, coût d'exécution DOM — aucune fenêtre, aucun fournisseur, aucun indicateur, spec `docs/superpowers/specs/2026-09-02-lot-v27-decider-design.md`) et le 2026-09-04 (catalogue positionnement/orderflow et PLAY-POS, cf. Conventions), et le 2026-09-06 (onglet « Indicateurs » de la fenêtre RATE + trois fournisseurs statistiques publics sans clé — OCDE, Eurostat, ONS — au titre du remplacement des miroirs FRED internationaux démantelés ; spec `docs/superpowers/specs/2026-09-06-indicateurs-macro-mondiaux-design.md`), et le 2026-09-07 (fenêtre BPL : horizon de projection porté à +50 ans et navigation zoom/pan du graphe ; synchronisation des vues de la grille multi-chart — unités de temps, zoom/défilement, réticule — plan `docs/superpowers/plans/2026-09-07-synchronisation-multivue.md` ; demandes utilisateur explicites — aucune fenêtre, aucun fournisseur, aucun indicateur nouveau), et le 2026-09-14 (fenêtre BT : section « Tenue par moitié » — découpage walk-forward de lecture du run exécuté, `partagerResultatMoities` dans `@axiom/backtest`, frontière tracée sur l'équité ; excursions MAE/MFE par trade calculées par le moteur sur les barres détenues, colonnes de la table et moyennes de la grille ; demande utilisateur « nouvelle fonction pertinente » — aucune fenêtre, aucun fournisseur, aucun indicateur nouveau ; puis, le même jour, lot ON-CHAIN sur demande utilisateur « nouvelle fonction pertinente on-chain » + « Go » : sections « Mineurs » (Hash Ribbons SMA 30/60 j, hashprice) et « Activité DEX » (volume DEX 24 h, part du volume total) et tuile « Thermocap multiple » dans la fenêtre CHAIN, alerte globale `onchain-seuil` front-only sur six métriques quotidiennes — aucune fenêtre, aucun fournisseur (hôtes déjà autorisés : mempool.space, blockchain.info, Coin Metrics community, DefiLlama, CoinGecko), aucun indicateur graphique nouveau ; enfin, le même jour, chantier « indicateurs gratuits vérifiés » sur « Go pour tous les lots » du propriétaire après recherche sondée — cf. section « Chantier autorisé le 14 septembre 2026 » — aucune fenêtre, aucun fournisseur, aucun hôte, aucun indicateur graphique nouveau), et le 2026-09-16 (fournisseur CryptoQuant BASIC à clé personnelle sur décision du propriétaire : section repliable « Flux takers toutes places » dans DES et sous-section « Production des mineurs cotés » dans la section Mineurs de CHAIN — aucune fenêtre, aucun indicateur graphique, aucune dépendance, aucun hôte `/extapi` ; route dédiée `/cqapi` ; spec `docs/superpowers/specs/2026-09-16-cryptoquant-takers-mineurs-design.md`) ; le gel reste la règle pour toute autre surface.

## Jalons historiques (atteints — ne pas rejouer, ne pas prendre comme périmètre actuel)
- **M1 — Chart live** (`apps/web`) : Vite+React+TS+Tailwind ; client WS Binance + backfill REST ; rendu KLineChart live ; sélecteur symbole + timeframe ; crosshair. Store marché vanilla. **Atteint.**
- **M2 — Moteur + 7 indicateurs** (`packages/indicators`) : `IndicatorDef`/`engine.ts` (calcul, helpers SMA/EMA/RMA dans `utils.ts`) ; SMA, EMA, RSI, MACD, Bollinger Bands, Volume, VWAP avec tests vs valeurs de référence (Wilder pour RSI). **Atteint et dépassé** (le catalogue est à 189).
- M3 watchlist+persistance locale, M4 spike sync WebGL, M5 CVD+footprint (aggTrade), M6 `IDerivedDataProvider`→Coinalyze : **tous atteints.**

## Anti-objectifs (NE PAS faire)
- Ne pas créer de backend **réseau/multi-tenant**, de docker-compose, de schéma DB serveur (le daemon localhost mono-process de la Phase 2 est la SEULE exception, cf. Décisions verrouillées).
- **Avant le verdict G100** : pas de nouvelle fenêtre, pas de nouveau fournisseur sans remplacement direct d'une source défaillante (exceptions ACTÉES : fournisseurs de capitalisation CMC/CCData, fournisseurs statistiques publics OCDE/Eurostat/ONS le 2026-09-06, et CryptoQuant BASIC le 2026-09-16 sur décision explicite du propriétaire — **sans source défaillante remplacée**, l'exception est nommée comme telle — cf. Décisions verrouillées), pas de migration React/Vite/Zustand/KLineChart majeure (plan 2026-08-24, §12).
- Ne pas « améliorer » `@axiom/types` ni les configs racine.
- Ne pas étendre le catalogue d'indicateurs sans nécessité démontrée (le contrat est à 200, pas « plus de 7 » — l'ancien jalon M2 est historique, cf. ci-dessus).

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

## Extension autorisée le 9 septembre 2026

Le propriétaire demande la réalisation de tous les points de la revue globale et
a supprimé la réservation des rôles à Fable. Le plan courant est
`docs/superpowers/plans/2026-09-09-revue-integrale.md`. L’orchestrateur GPT peut
planifier et arbitrer ; les changements sont revus par un agent indépendant.

Sont autorisés dans les surfaces existantes : qualité par métrique, extensions
FRED/ALFRED, Treasury DTS, économie des chaînes, raccordements DefiLlama Pro
conditionnés à un accès personnel valide, outils d’évènements, microstructure,
gamma, WHALES et validation des signaux. Aucun achat, ordre réel, nouveau
backend, fenêtre supplémentaire ou recorder tick permanent. Les types locaux
et interfaces du package backtest peuvent évoluer de façon compatible ;
`@axiom/types` reste inchangé. Vitest **4.1.11** et le lockfile sont autorisés
pour le correctif de sécurité ; aucune nouvelle dépendance runtime. Les
absences de consensus, heure exacte, abonnement ou quantité sous-jacente
sont explicites. Le registre G100 conserve uniquement les contrôles réellement
exécutés et observés.

Précisions de réalisation :

- Le catalogue macro compte 24 familles et 88 définitions, dont 86 raccordées.
  Les données FRED révisées et les vues ALFRED connues à une date utilisent des
  caches distincts ; la date quotidienne ALFRED ne devient pas une heure d'annonce.
- Le relais DefiLlama Pro est limité à trois chemins GET validés. La clé
  personnelle n'entre ni dans le state, ni dans les exports/snapshots ; le relais
  retire son en-tête et ne suit pas de redirection. Sans droits, l'accès reste explicite.
- Le funding historique vérifié emploie les archives mensuelles Binance BTC/ETH,
  leur checksum et les échéances REST correspondantes. Le proxy autorise seulement
  les chemins précis `.zip`/`.CHECKSUM` de ces archives ; aucune cadence passée
  n'est déduite des seuls réglages actuels.
- DOM/EQS partagent un diagnostic du symbole maître, spot/CVD 5 minutes et OI
  perp en quantité. Il est retenu à la demande et réinitialisé aux discontinuités ;
  il n'ajoute pas de recorder permanent. Les trois signes gamma sont des hypothèses.
- Le budget initial prévu est bloquant : 1 220 000 octets bruts et 360 000 gzip
  niveau 9, imports statiques transitifs et préchargements dédupliqués. Les ressources
  chargées à la demande sont mesurées séparément. Vite/React/Zustand/KLineChart restent
  sur leurs versions de référence.

Les preuves à jour figurent dans le
[bilan du chantier](docs/superpowers/progress/2026-09-09-revue-integrale.md) ; les
résultats et la décision WTP du gate demeurent exclusivement dans son registre.

## Indicateur demandé le 11 septembre 2026

La demande du propriétaire ajoute « Cycle de la dette à long terme » dans
MACRO / RATE → Indicateurs. Le catalogue macro passe à **25 familles et
96 définitions, dont 94 raccordées** ; le catalogue technique reste à 189.
Les huit séries BIS/FRED `CAM770A` donnent le crédit total au secteur non
financier (public et privé) en % du PIB. Elles sont trimestrielles, en valeur
de marché, ajustées des ruptures et révisables. Aucun score ni datation
automatique du supercycle n’est déduit du ratio.

Cette famille dispose des horizons 30 ans, 60 ans et Max, avec couverture
réellement disponible par zone. Max peut inclure des dates avant 1970 ; les
bornes de chargement et d’affichage respectent aussi les vues ALFRED. La clé
FRED existante reste requise. Aucun nouveau fournisseur, proxy, backend,
dépendance ou fenêtre. Voir le
[plan et les sources](docs/superpowers/plans/2026-09-11-cycle-dette-long-terme.md)
et le [rapport de vérification](docs/superpowers/progress/2026-09-11-cycle-dette-long-terme.md).

## Chantier autorisé le 14 septembre 2026

Le propriétaire a donné son « Go pour tous les lots » après une recherche
sondée : requêtes HTTP réelles sans clé, vérification adversariale de chaque
candidat, douze fonctions retenues. Le chantier étend UNIQUEMENT des surfaces
existantes : chart maître (bandes de mouvement attendu implicite, niveaux clés
périodiques, niveaux d'options, ligne « Coût Strategy » — couches chargées à la
demande, chart maître seulement), OMON (options IBIT/ETHA du CBOE, mouvement
attendu par échéance, probabilités implicites, vol forward d'événement), TERM
(portage excédentaire basis − T-bill US), CYCLE (distance à l'ATH, modèles de
prix, correctifs du sommet des cycles passés et du repli MVRV), CHAIN (réseau
ETH et flux nets BTC des exchanges via Coin Metrics community, trésoreries
d'entreprises CoinGecko) et DES (open interest des perps DEX, DefiLlama).
**39 fenêtres, 189 indicateurs, 9 identifiants de marché, `@axiom/types`
inchangé, aucune dépendance.**

Aucun hôte nouveau : `cdn.cboe.com`, `www.deribit.com`, `api.binance.com`,
`community-api.coinmetrics.io`, `api.coingecko.com`, `api.llama.fi` et
`home.treasury.gov` sont déjà autorisés (liste `/extapi` ou appel direct à CORS
ouvert). Décisions du propriétaire : Coin Metrics community est admis pour le
réseau ETH (BGeometrics n'a pas d'ETH) et pour les **flux** nets BTC des
exchanges ; la réserve BTC des exchanges n'est pas affichée (dérive du périmètre
d'adresses). La règle « aucun substitut Coin Metrics » reste entière pour
MVRV-Z, SOPR, NUPL et Puell BTC, et CYCLE perd son repli `CapMVRVCur`.

Les limites sont affichées, jamais corrigées en silence : mouvement attendu et
probabilités = mesures risque-neutres, pas des prévisions ; options IBIT/ETHA
différées et fermées hors séance US ; avoirs des trésoreries non horodatés ; OI
DEX tous actifs, compté ≈ +29 % au-dessus de l'API Hyperliquid ; données Coin
Metrics « flash » révisables. Restent exclus sans nouvel amendement : l'OI
agrégé multi-venues (AggregationEngine interdit) et tout remplacement des
séries BGeometrics.

Le budget initial reste bloquant (1 220 000 octets bruts, 360 000 gzip ; marge
de départ 9 249 bruts et 3 179 gzip) : toute logique nouvelle vit dans des
chunks chargés à la demande. Voir le
[plan](docs/superpowers/plans/2026-09-14-indicateurs-gratuits.md).

## Extension autorisée le 16 septembre 2026

Le propriétaire a demandé d'implémenter les indicateurs et fonctions proposés
par la revue de la veille (« go implémenter les indicateurs et fonction
suggérés ») : dix indicateurs, trois fonctions et trois gains d'observabilité.
Le catalogue technique passe à **200 indicateurs** (190 + 10) ; les **39
fenêtres**, les **9 identifiants de marché**, `@axiom/types`, les dépendances et
la liste d'hôtes `/extapi` restent inchangés. Aucune nouvelle fenêtre.

Indicateurs ajoutés (TS pur, `@axiom/indicators`, un fichier et un test par def) :

| Id | Catégorie | Contenu et limite affichée |
|---|---|---|
| `vpin` | orderflow | Toxicité du flux par buckets de VOLUME (`|Σq|/V` moyen, q = split taker) ; approximations assumées : ordre intra-barre inconnu, split réparti proportionnellement — lit des régimes, pas un instant. Dépend du split taker : **UNUSABLE hors Binance**, comme le CVD |
| `cointegrationAdf` | statistical | Engle-Granger roulant vs `refClose` : t de l'ADF augmenté sur le résidu, repère −3,34 (5 %, N=2, constante — approximation de MacKinnon). Distribution non standard et biais de petit échantillon documentés |
| `spreadHalfLife` | statistical | Demi-vie de retour à la moyenne du spread log (barres) + β de couverture, même noyau (`utils-cointegration.ts`) |
| `corwinSchultz` | volatility | Spread effectif estimé sur les ranges de deux barres consécutives (borné à 0) ; sur carnet crypto à tick fin, l'historique est bruité — le DOM reste la référence instantanée |
| `amihudIlliq` | volume | Illiquidité d'Amihud (×10⁶), `|r|/DV` moyen, repli `close × volume` |
| `kyleLambda` | orderflow | λ de Kyle en points de base par unité de déséquilibre taker normalisé ; dépend du split taker → **UNUSABLE hors Binance** |
| `garmanKlassVol` | volatility | Estimateur OHLC (borne à 0 pour données incohérentes uniquement) |
| `rogersSatchellVol` | volatility | Estimateur OHLC sans dérive |
| `yangZhangVol` | volatility | Estimateur OHLC + saut overnight (variances de population, convention du package) |
| `skewKurt` | volatility | Skew et kurtosis d'excès des rendements log (garde de variance relative) |

Fonctions :

- **BT — mode intrabar** (`params.intrabar`, case à cocher, défaut OFF) : stop et
  objectif jugés sur le **high/low** des barres détenues, au niveau touché, ou à
  l'OPEN si la barre ouvre au-delà (gap) ; **stop prioritaire** si les deux sont
  touchés dans la même barre (convention conservatrice, OHLC ne dit pas l'ordre).
  Les sorties par RÈGLE gardent le modèle clôture → open+1. Défaut absent =
  résultats historiques reproductibles à l'identique ; `intrabar` entre dans la
  signature de run (résultat périmé si la case change).
- **BRIEF — concordance multi-échelle** : section « Concordance multi-échelle »
  (15 m / 1 h / 4 h / 1 j du symbole du chart) : tendance close vs EMA 50, RSI 14,
  ATR 14 en % et Δ sur 20 barres, avec compteur d'alignement. Lecture
  DESCRIPTIVE — un alignement n'est pas un signal ; une échelle en échec reste
  « — » sans invalider les autres.
- **Observabilité** : `/health` expose `collecteurs.whales` et
  `collecteurs.globe` (dernier rafraîchissement réussi GDELT/UCDP) en plus de
  `liquidations`, ainsi que `base.octets` (taille logique SQLite) — champs à 0 si
  la base est indisponible, la sonde ne casse jamais. Le proxy met un **hôte en
  quarantaine après un 429** (durée = `Retry-After`, secondes ou date HTTP,
  bornée à 15 min, repli 60 s), répond 429 localement pendant la quarantaine et
  **propage `retry-after`** au client (l'en-tête amont était perdu). La
  navigation des panneaux cible désormais le **slot focus** de la grille
  (slot 0 = maître inchangé ; slot secondaire = config du slot), au lieu de
  forcer le slot 0.

Budget : les additions coûtaient ~12,7 ko bruts au chemin d'entrée. Le
**contrôleur de heatmap des liquidations** (classe + commande LIQMODE + helpers
de couleur) est sorti du chunk d'entrée — commande déplacée vers
`chart/liquidationMarkers.ts`, helpers purs extraits dans `chart/rampesHeat.ts`,
classe chargée par `import()` à la **première activation** (défaut OFF) comme les
couches de niveaux. Mesure locale après intégration : **1 205 532 octets bruts et
355 386 gzip** (marges 14 468 / 4 614), soit ~10,5 ko bruts et ~3,2 ko gzip SOUS
la mesure d'avant chantier. Le plafond reste inchangé.

Limites à ne pas masquer : VPIN et λ de Kyle sont des mesures par bougies
(approximations du tick) et Binance-only ; la cointégration garde un biais de
petit échantillon et un repère critique approximatif ; le mode intrabar ne
simule ni l'ordre réel des touches ni la profondeur (le fill au niveau suppose
une exécution au prix du stop) ; la quarantaine 429 est par hôte et par
processus (pas de persistance).

### Fournisseur CryptoQuant BASIC (décision du propriétaire, 2026-09-16)

Le propriétaire a souscrit l'offre BASIC de CryptoQuant (licence PERSONNELLE ; 10 req/min ;
10 000 crédits/mois (15 par appel réussi observé le 2026-09-17) ; fenêtre journalière seule ;
30 jours glissants, `limit` ≤ 30, `from` antérieur à 30 j refusé ; aucune donnée on-chain,
réservée au plan Professional) et
demande son raccordement à deux sections existantes : **DES — « Flux takers toutes
places »** (agrégat multi-places `spot/trade` et `swap/trade`, `btc_all`/`eth_all` : ratio
taker achat/vente, Δ taker en quote, volumes, VWAP, lus contre l'historique accumulé côté
client) et **CHAIN — « Production des mineurs cotés »** dans la section Mineurs
(`miner-data/companies`, neuf sociétés : production J-1, cumul mensuel fournisseur, USD,
production déclarée quand publiée ; Σ et parts sont des sommes d'affichage).

Règles : (1) clé PERSONNELLE saisie dans les Réglages, exclue des exports
(`CLES_CREDENTIALS_LOCALES`), repli `CRYPTOQUANT_API_KEY` de `apps/web/.env` pour le proxy
Vite et le daemon lié à `127.0.0.1` uniquement, JAMAIS de variable serveur sur Vercel —
sans clé personnelle sur Vercel : aucun appel, « clé personnelle requise » ; la règle
« une seule variable serveur `BGEOMETRICS_API_KEY` » reste intacte. (2) Route dédiée
`/cqapi` à liste FERMÉE (`shared/cryptoquant-proxy.ts`) sur les trois chemins — Vite,
daemon, fonction Vercel — GET seul, `Authorization: Bearer` relayé, `private, no-store`,
zéro redirection, en-têtes `x-ratelimit-*` et `x-credit-cost` relayés ; aucun ajout à `shared/extapi-hosts.ts`,
CSP inchangée, aucune entrée de cache proxy (`TTL_SECONDES_PAR_PREFIXE` inchangé) :
l'archive côté client est le cache. (3) Archive CÔTÉ CLIENT : à l'ouverture des fenêtres,
le client fusionne les jours nouveaux dans une archive versionnée par série (localStorage
`axiom:onchain:cq:<serie>:v1` + KV daemon `onchain/cq:<serie>:v1`, union des deux, jamais
destructive, hors export/import de sauvegarde) ; la fenêtre fournisseur de 30 j sans
rattrapage impose d'afficher la date de début de l'archive, ses jours manquants et ses
jours définitivement perdus ; aucun collecteur daemon. Le COMPTEUR de crédits
`axiom:cryptoquant:credits:v1` (valeur `{ "v": 1, "jours": {…} }`, élagué à 31 jours UTC,
écriture additive sur la valeur stockée pour que deux onglets comptent tous deux) est un
état LOCAL au navigateur : exclu de l'export comme la clé, ni écrasé ni purgé à l'import
(`ETATS_LOCAUX_NON_EXPORTES` de `apps/web/src/store/persist.ts`) — c'est ce qui rend vraie
la mention « par navigateur » de la règle (4). (4) Requêtes toujours
`window=day&limit=30` sans `from` ; cadencement client 10 req/min visible (« en attente du
quota »), garde « J-1 déjà archivé → aucun appel » et reprise 12 h (amendement §13,
2026-09-17), plafond de sécurité de 9 000 crédits sur une fenêtre glissante de 31 jours UTC
(par navigateur), 402 explicite à crédits mensuels épuisés — ≈ 195 crédits par passe
DES + CHAIN ; plafond 9 000 / 31 j. (5) L'agrégat multi-places du fournisseur est CONSOMMÉ tel
quel — aucun AggregationEngine, spot et perp jamais additionnés, composition des places non
documentée et affichée comme limite. (6) BGeometrics reste la source unique de MVRV-Z,
SOPR, NUPL et Puell : CryptoQuant n'y est jamais substitué et ne fournit ici aucune
métrique de valorisation. (7) Aucune fenêtre (39), aucun indicateur graphique (200),
aucune dépendance, `EXCHANGE_IDS` à 9 ; tout code nouveau vit dans des chunks chargés à la
demande ; le budget initial reste bloquant (1 220 000 octets bruts, 360 000 gzip), mesures
avant/après consignées dans le rapport du lot. Exclus sans nouvel amendement : toute autre
série CryptoQuant, toute substitution de BGeometrics, tout collecteur daemon, tout
AggregationEngine.

Limites à ne pas masquer : dernière ligne = J-1 ; composition des places « cross-exchange
aggregate » non documentée ; sémantique de `base_volume`/`vwap` pour les swaps inverses et
de `reported_production`/`report_accuracy` non confirmée (affichées brutes, sans écart
calculé) ; `accumulated_monthly_rewards` est le cumul du fournisseur (non recalculé) ;
l'archive dépend de l'usage (pas de collecteur) et, sur un poste sans daemon, vider le
stockage du navigateur la perd.
