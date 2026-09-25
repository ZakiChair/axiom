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
- **Indicateurs** : **TS pur**, package `@axiom/indicators` = source de vérité unique (**214 indicateurs** depuis le 2026-09-23, cf. « Quatre lots complémentaires du 23 septembre 2026 »). PAS de WASM, PAS de service Python. `pandas-ta-classic` peut servir d'oracle de référence en commentaire de test, mais AUCUNE dépendance runtime Python.
- **Données dérivées (OI/funding/L-S/liquidations)** : **ACHETER** via un `IDerivedDataProvider` (Coinalyze **câblé**, M6 atteint) — NE PAS construire d'AggregationEngine multi-exchange. Trois couches de liquidations distinctes et étiquetées : heatmap *exécutée*, niveaux **EST.** (modèle levier), niveaux **HL réels** (Hyperliquid, non exhaustif). Depuis le 2026-09-21, la heatmap exécutée reçoit aussi une venue `hyperliquid` **PARTIELLE** (fills des makers suivis, couverture mesurée affichée — cf. « Corrections et extension demandées le 21 septembre 2026 »). Depuis le 2026-09-22, la couche HL réels est aussi une **heatmap temps × prix des instantanés** collectés par le daemon (opt-in, couverture mesurée en % de l'OI — cf. « Revue et extension du 22 septembre 2026 »).
- **Trading** : **PAS d'exécution d'ordres** — aucune clé de trading. Le paper trading (`PAPER`) est une simulation locale (hors gate G100/K8). Ne rien implémenter qui touche à des clés de trading réelles.
- **Sources** : **9 identifiants** (`EXCHANGE_IDS` dans `@axiom/types`) — Binance, Bybit, OKX, Hyperliquid, Coinbase, Kraken, Twelve Data, MEXC, synthetic. Ne pas en ajouter sans nécessité démontrée (non-objectif avant G100).
- **Fournisseurs de capitalisation (exception ACTÉE le 2026-09-01, même statut que WHALES)** : l'historique TOTAL/TOTAL2/TOTAL3 et la fenêtre BPL sont servis par l'endpoint public `api.coinmarketcap.com/data-api` (sans clé, via `/extapi`), avec repli CryptoCompare/CCData `min-api.cryptocompare.com` (clé personnelle navigateur, route dédiée `/ccdataapi` daemon + Vercel) puis CoinGecko local. `EXCHANGE_IDS` reste à 9 (l'adaptateur de capitalisation est de source `synthetic`). Aucun autre fournisseur sans amendement du contrat (amendements : fournisseurs statistiques publics le 2026-09-06, CryptoQuant BASIC le 2026-09-16 — cf. « Extension autorisée le 16 septembre 2026 »).
- **Fournisseurs statistiques publics (exception ACTÉE le 2026-09-06, même statut que les fournisseurs de capitalisation)** : trois sources publiques sans clé API — OCDE (`sdmx.oecd.org`), Eurostat (`ec.europa.eu`), ONS (`www.ons.gov.uk`) — admis en appel DIRECT avec vérification des en-têtes CORS, sans ajout à `shared/extapi-hosts.ts`. Remplacent des miroirs FRED internationaux défaillants (CPI zone euro arrêté en 2023, CPI japonais en 2021, M2 chinois en 2019) avec des `last_updated` trompeurs. `EXCHANGE_IDS` reste à 9 (aucun adaptateur marché n'est impliqué). Cf. `docs/superpowers/specs/2026-09-06-indicateurs-macro-mondiaux-design.md`.

## Conventions

**Simplification demandée le 23 septembre 2026 :** le propriétaire demande une revue
du projet et la sélection automatique des sources selon l'actif. Les fournisseurs
restent les neuf identifiants existants. La recherche, les slots et le constructeur
de ratios ne demandent plus de choisir un fournisseur ; le routage garde la devise
et la nature de l'instrument, et affiche la provenance effective. Aucun repli spot
vers perpétuel, ni action vers action tokenisée. Les erreurs, conditions d'accès et
capacités manquantes restent explicites. Les paramètres de calcul OHLC, les clés
personnelles et la provenance historique conservent leur sens. Voir la
[conception](docs/superpowers/specs/2026-09-23-sources-automatiques-design.md).

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
- **214 indicateurs** TS purs dans `@axiom/indicators` (dont 30 stratégies étiquetées « non validé ») ; **4 golden tests** pandas-ta (ADX, SuperTrend, Ichimoku, PSAR) — le reste est couvert par tests unitaires/structurels.
- **39 fenêtres** à mnémonique (`WINDOW_REGISTRY`) — dont WHALES (mouvements baleines on-chain + positions top comptes Hyperliquid), ajoutée le 2026-08-25 sur décision utilisateur, et BPL (Bitcoin Power Law), ajoutée le 2026-09-01 avec les séries TOTAL/TOTAL2/TOTAL3 chartables (chantier CAP/BPL) : **écarts ASSUMÉS** au gel « aucune nouvelle fenêtre avant le verdict G100 » (§ ci-dessous).
- **Daemon** `axiomd` : proxy+cache SQLite, KV/snapshots, candles, alertes (macOS + Telegram), replay dumps Binance, couches GDELT/UCDP, LIQHL Hyperliquid paresseux, collecteur whales (blocs confirmés blockchain.info + Etherscan stables, table `whale_moves`, rétention 30 j). Bind `127.0.0.1:8787`, whitelist `/extapi`, garde Host/Origin/DNS-rebinding.
- **Vercel** : front + proxy serverless sans secret partagé, whitelist/MIME/DNS durcis. Les clés personnelles restent dans le navigateur. **Exception ACTÉE le 2026-09-14** (demande utilisateur, test communautaire) : une seule variable serveur, `BGEOMETRICS_API_KEY`, portée par `api/proxy.ts` vers bitcoin-data.com quand le client n'envoie aucune clé — clé gratuite et révocable, plafonds de l'offre gratuite (10 req/heure et 15 req/jour) partagés par les visiteurs, jamais exposée au navigateur ; toute autre clé reste personnelle (test structurel `apps/daemon/src/vercelProxy.test.ts`). Toute fonction strictement locale est marquée `UNUSABLE`, toute fenêtre partielle `PARTIAL` ; jamais de pane muet. La clé CryptoQuant (2026-09-16) relève de cette règle : personnelle, saisie dans les Réglages, repli `.env` pour le proxy Vite et le daemon `127.0.0.1` uniquement, JAMAIS de variable serveur sur Vercel (le test structurel continue d'exiger exactement une lecture d'environnement).
- **Paper trading** (`PAPER`) : moteur de simulation locale présent, hors gate G100.
- **Gate G100** : code-complete, e2e partiellement automatisés, **verdict manuel ouvert** (voir `docs/superpowers/plans/2026-07-22-gate-g100-qa.md` et plan d'action 2026-08-24). **Aucune nouvelle fenêtre ni fonctionnalité de surface avant le verdict** — des exceptions ACTÉES : le 2026-08-25 (fenêtre WHALES + alerte `whale-flux`, demande utilisateur explicite), le 2026-09-01 (fenêtre BPL + séries TOTAL/TOTAL2/TOTAL3 chartables, chantier CAP/BPL demandé par l'utilisateur) le 2026-09-02 (lot v2.7 « Décider » : alerte composite, backtest en R, coût d'exécution DOM — aucune fenêtre, aucun fournisseur, aucun indicateur, spec `docs/superpowers/specs/2026-09-02-lot-v27-decider-design.md`) et le 2026-09-04 (catalogue positionnement/orderflow et PLAY-POS, cf. Conventions), et le 2026-09-06 (onglet « Indicateurs » de la fenêtre RATE + trois fournisseurs statistiques publics sans clé — OCDE, Eurostat, ONS — au titre du remplacement des miroirs FRED internationaux démantelés ; spec `docs/superpowers/specs/2026-09-06-indicateurs-macro-mondiaux-design.md`), et le 2026-09-07 (fenêtre BPL : horizon de projection porté à +50 ans et navigation zoom/pan du graphe ; synchronisation des vues de la grille multi-chart — unités de temps, zoom/défilement, réticule — plan `docs/superpowers/plans/2026-09-07-synchronisation-multivue.md` ; demandes utilisateur explicites — aucune fenêtre, aucun fournisseur, aucun indicateur nouveau), et le 2026-09-14 (fenêtre BT : section « Tenue par moitié » — découpage walk-forward de lecture du run exécuté, `partagerResultatMoities` dans `@axiom/backtest`, frontière tracée sur l'équité ; excursions MAE/MFE par trade calculées par le moteur sur les barres détenues, colonnes de la table et moyennes de la grille ; demande utilisateur « nouvelle fonction pertinente » — aucune fenêtre, aucun fournisseur, aucun indicateur nouveau ; puis, le même jour, lot ON-CHAIN sur demande utilisateur « nouvelle fonction pertinente on-chain » + « Go » : sections « Mineurs » (Hash Ribbons SMA 30/60 j, hashprice) et « Activité DEX » (volume DEX 24 h, part du volume total) et tuile « Thermocap multiple » dans la fenêtre CHAIN, alerte globale `onchain-seuil` front-only sur six métriques quotidiennes — aucune fenêtre, aucun fournisseur (hôtes déjà autorisés : mempool.space, blockchain.info, Coin Metrics community, DefiLlama, CoinGecko), aucun indicateur graphique nouveau ; enfin, le même jour, chantier « indicateurs gratuits vérifiés » sur « Go pour tous les lots » du propriétaire après recherche sondée — cf. section « Chantier autorisé le 14 septembre 2026 » — aucune fenêtre, aucun fournisseur, aucun hôte, aucun indicateur graphique nouveau), et le 2026-09-16 (fournisseur CryptoQuant BASIC à clé personnelle sur décision du propriétaire : section repliable « Flux takers toutes places » dans DES et sous-section « Production des mineurs cotés » dans la section Mineurs de CHAIN — aucune fenêtre, aucun indicateur graphique, aucune dépendance, aucun hôte `/extapi` ; route dédiée `/cqapi` ; spec `docs/superpowers/specs/2026-09-16-cryptoquant-takers-mineurs-design.md`) ; le gel reste la règle pour toute autre surface.

## Jalons historiques (atteints — ne pas rejouer, ne pas prendre comme périmètre actuel)
- **M1 — Chart live** (`apps/web`) : Vite+React+TS+Tailwind ; client WS Binance + backfill REST ; rendu KLineChart live ; sélecteur symbole + timeframe ; crosshair. Store marché vanilla. **Atteint.**
- **M2 — Moteur + 7 indicateurs** (`packages/indicators`) : `IndicatorDef`/`engine.ts` (calcul, helpers SMA/EMA/RMA dans `utils.ts`) ; SMA, EMA, RSI, MACD, Bollinger Bands, Volume, VWAP avec tests vs valeurs de référence (Wilder pour RSI). **Atteint et dépassé** (le catalogue est désormais à 214).
- M3 watchlist+persistance locale, M4 spike sync WebGL, M5 CVD+footprint (aggTrade), M6 `IDerivedDataProvider`→Coinalyze : **tous atteints.**

## Anti-objectifs (NE PAS faire)
- Ne pas créer de backend **réseau/multi-tenant**, de docker-compose, de schéma DB serveur (le daemon localhost mono-process de la Phase 2 est la SEULE exception, cf. Décisions verrouillées).
- **Avant le verdict G100** : pas de nouvelle fenêtre, pas de nouveau fournisseur sans remplacement direct d'une source défaillante (exceptions ACTÉES : fournisseurs de capitalisation CMC/CCData, fournisseurs statistiques publics OCDE/Eurostat/ONS le 2026-09-06, et CryptoQuant BASIC le 2026-09-16 sur décision explicite du propriétaire — **sans source défaillante remplacée**, l'exception est nommée comme telle — cf. Décisions verrouillées), pas de migration React/Vite/Zustand/KLineChart majeure (plan 2026-08-24, §12).
- Ne pas « améliorer » `@axiom/types` ni les configs racine.
- Ne pas étendre le catalogue d'indicateurs sans nécessité démontrée (le contrat est à 214, pas « plus de 7 » — l'ancien jalon M2 est historique, cf. ci-dessus).

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
  objectif jugés sur toutes les barres détenues, **dernière barre comprise**.
  Un niveau franchi à l'OPEN (gap) est exécuté à l'OPEN avant les touches high/low ;
  sinon, exécution au niveau touché et **stop prioritaire** si les deux sont
  touchés dans la même barre (convention conservatrice, OHLC ne dit pas l'ordre).
  Pour une sortie certaine à l'OPEN, MAE/MFE retiennent le prix exécuté (slippage
  inclus) et excluent les extrêmes ultérieurs de la barre de sortie.
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
métrique de valorisation. (6 bis) Découvrabilité (décision du propriétaire, 2026-09-18) :
DEUX entrées de NAVIGATION vers ces sections déjà livrées — `CQTAKR` (groupe « Marché &
dérivés ») et `CQMINE` (« On-chain & stablecoins ») — dans le menu « Fonctions » ET dans la
palette ⌘K ; un clic ouvre la fenêtre hôte (DES / CHAIN), déplie la section visée et la fait
défiler à l'écran, badge « nouveau » jusqu'au premier clic. AUCUNE fenêtre nouvelle (le
registre reste à 39), aucun indicateur, aucun appel `/cqapi` de plus : le client charge au
montage de la fenêtre, jamais au dépliage. (7) Aucune fenêtre (39), aucun indicateur graphique (200),
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

## Corrections et extension demandées le 21 septembre 2026

Le propriétaire a signalé des chiffres « longs/shorts piégés » incohérents et demandé que les
liquidations proviennent d'Hyperliquid, intégrées « de façon lisible et belle » au graphe.
**39 fenêtres, 200 indicateurs, 9 identifiants de marché, aucune dépendance, `@axiom/types`
inchangé.**

1. **Volume piégé (`trappedVolume`) — calcul corrigé** (`59452a2`). L'indicateur distribuait le
   volume TOTAL de chaque bougie de part et d'autre du close courant : au plus haut 24 h de
   BTCUSDT 15m, 100 % du volume de la fenêtre était déclaré « shorts piégés ». Il ne compte plus
   que le volume **agressif** (taker) : `trappedLong = Σ buyVolume × fracAbove`,
   `trappedShort = −Σ sellVolume × (1 − fracAbove)` ; bougie sans split ignorée, fenêtre sans
   aucun split → `undefined`. Dépend du split taker → **UNUSABLE hors Binance** (comme CVD,
   VPIN, λ de Kyle). Le champ existant `IndicatorOutput.color` est désormais honoré par le pont
   KLineChart (`couleurDeclaree`) : `--down` au nord, `--up` au sud.
2. **Bulles de clusters de liquidations (`LIQBUL`)** (`c7c254f`). Une bulle PAR CELLULE de la
   grille agrégée (≥ P70 des totaux, rayon ∝ √USD, côté dominant, étiquettes des 4 plus
   grosses), dessinée dans le contrôleur de heatmap déjà chargé à la demande — aucun module
   nouveau dans le chunk d'entrée ; bascule persistée (défaut ON), bouton « Bulles » de la
   fenêtre LIQ, mini-légende. Budget d'entrée mesuré : 356 432 / 360 000 octets gzip.
3. **Source Hyperliquid des liquidations exécutées — minage officiel PARTIEL** (décision du
   propriétaire parmi trois options ; plan
   `docs/superpowers/plans/2026-09-21-liquidations-hyperliquid.md`). Hyperliquid n'a **aucun
   flux public de liquidations** ; elles n'existent que dans les fills des adresses impliquées.
   Le daemon (`apps/daemon/src/hlLiqFeed.ts`, ingestion À FROID, même statut que le collecteur
   Bybit/OKX) suit sur **une** WS officielle les `trades` des coins surveillés pour classer les
   makers, puis les `userFills` du vault HLP Liquidator et des **9** makers les mieux classés
   (10 utilisateurs uniques = plafond HL ; rotation 5 min avec hystérésis ; aucun appel REST) ;
   chaque fill portant `liquidation.liquidatedUser` devient une ligne `liquidations` de venue
   `hyperliquid` (convention de côté figée par test). Le front la consomme par
   `GET /liquidations/:symbole?venue=hyperliquid` toutes les 30 s (jamais de dual-write
   retour). Règles d'honnêteté : santé `partiel: true` avec `couverture` MESURÉE (part du
   volume maker absorbée par les adresses suivies) affichée dans la fenêtre LIQ (« N adresses
   suivies · couverture ≈ X % · différé ≤ 30 s ») ; une venue partielle est **exclue** du
   calcul « collecteur muet » (la mort de Bybit + OKX reste visible et déclenche le repli
   Coinalyze) ; jamais présentée comme exhaustive ; indisponible sans daemon (Vercel). Aucun
   fournisseur nouveau (Hyperliquid est l'un des 9), aucun AggregationEngine (une seule venue,
   consommée telle quelle), aucune fenêtre, aucun indicateur. Preuve réelle du 2026-09-21 :
   10 souscriptions `userFills` acceptées sans `error` HL, couverture mesurée ≈ 48–50 % du flux
   makers (BTC/ETH/SOL, 30 min). Budget d'entrée mesuré après le lot : **356 979 / 360 000
   octets gzip** (marge 3 021, au seuil de vigilance I11 ≈ 3 000) : le prochain lot touchant le
   chemin d'entrée doit d'abord libérer des octets.

## Revue et extension du 22 septembre 2026

Le propriétaire a demandé une revue d'AXIOM, l'intégration « correcte » des liquidations Hyperliquid
sur le graphe (carte thermique) et de nouveaux indicateurs on-chain depuis les sources déjà admises ;
il a validé les trois lots proposés (plan `docs/superpowers/plans/2026-09-22-heatmap-hl-indicateurs-onchain.md`,
rapport `docs/superpowers/progress/2026-09-22-heatmap-hl-indicateurs-onchain.md`). **39 fenêtres,
210 indicateurs, 9 identifiants de marché, aucune dépendance, aucun fournisseur nouveau.**

1. **Défauts corrigés par la revue.** (a) Les couches LIQEST/LIQHL restaient MUETTES après un
   changement de symbole ou un rechargement tant que LIQMARK n'avait jamais été activée : le contrôleur
   de heatmap partagé n'était instancié que par LIQMARK — il l'est désormais dès qu'UNE des trois
   bascules est active. (b) LIQHL est persistée (`sessionUi.liqHl`) comme LIQEST. (c) La heatmap
   exécutée ne dépend plus uniquement de l'uptime du daemon : quand le collecteur est vivant mais que
   des JOURS UTC de la fenêtre de 7 j n'ont aucun événement réel, le repli Coinalyze (approx) comble
   CES jours seulement (jour courant exclu) et la légende l'annonce (« Coinalyze ≈ sur N j »). (d) Le
   premier `/hl/liqlevels` après le boot attendait la construction de l'instantané et mourait au
   `idleTimeout` Bun de 10 s (porté à 120 s ; un instantané en vol sert le cache périmé sans attendre).
2. **Heatmap Hyperliquid des niveaux de liquidation RÉELS** (couche LIQHL, décision du propriétaire :
   collecteur daemon opt-in). Le daemon (`apps/daemon/src/hlLiqHeat.ts`) prend toutes les 5 min un
   instantané des positions du pool et l'écrit dans `hl_liq_instantanes` (une ligne par coin surveillé
   — mêmes symboles que le collecteur de liquidations —, niveaux `[px, side, usd]`, totaux long/short,
   OI HL du coin via `metaAndAssetCtxs`, adresses scannées ; rétention 14 j). La collecte n'existe que
   si le drapeau KV `hl/heat` vaut `{ actif: true }` — posé par l'activation de LIQHL, retirable depuis
   la fenêtre LIQ (« Collecte daemon ») : sans drapeau, aucun leaderboard (34 Mo) ni requête de compte.
   Le **pool** passe de « top‑150 par `accountValue` » à « top‑150 `accountValue` ∪ top‑350 volume
   hebdomadaire » (≤ 500 adresses, `clearinghouseState` 4 en vol / 100 ms → ≈ 50 s par instantané,
   ≈ 200 poids/min en moyenne sous le quota 1 200 ; un 429 interrompt l'instantané) : mesure du
   2026-09-22 sur BTC, 18 → 114 positions à `liquidationPx` exploitable et **couverture ≈ 23 % de l'OI
   HL** (formule affichée : `(Σ long + Σ short) / (2 × OI)`, l'OI comptant un côté). Route
   `GET /hl/liqheat/:coin?depuis&jusqua&pas` (dernier instantané par seau `pas`, ≤ 2 000). Le front
   (`data/hyperliquidHeat.ts`, chunk paresseux) peint les instantanés en cellules temps × prix (rampe
   AMBRE distincte du viridis des liquidations exécutées, dernier instantané ≤ fin de bougie, report
   ≤ 2 pas, colonne vide au-delà), garde les barres du dernier instantané au bord droit, et affiche
   « HL HEATMAP (niveaux réels) — N instantanés · X adresses · couverture ≈ Y % OI · pas … · T trous =
   daemon éteint ». Règles d'honnêteté : ÉCHANTILLON du leaderboard jamais présenté comme exhaustif ;
   trous d'historique = daemon éteint, visibles ; indisponible sans daemon (Vercel). Aucun
   AggregationEngine (une venue, ses positions telles quelles), aucune fenêtre, `EXCHANGE_IDS` à 9.
   La fenêtre WHALES, qui lit le même instantané, voit donc désormais « gros comptes ET gros tradeurs ».
   Correction du 23 septembre : l'acquisition partagée ne contient aucun repli vers un ancien
   instantané. Ce repli reste disponible pour l'affichage, avec sa date d'origine. Le collecteur
   forcé n'archive rien en cas d'échec total ; les lignes et le dernier succès portent la date
   d'observation `inst.ts`, jamais celle de la relecture. Zéro adresse observée reste un échec ;
   des comptes observés sans positions sur un coin produisent un instantané vide valide.
   Extension du 25 septembre (demande du propriétaire : « toutes les liquidations disponibles »,
   précisée en « pool d'adresses scannées porté à ~1 500 ») : le pool devient **1 500 adresses
   cibles** — top 500 `accountValue` complété par le classement volume hebdomadaire sans doublon
   (`TAILLE_POOL`, `N_VALEUR_POOL`) ; le pool persisté `hl/pool` porte ses paramètres (un pool
   d'autres paramètres est retéléchargé, mais reste le repli si l'amont échoue). Cadence : quota
   officiel 1 200 poids/min/IP, `clearinghouseState` = 2 ; le scan est plafonné à 900 poids/min
   (marge laissée au navigateur, même IP) → un lot de 4 au plus toutes les 534 ms, ≈ 200 s par
   scan (calculé, non mesuré ; arrêt au premier 429 conservé). Une lecture `/hl/liqlevels` ou
   `/hl/positions` n'attend plus jamais un scan quand un cache existe, même périmé (servi, scan
   relancé en fond) ; sans aucun cache, elle attend au plus 15 s puis répond 503
   `{ enConstruction: true }` + `Retry-After: 30` — la couche LIQHL reste « chargement » et la
   fenêtre WHALES affiche « instantané en construction », toutes deux relancent toutes les 30 s.
   Le collecteur forcé attend toujours son point neuf. Cela reste un **échantillon** du
   leaderboard : l'interface annonce « N adresses », jamais « toutes » les liquidations.
3. **Dix indicateurs** (TS pur, `@axiom/indicators`, un fichier et un test par def, catalogue 200 →
   210). Séries aux ajoutées à `AuxSeriesId` (`@axiom/types`, écart signalé comme aux lots précédents) :
   `liqLongUsd`, `liqShortUsd`, `hashrate`, `sthMvrv`, `lthMvrv`, `nrplUsd`, `vddMultiple`, `aviv`,
   `supplyProfit`, `supplyLoss`, `hlFunding`, `hlWhalesNet`.

   | Id | Contenu et limite affichée |
   |---|---|
   | `liqParBougie` | Liquidations par bougie (Coinalyze `liquidation-history` à l'intervalle du chart, flux apparié 1:1) : histogrammes shorts (+) / longs (−) + net. Clé Coinalyze requise, perp Binance, intervalle non couvert → UNUSABLE |
   | `hashRibbons` | Hash Ribbons : RATIO SMA 30 / SMA 60 du hashrate (mempool.space, sans quota — croisement lu au passage par 1,0 ; valeurs absolues dans CHAIN) + régime (−1 capitulation, +1 reprise 10 barres, 0). BTC, ≥ 1d, 1 an d'historique |
   | `mvrvCohortes` | MVRV STH / LTH (BGeometrics `sth-mvrv`, `lth-mvrv`). BTC, ≥ 1d |
   | `nrpl` | Profits / pertes réalisés nets USD (BGeometrics `nrpl-usd`) : histogrammes signés + SMA 7. BTC, ≥ 1d |
   | `vddMultiple` | VDD Multiple (BGeometrics). BTC, ≥ 1d |
   | `aviv` | AVIV (BGeometrics). BTC, ≥ 1d |
   | `offreEnProfit` | % de l'offre en profit = `100 × sp / (sp + sl)` (BGeometrics `supply-profit`/`supply-loss`, défs et cache partagés avec CHAIN). BTC, ≥ 1d |
   | `hlFunding` | Funding Hyperliquid annualisé (`fundingHistory`, horaire, appel direct, multi-actif HL) |
   | `fundingSpreadHl` | Écart de funding HL − Binance en points de % annualisés (`(hl_h − binance_h) × 24 × 365 × 100`), cadence Binance observée dans l'historique — correction du 23 septembre ci-dessous |
   | `hlWhalesNet` | Positionnement net des gros comptes HL suivis, `100 × (L − S) / (L + S)` par instantané du collecteur. Daemon + collecte requis ; échantillon (couverture en légende HL) |

   Règles : les cinq séries BGeometrics nouvelles sont chargées à la demande (pose de l'indicateur),
   cache 24 h, fenêtre 4 ans (offre gratuite), champ JSON vérifié par un appel réel chacun ; elles
   consomment le même quota 15/j que CHAIN — un utilisateur qui pose tout le catalogue le même jour
   atteint le plafond et voit « quota » (jamais un pane muet). BGeometrics reste la source unique de
   MVRV-Z, SOPR, NUPL et Puell ; Coin Metrics n'y est pas substitué. Aucune série CryptoQuant.
4. **Budget d'entrée.** Préalable obligatoire (marge 3 021 o gzip avant le chantier) : `AlertsPanel`
   chargé par `React.lazy` (comme les fenêtres) et `data/backtestFunding` en `import()` au premier
   run — 1 210 126 / 356 979 → 1 176 378 / 347 934 (bruts / gzip). Mesure après les trois lots :
   **1 187 537 / 350 745** (marges 32 463 / 9 255 ; plafond 1 220 000 / 360 000 inchangé et
   bloquant). `pnpm check` vert : indicators 1 450, alerts 76, backtest 109, daemon 679, web 4 792.

Limites à ne pas masquer : la heatmap HL n'a d'historique que quand le daemon tourne avec le drapeau
posé (trous affichés) et ne voit que les positions dont `liquidationPx` est exploitable (les comptes
en marge croisée très collatéralisés en sont absents) ; la couverture est mesurée, pas garantie ;
`hlWhalesNet` lit le même échantillon ; `liqParBougie` dépend de la profondeur d'historique que
Coinalyze accorde à chaque intervalle (règle mesurée dans `auxProvider.ts`) ; le régime Hash Ribbons
est une lecture descriptive, pas un signal validé.

## Corrections de la revue du 23 septembre 2026

Le propriétaire a autorisé la correction des quatre défauts vérifiés : dernière bougie du
backtest, risque initial PAPER → EXPY, fraîcheur des instantanés Hyperliquid et cadence du
spread de funding HL − Binance. Les changements préexistants du dépôt sont conservés.

- **BT** : le mode intrabar traite aussi la dernière barre détenue, même si l'entrée vient
  d'être exécutée à son ouverture. Les gaps sont traités avant les touches high/low ; MAE/MFE
  n'intègrent pas les mouvements postérieurs à une sortie certaine à l'ouverture. Le mode
  sans intrabar conserve son comportement ; l'ordre inconnu des touches intrabar reste une
  convention de simulation, pas une reconstruction du flux de transactions.
- **PAPER → EXPY** : `PositionPaper.stopInitial` est fixé lors de la première exécution,
  persisté et conservé après déplacement/suppression du stop ou renfort. `null` signifie
  absence de stop à l'ouverture ; un champ absent signifie ancienne position sans preuve.
  Ces deux cas donnent un R indéfini à l'export, avec une note pour le cas historique.
  Après renfort, le R du trade fusionné utilise le prix moyen et la taille totale avec ce
  stop de référence ; il ne représente pas le R isolé de la première tranche. Aucun ancien
  trade déjà exporté dans EXPY n'est réécrit.
- **Hyperliquid** : l'archive exige une acquisition neuve ; le repli de cache est réservé
  à l'affichage. La santé et les lignes utilisent la date originale de l'observation.
  Aucun ancien instantané en base n'est supprimé ou corrigé rétroactivement.
- **Écart de funding HL − Binance** : l'auxiliaire dédié `binanceFundingHourly` lit les
  règlements Binance USDⓈ-M via le transport `extUrl` existant, dans un module chargé à
  la demande. Cet ajout étroit à `AuxSeriesId` remplace la jambe `funding` mixte
  Coinalyze/Binance pour cet indicateur seulement. Après deux intervalles précédents
  concordants de 1, 2, 4 ou 8 h, le taux par règlement est ramené à l'heure. Une tolérance
  de 60 s reconnaît les décalages d'horodatage sans déplacer l'instant de publication.
  Cadence incertaine, taux invalide ou règlement spécial donnent une valeur inconnue ;
  une valeur expire au prochain règlement attendu, sans report à travers le trou.
  La dernière bougie en cours est lue au plus à l'instant présent. Aucun intervalle
  actuel de `fundingInfo` n'est appliqué au passé. La mention **cadence observée** reste
  visible : cette inférence n'est pas un historique certifié des changements de cadence.

Validation finale : **7 283 tests** et typechecks/build verts (`pnpm check`), parcours
Chromium backtest réussi, quatre lots acceptés en revue indépendante. Budget initial
**1 204 408 / 356 368 octets** (bruts/gzip), plafonds inchangés. Détails et limites :
`docs/revue-2026-09-23-quatre-corrections.md`.

## Quatre lots complémentaires du 23 septembre 2026

Le propriétaire a précisé « Les quatre lots, avec les ajouts ». Le périmètre est
décrit dans `docs/superpowers/specs/2026-09-23-quatre-lots-design.md` et exécuté par
`docs/superpowers/plans/2026-09-23-quatre-lots.md`. Cette autorisation couvre les
extensions ci-dessous dans les surfaces existantes : **214 indicateurs, 39 fenêtres,
9 identifiants de marché**, aucune dépendance, infrastructure ou exécution réelle.
Les changements utilisateur préexistants restent conservés et séparés dans les preuves.

- **Durabilité locale** : NOTE et EXPY conservent une mutation et la saisie en mémoire
  après un échec d'écriture, exposent l'erreur et un réessai idempotent. Réessayer ne
  change ni le prix ni la date métier et ne crée pas de doublon. Le succès local est
  distinct de l'acquittement d'un miroir daemon différé.
- **BT** : le run calcule et archive une copie immuable de sa configuration de départ.
  Versions nommées et historique synthétique sont limités chacun à 50 entrées, sans
  éviction silencieuse. Pas d'OHLC, de courbe ni de liste d'exécutions persistés dans
  cette archive. Profit factor infini encodé explicitement ; deltas uniquement sur
  marchés/sources/intervalles/bornes identiques, différences de coûts et capital signalées.
- **Dossiers** : preuve compacte capturée au signal, puis thèse, invalidation et revue
  dans EXPY. Un ancien signal reste partiel. La préparation PAPER est un brouillon ;
  les ordres exigent encore la validation utilisateur. Provenance explicite verrouillée
  et prix isolés par source ; aucun mélange legacy/source explicite ni conversion
  silencieuse d'instrument. Les liens `decisionIds` sont unis au renfort, puis conservés
  à la clôture avec `stopInitial`. Limite de 100 dossiers sans éviction silencieuse.
- **Indicateurs** : `liquidationsOi`, `downsideCorrelation`, `downsideBeta` et
  `fundingDispersion`. Contrat financier et oracles :
  `docs/superpowers/specs/2026-09-23-indicateurs-contrat.md`. Liquidations et OI sont
  en USD sur le même perp Binance et le même intervalle Coinalyze, OI observé juste
  avant le bucket. Les moments baissiers utilisent les rendements logarithmiques
  exactement appariés et les seules baisses de la référence, sans combler les trous.
  Les auxiliaires dédiés `oiDebutLiqUsd`, `refCloseStrict`, `fundingHistBinance`,
  `fundingHistBybit`, `fundingHistOkx`, `fundingHistHl` sont autorisés dans `@axiom/types`.
- **FUNDX** : historique demandé 7/30/90 jours, clients partagés chargés à la demande,
  règlements réalisés et expiration causale des taux horaires. APR = taux horaire ×
  24 × 365 × 100 ; dispersion population sur les quatre places fixes Binance, Bybit,
  OKX et Hyperliquid. Une place inconnue rend σ/min/max inconnus ; couverture et trous
  restent visibles. La période demandée n'est pas une promesse de rétention amont.
- **Expiration** : date optionnelle commune au moteur, navigateur, daemon et scans.
  À `now >= expireTs`, aucune évaluation ni demande exclusive de flux ; une demande
  partagée reste active. Date invalide rejetée, pause/reprise sans renouvellement,
  prolongation explicite. Les demandes CVD d'alertes restent transitoires, distinctes
  des choix du graphique (`enabled` persisté, `cvdSpotPerp` conservé en session).
  Contrat détaillé :
  `docs/superpowers/specs/2026-09-23-expiration-contrat.md`.
- **Usage** : favoris d'indicateurs, 12 récents maximum, recherche et disponibilité
  combinables ; ajout effectif avant mise à jour des récents. DATA propose des actions
  vérifiées pour chaque capacité (vue propriétaire, réglages, documentation fixe ou
  rechargement existant) et affiche leur résultat. Les plafonds d'entrée web restent
  **1 220 000 octets bruts / 360 000 gzip** ; charger les menus à l'ouverture.

Clés personnelles nouvelles : `axiom:backtest:history:v1`,
`axiom:decisionDossiers:v1`, `axiom:indicatorPreferences:v1`. Les historiques BT,
dossiers et état PAPER sont inclus dans le périmètre de sauvegarde personnelle.
Aucun credential n'y est ajouté. Les archives BT et dossiers locaux illisibles sont
conservés pour export avant une écriture de remplacement, jamais effacés silencieusement.

Validation finale de ces ajouts : **7 416 tests**, typage et build réussis (`pnpm check`),
**127/127 parcours Chromium** réussis (`pnpm check:e2e`), dont 24 nouveaux. Les sept
tâches et leurs interfaces sont acceptées en revue indépendante. Budget initial final :
**1 206 551 / 357 464 octets** (bruts/gzip), plafonds inchangés. Aucune dépendance ni
règle de proxy ajoutée ; changements préexistants conservés, aucun commit ou déploiement.
Les tests navigateur utilisent des réponses simulées et ne valent pas verdict manuel
G100. Le daemon utilisateur reste sur son processus initial ; redémarrage nécessaire
pour charger le nouveau code serveur. Rapport : `docs/revue-2026-09-23-quatre-lots.md`.


## Analyse multidomaine autorisée le 23 septembre 2026

Après la proposition de huit fonctions complémentaires, le propriétaire a demandé
« Go pour les points mentionnés ». Le périmètre est décrit dans la
[conception](docs/superpowers/specs/2026-09-23-analyse-multidomaine-design.md),
le [plan](docs/superpowers/plans/2026-09-23-analyse-multidomaine.md) et le
[contrat de calcul](docs/superpowers/specs/2026-09-23-analyse-multidomaine-contrat.md).

Cette exception de surface couvre les quadrants croissance/inflation de RATE,
la stabilité du coût d’exécution dans DOM, la rotation de la cohorte fixe de
CHAIN, les scénarios de transmission de GLOBE, une synthèse datée dans BRIEF,
l’association multifacteur de SCEN, le carry net dans FUNDX et les résultats
EXPY par contexte figé au signal. Les 39 fenêtres, 214 indicateurs et neuf
identifiants de marché restent inchangés ; aucun fournisseur, secret, service
ou dépendance supplémentaire n’est autorisé par ce chantier.

Les nouveaux panneaux sont chargés à la demande. Le registre partagé conserve
uniquement des lectures bornées avec source, période, fraîcheur et preuve. La
capture au signal est synchrone et ne charge jamais rétrospectivement une donnée.
Les calculs descriptifs, données révisées, hypothèses de scénario et observations
réellement disponibles demeurent identifiables. Les limites de bundle initial
restent 1 220 000 octets bruts et 360 000 octets gzip.


## Corrections demandées le 24 septembre 2026

Le propriétaire a signalé que « certains actifs prennent énormément de temps à
charger » et que les « longs et shorts piégés semblent toujours incohérents »
(second signalement après le 21 septembre), puis demandé correction, fusion et
déploiement. **39 fenêtres, 214 indicateurs, 9 identifiants de marché, aucune
dépendance, aucun hôte ni fournisseur, aucune règle de proxy modifiée,
`@axiom/types` inchangé.** Rapport : `docs/revue-2026-09-24-chargement-pieges.md`.

1. **Chargement des actifs.** Causes mesurées : tout backfill crypto attendait
   les huit catalogues (`Promise.allSettled`, jusqu'à 12 s si une place était
   muette) sans servir le cache périmé ; le catalogue Coinbase partait en direct
   sans CORS, donc toujours « indisponible », cache ramené à 30 s ; exchangeInfo
   Binance complet (17,6 Mo) ; file Twelve Data 8/60 s sans annulation, où le
   backfill abandonnait à 20 s une requête qui partait quand même plus tard.
   Corrections : catalogue servi périmé et rafraîchi en fond, republication
   seulement si son contenu change, échec d'une source mémorisé 30 s sans perdre
   son dernier succès ; résolution progressive (à froid, seule la provenance ou
   Binance est attendue) ; essai spéculatif borné à 4 s ; Coinbase par `/extapi`
   (hôte déjà admis) ; exchangeInfo `symbolStatus=TRADING&showPermissionSets=false`
   (mêmes 1 372 symboles, 2,5 Mo) ; file Twelve Data FIFO à deux priorités
   (graphe devant cotations et polls), annulable, crédits d'une cotation groupée
   réservés d'un coup, délai du backfill armé à l'obtention du créneau, message
   « Quota Twelve Data : prochain créneau dans N s », refus immédiat sans clé en
   appel direct (Vercel). Mesures au navigateur (Chrome, API réelles, serveur
   Vite de dev), main → branche : démarrage à froid 1 084 → 748 ms ; place muette
   (simulée par surcharge de `fetch`) 12,5 s → 0,8 s ; ouverture après expiration
   du cache (simulée par `Date.now` + 6 min) 698-994 → 257-510 ms. En inactivité
   réelle de 6 min, main ne bloquait pas (270 contre 284 ms) : ses boucles de fond
   gardaient le catalogue chaud. Limite assumée : une provenance dont l'hôte est
   entièrement muet coûte 4 s avant le repli.
2. **Watchlist.** Les synthétiques (TOTAL, TOTAL2, TOTAL3) et les ratios
   entretenaient une boucle de 30 s qui resondait tous les favoris. Ils sont
   désormais résolus sans prix ; les confirmations de source valent pour la
   session ; la sonde OKX vise un seul instrument (`ticker?instId=`) ; le ticker
   Coinbase passe par `/extapi`. Trafic de fond mesuré : 15,1 → 3,8 requêtes/min.
3. **Provenance.** Voir l'amendement de
   `docs/superpowers/specs/2026-09-23-sources-automatiques-design.md` : Binance
   confirmé passe devant une provenance enregistrée au comptant. `store/market.ts`
   (héritage de `setSymbol`) est inchangé : le routage tranche.
4. **Volume piégé (`trappedVolume`) — nouveau modèle.** Le modèle du 21 septembre
   n'était qu'un miroir du profil de volume (corrélation 0,996-1,000 avec un split
   50/50 ou permuté ; au plus bas 24 h, jusqu'à 100 % de tout le volume acheteur
   déclaré piégé ; en 1h, en médiane 130-220 % de l'OI Binance, maxima 350-870 %).
   Il suit maintenant le
   delta agresseur NET par bougie (`buy − sell`), réparti sur `[low, high]`. Une
   tranche est libérée quand le prix revient à son niveau après être passée sous
   l'eau : `(close_{k−1}, high_k]` pour un long, `[low_k, close_{k−1})` pour un
   short. Son poids vaut `1 − âge/length` sur `(i−length, i]`. Le calcul se fait
   en une passe avant, invariante par préfixe. Il est vérifié par trois
   réimplémentations indépendantes (écart ≤ 1e-9). Id, clés
   `trappedLong`/`trappedShort`, couleurs et `length = 96` sont conservés. L'input
   est renommé « Horizon (barres) » ; l'indicateur passe en précision 2. Les
   valeurs baissent d'un facteur qui croît avec l'unité de temps (médianes à
   horizon 96 : ~30× en 5m, ~45× en 15m, 60-120× en 1h, ~200× en 4h et 1d) : les
   **seuils d'alerte existants sur ces clés sont à recalibrer au cas par cas,
   jamais par un facteur unique**. Le croisement d'indicateur ne propose plus
   `trappedVolume`, car longs et shorts sont de signes opposés. L'histogramme
   n'est pas plus lisse : il dépend du chemin du prix.
5. **Panes sans valeur.** Un indicateur UNUSABLE n'est plus tracé. Son en-tête
   de pane (ou la légende d'overlay) affiche la raison. Un résultat sans valeur
   finie affiche « indisponible » avec sa cause, par exemple « Historique
   insuffisant : 74 bougies, horizon 96 » en 1M. Pendant l'extension de session,
   aucun recalcul par page ni sur tick : un seul recalcul après sa réapplication
   finale (un indicateur ajouté pendant l'extension reste calculé sur le buffer
   étendu, comportement préexistant). Les grands nombres négatifs sont abrégés comme
   les positifs (formateur symétrique installé à `init`, qui sert aussi CVD, OI,
   macro et revenus).

Validation : **7 010 tests** (indicateurs 838, alertes 62, backtest 114, daemon
695, web 5 301), typage et build réussis ; **139/139 parcours Chromium** deux fois
de suite sur `1f9383a`. Le test FUNDX « expire une source perp âgée » attend
désormais la cotation actualisée avant d'avancer l'horloge : il contenait une
course préexistante (2 à 3 échecs sur 5 sur main). Revues indépendantes par lot,
revue finale sous quatre angles et vérification factuelle de ces documents.
Budget d'entrée : la mesure gzip dépend de la version de zlib. Le Node 26 local
(zlib 1.2.12) mesurait 359 667 octets gzip ; la CI (Node 22, zlib 1.3.x) et
Node 24 mesuraient 361 075, donc un dépassement. Il est corrigé par `ebd74eb` :
`App.tsx` importait tout `store/backtest` (archive, historique, signature ; 23,5 Ko
bruts) pour la seule commande BT de la palette. Cette commande bascule désormais
la fenêtre par le gestionnaire, et le store se charge avec `BacktestWindow`, déjà
différée. Le garde-fou `src/chargementInitial.test.ts` interdit son retour dans le
chemin initial. Budget final : **1 189 319 octets bruts ; 354 431 octets gzip en
zlib 1.3.1 (référence CI), 353 099 en zlib 1.2.12**. Plafonds 1 220 000 / 360 000
inchangés. **Toujours mesurer le budget avec un zlib 1.3.x** (par exemple Node 24 :
`PATH=<node24>/bin:$PATH pnpm --filter @axiom/web build`) : le Node 26 local
sous-estime d'environ 1,3 Ko. Déploiement : ne
plus lancer `vercel build` dans le checkout principal. Il écrase
`apps/web/dist`, que le daemon sert (bundle Vercel en local : Twelve Data en
direct sans la clé `.env`, WHALES et Replay coupés). Déployer par build distant,
puis reconstruire `dist` par `pnpm --filter @axiom/web build`.
