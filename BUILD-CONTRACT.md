# AXIOM — Contrat de build (à lire par CHAQUE agent avant d'écrire du code)

Ce fichier est la **source de vérité** des conventions et du périmètre. Il prime sur toute supposition.
Référence critique complète : `~/AXIOM-revue-critique-2026-06-26.md`.

> **Amendement du 30 septembre 2026 — clés par défaut en ligne :** la demande
> explicite du propriétaire autorise désormais les clés des onze fournisseurs
> existants en variables serveur Vercel. Elle remplace les restrictions historiques
> « BGeometrics seulement » et « aucun repli CryptoQuant sur Vercel » ci-dessous.
> Le propriétaire conserve expressément le lien public sans connexion et accepte
> que ses visiteurs puissent consommer les quotas. Voir la section dédiée en fin
> de document ; aucune valeur de clé ne doit être envoyée au navigateur.

> **Routage multi-modèles** : avant d'agir, lire aussi `.devin/provider-rules.md`
> (rôles d’orchestration, développement et revue indépendante ; aucun modèle
> exclusif ni visa Fable requis).

## Décisions verrouillées (branche PERSO mono-utilisateur)
- **Cible** : terminal pour UN utilisateur (ses propres clés). PAS de multi-tenant, PAS d'auth réseau, PAS de SaaS. Crypto d'abord (spot + perp) ; tradfi/commodités en complément.
- **Renderer-first** : le premier livrable à valeur est un graphe live à l'écran. **AUCUN backend réseau/multi-tenant (Docker/TimescaleDB/Redis interdits). Un daemon localhost mono-process (`apps/daemon`, Bun + SQLite, port 8787) est autorisé depuis la Phase 2 — proxy/cache/persistance/alertes UNIQUEMENT, jamais sur le chemin chaud du renderer (les WS de marché du front restent directs).** Le front parle directement aux WS publics des exchanges (mode mono-utilisateur assumé) et reste **100 % fonctionnel SANS daemon** (feature-detect `/health` + repli localStorage/proxy Vite). Déviation assumée vs roadmap E1 : les proxys Vite restent en dev (dev sans daemon), le daemon est le chemin de PROD + services additionnels.
- **Chart** : **KLineChart** figé (pas de lightweight-charts, pas d'abstraction `IChartRenderer` « swap de moteur »). L'overlay orderflow se synchronise sur le viewport de KLineChart. Multi-chart 2×2 : un store par slot ; les overlays doivent être scellés au slot (voir plan 2026-08-24, Lot 3).
- **Indicateurs** : **TS pur**, package `@axiom/indicators` = source de vérité unique (**221 indicateurs** depuis le 2026-11-07, cf. « Outils d'analyse et sources (autorisation du 7 novembre 2026) » ; 220 au 2026-10-19 avec AXIS S/R, 219 au 2026-10-07, cf. « AXIS — confluence de signaux (demande du 7 octobre 2026) » ; 218 au 2026-10-01, 215 au 2026-09-26). PAS de WASM, PAS de service Python. `pandas-ta-classic` peut servir d'oracle de référence en commentaire de test, mais AUCUNE dépendance runtime Python.
- **Données dérivées (OI/funding/L-S/liquidations)** : **ACHETER** via un `IDerivedDataProvider` (Coinalyze **câblé**, M6 atteint) — NE PAS construire d'AggregationEngine multi-exchange. Trois couches de liquidations distinctes et étiquetées : heatmap *exécutée*, niveaux **EST.** (modèle levier), niveaux **HL réels** (Hyperliquid, non exhaustif). Depuis le 2026-09-21, la heatmap exécutée reçoit aussi une venue `hyperliquid` **PARTIELLE** (fills des makers suivis, couverture mesurée affichée — cf. « Corrections et extension demandées le 21 septembre 2026 »). Depuis le 2026-09-22, la couche HL réels est aussi une **heatmap temps × prix des instantanés** collectés par le daemon (opt-in, couverture mesurée en % de l'OI — cf. « Revue et extension du 22 septembre 2026 »).
- **Trading** : **PAS d'exécution d'ordres** — aucune clé de trading. Le paper trading (`PAPER`) est une simulation locale (hors gate G100/K8). Ne rien implémenter qui touche à des clés de trading réelles.
- **Sources** : **9 identifiants** (`EXCHANGE_IDS` dans `@axiom/types`) — Binance, Bybit, OKX, Hyperliquid, Coinbase, Kraken, Twelve Data, MEXC, synthetic. Ne pas en ajouter sans nécessité démontrée (non-objectif avant G100).
- **Fournisseurs de capitalisation (exception ACTÉE le 2026-09-01, même statut que WHALES)** : l'historique TOTAL/TOTAL2/TOTAL3 et la fenêtre BPL sont servis par l'endpoint public `api.coinmarketcap.com/data-api` (sans clé, via `/extapi`) — de même, SANS repli, la dominance des stablecoins `STABLE.D` (2026-10-29, cf. section « Dominance des stablecoins ») —, avec repli CryptoCompare/CCData `min-api.cryptocompare.com` (clé personnelle navigateur, route dédiée `/ccdataapi` daemon + Vercel) puis CoinGecko local. `EXCHANGE_IDS` reste à 9 (l'adaptateur de capitalisation est de source `synthetic`). Aucun autre fournisseur sans amendement du contrat (amendements : fournisseurs statistiques publics le 2026-09-06, CryptoQuant BASIC le 2026-09-16 — cf. « Extension autorisée le 16 septembre 2026 » —, Wikimedia (pages vues Wikipédia) le 2026-11-07 — cf. « Outils d'analyse et sources (autorisation du 7 novembre 2026) »).
- **Fournisseurs statistiques publics (exception ACTÉE le 2026-09-06, même statut que les fournisseurs de capitalisation)** : trois sources publiques sans clé API — OCDE (`sdmx.oecd.org`), Eurostat (`ec.europa.eu`), ONS (`www.ons.gov.uk`) — admis en appel DIRECT avec vérification des en-têtes CORS, sans ajout à `shared/extapi-hosts.ts`. Remplacent des miroirs FRED internationaux défaillants (CPI zone euro arrêté en 2023, CPI japonais en 2021, M2 chinois en 2019) avec des `last_updated` trompeurs. `EXCHANGE_IDS` reste à 9 (aucun adaptateur marché n'est impliqué). Cf. `docs/superpowers/specs/2026-09-06-indicateurs-macro-mondiaux-design.md`.
- **Fournisseur d'attention publique (exception ACTÉE le 2026-11-07, même statut que les fournisseurs statistiques publics)** : pages vues quotidiennes Wikipédia par l'API REST Wikimedia (`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/…`), sans clé, en appel DIRECT du navigateur (en-tête `Api-User-Agent` générique, repli en requête simple si le pré-vol est refusé), sans ajout à `shared/extapi-hosts.ts` ni au proxy Vercel ou daemon ; hôte exact `https://wikimedia.org` ajouté à `connect-src` (CSP Report-Only de `vercel.json`). **Aucune source défaillante remplacée** : l'exception est nommée comme telle (cf. « Outils d'analyse et sources (autorisation du 7 novembre 2026) »). `EXCHANGE_IDS` reste à 9.

## Conventions

**Simplification demandée le 23 septembre 2026 :** le propriétaire demande une revue
du projet et la sélection automatique des sources selon l'actif. Les fournisseurs
restent les neuf identifiants existants. La recherche, les slots et le constructeur
de ratios ne demandent plus de choisir un fournisseur ; le routage garde la devise
et la nature de l'instrument, et affiche la provenance effective. Aucun repli spot
vers perpétuel, ni action vers action tokenisée. Les erreurs, conditions d'accès et
capacités manquantes restent explicites. Les paramètres de calcul OHLC, les clés
personnelles et la provenance historique conservent leur sens. Depuis le
26 septembre 2026, pour un même instrument au comptant, la place retenue est celle
qui affiche le plus d'historique à l'unité de temps demandée (cf. « Profondeur
d'historique (demande du 26 septembre 2026) »). Voir la
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
- **221 indicateurs** TS purs dans `@axiom/indicators` (dont 32 stratégies ; AXIS, ajoutée le 2026-10-07, est la première **testée favorable** sur données jamais vues — v1 recalée le matin même, v2 validée le soir, `scripts/axis/` ; AXIS S/R, 220e, le 2026-10-19 ; `primeVol`, 221e, le 2026-11-07) ; **4 golden tests** pandas-ta (ADX, SuperTrend, Ichimoku, PSAR) — le reste est couvert par tests unitaires/structurels.
- **39 fenêtres** à mnémonique (`WINDOW_REGISTRY`) — dont WHALES (mouvements baleines on-chain + positions top comptes Hyperliquid), ajoutée le 2026-08-25 sur décision utilisateur, et BPL (Bitcoin Power Law), ajoutée le 2026-09-01 avec les séries TOTAL/TOTAL2/TOTAL3 chartables (chantier CAP/BPL) : **écarts ASSUMÉS** au gel « aucune nouvelle fenêtre avant le verdict G100 » (§ ci-dessous).
- **Daemon** `axiomd` : proxy+cache SQLite, KV/snapshots, candles, alertes (macOS + Telegram), replay dumps Binance, couches GDELT/UCDP, LIQHL Hyperliquid paresseux, collecteur whales (blocs confirmés blockchain.info + Etherscan stables, table `whale_moves`, rétention 30 j). Bind `127.0.0.1:8787`, whitelist `/extapi`, garde Host/Origin/DNS-rebinding.
- **Vercel** : front + proxy serverless sans secret partagé, whitelist/MIME/DNS durcis ; depuis le 2026-09-25, fonction `api/hlpool.ts` sans secret (pool réduit LIQHL, CDN 6 h). Les clés personnelles restent dans le navigateur. **Exception ACTÉE le 2026-09-14** (demande utilisateur, test communautaire) : une seule variable serveur, `BGEOMETRICS_API_KEY`, portée par `api/proxy.ts` vers bitcoin-data.com quand le client n'envoie aucune clé — clé gratuite et révocable, plafonds de l'offre gratuite (10 req/heure et 15 req/jour) partagés par les visiteurs, jamais exposée au navigateur ; toute autre clé reste personnelle (test structurel `apps/daemon/src/vercelProxy.test.ts`). Toute fonction strictement locale est marquée `UNUSABLE`, toute fenêtre partielle `PARTIAL` ; jamais de pane muet. La clé CryptoQuant (2026-09-16) relève de cette règle : personnelle, saisie dans les Réglages, repli `.env` pour le proxy Vite et le daemon `127.0.0.1` uniquement, JAMAIS de variable serveur sur Vercel (le test structurel continue d'exiger exactement une lecture d'environnement).
- **Paper trading** (`PAPER`) : moteur de simulation locale présent, hors gate G100.
- **Gate G100** : code-complete, e2e partiellement automatisés, **verdict manuel ouvert** (voir `docs/superpowers/plans/2026-07-22-gate-g100-qa.md` et plan d'action 2026-08-24). **Aucune nouvelle fenêtre ni fonctionnalité de surface avant le verdict** — des exceptions ACTÉES : le 2026-08-25 (fenêtre WHALES + alerte `whale-flux`, demande utilisateur explicite), le 2026-09-01 (fenêtre BPL + séries TOTAL/TOTAL2/TOTAL3 chartables, chantier CAP/BPL demandé par l'utilisateur) le 2026-09-02 (lot v2.7 « Décider » : alerte composite, backtest en R, coût d'exécution DOM — aucune fenêtre, aucun fournisseur, aucun indicateur, spec `docs/superpowers/specs/2026-09-02-lot-v27-decider-design.md`) et le 2026-09-04 (catalogue positionnement/orderflow et PLAY-POS, cf. Conventions), et le 2026-09-06 (onglet « Indicateurs » de la fenêtre RATE + trois fournisseurs statistiques publics sans clé — OCDE, Eurostat, ONS — au titre du remplacement des miroirs FRED internationaux démantelés ; spec `docs/superpowers/specs/2026-09-06-indicateurs-macro-mondiaux-design.md`), et le 2026-09-07 (fenêtre BPL : horizon de projection porté à +50 ans et navigation zoom/pan du graphe ; synchronisation des vues de la grille multi-chart — unités de temps, zoom/défilement, réticule — plan `docs/superpowers/plans/2026-09-07-synchronisation-multivue.md` ; demandes utilisateur explicites — aucune fenêtre, aucun fournisseur, aucun indicateur nouveau), et le 2026-09-14 (fenêtre BT : section « Tenue par moitié » — découpage walk-forward de lecture du run exécuté, `partagerResultatMoities` dans `@axiom/backtest`, frontière tracée sur l'équité ; excursions MAE/MFE par trade calculées par le moteur sur les barres détenues, colonnes de la table et moyennes de la grille ; demande utilisateur « nouvelle fonction pertinente » — aucune fenêtre, aucun fournisseur, aucun indicateur nouveau ; puis, le même jour, lot ON-CHAIN sur demande utilisateur « nouvelle fonction pertinente on-chain » + « Go » : sections « Mineurs » (Hash Ribbons SMA 30/60 j, hashprice) et « Activité DEX » (volume DEX 24 h, part du volume total) et tuile « Thermocap multiple » dans la fenêtre CHAIN, alerte globale `onchain-seuil` front-only sur six métriques quotidiennes — aucune fenêtre, aucun fournisseur (hôtes déjà autorisés : mempool.space, blockchain.info, Coin Metrics community, DefiLlama, CoinGecko), aucun indicateur graphique nouveau ; enfin, le même jour, chantier « indicateurs gratuits vérifiés » sur « Go pour tous les lots » du propriétaire après recherche sondée — cf. section « Chantier autorisé le 14 septembre 2026 » — aucune fenêtre, aucun fournisseur, aucun hôte, aucun indicateur graphique nouveau), et le 2026-09-16 (fournisseur CryptoQuant BASIC à clé personnelle sur décision du propriétaire : section repliable « Flux takers toutes places » dans DES et sous-section « Production des mineurs cotés » dans la section Mineurs de CHAIN — aucune fenêtre, aucun indicateur graphique, aucune dépendance, aucun hôte `/extapi` ; route dédiée `/cqapi` ; spec `docs/superpowers/specs/2026-09-16-cryptoquant-takers-mineurs-design.md`), et le 2026-09-26 (ratios ÷ marchés et devises, cf. section dédiée), et le 2026-11-07 (chantier « outils d'analyse et sources » sur « Go pour tes suggestions » du propriétaire : surfaces nouvelles dans des fenêtres existantes — graphe, EQS, DIST, BRIEF, CAP, CORR, OMON, CYCLE —, indicateur `primeVol`, identifiant aux `dvol`, fournisseur Wikimedia en appel direct ; aucune fenêtre nouvelle ; cf. section « Outils d'analyse et sources (autorisation du 7 novembre 2026) »), et le 2026-11-11 (chantier « AXIS lisible, honnête et annonciateur » sur « poursuis l'amélioration d'AXIS » : affichages ajoutés dans des surfaces existantes — seconde ligne au bord droit et pré-signal d'AXIS S/R, « inactives » au bandeau de session et ligne « alertes » du registre santé — ; aucune fenêtre, aucun fournisseur, aucun indicateur, aucune dépendance, aucun type nouveau ; cf. section « AXIS — lisible, honnête et annonciateur (demande du 11 novembre 2026) »), et le 2026-11-12 (phase 2 d'AXIS, lot 1, sur la même demande : affichages ajoutés dans des surfaces existantes — texte de l'annotation visée dans l'encart O/H/L/C du graphe au téléphone, avis d'alerte qui reste jusqu'au toucher, libellés, états et note du panneau des alertes — ; aucune fenêtre, aucun fournisseur, aucun indicateur, aucune dépendance, aucun type nouveau ; cf. section « AXIS au téléphone — texte complet sous le doigt et alertes visibles (phase 2, lot 1, 12 novembre 2026) ») ; le gel reste la règle pour toute autre surface.

## Jalons historiques (atteints — ne pas rejouer, ne pas prendre comme périmètre actuel)
- **M1 — Chart live** (`apps/web`) : Vite+React+TS+Tailwind ; client WS Binance + backfill REST ; rendu KLineChart live ; sélecteur symbole + timeframe ; crosshair. Store marché vanilla. **Atteint.**
- **M2 — Moteur + 7 indicateurs** (`packages/indicators`) : `IndicatorDef`/`engine.ts` (calcul, helpers SMA/EMA/RMA dans `utils.ts`) ; SMA, EMA, RSI, MACD, Bollinger Bands, Volume, VWAP avec tests vs valeurs de référence (Wilder pour RSI). **Atteint et dépassé** (le catalogue est désormais à 221).
- M3 watchlist+persistance locale, M4 spike sync WebGL, M5 CVD+footprint (aggTrade), M6 `IDerivedDataProvider`→Coinalyze : **tous atteints.**

## Anti-objectifs (NE PAS faire)
- Ne pas créer de backend **réseau/multi-tenant**, de docker-compose, de schéma DB serveur (le daemon localhost mono-process de la Phase 2 est la SEULE exception, cf. Décisions verrouillées).
- **Avant le verdict G100** : pas de nouvelle fenêtre, pas de nouveau fournisseur sans remplacement direct d'une source défaillante (exceptions ACTÉES : fournisseurs de capitalisation CMC/CCData, fournisseurs statistiques publics OCDE/Eurostat/ONS le 2026-09-06, CryptoQuant BASIC le 2026-09-16 sur décision explicite du propriétaire — **sans source défaillante remplacée**, l'exception est nommée comme telle — et Wikimedia (pages vues, sans clé, appel direct) le 2026-11-07, au même titre — cf. Décisions verrouillées), pas de migration React/Vite/Zustand/KLineChart majeure (plan 2026-08-24, §12).
- Ne pas « améliorer » `@axiom/types` ni les configs racine.
- Ne pas étendre le catalogue d'indicateurs sans nécessité démontrée (le contrat est à 221, pas « plus de 7 » — l'ancien jalon M2 est historique, cf. ci-dessus).

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
   trous d'historique = daemon éteint, visibles ; historique indisponible sans daemon (Vercel :
   niveaux courants seuls, scannés par le navigateur depuis le 25 septembre). Aucun
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
   officiel 1 200 poids/min/IP, `clearinghouseState` = 2, `fundingHistory` = 20 + 1 par tranche
   de 20 éléments ; le scan est plafonné à 750 poids/min → un lot de 4 au plus toutes les 640 ms,
   ≈ 240 s par scan (mesuré le 25/09 : 1 500 adresses en 240,9 s, aucun 429 ; arrêt au premier 429 conservé). Les 450 poids/min
   restants vont au navigateur (même IP) : une série `fundingHistory` 90 j en consomme ≈ 208 par
   minute, la marge dépend donc des indicateurs HL actifs. Une lecture `/hl/liqlevels` ou
   `/hl/positions` n'attend plus jamais un scan quand un cache existe, même périmé (servi, scan
   relancé en fond) ; sans aucun cache, elle attend au plus 15 s puis répond 503
   `{ enConstruction: true }` + `Retry-After: 30` — la couche LIQHL reste « chargement » et la
   fenêtre WHALES affiche « instantané en construction », toutes deux relancent toutes les 30 s
   (premier scan ≈ 4 min, ≈ 4,5 avec le téléchargement du leaderboard de ≈ 39 Mo). Amont en
   panne : si les 3 premiers lots échouent tous, le 1er lot est rejoué une fois (une coupure
   d'une seconde au lancement ne jette pas un scan sain) puis, s'il échoue encore, le scan est
   abandonné ; sans cache, un échec total (pool vide ou zéro adresse) est retenu jusqu'au premier
   succès, les lectures répondent le 503 « pool indisponible » (état « erreur » côté front,
   jamais « en construction » sans fin) et n'en relancent un essai qu'au moins 2 min après la
   FIN de l'essai raté. Un pool téléchargé reste utilisé même si sa persistance SQLite échoue.
   Le collecteur forcé attend
   toujours son point neuf et n'est pas soumis à ce repli. Cela reste un **échantillon** du
   leaderboard : l'interface annonce « N adresses », jamais « toutes » les liquidations.
   Côté graphe, la fenêtre ±40 % du prix (+ plancher 10 k$) des barres LIQHL — seul filtre de
   distance de toute la chaîne, qui écartait 55 % du notionnel BTC, 61 % ETH et 97 % SOL le
   25 septembre — est supprimée : `filtrerNiveauxHl` ne garde plus que la validité (px et
   montant finis, > 0). Les barres sont normalisées sur les clusters VISIBLES, et ce que l'axe Y
   (calé sur les bougies) ne montre pas est résumé en repères de bord « ▲/▼ N niv. hors écran ·
   total · max … @ prix » au lieu d'être jeté par le clip ; la légende porte les cumuls ↑/↓ de
   tout l'échantillon. La heatmap HL normalise sur les buckets visibles et son rendu lissé est
   borné à l'écran (≤ 4 096 lignes, repli rects sur exception) : les aberrations de marge croisée
   (jusqu'à ~27 M$ sur BTC) ne blanchissent plus l'image ni n'arrêtent la boucle rAF. Sur une
   paire cotée hors USD, la couche se tait et dit « cotation X ≠ USD, niveaux masqués ».
   Extension du 25 septembre, **mode navigateur sur Vercel** (décision du propriétaire, « le
   déploiement n'est toujours pas ok » : il utilise la version Vercel et veut y voir les
   liquidations disponibles). La commande LIQHL n'est plus `UNUSABLE` sur Vercel. Le code du scan
   indépendant de Bun et de SQLite (types, constantes de pool et de cadence, `extrairePool`,
   téléchargement du leaderboard borné en octets pendant la lecture, même sans content-length,
   `parserEtatCompte`, `construireInstantane` avec rejeu,
   arrêt sur 429 et abandon) passe dans `shared/hyperliquidScan.ts`. Ce module n'importe ni Bun,
   ni `node:*`, ni le DOM ; il est compilé par les tsconfig web et daemon, et le daemon le
   réexporte sans changer ses importeurs. Il ajoute au scan une progression (instantané partiel
   tous les 5 lots), une interruption (`signal`) et une pause avant chaque lot (`avantLot`), sans
   changer le comportement par défaut. `deciderModeHl` choisit la source : Vercel → navigateur ;
   en local → daemon s'il annonce la capability `hl`, sinon navigateur (repli). Le mode daemon
   est inchangé. Le repli local n'est pas définitif : le daemon est re-sondé toutes les 60 s et,
   dès qu'il annonce de nouveau `hl` (redémarrage, lancement tardif), la couche lui revient et le
   scan de la page s'arrête, pour ne pas partager l'IP à deux scans (relecture du 25 septembre).
   En mode navigateur, `data/hyperliquidLiqNavigateur.ts` est chargé par `import()`
   hors du chunk d'entrée et exécute le même scan, à 750 poids/min : sur Vercel, le navigateur
   est seul sur son IP. Le pool est pris dans le stockage local (`axiom:hl:pool:v1`, mêmes
   paramètres, < 6 h), puis servi par `GET /hlpool`, puis tiré du leaderboard direct (≈ 39 Mo,
   légende « chargement du pool d'adresses… »). Faute d'amont, le pool stocké périmé sert de
   repli. La fonction Vercel `api/hlpool.ts` (rewrite `/hlpool`) n'a **aucun secret ni aucune
   lecture d'environnement** et ne lit aucun paramètre. Elle télécharge le leaderboard (délai
   45 s, `maxDuration` 60 s) et répond le pool réduit `{ ts, nValeur, tailleCible, adresses }`
   (≈ 65 Ko) avec `public, s-maxage=21600, stale-while-revalidate=86400` : le CDN le sert à tous
   pendant 6 h. Elle refuse toute autre méthode que GET (405) ; un amont en échec donne 502
   `no-store`, ou le pool d'instance périmé avec 10 min de cache. Elle n'appelle jamais
   `api.hyperliquid.xyz/info` : les `clearinghouseState` partent de l'IP du visiteur. Un
   instantané couvre tous les coins : changer de symbole ne relance aucun scan. Un scan
   recommence toutes les 5 min tant que la couche est active, pas plus d'un à la fois. Le scan
   se met en pause quand l'onglet est caché et s'arrête proprement au OFF ; un rescan échu
   pendant l'absence n'est horodaté qu'au retour (ni instantané antidaté, ni second scan
   enchaîné). Après un échec total,
   un nouvel essai part 2 min plus tard ; sans instantané complet à garder, la légende affiche
   « source indisponible ». Pendant le premier scan, les barres apparaissent dès les premières
   adresses. La légende affiche
   alors « LIQ HL RÉELS (navigateur) — scan N/T adresses · P positions · ↑ … · ↓ … », puis
   « N adresses · … » ; les rescans sont silencieux. La CSP Report-Only admet
   `https://stats-data.hyperliquid.xyz` pour le repli direct. Le test structurel
   `apps/daemon/src/vercelProxy.test.ts` couvre toutes les fonctions de `api/` et la forme de
   `/hlpool`. L'historique (heatmap HL, collecteur `hlLiqHeat`) reste **réservé au daemon** : en
   mode navigateur, aucun fetch `/hl/liqheat`, et la légende HL HEATMAP le dit au lieu d'afficher
   « source indisponible ». Honnêteté inchangée : c'est un échantillon de ~1 500 adresses du
   leaderboard, jamais « toutes » les liquidations.
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
   Binance est attendue ; chemin à froid modifié le 26/09, cf. section Profondeur
   d'historique) ; essai spéculatif borné à 4 s ; Coinbase par `/extapi`
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
   (héritage de `setSymbol`) est inchangé : le routage tranche. *Remplacé le
   26/09, cf. section Profondeur d'historique.*
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
   insuffisant : 74 bougies, horizon 96 » en 1M. Pendant l'extension de session
   (ou d'amorce, depuis le 2026-10-09, cf. AXIS « Fidélité d'affichage »),
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


## Profondeur d'historique (demande du 26 septembre 2026)

Le propriétaire demande : « lorsque je recherche un actif pour l'ajouter à ma
liste de surveillance, la source doit être celle qui affiche le plus de données
d'historique » (HYPEUSDT routé sur Binance, qui n'a pas une semaine d'historique).
**39 fenêtres, 214 indicateurs, 9 identifiants de marché, aucune dépendance,
aucun hôte ni fournisseur, aucune règle de proxy modifiée, `@axiom/types`
inchangé.** Branche `feat/sources-profondeur-historique` : `410d90d` (routage),
`28bc365` (favoris), `8a4986e` (recherche), `4c7f304` (parcours navigateur),
`b0062f2` et `fc6271d` (corrections de la revue finale), puis le lot G (après
`fc6271d`). Conception : amendement du 26/09 de
`docs/superpowers/specs/2026-09-23-sources-automatiques-design.md`, qui remplace
celui du 24/09.

1. **Cause mesurée.** Binance ne sert HYPEUSDT que depuis le 24/09/2026 (1 bougie
   1w, 3 bougies 1d). Bybit le sert depuis le 11/07/2025 (443 bougies 1d), OKX
   depuis le 04/11/2025 (327 bougies 1d). La règle du 24/09 plaçait Binance
   confirmé devant toute autre place.
2. **Règle** (`classer`, `data/marketRouting.ts`). Pour un même instrument au
   comptant (même symbole, même devise), la place dont le graphe affiche
   l'historique le plus ancien à l'unité de temps demandée passe devant,
   provenance comprise.
   - Historique accessible = max(première bougie servie par l'adaptateur de la
     place, maintenant − min(plafond de la place, 20 000) × unité). Plafonds :
     OKX 1 440 (`/market/candles`), Kraken 500 (backfill de 500 bougies,
     `endTime` ignoré ; message « Historique Kraken limité à ~500 bougies »),
     graphe 20 000.
   - Chaque place a une fourchette de début accessible : exacte ; bornée
     (`exact:false`, sonde arrêtée avant le début réel), « au moins aussi
     profonde », du plancher de sa place à la borne ; non mesurée, du plancher de
     sa place à +∞ ; sans aucune bougie, reléguée.
   - Clés, dans l'ordre : essai spéculatif hors provenance en dernier, unité de
     temps supportée, palier de profondeur, Binance confirmé, provenance, ordre
     des sources. Palier 0 : peut être aussi profonde que la place la plus
     profonde prouvée parmi celles qui peuvent être en tête (premier groupe
     présent), à la tolérance près ; palier 1 : au-delà, par début croissant ;
     palier 2 : aucune bougie.
   - Tolérance : 5 % de la fenêtre du graphe (20 000 bougies), bornée à 7 jours,
     jamais moins d'une bougie (1m : environ 16 h 40).
   - Binance ne départage qu'à profondeur équivalente (BTCUSDT reste sur Binance).
   - Mesure absente (sonde en échec, encore en vol, place sans sonde) : bénéfice
     du doute jusqu'au plancher de sa place. Elle ne perd la tête que si ce
     plancher l'empêche d'égaler la place la plus profonde prouvée (OKX ou Kraken
     non mesurés derrière une place plus profonde).
   - Aucune sonde pour un perp, un actif TradFi, un synthétique ni un actif coté
     sur une seule place (CARDSUSDT reste sur OKX).
3. **Mesure** (`data/profondeurHistorique.ts`).
   - Première bougie servie par l'adaptateur existant : Binance, Bybit, MEXC
     1w × 1 000 ; Kraken 1w × 720 ; OKX 1M × 300 ; Coinbase 1d × 350 sur 4 pages
     au plus, arrêt sur page vide. Une cotation récente est ramenée au jour par
     une sonde 1d ; OKX plus ancien, par une page 1w autour du 1er du mois.
   - Files par place à trois rangs (graphe, favoris, recherche), puis ordre
     d'arrivée ; une sonde rejointe par un demandeur plus prioritaire est promue.
     Deux créneaux par place : favoris et recherche n'en prennent qu'un, le second
     reste au graphe. Départs espacés : Kraken 1 s, Coinbase 200 ms, OKX 70 ms,
     autres 50 ms. Le créneau n'est rendu qu'à la fin réelle de la requête ; à
     15 s, les demandeurs reçoivent « inconnu » et une réponse tardive entre
     encore au cache. Mesures dédoublonnées ; un appel abandonné (`AbortSignal`)
     retire ses sondes non démarrées que personne d'autre n'attend.
   - Sortie anticipée : `mesurerProfondeurs` rend dès que la tête ne peut plus
     changer (`teteDecidee`, qui borne chaque place non mesurée par son
     plancher). BTCUSDT en 1m ou 1h est décidé à la mesure de Binance, sans
     attendre Coinbase. Sinon, le graphe et la recherche attendent au plus 2,5 s,
     les favoris 15 s.
   - Cache `axiom:profondeurHistorique:v1` : mémoire et localStorage, 25 à 35 j
     selon la clé (pseudo-aléa fixe, pour éviter une expiration groupée), 1 000
     entrées au plus (environ 50 ko), `place:symbole → [début, exact, horodatage
     de mesure]`, sans identifiant ni credential ; « vide » 24 h et échec 60 s,
     en mémoire seulement. Non recopiée par le daemon (hors `MANAGED_KEYS`) ;
     incluse dans l'export JSON comme les autres caches (`eco`, `cot`).
4. **Graphe, chemin à froid** (`resolveMarketCandidatesProgressifs`). Catalogue en
   cache, même périmé : liste complète classée après mesure. À froid, les huit
   catalogues partent et le perp n'attend qu'Hyperliquid. Au comptant, le
   catalogue Binance est toujours lu : une mesure en cache ne prouve pas la
   cotation (paire suspendue, bougies figées). Les autres places spot sont
   attendues jusqu'à 2,5 s après le début. Binance confirmé est mesuré pendant ce
   temps ; décidé face à toutes les places encore possibles, il part seul
   aussitôt. Sinon, les places confirmées sont mesurées puis classées, et les
   catalogues retardataires ne comptent que dans la liste complète. Sans aucune
   place confirmée, la provenance spot reste attendue au-delà (CARDSUSDT).
5. **Favoris** (`components/Watchlist.tsx`). Classés comme le graphe, en 1h, sur
   le catalogue complet ; mesures au rang des favoris.
   - Sans source : le premier candidat qui renvoie un vrai prix. Source R en tête
     et listée : confirmée sans sonde de ticker. Sinon, sondes des places classées
     au-dessus de R (mesurées comme elle), puis de R, jamais d'une place classée
     dessous ; sans prix, R est conservée. Un favori peut donc migrer vers une
     place plus profonde (`binance:HYPEUSDT` → Bybit) ; `okx:BTCUSDT` revient à
     Binance. Les confirmations valent pour la session : pas d'oscillation.
   - Doute : dès que le favori a deux places mesurables et que l'une d'elles, la
     place retenue comprise, reste sans mesure, rien n'est confirmé. Une source
     enregistrée reste la sienne, sans sonde ; un favori sans source, ou dont le
     catalogue dément la source, affiche à titre provisoire le prix de la place
     retenue. Réessai à chaque passe (30 s), 5 min au plus depuis le premier
     doute, puis confirmation définitive. Un favori retiré oublie son doute.
   - Graphe prêt : il ne retient la place d'un favori sans source que si elle est
     en tête du classement 1h, même quand aucun ticker ne répond. Un graphe prêt
     sur un actif hors watchlist n'est ni classé ni mesuré. Le screener ajoute ses
     favoris sans source imposée.
6. **Recherche** (`components/PairSearch.tsx`). Un résultat par instrument,
   représenté par sa place la mieux classée d'après le cache, à l'unité du
   graphe. Libellé « Auto » tant qu'une de ses places n'est pas mesurée, puis la
   place qui sera retenue ; infobulle : places classées, ou ordre alphabétique
   pendant la mesure. Après 250 ms sans frappe, le résultat actif (clavier,
   survol) puis les 12 premiers sont mesurés au rang de la recherche. Les sondes
   pas encore parties sont abandonnées à la frappe suivante, à la fermeture et au
   démontage.
7. **Validation de la branche.**
   - Web : 390 fichiers, 5 546 tests (journaux du lot G) ; `tsc` web réussi (lot
     G) ; `pnpm -r typecheck` réussi (contrôle conjoint du lot F). Les paquets
     hors web ne sont pas modifiés ; `pnpm -r test` réussi au `4c7f304` (revue
     finale).
   - Mutants détectés : tolérance de 7 jours (lot A) ; 9 (lot B), 10 (lot F2) et
     7 (lot G) sur `Watchlist.tsx` ; 6 sur `PairSearch.tsx` (lot F2) ; priorité
     et sortie anticipée (lot F1).
   - E2E `sources-automatiques` et `multivue` : 30/30 deux fois au lot F et deux
     fois au lot G, dont deux parcours HYPEUSDT (recherche, graphe et favori sur
     Bybit ; migration d'un ancien favori Binance). Limite Kraken PARTIAL : 1/1
     (lot G).
   - Revue finale sous trois angles (routage et latence, favoris et persistance,
     budget et sécurité), chaque constat bloquant ou important contre-vérifié (dix
     contre-vérifications, dont un réfuté et un rétrogradé) : un bloquant (les sondes
     de la recherche affamaient celle du graphe) et sept importants, dont un sur
     la documentation. Ils sont traités par les lots D, F et G ; les résidus
     figurent ci-dessous et dans le rapport.
   - Budget d'entrée de la branche (Node 24.13, zlib 1.3.x ; état F1 + F2, non
     remesuré après le lot G) : **1 198 940 / 358 297 octets** (bruts/gzip),
     plafonds 1 220 000 / 360 000 inchangés, marge 21 060 / **1 703** (0,47 %) ;
     +8 390 / +3 241 par rapport à main.
8. **Mesures au navigateur** (contrôle conjoint du lot F, avant le lot G :
   Chromium headless, profils neufs, API réelles, serveurs Vite de dev, branche
   contre main `f786c0a`, 26/09) :
   - HYPEUSDT : recherche « Auto » à 8 ms, puis « Bybit » à 1 050 ms (main :
     « Binance » à 7 ms). Entrée : graphe Bybit prêt en 307 ms, barre d'outils
     « Auto · Bybit » (main : Binance en 409 ms). **443 bougies 1d depuis le
     11/07/2025** (main : 3 bougies depuis le 24/09/2026).
   - Démarrage à froid, BTCUSDT 1m (médiane de 5 mesures alternées) : **1 562 ms
     contre 1 272 ms** sur main, soit +290 ms (+3 057 ms à la revue finale).
     Binance 5 fois sur 5. La borne de 2,5 s n'est plus atteinte ; le reste est
     la sonde Binance 1w, qui décide la tête. 15 sondes (3 favoris × 5 places) en
     27 requêtes, terminées entre 5,7 et 6,9 s ; main n'en fait aucune.
   - À chaud (5 rechargements) : 906 ms contre 915 ms, 0 sonde.
   - Entrée immédiate, libellé encore « Auto » : Bybit en 827, 927 et 1 847 ms,
     contre Binance en 317, 320 et 416 ms sur main.
   - Frappe lente de « HYPEUSDT » : 32 sondes à 250 ms par touche et 36 à
     350 ms (55 à la revue finale), qui touchent chaque fois 9 paires jamais
     choisies ; 6 sondes à 150 ms.
9. **Limites assumées.**
   - Le split taker Binance est perdu (CVD, indicateurs acheteur/vendeur, DOM ;
     DES jusqu'au 5 octobre 2026, cf. « Produits dérivés multi-places ») sur les
     actifs dont Binance n'est pas la place la plus profonde : HYPEUSDT sur Bybit
     affiche le CVD UNUSABLE.
   - La place retenue peut changer avec l'unité de temps (HYPEUSD : OKX en 1d,
     Coinbase en 1h). Les dessins sont indexés par `slot:place:symbole`.
   - Coinbase est sondé sur 4 pages : sa borne (environ 3,8 ans) reste « au moins
     aussi profonde », et Binance départage BTCEUR, BTCUSDC et ETHBTC en 4h, 6h et
     1d alors que Coinbase afficherait plus d'historique.
   - Dépassements simulés de la borne de 2,5 s : Kraken dans 1 cas sur 48 (clic
     au départ d'une sonde de recherche Kraken) ; Coinbase à 1 340 ms par page,
     où deux pages en série dépassent seules la borne. La place non mesurée garde
     alors le bénéfice du doute.
   - Une requête qui ne se termine jamais garde son créneau pour la session, faute
     de signal dans `fetchKlines` (`@axiom/types` figé). Une seule sonde pendue,
     quel que soit son demandeur (graphe compris), bloque favoris et recherche de sa
     place ; une seconde, forcément du graphe puisque le second créneau lui est
     réservé, bloquerait tout.
   - La frappe lente mesure encore environ 9 paires non choisies. L'Entrée
     immédiate sur « Auto » coûte environ 600 ms.
   - Quand la mesure de la place retenue échoue, le favori reste en doute 5 min
     au plus, avec un réessai toutes les 30 s.
   - OKX est limité aux 1 440 dernières bougies par `/market/candles` ; suite
     possible : `history-candles`.

Rapport : `docs/revue-2026-09-26-profondeur-historique.md`.

## Ratios ÷ marchés et devises (demande du 26 septembre 2026)

Le propriétaire a demandé de pouvoir diviser un actif par autre chose que BTC, ETH et
SOL : l'or, le Nasdaq, le S&P 500, le franc suisse, le yen, etc. Exception au gel G100
sur demande explicite, limitée aux ratios (bouton ÷ du bandeau, unités de temps des
ratios Twelve Data mixtes, y compris ceux du lot D) et à la navigation clavier des menus
déroulants. **39 fenêtres, 214 indicateurs, 9 identifiants de marché (`EXCHANGE_IDS`),
aucune dépendance, aucun hôte ni fournisseur, aucune règle de proxy modifiée,
`@axiom/types` inchangé.**

1. **Dénominateurs.** Menu groupé Crypto (ETH, SOL ; ÷BTC garde son bouton), Marchés
   (÷Or = or spot XAU/USD, en onces ; ÷Nasdaq 100 (QQQ) ; ÷S&P 500 (SPY)) et Devises
   (en EUR, GBP, CHF, JPY, CAD, AUD, par la paire CCY/USD : BTC en CHF = BTCUSDT ÷
   CHF/USD). Jambe B Twelve Data unique, quelle que soit la source de l'actif
   (`data/ratio.ts`). Vérifiés sur l'offre du propriétaire le 26/09 : XAU/USD, EUR/USD,
   GBP/USD, CHF/USD, JPY/USD, CAD/USD, AUD/USD, SPY et QQQ sont servis ; SPX, NDX et
   XAG/USD exigent l'offre Grow. D'où les ETF SPY et QQQ, nommés dans le libellé et
   l'infobulle (prix de l'ETF, pas le niveau de l'indice : ≈ SPX/10, ≈ NDX/41) : jamais
   une substitution silencieuse.
2. **Devise.** Réservé aux actifs cotés en dollar : USD et stablecoins USD (USDT, USDC,
   FDUSD, USDD, TUSD, USDE, DAI ; un stablecoin est compté pour 1 USD, ce que dit
   l'infobulle), perps Hyperliquid (USDC), TOTAL*, tickers Twelve Data US sans place
   explicite (« RY:TSX » refusé) et paires X/USD. Liste unique `COTATIONS_USD`
   (`data/symbol.ts`), partagée avec la couche HL et le cache d'options. `splitSymbol`
   tient compte de la place : FDUSD n'est une cotation que chez Binance (WFDUSD =
   W/FDUSD ; UFD/USD de Kraken reste UFD/USD) ; TUSD ne l'est pas chez Kraken, Coinbase,
   OKX et Bybit (DOT/USD reste DOT/USD, sans note « TUSD »). La place est transmise par
   les ratios, la couche et la fenêtre de liquidations HL (`basePerp`,
   `raisonCotationHl`) et `actifDeribit` ; les autres consommateurs, sans place, gardent
   le découpage historique. Rejeu sur 7 529 symboles réels (catalogue de prix, 32 paires
   FDUSD réellement TRADING) : découpages justes Binance 2 421 → 2 618, Kraken 1 272 →
   1 336, Coinbase 462 → 509, OKX 1 378 → 1 406, Bybit 513 → 514 ; sans place, aucun
   changement ; aucun découpage juste devenu faux. Jamais l'actif
   divisé par lui-même ni par sa propre devise (EURUSDT en EUR). `estRatio` ne reconnaît
   que ce que le bouton aurait posé.
3. **÷BTC/ETH/SOL étendus** à Bybit et OKX (spot contre spot) et aux perps Hyperliquid
   (perp contre perp) : un actif routé sur Bybit (HYPEUSDT) garde ses ratios.
4. **Aucune anticipation en intrajournalier.** La grille Twelve Data n'est pas la grille
   UTC (mesures du 26/09, `timezone=UTC`) : or et forex 4h à 01/05/09…Z en heure d'été,
   actions et ETF 1h/4h en séance à :30. Composée à une autre grille, la barre B
   chevauchant l'ouverture de A porterait un prix futur : ces unités ne sont pas
   proposées (`supportedTimeframesFor`), y compris pour le lot D. Les préréglages
   « BTC / OR (proxy GLD) » et « BTC / DXY (proxy UUP) » n'offrent donc plus 1h ni 4h. Une
   unité retirée devient l'unité suivante proposée (`timeframeProche`, ex. ÷SPY 4h → 1d),
   jamais la minute : bouton du bandeau, slots, routeur, liaison des graphes (en dernier
   repli, après l'unité de la source), espaces de travail et session restaurée. Twelve
   Data au numérateur (GLD ÷ BTC, AAPL en CHF, AAPL ÷ SPY) : le 1m n'est pas proposé,
   car cette jambe n'est sondée que toutes les 5 min ; il devient 5m. En direct, une barre B ouverte après la bougie A (daily
   forex/or daté J+1 dès 21:00Z) ne fige plus le ratio : la barre B précédente sert,
   sinon la dernière clôture connue (au plus une barre d'avance), et la bougie A
   clôturée est toujours émise. Twelve Data au numérateur (GLD ÷ BTC) : après la
   clôture de séance, la dernière bougie tradfi n'est pas repeinte avec le cours crypto.
5. **Quota Twelve Data.** Toute jambe Twelve Data d'un synthétique est amorcée
   immédiatement (réessayée, même marché fermé, tant que rien n'est livré), puis sondée
   seulement marché ouvert, plus une dernière fois au premier sondage marché fermé (la
   clôture de 16:00 à New York est captée même si le sondage précédent l'a devancée),
   au plus toutes les 5 min, toutes les 15 min dès 1d : environ
   288 crédits par jour ouvré pour l'or et le forex (96 dès 1d), 82 pour les actions et
   ETF (28 dès 1d). Avant : 60 s, 24 h/24, soit 1 440 crédits par jour pour un seul
   ratio ouvert, au-delà du plafond de 800. La séance actions (`data/heuresMarche.ts`,
   extrait de `data/ticker.ts` qui le réexporte) suit désormais l'heure de New York :
   09:20-16:10 locales, soit 13:20-20:10Z en été et 14:20-21:10Z en hiver ; les
   cotations TradFi de la watchlist en profitent aussi. Moteur sans ce fuseau : repli
   sur l'ancienne fenêtre UTC d'été, jamais un module qui ne se charge plus.
6. **Clavier.** Le menu repose sur la primitive `MenuDeroulant` (`aria-haspopup`,
   ↑/↓/Début/Fin, Échap). À l'ouverture, le focus entre dans le panneau, et une flèche
   reçue quand le focus n'est nulle part y ramène (Safari et Firefox ne donnent pas le
   focus au bouton cliqué) ; un champ qui a pris le focus (« / ») le garde. Le menu se
   ferme quand le focus part vers un autre élément (Tab, « / »), et ↓ retrouve alors
   son sens global. Le raccourci global ignore une flèche ou un Échap déjà traités par un menu :
   ↓ ne change plus de paire tant que le focus est dans le menu (ou nulle part), Échap
   ne réduit plus la fenêtre focalisée.

Limites assumées :
- Daily forex/or (J-1 21:00Z → J 21:00Z) apparié à la bougie crypto J : décalage de 3 h,
  sans prix postérieur à la clôture de A.
- 1d, 1w et 1M SPY/QQQ : l'ouverture du ratio divise par l'ouverture de séance,
  postérieure à 00:00Z (anticipation assumée de l'ouverture, comme un ratio de séances) ;
  clôture périmée de 3 à 4 h en 1d (16:00 à New York contre 00:00Z), jusqu'au week-end en
  1w et 1M.
- Un dénominateur Twelve Data périmé (quota épuisé, réseau) reste reporté sans signal
  sur le graphique. C'est une dette antérieure, commune aux préréglages BTC/GLD et
  BTC/UUP.
- Sans clé Twelve Data en appel direct (Vercel), les entrées restent actives et l'erreur
  « clé » s'affiche au chargement.
- Jours fériés US non gérés : SPY et QQQ y sont sondés pour rien (environ 82 crédits en
  intrajournalier, 28 dès 1d, par jour férié).
- Clôture SPY/QQQ en direct : captée par le sondage de fermeture, au plus 5 min (15 min
  dès 1d) après 16:10 à New York, retenté à chaque cadence en cas d'échec ; exacte au
  rechargement.

Validation : **5 449 tests web** et typage de tous les paquets réussis ; parcours
Chromium `gate-v24-macro-denominateur`, `gate-v25-cap-dominance`, `multivue`,
`quatre-lots-indicateurs` et `niveaux-chart` : 34/34 deux fois de suite au tour
précédent, puis `gate-v24-macro-denominateur` et `multivue` 19/19 deux fois après le
dernier tour (les parcours clavier échouent sans leurs gardes). Budget d'entrée
**1 195 875 octets bruts / 356 997 gzip** (Node 24.13.0, zlib 1.3.1), contre
1 190 550 / 355 056 sur `main` ; plafonds 1 220 000 / 360 000 inchangés. Revue
indépendante sous trois angles (calcul, robustesse, contrat et budget), contre-revue
puis deux vérifications ; leurs points bloquant, importants et mineurs retenus sont
corrigés ci-dessus.

## Classement, impression de stablecoins et dessins (26 septembre 2026)

Le propriétaire a demandé trois changements : un classement des actifs les plus performants
(comme l'accueil de CoinGlass), l'impression quotidienne de stablecoins sous le graphique, et
la correction des rectangles qui se déplacent en passant d'un graphique à un autre. **39
fenêtres, 215 indicateurs (+1), 9 identifiants de marché. Aucune dépendance, aucun hôte ni
fournisseur, aucune règle de proxy ; `@axiom/types` inchangé.** Une revue indépendante (trois
angles, constats contre-vérifiés) a été suivie d'un second commit de corrections.

1. **Classement : onglet « Classement » de MAP, mnémonique `TOP`.** C'est un onglet, pas une
   nouvelle fenêtre.
   - Données : les tuiles CoinGecko de la carte (top 250, cache 5 min). La requête
     `/coins/markets` ajoute seulement la période `1h` : toujours 3 requêtes par
     rafraîchissement.
   - Affichage : rang, prix, Δ 1 h / 24 h / 7 j / 30 j, volume 24 h, capitalisation ; choix
     hausses ou baisses, top 100 ou 250, « Hors stablecoins » (liste connue, ancrages non USD
     et jetons de trésorerie compris, ou prix ancré à 1 $ sans mouvement) ; nombre de hausses,
     de baisses et médiane.
   - Un actif sans variation connue sur la période sort du classement, sans 0 inventé. Le Δ24 h
     a pour cela un champ nullable dédié (`changePct24hConnu`), aussi lu par SECT ; la treemap
     garde sa convention 0. Un cache frais d'un ancien schéma est rechargé au lieu d'être servi
     (un cache à liste vide reste servi).
   - Clic, Entrée ou Espace sur une ligne : la paire `SYMBOLEUSDT` ne s'ouvre que si un
     catalogue la cote, avec deux contrôles. Un ticker n'est pas unique : AIUSDT est Sleepless
     AI, pas Artificial Inu.
     - Identité : aucune place au prix connu ne sort de ×0,8 – ×1,25 du prix CoinGecko. Sinon,
       refus collant : la ligne est estompée et l'infobulle donne la raison.
     - Première place : la place que le graphe essaiera d'abord (premier candidat confirmé du
       résolveur commun `resolveMarketCandidates`, à l'unité de temps du slot focus, aucun ordre
       réimplémenté) doit avoir un prix connu et cohérent. Sinon, « vérification incomplète,
       réessayez », sans désactiver la ligne.
     - La navigation passe cette place en provenance. Les lignes non cotées ou refusées sont
       estompées, avec une infobulle ; une ligne refusée reste focalisable (`tabIndex=-1`,
       `aria-disabled`), le focus clavier n'est pas perdu.
     - Intégration avec le routage par profondeur d'historique (`verifierClic`) : les mesures
       de profondeur des places cotées partent dès le clic, au rang « graphe », en parallèle
       des prix (abandonnées au clic suivant et au démontage) ; le refus d'identité tombe
       AVANT le résolveur, qui n'est interrogé qu'ensuite. Limite résiduelle : une place dont
       la mesure est encore en vol au moment du résolveur peut ensuite passer en tête et être
       ouverte sans prix vérifié. Le refus d'identité reste garanti pour toute place dont le
       prix est connu.
   - `MAP` et `IMAP` rouvrent sur la carte ; `TOP` ouvre sur le classement sans fermer la
     fenêtre.
2. **Impression de stablecoins : `stablecoinPrint`, pane séparé, unité 1d SEULEMENT.**
   - Mesure : variation nette quotidienne du stock circulant de stablecoins valorisé en USD
     (DefiLlama, série auxiliaire `stablecoins` existante, tous ancrages convertis en USD).
   - Ce n'est PAS une mesure des mint/burn. La variation inclut les effets de change et les
     changements de couverture. Les sorties s'appellent « Hausse nette de l'offre » et « Baisse
     nette de l'offre » (règle « ni d'interprétation mint/burn » ci-dessus) ; le nom
     « Impression de stablecoins (Δ offre / jour) » reprend le mot du propriétaire.
   - Unité : `minTimeframe` 1d, et `supportsIndicatorTimeframe` n'admet que 1d (table
     `TIMEFRAME_REQUIS`, commune au graphe, aux alertes et au backtest, avec le RVOL saisonnier
     en 1h). Le point DefiLlama daté D porte la dernière valeur du jour D : en intrajournalier,
     il serait lu dès 00:00 (anticipation) ; en 1w, la bougie du lundi lirait la semaine
     précédente.
   - Une valeur reportée à l'identique ne fait aucune barre. La bougie non clôturée (point
     réécrit en cours de journée) va dans « Jour en cours (partiel) », en gris, hors de la
     moyenne. Limite : « clos » désigne la bougie de prix. Juste après 00:00 UTC, le point de la
     veille peut encore être partiel (cache de la série 1 h, publication DefiLlama) ; il se
     corrige au rafraîchissement suivant.
   - Moyenne jusqu'à 365 jours (la série auxiliaire `stablecoins` livre tout l'historique
     quotidien DefiLlama, sans troncature à 90 jours, pour couvrir le même historique 1d que
     l'actif) ; légende et axe abrégés (K/M/B), comme pour l'offre de stablecoins.
3. **Dessins dont un point est hors des bougies chargées.** Dans klinecharts 9.8, un point
   posé à droite de la dernière bougie (ou avant la première) n'a qu'un `dataIndex`.
   - Cause : la sauvegarde ne gardait que `{timestamp, value}`. Le point revenait donc sans
     abscisse au rejeu (changement d'actif, d'unité de temps, de disposition, rechargement), et
     le dessin se déformait vers le bord gauche.
   - Sauvegarde : l'instant est extrapolé. Mois UTC en 1M et au-delà quand TOUTES les bougies
     mesurées (20 dernières au plus) s'ouvrent le 1er à 00:00 UTC. Sinon, au plus petit écart mesuré : c'est le cas du « 1M » d'Hyperliquid,
     des paquets de 30 j alignés sur l'époque. Avec moins de deux bougies, la durée de l'unité de
     temps.
   - Rejeu : un instant hors des bougies devient un indice extrapolé, que klinecharts rabattait
     sur la première ou la dernière bougie.
   - Historique préfixé : quand la première bougie change (extension de session, resync,
     pagination), TOUS les dessins sont rejoués depuis leurs instants. klinecharts ne décale pas
     l'indice en `applyNewData`. Parcours `e2e/dessins-hors-bougies` : −1 661 barres sans ce
     rejeu, 0 avec.
   - Le VPFR borne aux bougies chargées une plage dont un bord n'a qu'un indice (hors des
     bougies chargées), au lieu de disparaître.
   - Limites :
     - en TradFi, nuits et week-ends sont extrapolés comme des bougies de même durée (instant
       approché), et un instant futur peut ensuite être rabattu sur la bougie la plus proche ;
     - un dessin déjà sauvegardé par l'ancien code a perdu l'abscisse de son point futur et doit
       être retracé ;
     - les dessins restent indexés par slot, place et symbole (changer de place masque ceux de
       l'ancienne).

Validation après trois tours de revue : indicateurs 844, backtest 114, alertes 62, web 5 438
tests ; typage monorepo ; e2e `dessins-hors-bougies`, `multivue`, `gate-g7-liens`,
`gate-lot3-corr` (×3), `quatre-lots-backtest` et `revue-outils-avances`. Budget d'entrée en
Node 24 (zlib 1.3.x) : **1 195 440 / 356 742** octets (bruts/gzip), soit +4 890 / +1 686 par
rapport à `main` (1 190 550 / 355 056) ; marge gzip 3 258 octets.
Plafonds 1 220 000 / 360 000 inchangés.

## Budget d'entrée de l'intégration du 26 septembre 2026

Fusionnées, les branches profondeur d'historique, ratios ÷ marchés et devises, classement
des stablecoins et rectangles dépassaient le plafond : **1 204 877 / 360 399** (Node 24,
zlib 1.3.x). Leurs ajouts servent presque tous le premier graphe et restent statiques. La
compensation vient de deux commandes de palette qui tiraient des stores de fenêtres paresseuses :
- SIG (`commands/windowPanels.ts`) charge `store/signaux` par `import()`, choisit la vue
  Signaux puis ouvre EQS (≈ −3,8 Ko gzip) ;
- MACRO (`commands/registry.ts`) charge `store/macroRatesView` par `import()` ; `chart/macro.ts`
  importe `data/macro/fred` et `data/macro/stablecoins` sans le baril `data/macro`, qui tirait
  `catalogueMacro` (≈ −4,9 Ko gzip).

Budget mesuré à ce commit (e19de6e) : **1 180 508 / 351 567**. Le garde-fou
`src/chargementInitial.test.ts` interdit le retour de ces trois modules. Si le chunk d'un de
ces stores est introuvable (déploiement, réseau), SIG et MACRO ouvrent quand même leur fenêtre
et signalent l'échec en console (fbd4c61).

État final de l'intégration (toutes les corrections des trois branches et des interactions
fusionnées) : chargement initial **1 185 189 / 353 279** (Node 24.13.0, zlib 1.3.1), plafonds
1 220 000 / 360 000 inchangés, marge gzip 6 721 octets. `pnpm check` vert (indicateurs 844,
alertes 62, backtest 114, daemon 756, web 5 648 tests ; typage monorepo) et `pnpm check:e2e`
142/142, relancé sur l'état final. Au navigateur sur API réelles, contre main : HYPEUSDT sur
Bybit (443 bougies 1d depuis le 2025-07-11, contre 3 sur main), ratios ÷Or et en CHF exacts,
classement TOP, impression de stablecoins en 1d, rectangle à coin futur stable ; démarrage à
froid sans cache de profondeur environ +400 ms (1 618 contre 1 138 ms en médiane), à chaud égal.

## Options BTC et ETH après expiration (demande du 28 septembre 2026)

Le propriétaire demande une vérification DEX/GEX et une meilleure lecture du marché des
options après la grande expiration récente. Le chantier porte sur OMON et ses consommateurs
existants (régime, niveaux du graphique). **Aucune fenêtre, aucun fournisseur, aucune
dépendance, aucun hôte proxy ni modification de `@axiom/types` supplémentaires.**

- Le prix `underlying_price` Deribit reste le **forward de son échéance**. Le véritable index
  BTC/USD ou ETH/USD vient de `get_index_price`. Le calcul des greeks utilise le forward de
  chaque instrument et l'index commun ; permuter la chaîne ne doit changer aucun résultat.
  Le profil de prix conserve la base forward/index et l'IV constantes.
- Les options échues sortent des agrégats à 08:00 UTC, même sans succès réseau. Les caches
  s'arrêtent à la première expiration et les niveaux graphiques périmés sont retirés.
- Observation fournisseur, réception locale et horloge de calcul ont des rôles distincts.
  Un échec ne crée pas une nouvelle date de succès ; BTC et ETH ne partagent jamais leurs
  valeurs affichées pendant une transition. Les appels Deribit sont bornés dans le temps.
- La vue crypto distingue une portée toutes échéances et une portée sélectionnée, appliquées
  aux graphiques et aux métriques. La synthèse présente OI, P/C, concentration, court terme,
  couverture et échéances actives. OI inconnu, zéro observé et donnée périmée restent explicites.
- GEX en USD pour un mouvement de 1 %, DEX en USD notionnels. Les conventions de signe ne
  constituent pas une observation des portefeuilles dealers. Le cumul par strike reste
  distinct du zéro du profil GEX simulé. Aucun montant d'expiration passé n'est reconstruit
  depuis la seule chaîne courante.

Diagnostic, comparaison indépendante sur données publiques et résultats de validation :
[`docs/revue-2026-09-28-options-btc-eth.md`](docs/revue-2026-09-28-options-btc-eth.md).
Revue indépendante favorable ; `pnpm check` réussi (8 139 tests et typage monorepo),
18 parcours Chromium réussis. Entrée : **1 188 014 / 354 233** octets bruts/gzip
(Node 24, zlib 1.3.1), plafonds inchangés. Les six nouveaux parcours de fraîcheur
sont inclus dans `pnpm check:e2e`. Le max pain sans OI positif exploitable est absent.

### Nouvelle représentation GEX / DEX (seconde demande du 28 septembre 2026)

Le propriétaire demande ensuite de changer radicalement les graphiques. La refonte porte
sur les vues OMON existantes et conserve les sources, modèles et garde-fous ci-dessus.
La [conception](docs/superpowers/specs/2026-09-28-carte-gex-dex-design.md) décrit la carte
distance au spot × échéance et le profil de sensibilité de la métrique sélectionnée.

- Les bandes de distance couvrent tous les strikes ; elles sont catégorielles, comme les
  échéances. Les sommes signées sont conservées, sans filtre des faibles contributions.
- Les couleurs représentent l'exposition **nette**, avec une échelle commune linéaire et
  symétrique par métrique et portée. Une compensation peut donner un net nul ; une donnée
  absente reste distincte d'un zéro calculé. Les détails sont accessibles au clavier.
- Le profil simule GEX ou DEX sur ±15 % de spot en réutilisant le calcul commun, avec
  IV, OI, temps et ratio forward/index constants. Son point central rejoint le total
  affiché. Il reste absent en CBOE, dont les greeks fournis sont figés.
- Fraîcheur, couverture, périmètre et limites du modèle restent lisibles. La refonte
  n'ajoute ni dépendance, ni service, ni exécution de trading.

Revue indépendante favorable, `pnpm check` réussi (**8 166 tests**) et **20 parcours
Chromium** réussis. Budget initial : **1 188 014 / 354 236** octets bruts/gzip
(Node 24.13.0, zlib 1.3.1), plafonds inchangés. Les deux nouveaux parcours carte/profil
sont inclus dans `pnpm check:e2e`. Preuves et limites :
[`docs/revue-2026-09-28-carte-gex-dex.md`](docs/revue-2026-09-28-carte-gex-dex.md).

### Graphiques visuels complémentaires (demande du 28 septembre à 14:30)

Le propriétaire souhaite conserver les chiffres et disposer également d'un véritable
graphique. OMON GEX/DEX ouvre désormais la vue **Graphique** : histogramme signé par strike
sur un axe de prix proportionnel, repère du spot, et barres d'exposition par échéance.
La carte chiffrée et la sensibilité au prix restent disponibles dans leurs onglets.

- Le cadrage initial à ±30 % du spot concerne uniquement l'histogramme par strike ; le
  nombre de strikes visibles et le net de la zone sont explicités. « Tous les strikes »
  rétablit la totalité. Aucun seuil de petite exposition n'est introduit.
- Les totaux affichés, les barres par échéance, les calculs et la portée choisie ne changent
  pas lors du cadrage. Les dates du second graphique sont des catégories.
- Les graphiques sont calculés à partir des mêmes expositions déjà présentes dans la
  carte, sans nouveau calcul de greeks, fournisseur, dépendance ou formule financière.
- Le choix GEX/DEX pilote les deux histogrammes ; unités, zéro, absence et signe restent
  explicites. Les détails sont accessibles à la souris et au clavier. La vue CBOE dispose
  des graphiques et de la carte, toujours sans simulation de greeks figés.

Revue indépendante favorable, `pnpm check` réussi (**8 181 tests**), **21 parcours
Chromium** réussis. Contraste vérifié sur cinq thèmes ; build final à **1 188 014 /
354 245 octets bruts/gzip**, plafonds inchangés. Les contrôles de conservation des chiffres
au cadrage et d'interaction sont intégrés à la suite `options-carte` existante.

## Usage sur téléphone (demande du 28 septembre 2026)

Le propriétaire demande la révision complète de l'usage depuis un navigateur de
téléphone. L'adaptation porte sur les outils existants, sans nouveau fournisseur,
calcul financier, fenêtre métier ni dépendance.

- `hooks/useMobileLayout.ts` centralise la détection des petits écrans et du paysage
  tactile. Le terminal utilise la hauteur dynamique du navigateur et les marges
  de sécurité ; les menus portés dans le document suivent le viewport visuel.
- La navigation mobile donne accès aux fonctions, à la recherche, aux panneaux,
  aux dessins et aux réglages. Les options du graphique restent accessibles au
  toucher. Aucun contrôle indispensable ne dépend du survol ou d'un clic droit.
- Les fenêtres sont cadrées visuellement dans l'espace de travail. Le passage
  mobile ne transmet pas ce petit rectangle à `setWorkspace`, qui recalculerait
  et persisterait les géométries du bureau. Les fenêtres ouvertes inactives ou
  réduites restent montées sur mobile, masquées et inertes ; le passage de l'une
  à l'autre conserve les brouillons. Leur fermeture définitive démonte le contenu.
- Les panneaux déjà ouverts conservent les formulaires à leur fermeture. Les
  Réglages gardent un parent React stable, y compris au changement de mode
  téléphone/bureau, pour préserver les saisies non enregistrées.
- La grille conserve sa disposition et ses instruments. Sur téléphone, une vue
  est visible à la fois ; ses onglets pilotent également le focus des dessins.
- Les tableaux larges défilent dans un conteneur commun à l'en-tête et au corps.
  Les champs et les actions sont adaptés au toucher. Les graphiques des fenêtres
  exposent leur lecture au contact, sans modifier leurs données ou leurs formules.

Constats, vérifications et limites :
[`docs/revue-2026-09-28-mobile.md`](docs/revue-2026-09-28-mobile.md).

## Clés par défaut en ligne (demande du 30 septembre 2026)

Le propriétaire demande la réutilisation automatique des clés déjà renseignées
sur l'application Vercel. Il choisit explicitement de conserver le lien public,
sans connexion, en acceptant la consommation de ses quotas par ses visiteurs.
Cette décision remplace les restrictions historiques sur les secrets serveur ;
elle n'autorise ni ordre réel, ni clé de trading, ni achat d'abonnement.

- Les onze fournisseurs déjà présents dans les Réglages peuvent recevoir une
  clé serveur : FRED, Coinalyze, Twelve Data, SoSoValue, Etherscan, BGeometrics,
  CryptoQuant, CCData, DefiLlama Pro, Finnhub et CoinGecko. Seules les clés
  effectivement disponibles sont configurées ; une capacité ne signifie pas
  que l'abonnement ou la clé est valide auprès du fournisseur.
- Les secrets de production vivent dans les variables Vercel, jamais dans une
  variable `VITE_*`, un fichier suivi, le bundle ou une réponse de configuration.
  Une clé explicite du navigateur garde la priorité sur le repli serveur.
- `/api/config` expose uniquement la présence booléenne des clés. Les Réglages
  distinguent présence locale et serveur ; supprimer une clé locale ne supprime
  pas le secret du serveur. Le chargement de cette configuration est borné et
  son échec ne doit pas empêcher le terminal de démarrer.
- Le premier rendu attend au plus deux secondes. Une configuration tardive
  continue à charger en arrière-plan avec un délai réseau borné et une seule
  reprise après panne transitoire ; les capacités et l'accueil se mettent à jour
  sans demander de ressaisir une clé déjà disponible sur le serveur.
- L'injection se fait uniquement vers l'hôte du fournisseur sur sa route dédiée.
  Finnhub et CoinGecko disposent de routes de lecture dédiées ; les appels Twelve
  Data passent par le proxy en ligne pour ne pas exposer la clé serveur.
  Les chemins fermés CryptoQuant et DefiLlama restent fermés.
- Une requête authentifiée effectivement envoyée au fournisseur produit une
  réponse `private, no-store` et ne suit pas de redirection avec son credential.
  Les erreurs ne doivent pas refléter les secrets. Le proxy conserve les
  indications bornées de reprise après quota (`Retry-After`).
- Le fonctionnement local et les appels publics sans clé restent disponibles.
  Les clés restent exclues des sauvegardes du terminal. Aucun nouveau fournisseur,
  package runtime, système de comptes ou stockage serveur n'est ajouté.

La revue, les preuves et les limites figurent dans
[`docs/revue-2026-09-30.md`](docs/revue-2026-09-30.md).

## Suites de la revue (autorisation du 30 septembre 2026)

Le propriétaire autorise les améliorations proposées, en demandant de préserver
le fonctionnement de l'outil. Le périmètre est limité à quatre lots :

- Backtest : transmettre la fin réelle des données pour les unités de temps
  fixes, même sans funding. Lors d'une sortie intrabar, ne pas attribuer les
  extrêmes ultérieurs de la bougie à la détention. Les excursions confirmées
  constituent des bornes, explicitement qualifiées dans les trades, moyennes et
  archives. Préserver prix d'exécution, PnL, frais et règlements de funding.
- Finnhub : conserver le cache utile en cas d'échec, en montrant son âge et le
  motif du repli. Une donnée périmée ne doit pas sembler fraîche.
- CI : utiliser Node 24 comme la production et exécuter les parcours mobiles
  Chromium/WebKit dans un job dédié.
- Chargement : différer du code facultatif après mesure du graphe d'imports ;
  garder les plafonds existants et les parcours fonctionnels.

Chaque lot est revu indépendamment. Les validations intégrées et la publication
sont centralisées par l'orchestrateur ; les clés serveur et le lien public
conservent les règles du lot précédent. Plan :
[`docs/superpowers/plans/2026-09-30-corrections-revue.md`](docs/superpowers/plans/2026-09-30-corrections-revue.md).

## Indicateurs d'analyse (demande du 1 octobre 2026)

Le propriétaire demande de nouveaux indicateurs/fonctions et précise vouloir
couvrir les trois usages : polyvalent, intraday et swing. Cette demande autorise
trois définitions supplémentaires dans le catalogue existant, soit 218 au terme
du lot : `narrowRange`, `returnAutocorrelation` et `rollingDrawdown`. Aucun nouvel
écran, fournisseur, secret, ordre réel, package runtime ou changement de types.

- Calculs purs et causaux sur les bougies confirmées ; historique insuffisant ou
  invalide = valeur absente expliquée, jamais zéro inventé. Les périodes sont
  des nombres de bougies/rendements, pas des jours supposés.
- NR compare l'amplitude courante aux précédentes dans la fenêtre, égalités
  incluses. Inside Bar exige deux bornes strictement intérieures. Les sorties
  décrivent une compression, sans direction d'achat/vente.
- L'autocorrélation est l'ACF de retard 1 du NIST, avec une moyenne commune sur
  la fenêtre de rendements logarithmiques ; ce n'est pas Pearson sur deux listes
  tronquées. Une variance indéterminable ou une cadence irrégulière invalide la
  fenêtre. Les fermetures de marché peuvent donc rendre cette mesure absente.
- Le repli est signé depuis le maximum des clôtures de la fenêtre ; la hausse
  nécessaire pour retrouver ce niveau est distincte. Le départ d'un ancien pic
  de la fenêtre ne constitue pas une récupération réalisée.
- Trois configurations facultatives ajoutent chacune une EMA et un nouvel
  indicateur. L'ajout préserve les instances et jeux personnels, évite les
  doublons exacts et respecte la capacité mesurée du graphe. Son annulation ne
  retire que les instances qu'il vient d'ajouter.
- Les alertes de ces trois définitions exigent une valeur finie au dernier index
  évalué ; un croisement exige les deux derniers index. Une valeur historique
  avant un trou ou une variance indéterminable ne devient pas la valeur courante.
  Cette garde vise ces nouveaux identifiants, en conditions simples et composites.

Le moteur d'exécution, les stratégies et les formules des indicateurs existants
restent hors de ce lot. Revue mathématique indépendante, contrôles de causalité,
parcours navigateur et plafonds de build inchangés avant publication. Usage et
validation : [`docs/indicateurs-analyse-2026-10-01.md`](docs/indicateurs-analyse-2026-10-01.md).

## Produits dérivés multi-places (demande du 5 octobre 2026)

Le propriétaire demande que les produits dérivés d'un actif soient recherchés
parmi toutes les sources. PUMP, charté au comptant sur Bybit (place la plus
profonde depuis le 26 septembre), affichait « Binance uniquement » dans DES alors
que Binance, Bybit, OKX et Hyperliquid listent un perpétuel PUMP. Choix du
propriétaire : les quatre places perp d'AXIOM, Binance d'abord, avec sélecteur.
**39 fenêtres, 218 indicateurs, 9 identifiants de marché, aucune dépendance,
aucun hôte ni fournisseur, `@axiom/types` inchangé ; une règle de proxy élargie.**

1. **Découverte par actif** (`data/marchesPerp.ts`). DES ne dépend plus de la place
   au comptant du graphe. L'actif (base) est cherché dans le catalogue Coinalyze
   `/v1/future-markets` : un appel d'environ 1,6 Mo, cache mémoire 12 h, échec
   mémorisé 60 s, requêtes simultanées partagées. Les codes `A`, `6`, `3` et `H`
   désignent Binance, Bybit, OKX et Hyperliquid. Le `base_asset` normalisé couvre les
   alias (PUMP = `PUMPFUNUSDT` chez Bybit) et les contrats fractionnés (`1000PEPE`,
   `kPEPE` chez Hyperliquid, libellés « contrat ×1000 »). Un marché par place :
   marge stable, multiplicateur 1, puis USDT > USDC > USD. Les identifiants Coinalyze
   gardent leur casse (`kPEPE.H` ; `KPEPE.H` ne renvoie rien).
2. **Place affichée.** Binance, puis Bybit, OKX et Hyperliquid ; un perp Hyperliquid
   charté met sa place en tête. Le sélecteur « Place du perpétuel » retient le choix
   par actif pour la session, sans persistance ; les sous-panes OI/funding du graphe
   suivent le même marché. Aucun agrégat multi-places : une place à la fois, avec
   place, contrat et identifiant Coinalyze affichés.
3. **Absences explicites.** Sans clé, DES suppose le perp Binance sans appeler le
   catalogue. Catalogue injoignable : même repli, signalé, avec un nouvel essai
   toutes les 60 s. Aucun perp sur les quatre places, ou instrument TradFi ou
   synthétique : message dédié. Quand la place affichée ne publie pas une métrique
   chez Coinalyze (ratio long/short : ni OKX ni Hyperliquid ; liquidations : jamais
   Hyperliquid), DES la lit chez la première place qui la publie (Binance, Bybit,
   OKX) et l'étiquette (« Long / Short agrégé · Binance ») ; sans aucune place,
   l'absence est affichée. Une liste de liquidations vide signifie « aucune
   remontée », pas un zéro affirmé. Les référentiels « vs historique »
   (séries Binance USDⓈ-M) ne s'affichent que pour Binance. Le sentiment Binance
   sans clé apparaît dès qu'un perp Binance existe pour l'actif.
4. **Funding annualisé à la cadence réelle.** L'APR et le prochain règlement
   utilisent l'intervalle de la place : `fundingInfo` Binance (8 h par défaut),
   `instruments-info` Bybit, `funding-rate` OKX, 1 h pour Hyperliquid. L'hypothèse
   « base 8 h » était fausse d'un facteur 2 pour les perps à 4 h et de 8 pour
   Hyperliquid. Cadence inconnue : l'APR n'est pas calculé.
5. **Proxy.** `api/_policy.ts` autorise `v1/future-markets` pour la clé serveur
   Coinalyze ; les autres chemins restent refusés (test `vercelServerCredentials`).

Validation : `pnpm check` réussi (web 416 fichiers / 5 883 tests, indicateurs 1 570,
alertes 139, backtest 143, daemon) ; `pnpm check:e2e` 165/165, dont le nouveau
parcours `des-multi-places`. Budget d'entrée (Node 24.13, zlib 1.3.1) : HEAD
1 201 449 / 358 787 → **1 203 659 / 359 368** octets bruts/gzip (+2 210 / +581),
plafonds 1 220 000 / 360 000 inchangés ; le graphe charge le module de découverte
à la demande. Contrôle sur API réelles, PUMPUSDT en 1d (« Auto · Bybit ») : DES
affiche le perp Binance PUMPUSDT (OI 143,9 M$, APR au règlement de 4 h), puis OKX,
Bybit et Hyperliquid au sélecteur, avec un seul appel au catalogue. Limites : quatre
places seulement ; les indicateurs du graphe (OI, funding, L/S) restent adossés au
perp Binance du symbole ; marge gzip réduite à 632 octets.

Complément du même jour : sur PUMP-PERP (graphe Hyperliquid), DES n'affichait ni
ratio long/short ni liquidations. Les métriques manquantes viennent désormais d'une
autre place, étiquetée ; les résultats Coinalyze sont lus à positions fixes, un
appel sauté ne décale plus les séries. `pnpm check` réussi (web 5 887 tests),
parcours DES 12/12, dont un actif coté seulement sur Hyperliquid.

## AXIS — confluence de signaux (demande du 7 octobre 2026)

Le propriétaire demande, dans l'onglet Stratégies, un indicateur nommé **AXIS**
qui combine plusieurs signaux d'achat et de vente et marque sur le prix les
achats et les ventes. Cette demande autorise une définition
supplémentaire, `stratAxis` (catégorie `strategy`, pane prix), soit **219
indicateurs** dont 31 stratégies. Aucun nouvel écran, fournisseur, secret,
dépendance ni ordre réel. Quatre changements de `@axiom/types` :
`IndicatorDef.auxFacultatives` le soir du même jour (voir la couche flux),
`CalcContext.timeframe` le 8 octobre (voir l'unité de temps au calcul),
`IndicatorDef.amorceBougies` le 9 octobre (voir la fidélité d'affichage),
`IndicatorOutput.masquee` le 9 octobre encore (voir les sorties masquées).

- Six votes (+1, −1 ou 0) à la clôture, tous issus de cœurs existants : EMA 20/50,
  direction du Supertrend 10 × 3, +DI contre −DI seulement si l'ADX 14 atteint le
  seuil (20), MACD 12/26/9 contre son signal, RSI 14 contre 50, signe du CMF 20.
  Le score (−6 à +6) reste absent tant qu'un des cinq premiers cœurs n'est pas
  amorcé ; un CMF indéfini (volume nul) vote 0 sans bloquer le score. `cmfOf` est
  extrait de `volume/cmf.ts`, sans changement du CMF.
- Lecture long/plat, flèches alternées : achat à score ≥ +5 avec clôture
  au-dessus de l'EMA de tendance (200), vente à score ≤ −4 ; armement (la
  condition d'achat a d'abord été fausse une fois) ; la dernière bougie n'est
  jamais lue (anti-repaint, convention de `defStrategie`). Sortie `prixSignal`
  (prix d'achat tenu pendant la position) à l'échelle prix ; 120 marqueurs et
  10 étiquettes au plus. Calcul indépendant de l'unité de temps : AXIS est
  utilisable sur **toute unité** (demande du propriétaire du 2026-10-07,
  après une première journée réservée au 4h) ; seul le 4h a passé un test,
  et l'infobulle dit le statut de l'unité affichée (voir le test sur les
  autres unités).
- Statut : la v1 (épisodes ±4, sortie au retour du score à 0, long et short) a
  été **recalée** par la campagne du 2026-10-07
  (`scripts/axis/rapport-2026-10-07.md`, verdict DÉFAVORABLE). La v2, choisie
  sur les seules données déjà vues parmi ~35 lectures du score, a passé le test
  final du même jour sur données jamais vues (BTC/ETH/XRP/SOL, 4h, 2017-2024 ;
  protocole figé avant téléchargement, `scripts/axis/manifeste-v2-2026-10-07.json`,
  revue indépendante du protocole, exécution unique) : verdict **FAVORABLE**,
  21 blocs sur 21, timing p = 0,0005. Comparaison pré-déclarée sans effet sur
  le verdict : pas mieux qu'une EMA 200 seule en PnL net total sur 3 actifs
  sur 4. Suites du manifeste appliquées : champ `validation` retiré ; chaque
  infobulle porte la réserve honnête choisie par le runner (« test réussi…,
  pas mieux qu'une EMA 200 seule sur 3/4 actifs — mesure passée, pas une
  promesse »). Absente de BT et de `scripts/valider-strategies.ts` (réservé à
  `defStrategie`).
- **Couche flux** (demande du propriétaire du 2026-10-07, le soir : volume
  exécuté et intérêt ouvert pour repérer les gros mouvements). Trois lectures
  par bougie, chacune absente quand sa donnée manque : volume relatif (volume /
  SMA 20 du volume), delta taker ((acheteur − vendeur) / volume, champs taker des
  bougies Binance), ΔOI (variation % sur 6 bougies de la série aux `oi`). Par
  défaut, elle ne déplace aucun ▲/▼ (cœur testé intact) : elle **qualifie** les
  signaux (« fort » : deux confirmations sur trois lectures, toutes sinon,
  jamais avec un delta à contre-sens ; étiquettes « Achat fort » / « Vente
  forte »), pose des marqueurs **fort achat / forte vente** (couleur `--accent`,
  volume ≥ 3 × la moyenne, sens du delta taker à 10 % du volume sinon du corps,
  hors bougies de signal et dernière bougie, 60 au plus, étiquette « Fort achat
  ×n » sur les trois derniers ; `grosMouvementsAxis`, fonction pure exportée
  que la campagne rejoue) et offre un filtre optionnel « N'acheter que sur
  flux fort » (désactivé par défaut ; activé, l'infobulle remplace la réserve
  du test par « filtre flux actif : signaux hors du test…, non mesurés »).
  Six réglages de plus (14 inputs). Pure comme le reste du moteur : aucun fetch.
- **Test de la couche flux** (demande du propriétaire du 2026-10-08 : repérer
  les forts achats et fortes ventes et le backtester). Exploration sur les
  seules données déjà vues (`scripts/explorer-axis-flux.ts`, 36 définitions ×
  7 horizons) : la définition livrée a priori tient ; de l'exploration viennent
  seulement le sens testé (forts achats → continuation) et l'horizon (12
  bougies). Protocole figé avant téléchargement
  (`scripts/axis/manifeste-flux-2026-10-08.json`, hash épinglé dans
  `scripts/valider-axis-flux.ts`, 14 fichiers de code vérifiés), revue
  indépendante (`scripts/axis/journal-revue-flux-2026-10-08.md`, aucun
  bloquant, 4 mineurs corrigés avant figeage), répétition `--essai` sur les
  séries vues, exécution unique sur quatre actifs jamais lus par le dépôt
  (BNB/ADA/LINK/DOGE, Binance Spot 4h avec volume taker, 2017-2019 → 2026-10-08).
  Contrôles bloquants : événements = marqueurs `--accent` du chart et signaux
  exclus = ▲/▼ du chart, causalité sur préfixes réels, statistique par deux
  méthodes. Verdict **FAVORABLE** (`scripts/axis/rapport-flux-2026-10-08.md`) :
  690 forts achats, +1,61 % en moyenne à 12 bougies, p ≤ 0,0005 par décalage
  circulaire commun, 3 cellules sur 4 positives (BNB −0,14 %) ; **51 % de
  hausses** seulement, médiane +0,10 % ; nul complémentaire par permutation des
  sens p = 0,047 (tout fort mouvement est suivi de +1,12 % en moyenne). Fortes
  ventes : aucune suite mesurable. Signaux « forts » : pas meilleurs que les
  ordinaires (3/4), ventes « fortes » sans baisse supplémentaire (p 0,55).
  Suites du manifeste appliquées : infobulle des forts achats au statut mesuré
  (formulation pré-rédigée, chiffres du résultat), fortes ventes « repérée ;
  aucune suite mesurable », signaux « qualification descriptive, sans avantage
  mesuré » ; garde : les formulations mesurées n'apparaissent que sur une bougie
  à delta taker (population mesurée), sinon « couche flux non mesurée ». OI et
  filtre flux non mesurés. Ces données sont consommées.
- **Test sur les autres unités de temps** (demande du propriétaire du
  2026-10-08 : « teste-le sur les autres unités de temps également »). Rien
  ne change dans le calcul ; seuls les défauts sont mesurés, dans les treize
  unités Binance Spot de l'application hors 4h (1s à 1w ; 1M à 12M non
  mesurables, historique trop court ; 5s et 15s sans source), sur 42 alts
  jamais lues par une campagne AXIS (paires USDT cotées avant 2020, hors
  stablecoins). Protocole figé avant téléchargement
  (`scripts/axis/manifeste-ut-2026-10-08.json`, hash épinglé dans
  `scripts/valider-axis-ut.ts`) : signaux S1-S4 (expectancy nette aux coûts
  x1 et x3, timing par décalages circulaires communs, étendue, deux moitiés)
  et forts achats F1-F3 (continuation à 12 bougies, étendue, coût
  aller-retour), seuil de Bonferroni 0,0038 sur les treize unités, contrôles
  bloquants des campagnes précédentes. Revue indépendante
  (`scripts/axis/journal-revue-ut-2026-10-08.md`) : figeage d'abord refusé
  (p-valeurs des grandes unités, historique, traçabilité), autorisé après
  corrections ; commit de figeage `287e014`, que la campagne exige
  identique. Exécution unique le 2026-10-08, de 10:02 à 10:13 UTC (534
  séries sur 546 ; CVC et FTT absentes de 2h à 1w). Verdict : **aucune unité
  ne passe** (`scripts/axis/rapport-ut-2026-10-08.md`). Signaux perdants
  après frais de 1s à 30m et en 3d, à peu près nuls en 1h (+0,06 % par trade
  aux coûts x1, négatifs aux coûts x3) ; de 2h à 1d, expectancy nette
  positive (+1,64 % à +35,76 % par trade) et PnL positif sur 32 à 39 actifs
  sur 40, mais timing non significatif (p 0,055 à 0,12) et expectancy hors
  frais 3,9 à 6,8 fois plus forte dans la première moitié des décisions
  (jusqu'à juin-octobre 2023 selon l'unité, avec le cycle haussier de
  2020-2021) ; 1w non concluant (2 trades clos, environ un an de décisions
  après les 300 bougies d'amorce). Forts achats défavorables partout :
  moyenne à 12 bougies quasi nulle (±0,02 %) de 1s à 5m, négative de 15m à
  12h, positive mais non significative de 1d à 1w. La répétition sur les symboles déjà vus laissait croire à des
  forts achats favorables de 2h à 1d : non confirmé. Suites du manifeste
  appliquées : signaux et marqueurs inchangés ; `textesAxis(ctx.timeframe)`
  donne l'infobulle de chaque unité (formulations pré-rédigées, chiffres du
  résultat ; 4h ou unité absente : textes des tests 4h ; 1M à 12M, 5s et
  15s : « non mesuré »). Ces données sont consommées.
- **Stop suiveur et test v3** (demande du propriétaire du 2026-10-08 :
  « améliore encore l'outil et backteste-le » ; la faiblesse visée était
  « aucun stop » dans les limites du test v2). Nouveau réglage `stopAtr`
  (× ATR 14 de Wilder, défaut 0 = la v2 exacte, vérifiée identique au
  caractère près) : stop suiveur à cliquet = plus haut close depuis l'entrée
  − k × ATR, déclenché sur une clôture sous le niveau fixé à la bougie
  précédente, réarmement après une sortie par stop, raison « score »
  prioritaire ; sortie `stop` à l'échelle prix (absente à plat et à la sortie,
  reportée sur la bougie en formation), ▼ étiquetés « Stop » avec le niveau
  franchi ; `positionsStopAxis` et `textesAxis(u, stopAtr)` exportés.
  Exploration sur les seules données déjà vues (`scripts/explorer-axis-v3.ts`,
  8 symboles 4h avant le 2023-07-01, 13 variantes) : le choix (3 × ATR 14,
  métrique Sharpe par bougie) a changé la règle annoncée (RoMaD médian) après
  lecture des résultats — degré de liberté journalisé dans le manifeste.
  Protocole figé avant téléchargement
  (`scripts/axis/manifeste-v3-2026-10-08.json`, hash épinglé dans
  `scripts/valider-axis-v3.ts`, 15 fichiers de code et l'arbre des trois
  paquets vérifiés), revue indépendante
  (`scripts/axis/journal-revue-v3-2026-10-08.md` : trois majeurs corrigés —
  indépendance en temps reformulée, trois paires du test de charge UT
  retirées du pool, part des sorties par stop corrigée — puis contre-revue),
  répétition sur les symboles vus défavorable (1/8) consignée sans
  modification, commit de figeage `3894910`. Exécution unique le 2026-10-08
  (13:50-13:51 UTC) sur **151 alts USDT jamais lues** (cotées 2020-01 →
  2023-06), 4h, 2023-07-01 → 2026-10-08 : verdict **DÉFAVORABLE**
  (`scripts/axis/rapport-v3-2026-10-08.md`) — P1 tenu (7 947 trades clos,
  +0,71 % par trade à ×1, +0,43 % à ×3), mais Sharpe v3 > v2 sur 41,1 % des
  cellules seulement (seuil 60 %) et 37,7 % en première moitié (seuil > 50 %
  dans chaque). Le stop réduit le drawdown (plus faible sur 82,8 % des
  actifs, médiane 12,1 % contre 15,4 %) et l'exposition (23,4 % contre
  30,5 %), mais coupe 81 % des sorties à +1,57 % de gain moyen là où la v2
  récupère (PnL moyen +3,8 % contre +6,4 % par actif). Suites du manifeste
  appliquées : défaut conservé à 0 (signaux et textes de la v2 inchangés),
  infobulle à stopAtr 3 = échec chiffré des suites DÉFAVORABLE, autre
  multiplicateur = « hors du test », test croisé
  `apps/web/src/chart/indicators.axisStop.test.ts` (empreinte du résultat
  épinglée). Ces données sont consommées.
- **Fidélité d'affichage** (demande du propriétaire du 2026-10-09 : « revoir
  l'outil pour le rendre encore plus précis » ; lot A, aucune donnée jamais
  vue consommée). Les tests lisent des séries longues, le chart calculait sur
  son backfill de 500 bougies ; AXIS a une longue mémoire (EMA 200, lissages
  de Wilder, position tenue). Mesure sur les 8 séries 4h déjà vues (fenêtres
  glissantes, 300 dernières bougies décidées) : à 500 bougies, **60 % des
  fenêtres** montrent au moins un signal absent ou en trop par rapport à la
  série longue (11,6 % des signaux affichés faux, 11,6 % des signaux mesurés
  manquants) ; 0,4 % des fenêtres à 1 000 ; **aucun écart à 1 500**. Suites :
  `IndicatorDef.amorceBougies` (déclaratif, comme `aux` et `minTimeframe` ;
  AXIS déclare 1 500) ; le chart étend son backfill jusqu'à l'amorce des
  définitions actives par le mécanisme de l'extension de session
  (`amorceMinimale`, `limitePageAmorce`, `doitEtendreHistorique`,
  `etendreSessionJusqua` avec `bougiesMin`/`lireNombre`, compte en bougies
  donc exact sur une série à trous ; deux pages après le premier rendu, un
  recalcul, rien sans définition qui l'exige) ; sous 1 500 bougies,
  l'infobulle de chaque signal porte « amorce courte (N bougies, 1500
  attendues) : signaux pouvant différer de ceux d'une série longue », placée
  avant la couche flux pour laisser intacte la fin de l'infobulle que les tests
  croisés comparent aux formulations figées ; daemon : fenêtre glissante 1 min
  portée de 500 à 1 500 (`FENETRE_BOUGIES`), backfill REST paginé (1 000 klines
  par requête au plus) et fusionné avec les clôtures du flux au lieu de les
  remplacer — n'affecte que les alertes évaluées onglet fermé (1 min ou
  héritées). Signaux et textes sur série longue inchangés au caractère près ;
  screener (200 klines) inchangé.
- **Filtre ADX à l'entrée et test v4** (même demande du 2026-10-09, lot B ;
  la faiblesse visée était la sélection des entrées : la v2 achète dès six
  votes ≥ 5 au-dessus de l'EMA 200, y compris en tendance molle, le test v3
  ayant montré que les sorties n'amélioraient pas le rendement ajusté du
  risque). Nouveau réglage `adxEntree` (16e input, défaut 0 = la v2 exacte,
  vérifiée identique au caractère près) : achat seulement si ADX 14 ≥ k à la
  clôture de décision (le même ADX que le vote DMI ; ADX indéfini = faux), la
  condition d'achat ainsi complétée étant celle que l'armement observe ;
  ventes inchangées ; l'infobulle d'achat nomme la valeur d'ADX ;
  `textesAxis(u, stopAtr, adxEntree)` (mention du filtre avant celle du stop) ;
  `ADX_ENTREE_PERIODE` et `ADX_ENTREE_TESTE` exportés. Exploration sur les
  seules données déjà vues (`scripts/explorer-axis-v4.ts`, 151 alts du test v3
  et 8 grandes cryptos 4h, 13 variantes d'entrée à sorties inchangées, règle
  pré-écrite dans l'en-tête du script) : **aucune variante retenue** — adx-25
  première sur les alts (Sharpe > v2 sur 62,3 %, moitiés tenues) mais 2
  grandes cryptos sur 8 au lieu des 5 exigées ; le propriétaire a décidé de la
  tester quand même sur le pool jamais vu, l'écart à la règle déclaré dans le
  manifeste (`historique.choixV4`, `criteres.ecartRegleExploration`, limite).
  Pool sondé par dates de cotation seulement (open time de la première kline
  journalière, aucun prix gardé). Protocole figé avant téléchargement
  (`scripts/axis/manifeste-v4-2026-10-09.json`, figé à 2026-10-09T09:48:50Z,
  hash épinglé dans `scripts/valider-axis-v4.ts`, 16 fichiers de code et
  l'arbre des trois paquets vérifiés), revue indépendante
  (`scripts/axis/journal-revue-v4-2026-10-09.md` : aucun bloquant ni majeur,
  trois mineurs appliqués), répétition sur les symboles vus (Sharpe v4 > v2 sur
  4/8) consignée sans modification, commit de figeage `15cf8d0`. Exécution
  unique le 2026-10-09 (09:52-09:53 UTC) sur **123 paires USDT jamais lues**
  (cotées 2023-07 → 2025-06, chaque cellule de sa cotation au 2026-10-09
  exclu, 2 817 à 7 162 bougies), 123/123 cellules, contrôles bloquants
  passés : verdict **DÉFAVORABLE** (`scripts/axis/rapport-v4-2026-10-09.md`)
  — P1 échoue (2 515 trades clos, −1,78 % par trade à ×1, −2,06 % à ×3 : la v4
  perd à elle seule sur ce pool, dont l'achat-conservation a perdu 87 % en
  médiane), P2 tenu (Sharpe v4 > v2 sur 77/123, 62,6 %), P3 échoue en seconde
  moitié (54,5 % puis 48,8 %). Le filtre refuse 53,6 % des entrées de la v2,
  garde 81,8 % de ses trades, réduit le drawdown sur 77,2 % des actifs et perd
  moins (PnL moyen −3,7 % contre −4,9 %), sans rendre la stratégie viable ni
  stable. Suites du manifeste appliquées : défaut conservé à 0 (signaux et
  textes de la v2 inchangés), infobulle à adxEntree 25 = échec chiffré des
  suites DÉFAVORABLE, autre seuil = « hors du test », test croisé
  `apps/web/src/chart/indicators.axisAdx.test.ts` (empreinte du résultat
  épinglée). Ces données sont consommées.
- **Unité de temps au calcul** : `CalcContext.timeframe` (nouveau champ
  facultatif de `@axiom/types`), rempli par `computeIndicator` (paramètre
  facultatif après `aux`) quand l'appelant connaît l'unité, c'est-à-dire le
  chart ; jamais déduit de l'écart entre bougies. Le cache de calcul de
  `chart/indicators.ts` en tient compte : même buffer, autre unité, autre
  résultat. Alertes, screener et backtest calculent sans unité.
- **Séries auxiliaires facultatives** : `IndicatorDef.auxFacultatives` (nouveau
  champ de `@axiom/types`) déclare des séries lues si l'appelant les fournit,
  jamais exigées — un def ne les déclare que si sa sortie reste complète sans
  elles. Elles ne rendent jamais le def inutilisable (l'OI d'AXIS en `aux`
  l'aurait réservé aux perps USDT et écarté des alertes). Côté web,
  `lib/indicatorUsability.ts` (`auxFacultativesServies`) ne demande que les
  séries que le contexte peut servir, avec les mêmes règles par série que pour
  `aux` (`raisonAuxIndisponible`), et `chart/indicators.ts` les demande à part :
  seules les séries requises décident du statut (pending/UNUSABLE), les
  facultatives enrichissent le calcul quand elles arrivent (`onAuxReady`).
  Alertes, screener et backtest calculent sans aux : lectures « n.d. ».
- **Sorties masquées et rejeu commun** (9 octobre 2026). Quatre sorties dont
  deux **masquées** — `etat` (1 acheté, 0 à plat) et `score` (−6 à +6),
  calculées mais jamais tracées : nouveau champ `IndicatorOutput.masquee`
  (déclaratif, honoré par `chart/indicators.ts` : ni figure ni jeton de
  couleur ni statut « tracé » ; le panneau d'alertes les liste comme les
  autres sorties). La borne de décision `fin` vaut n−1 quand la source dit la
  dernière bougie clôturée (`closed === true` : runtime des alertes, flux WS
  ou REST des sources qui posent le drapeau), n−2 sinon — les campagnes
  figées (klines sans `closed`) sont inchangées ; le chart gagne au plus
  l'instant entre la clôture constatée par la source et la bougie suivante.
  Fenêtre BT : opérandes `stratAxis.etat`/`stratAxis.score` au catalogue et
  preset livré `builtin:axis` (« AXIS confluence (4h) », entrée `etat ≥ 1`,
  sortie `etat ≤ 0`, le moteur remplit à l'open suivant avec frais/slippage ;
  stop/target/risque à la main, `stopAtr` non pré-réglé — test v3 échoué ;
  « mesure passée, pas une promesse », BTC/ETH 2024-2026 in-sample). Rejeu
  commun : `enregistrerSpecStrategie` (nouvel export de
  `utils-fabrique-strategie.ts`) enregistre la spec d'AXIS hors
  `defStrategie` — `etatsStrategie("stratAxis")` et
  `scripts/valider-strategies.ts` la rejouent (clôture-à-clôture hors frais),
  `positionAxis` étant identique à `calc().series.etat` élément par élément.
- **Garde-fou de régime BTC (v5, 10 octobre 2026)** : réglage `regimeBtc` —
  quand il est > 0, l'achat exige en plus que la série `refClose` (aux
  facultative ; BTC du chart, alignée par ouverture en LOCF) clôture au-dessus
  de sa propre EMA de `regimeBtc` bougies, calculée depuis la première valeur
  définie (`emaDepuisPremiereDefinie` — l'`ema` du dépôt compterait les
  indéfinies pour 0 dans l'amorce). Référence ou EMA indéfinie → garde-fou NON
  appliqué (condition de la v2) : alertes, fenêtre BT, screener et rejeu
  commun n'ont pas de référence. Variante `btc-ema100` retenue par la règle
  pré-écrite de l'exploration sur données vues (Sharpe > v2 sur 77,5 % des
  151 alts, 6/7 majors, `scripts/explorer-axis-v5.ts`, SANS VALEUR PROBANTE) ;
  test unique sur données jamais vues — 139 paires USDT spot KuCoin cotées
  2019-2024, 4h, suivies au 2026-10-10, manifeste
  `scripts/axis/manifeste-v5-2026-10-10.json` figé puis commité (`c7c8b3d`),
  contrôles croisés à 0 écart — verdict **FAVORABLE**
  (`scripts/axis/rapport-v5-2026-10-10.md`) : les 5 blocs tenus, expectancy
  regroupée 4,58 % contre 3,29 % (x1) et 4,30 % contre 3,00 % (x3), Sharpe
  meilleur sur 75,5 % des cellules (64,0 % puis 70,5 % par moitié), DD médian
  18,3 % contre 21,9 %, 23 % des entrées v2 refusées, achat-conservation −96 %
  médian sur ce pool. Suites appliquées : défaut devenu 100 ; infobulle =
  mesure en 4h, « non mesuré en {u} » ailleurs, « sans garde-fou » à 0, « hors
  du test » aux autres périodes ; `refClose` du chart portée à l'amorce
  (1 500 bougies, deux appels fusionnés). Ces données sont consommées.
  Le même jour, la référence a été servie hors du chart : `ParamsBacktest.aux`
  et `ContexteAlerte.aux` (champs facultatifs d'`@axiom/types` portés par les
  deux moteurs, qui restent purs et ne fetch jamais) ; la fenêtre BT charge
  `refSymbol` paginé sur la fenêtre du run (note « référence chargée » /
  « indisponible → v2 ») et le runtime des alertes web réutilise
  `auxProvider` (même clé de cache `refClose:{refSymbol}:{tf}`, même fetch,
  une seule évaluation par clôture après l'arrivée de la série, échec → v2).
  Le daemon (alertes 1 min héritées), le screener et le rejeu commun
  (`valider-strategies.ts`) restent SANS référence — condition de la v2.
- **AXIS S/R — duplication avec futures zones de support/résistance (demande du 19 octobre 2026)** :
  sur demande explicite du propriétaire (« duplique la stratégie, l'une avec les
  résistances et supports, l'autre sans »), `stratAxis` (« AXIS ») reste
  strictement inchangée (sans zones S/R), et une 220e définition `stratAxisSr`
  (« AXIS S/R », catégorie `strategy`, pane `overlay`, 32e stratégie) partage
  les cœurs purs de `stratAxis` et y ajoute `zonesSrAxis` : confirmation causale
  des pivots de swing (`pivotSr`, défaut 5 bougies gauche/droite : pivot en
  $p = i - g$ confirmé à la clôture $i$, zéro repaint), agrégation en zones
  d'épaisseur adaptative `± zoneSrAtr × ATR 14` (défaut 0,5), comptage des
  touches et des rejets sur volume fort (`rvol ≥ seuilRvol`), inversion de
  polarité S↔R après cassure franche d'une zone renforcée (≥ 2 touches ou rejet
  sur volume fort ; retirée à la seconde cassure), projection des `maxZonesSr`
  (défaut 4) futures zones de support (`--up`) et de résistance (`--down`) les
  plus proches du cours jusqu'au bord droit via `annotations.rubans` et
  `annotations.segments`, exposition des sorties masquées `support` et
  `resistance` (et du preset BT `builtin:axis-sr`), et filtre d'entrée optionnel
  `margeResistanceAtr` (défaut 0 = mêmes signaux qu'AXIS) exigeant une marge
  minimale en ATR sous la résistance active la plus proche.
- Chargement initial : AXIS coûte ~800 octets gzip, la couche flux ~1 200 de
  plus, les infobulles par unité ~1 000 de plus. Sur le modèle de BT et SIG, les commandes EQS, WHALE et MARKS vivent
  dans `commands/windowPanels.ts` (EQS : bascule identique ; WHALE et MARKS :
  `import()` du contrôleur au premier usage, qui démarre à l'import comme
  avant) ; les marqueurs éco sont chargés avec EcoWindow, seule à les activer.
  `store/screener`, `chart/whaleBubbles`, `chart/tradeMarkers` et
  `chart/ecoMarkers` rejoignent les modules différés de
  `chargementInitial.test.ts`. BOOK suit le même modèle : seul le store de bascule
  (`chart/depthHeatBascule`) reste au démarrage, `chart/depthHeat` (avec `data/depth` et
  `chart/rampesHeat`) est chargé par `import()` à la première activation — par la commande
  comme par ChartInstance, qui construit le contrôleur canvas à l'arrivée du module.

Validation : `pnpm -r typecheck` réussi ; vitest indicateurs 970 tests (dont 43
pour AXIS ; mutations du calcul détectées), alertes 122, backtest 129, pacte
120, web 416 fichiers / 5 893 tests ; daemon 780 tests (Bun 1.4.2). Les
runners `scripts/valider-axis-flux.ts` et `scripts/explorer-axis-flux.ts`
passent `tsc --strict` avec les options du `tsconfig.base.json`.
Budget d'entrée (Node 24.21, zlib 1.3.2.1) : **1 198 184 / 358 154** octets
bruts/gzip après la couche flux et les trois modules différés, plafonds
1 220 000 / 360 000 inchangés, marge gzip **1 846 octets** (166 avant) ;
**1 198 919 / 358 429** après les infobulles mesurées du 8 octobre (marge gzip
1 571).
Après le test sur les autres unités : `pnpm -r typecheck` réussi ;
indicateurs 977 tests (dont 48 pour AXIS ; mutations des textes par unité
détectées), alertes 122, backtest 129, pacte 120, web 417 fichiers / 5 917
tests (dont 21 qui recoupent au caractère près les infobulles de chaque
unité avec le résultat de la campagne) ; daemon 780 tests (Bun 1.4.2) ;
`scripts/valider-axis-ut.ts` passe `tsc --strict`. Budget : **1 202 601 /
359 453**, marge gzip **547 octets** : le prochain lot qui touche le chemin
initial doit d'abord libérer des octets.
Après le stop suiveur (v3) et BOOK différé : `pnpm -r typecheck` réussi ;
indicateurs 998 tests (dont 69 pour AXIS ; mutations du stop détectées),
alertes 122, backtest 129, pacte 120, web 419 fichiers / 5 933 tests (dont 10
qui recoupent au caractère près les infobulles du stop avec le résultat de la
campagne v3, empreinte épinglée) ; daemon 780 tests (Bun 1.4.2) ;
`tsc --strict` propre sur `scripts/valider-axis-v3.ts` et
`scripts/explorer-axis-v3.ts` au figeage (depuis, la garde
`HASH_MANIFESTE === "A_FIGER"` du runner soulève TS2367, littéraux
disjoints : erreur statique sans effet à l'exécution, et le fichier figé
ne peut être retouché sans invalider l'arbre vérifié). Budget :
**1 192 494 / 356 283**, marge gzip **3 717 octets** (BOOK différé a
libéré 3 665 ; le stop en a coûté 495).
Après la fidélité d'affichage (9 octobre) : `pnpm check` réussi — typage des
8 projets ; indicateurs 1 001 tests (dont 72 pour AXIS : amorce déclarée,
mention chiffrée présente sous 1 500 bougies et absente au-delà sur une même
série, jamais sur les forts achats), alertes 122, backtest 129, pacte 120,
web 419 fichiers / 5 940 tests (dont 32 pour l'extension d'historique :
amorce lue sur la définition, 500 → 1 500 en deux pages puis rien, session et
amorce combinées, source à sec), daemon 785 tests (Bun 1.4.2 ; backfill
paginé, fusion avec le flux) ; les tests croisés des infobulles figées
(`indicators.axisUnites.test.ts`, `indicators.axisStop.test.ts`) passent
sans modification. Budget : **1 193 086 / 356 453** (+592 / +170), marge gzip
**3 547 octets**.
Après le filtre ADX à l'entrée (v4, 9 octobre) : `pnpm check` réussi — typage
des 8 projets ; indicateurs 1 010 tests (dont 81 pour AXIS : équivalence
exacte de la v2 à `adxEntree` 0, achats retardés de la fixture, recoupement du
chart avec `positionsAxis`, combinaison avec le stop, causalité, textes après
verdict), alertes 122, backtest 129, pacte 120, web 420 fichiers /
5 951 tests (dont 11 qui recoupent au caractère près les infobulles du
filtre avec le résultat de la campagne v4, empreinte épinglée), daemon
785 tests (Bun 1.4.2) ; `tsc --strict` propre sur
`scripts/valider-axis-v4.ts` avant et après le figeage (`HASH_MANIFESTE`
déclaré `string`) et sur `scripts/explorer-axis-v4.ts` ; banc des chemins de
verdict 39 vérifications. Budget : **1 193 835 / 356 648** (+749 / +195),
marge gzip **3 352 octets**.
Après les sorties masquées et le rejeu commun (9 octobre) : `pnpm check`
réussi — typage des 8 projets ; indicateurs 1 659 tests (dont 87 pour AXIS :
`etat` = `positionsStopAxis`/`positionAxis` élément par élément, bougie
`closed` décidée, invariant sans `closed` identique au caractère près),
alertes 142 (dont 3 de tir aux signaux de la fixture), backtest 143, pacte
120, web 421 fichiers / 5 958 tests (dont 4 sur le masquage — figures, statut
« vide », jetons — et 3 sur le preset `builtin:axis` et `runBacktest` de la
fixture), daemon 785 tests (Bun 1.3.11). Budget : **1 194 813 / 355 849**
(+978 / −799), marge gzip **4 151 octets**.
Après le garde-fou de régime (v5, 10 octobre, suites du verdict FAVORABLE) :
`pnpm check` réussi — typage des 8 projets ; backtest 145 (dont `engine.aux.test.ts`), alerts 144 (dont
les cas `aux.refClose` de `engine.axis.test.ts`), web dont
`backtest-indicateurs.test.ts` (aux transporté au worker, note, pas de fetch
sans `refClose`) et `runtime.test.ts` (alerte AXIS → référence, RSI → non) ;
indicateurs dont stratAxis.test
(contrat défaut 100, `emaDepuisPremiereDefinie`, équivalence à 0, cas
référence croissante/décroissante/indéfinie/partielle, armement, causalité,
textes à chaque réglage), web dont `indicators.axisRegime.test.ts` (empreinte
du résultat épinglée, formulations FAVORABLE comparées au résultat) et
`auxProvider.test.ts` (deux pages `refClose` fusionnées, 1 500 bougies),
alertes 142, backtest, pacte 120, daemon — comptes exacts dans le rapport de
suite ; `tsc --strict` du runner v5 figé signalant sa garde pré-verdict si
littéraux disjoints (fichier figé, non retouché).
Usage, limites et tests :
[`docs/axis-2026-10-07.md`](docs/axis-2026-10-07.md),
[`scripts/axis/rapport-v2-2026-10-07.md`](scripts/axis/rapport-v2-2026-10-07.md),
[`scripts/axis/rapport-flux-2026-10-08.md`](scripts/axis/rapport-flux-2026-10-08.md),
[`scripts/axis/rapport-ut-2026-10-08.md`](scripts/axis/rapport-ut-2026-10-08.md),
[`scripts/axis/rapport-v3-2026-10-08.md`](scripts/axis/rapport-v3-2026-10-08.md)
[`scripts/axis/rapport-v4-2026-10-09.md`](scripts/axis/rapport-v4-2026-10-09.md)
et [`scripts/axis/rapport-v5-2026-10-10.md`](scripts/axis/rapport-v5-2026-10-10.md).

## Dominance des stablecoins (demande du 29 octobre 2026)

Le propriétaire demande « la courbe de l'USDT+USDC+DAI dominance afin de voir la dominance des
stablecoin sur le marché ». Elle est livrée comme série chartable autonome **`STABLE.D`**, de
source `synthetic` comme TOTAL/TOTAL2/TOTAL3 : `100 × (USDT + USDC + DAI) / TOTAL`, en %, soit
l'équivalent de `USDT.D+USDC.D+DAI.D` sur TradingView. **39 fenêtres, aucun indicateur,
aucun fournisseur ni hôte nouveau (endpoint CMC public de l'exception du 2026-09-01), aucune
dépendance, `@axiom/types` inchangé.** Exception au gel G100 au titre de la demande explicite du
propriétaire. Spec : `docs/superpowers/specs/2026-10-29-dominance-stablecoins-design.md` ; son
§9 (amendement après revue) prime sur les §0 à §8.

- **Données : CoinMarketCap seul, aucun repli.**
  - Numérateur : `data-api/v3.3/cryptocurrency/detail/chart`, un appel par id (825 USDT,
    3408 USDC, 4943 DAI ; le multi-id est refusé), capitalisation `v[2]` et prix `v[0]`.
  - Dénominateur : le TOTAL CMC (`global-metrics/quotes/historical`). Numérateur et
    dénominateur viennent du même fournisseur et suivent la même méthode.
  - Ni CCData ni l'échantillonnage CoinGecko local n'ont ces capitalisations. Une panne donne
    dans l'overlay « Dominance stablecoins indisponible : … », jamais un repli.
- **Instants (mesurés le 29/10/2026).**
  - Le global 1d daté D est l'instantané de D 00:00 UTC, égal aux points 1h et 4h de 00:00.
  - Le point 1d d'une pièce daté D vaut `prix(D 00:00) × offre(D 23:00)` : USDT et USDC sur
    584 jours sur 584, DAI sur 801 jours sur 849 (le reste est de l'arrondi). Il est publié
    après D 23:00.
  - L'apparier tel quel au TOTAL de D donnait 23 h d'avance au numérateur. Effets : 0,856 pt
    d'erreur le 2020-03-31 ; 295 jours récents sur 499 faux à 2 décimales ; le même instant
    affiché 9.51 en 1d et 9.53 en 4h. La revue indépendante l'a classé bloquant.
  - Correction « V2 » : `cap(D) = cap1d(D−1) × prix1d(D) / prix1d(D−1)`, soit l'offre de
    D−1 23:00 au prix de D 00:00. Pour la barre du jour (ligne de D pas encore publiée) ou un
    prix invalide, on garde `cap1d(D−1)` (« V1 »). Les lancements sont décalés d'un jour sur ce
    chemin : la série 1d commence le 2015-02-26, la série 1h le 2015-02-25 à 13:00.
  - Le point 1h d'une pièce est l'instantané de HH:00 : le 1h et le 4h n'ont pas de décalage.
  - Contrôle indépendant : le module est identique bit à bit à un calcul V2 fait à part, sur
    4 261 jours. Écart à la vérité horaire (somme des capitalisations 1h de 00:00 divisée par le
    TOTAL de 00:00), sur 595 jours : médiane 0,0007 pt, p99 0,064, max 0,10 pt (2022-11-12).
    Référence : 9,5326 % le 28/10/2026, pour une vérité de 9,5331 %.
- **Calcul.**
  - Contribution d'une pièce avant son lancement (USDT 2015-02-25, USDC 2018-10-08, DAI
    2019-11-22) : 0.
  - Après : son dernier point s'il date d'au plus 2 pas (2 j en 1d, 2 h en 1h). Au-delà, aucune
    bougie : jamais de 0 inventé.
- **Unités de temps.**
  - 1h et 4h : pages CMC. Le global est lu à l'unité du graphe et les pièces en 1h, car
    `interval=4h` renvoie du journalier. Pagination par 1 000 bougies, 4 appels par page.
  - Au plus 2 pages en vol : EVTS en 1h passe de 48 requêtes CMC simultanées à 8.
  - 1d à 12M : historique journalier. Le global vient du cache 12 h de TOTAL. Les pièces, prix
    compris, viennent du cache brut `axiom:mcap:cmc-stables:v2` (≈ 186 Ko), rafraîchi par
    incréments.
  - Repoll à la cadence de TOTAL : 5 min en 1h/4h, 15 min au-delà.
  - Règle « pièce vide → erreur ». Seule exemption : une fenêtre 1h qui finit avant le minuit
    suivant le lancement. Les premiers points horaires tombent à 13:00 (USDT), 18:00 (USDC) et
    01:00 (DAI) ; aucune bougie n'est tracée sur les heures qui précèdent.
- **Routage.**
  - `STABLE.D` rejoint `SYMBOLES_CAPITALISATION`. Adaptateur, unités, catalogue, persistance,
    watchlist, bandeau et pagination le traitent donc comme TOTAL, avant la règle
    « . = TradFi ».
  - `estCapitalisationUsd` l'exclut des 5 sites « valeur en USD » : ratios ÷BTC/÷Or/devises,
    jambes `mcap` des SYN, constructeur SYN (« STABLE.D est une série en %, non composable »),
    mesure de `McapSnapshot`.
  - En watchlist, STABLE.D est résolu sans prix, comme TOTAL* (cf. point 2 des corrections du
    24 septembre).
  - Vérifié au navigateur sur API réelles : toutes les requêtes de STABLE.D vont à
    `/extapi/api.coinmarketcap.com`, aucune vers Twelve Data ni vers une place.
- **Interface.**
  - Recherche par `USDT.D`, `USDC.D`, `DAI.D`, `USDT.D+USDC.D+DAI.D`, `STABLES`, `STABLECOINS`
    ou `DOMINANCE`, avec la colonne source « Dominance ».
  - Pas d'alias `STABLE` : un token STABLE existe (rang 89 sur CMC). À rang égal, un marché
    réel passe désormais devant une série `synthetic` (« T » ou « TO » ne mettent plus TOTAL en
    tête ; « TOTAL » exact, si).
  - Préréglage SYN « USDT+USDC+DAI dominance ».
  - Commande ⌘K « Dominance stablecoins (graphe) », sans mnémonique : la frappe « stable »
    ouvre STBL. Les alias pointés tapés comme navigation ⌘K (« usdt.d 4h ») ouvrent STABLE.D au
    lieu de partir vers Twelve Data.
  - Palette ⌘K, pour toutes les commandes : une saisie de plusieurs mots égale à un mot-clé
    (« dominance stablecoins », « open interest »…) ne met plus « Changer la paire → … » en
    tête.
  - Affichage : bandeau, haut/bas et encart en % (« 9.53 % »), Δ et amplitude en points
    (« +0.03 pt »), axe à 2 décimales, « Vol » masqué, composition en infobulle.
  - Correction au passage : les préréglages SYN des séries autonomes (TOTAL*) étaient inertes
    depuis bf25024.
- **Chargement paresseux.**
  - Requêtes, cache, calcul et repoll vivent dans `data/dominanceStablecoins.ts`. Le module est
    chargé par un `import()` mémorisé depuis `data/mcapCandles.ts` et inscrit dans
    `MODULES_DIFFERES`.
  - Si le chunk est introuvable (redéploiement), l'overlay dit « Dominance stablecoins non
    chargée (réseau ou mise à jour d'AXIOM) ; rechargez la page. ». Un nouvel essai ne rattrape
    qu'une coupure passagère.
  - `chart/dataLoadErrorMessage.ts` (ratifié hors attribution) reconnaît les deux erreurs par
    leur nom, sans import de valeur du chunk.
- **Signaux.**
  - Rafraîchissement des pièces en échec : le cache est servi s'il a au plus 24 h, avec un
    `console.warn` ; au-delà, erreur explicite. Un `majTs` futur vaut cache périmé.
  - Repoll en échec : un `console.warn` au premier échec d'une série.
- **Budget.**
  - Chargement initial : **1 186 324 / 355 233** avec la clé factice de la mesure de référence
    (355 231 sans clé, dans `pnpm check`), Node 24.13.0, zlib 1.3.1.
  - Soit +2 337 / +984 depuis 2f187fe (1 183 987 / 354 249). L'objectif d'environ +600 o gzip
    est dépassé, et l'écart est accepté : plafonds 1 220 000 / 360 000, marge gzip 4 767.
  - Chunk paresseux : 6 412 / ≈ 3 060.
- **Limites.**
  - Périmètre littéral USDT + USDC + DAI : ni USDe, FDUSD, PYUSD, ni USDS (successeur de DAI),
    ni SAI. `data-api` n'est pas documentée.
  - Une bougie formée en direct garde, jusqu'au rechargement, la valeur reportée de la pièce,
    publiée un pas après le global :
    - en 1h/4h : écart médian 0,001 pt, max 0,07 pt ;
    - en 1d : V1 jusqu'à la publication de la ligne, écart médian 0,001 pt, max 0,15 pt
      (2020-03-13).
  - Avec 2 décimales, la période 2015–2017 s'affiche entre 0.00 et 0.0x %.
  - Deux fuites préexistantes, relevées ici hors lot, sont corrigées par le lot suivant (voir
    « Fuites des séries synthétiques ») :
    - l'alerte Funding et la fenêtre LIQ envoyaient le symbole à Binance fapi, Bybit et
      Coinalyze ;
    - « USDT.D » + Entrée avant l'arrivée du catalogue commun partait brut vers Twelve Data.
- **Revue et tests.**
  - Revue indépendante en 6 angles (calcul, routage, réseau et sécurité, défaillances
    silencieuses, tests, simplicité), chaque constat contre-vérifié : 26 constats, 20 retenus
    (1 bloquant et 1 important, signalé deux fois), tous traités ou assumés ci-dessus.
  - Deux tours de contrôle indépendant ont suivi : portes, recalcul financier, routage.
  - `pnpm check` vert : typage des 7 projets ; web 424 fichiers / 6 110 tests, indicateurs
    1 043, alertes 127, backtest 131, pacte 120, daemon 786.
  - `pnpm check:e2e` : 171/171 sur 45 fichiers, dont les 4 parcours de
    `dominance-stablecoins.e2e`. Le suffixe est obligatoire dans `scripts/ci.sh` : le motif nu
    sélectionne tout le worktree `.worktrees/dominance-stablecoins/`.

## Fuites des séries synthétiques (demande du 29 octobre 2026)

Le propriétaire demande de corriger « dans un lot séparé » les deux fuites préexistantes repérées
pendant la revue de STABLE.D :
- une série sans marché perp interrogeait des fournisseurs perp ;
- un alias pointé partait brut vers Twelve Data.

**Aucun fournisseur, hôte, dépendance ni indicateur nouveau. `@axiom/types`, `QUOTE_ASSETS`
(`data/symbol.ts`) et `normalizeMarketSymbol` sont inchangés.** Spec :
`docs/superpowers/specs/2026-10-29-fuites-series-synthetiques-design.md`. Ses arbitrages après
revue priment dans cet ordre : §6, §5, puis les §0 à §4.

- **Prédicat partagé.**
  - `sansMarchePerp(exchange, symbol)`, fonction PURE de `store/market.ts`. Il est vrai pour une
    source synthetic ou twelvedata, une série de capitalisation (TOTAL*, STABLE.D), un composite
    (`|`) ou une TradFi reconnue (`isTradfiMarketSymbol`).
  - `sansMarchePerpCible` juge une cible d'alerte saisie : sur un graphe synthetic, la saisie se
    lit comme sur Binance.
  - `grapheSansPerp(state)` est l'aide unique des contrôleurs, évaluée une fois par `sync()`.
  - Jamais `basePerp` ni `actifPerpDe` comme garde réseau : leurs bornes rejettent de vrais perps
    (SUSDT, WUSDT, TUSDT, BROCCOLI714USDT, 1000000PEIPEIUSDT).
  - Balayage des catalogues réels : aucun vrai marché exclu sur 24 134 couples.
- **Sites gardés : aucune requête perp hors perp.**
  - Alertes Funding, CVD S/P et Cascade liq :
    - options désactivées avec un titre, refus à la soumission et dans « Créer l'alerte
      composée » ;
    - `pollFunding` ignore une définition sans perp ;
    - le minuteur de 60 s n'est armé que s'il reste une définition éligible ;
    - les définitions persistées sont conservées, inertes.
  - Liquidations, dont le `sync()` est partagé par la fenêtre LIQ et la heatmap :
    - WS Bybit et OKX fermés, aucune amorce Coinalyze, sondage HL arrêté ;
    - la fenêtre LIQ affiche « Pas de marché perp pour cette série : liquidations
      indisponibles. » ;
    - l'état actif reste persisté et redevient effectif au retour sur un perp ;
    - le déclencheur suit aussi la source.
  - Liquidations par bougie :
    - `raisonUnusableIndicateur` est gardée par le prédicat, symbole compris ;
    - `ChartIndicators` jette la réponse auxiliaire d'un ancien symbole. Une réponse Coinalyze en
      vol ne vise donc plus le nouveau symbole avec la source de l'ancien graphe (IBM, PLTR) ;
    - le sync du backfill demande ensuite le nouveau perp.
  - LIQHL sur Vercel : le scan navigateur démarre au premier perp, atteint par le symbole ou par
    la source. Un scan déjà lancé n'est pas arrêté : son pool sert à toutes les pièces.
  - LIQEST : garde à la synchronisation et au rafraîchissement de 15 min. Avant, EUR/USD
    interrogeait Coinalyze et fapi.
- **Twelve Data.**
  - `resoudreSerieAutonome(saisie)`, fonction PURE de `data/mcap.ts`, rend `{synthetic, série}`
    pour un nom exact de série, un alias pointé ou l'un de ses termes « + » (USDT.D, USDC.D,
    DAI.D).
  - Points d'application :
    - catalogue local de PairSearch : séries comprises avant l'arrivée du catalogue commun ;
    - `setSymbol` ;
    - watchlist : ajout et hydratation ;
    - `sanitizeSlotConfig` ;
    - `preparerIdentite` ;
    - `hydrateChart`, qui résout avant de valider l'unité (1m devient 1h pour STABLE.D) ;
    - `setMarket`, pour une série désignée sur twelvedata.
  - Les alias sans point (STABLES…) rendent `null`. BRK.B, EUR/USD et SPY ne changent pas.
- **Résidus acceptés.**
  - Sur un graphe Twelve Data, une cible perp cotée USD1 ou U (BTCUSD1, BTCU…) reste refusée :
    `QUOTE_ASSETS` ignore ces cotations. Le titre de l'option et le refus disent « Indisponible
    depuis un graphe Twelve Data : ouvrez la paire crypto pour créer cette alerte. », sans nier le
    marché perp.
  - Transitoires :
    - changement de source seul sur le même symbole, avec une réponse en vol ;
    - identité {binance, IBM} créée par une alerte PRIX à source forcée ;
    - kraken+TOTAL.
  - LIQEST : un aller-retour par {synthetic, même symbole} relance l'OI au retour sur le perp.
- **Hors lot**, signalé au propriétaire :
  - NEWS (GDELT), revenus (DefiLlama) ;
  - import Backtest, funding « binance-reel » ;
  - fenêtres liées, comparaison base 100, presets d'espace de travail ;
  - variantes d'alias (combinaisons partielles, BTC.D) ;
  - alerte PRIX à source forcée ;
  - appels au daemon local.
- **Budget.**
  - Chargement initial : **1 188 293 / 355 970** avec la clé factice, sous Node 24.13.0 (355 953
    sans clé, dans `pnpm check`).
  - Soit +1 969 / +737 depuis c2f757d (1 186 324 / 355 233).
  - La cible de +400 o gzip est dépassée ; l'écart est accepté sous le plafond de 360 000, avec
    une marge de 4 030.
- **Revue et tests.**
  - Revue indépendante en 7 tours (fuites, régressions, qualité), puis un contrôle indépendant
    des portes. Moyens : capteurs fetch et WS, tests de course, mutants, et différentiel contre
    c2f757d.
  - `pnpm check` vert : typage des 7 projets ; web 430 fichiers / 6 366 tests, indicateurs
    1 043, alertes 127, backtest 131, pacte 120, daemon 786.
  - `pnpm check:e2e` : 175/175, dont les 4 parcours de `fuites-series-synthetiques.e2e`, inscrit
    avec son suffixe dans `scripts/ci.sh`.
  - Instabilité préexistante, hors lot : `quatre-lots-sauvegardes.e2e.ts:32` échoue parfois. La
    réouverture de NOTE par ⌘K, juste après « Fermer », n'aboutit pas. C'est reproduit à
    c2f757d.

## Graphique COT (demande du 5 novembre 2026)

Le propriétaire demande « une vision graphique du rapport COT : chaque semaine on récupère les
résultats et on trace le graphique de l'exposition des institutions sur les marchés décrits dans
le rapport ». Livré comme onglet **« Graphique »** de la fenêtre COT existante (à côté de
« Synthèse »). **39 fenêtres, aucun indicateur, aucun fournisseur ni hôte nouveau
(`publicreporting.cftc.gov` est déjà dans `shared/extapi-hosts.ts`), aucune dépendance,
`@axiom/types` inchangé.** Exception au gel G100 au titre de la demande explicite du propriétaire.

- **Contenu.**
  - Pour un marché de `WATCHLIST_COT` (14), le net (longs − shorts) de CHAQUE catégorie de traders,
    rapport après rapport, sur tout l'historique publié (« Futures Only ») :
    - financiers (devises, indices, crypto CME) → TFF `gpe5-46if` : Dealers / intermédiaires,
      Gérants d'actifs / institutionnels, Fonds à effet de levier, Autres déclarants, Non déclarants ;
    - matières premières (métaux, énergie) → Disaggregated `72hh-3qpy` : Producteurs / négociants,
      Swap dealers, Managed Money, Autres déclarants, Non déclarants ;
    - au choix, Legacy `6dca-aqww` pour tous : Commerciaux, Non-commerciaux, Non déclarants.
  - Unité : contrats ou % de l'open interest total. Périodes 1 a / 3 a (défaut) / 5 a / 10 a / Tout,
    zoom et déplacement (`useDomaineZoom`). Open interest dans un panneau séparé (jamais de double axe).
  - Le tableau sous le graphe est la légende cliquable (masquer / afficher) et la vue chiffrée du
    dernier rapport : net, net/OI, Δ net, longs, shorts, indice 3 ans (`cotIndex`, même définition
    que la synthèse) — net en tête pour rester visible à 390 px. L'infobulle donne chaque rapport.
  - Identité jamais portée par la seule couleur : « Autres déclarants » en tirets (sa couleur est
    voisine de la 3e dans le thème sombre), non déclarants en pointillés atténués ; même motif dans
    la légende. Un rapport sans voisin relié (rapport unique, trou de plus de 3 semaines) est un point.
  - Le bouton « Graphique › » de chaque marché de la synthèse ouvre l'onglet sur ce marché.
- **Colonnes vérifiées à l'exécution (contrat « ne pas deviner »).**
  - Seules quatre paires étaient vérifiées en direct (`DATASETS_COT`) ; l'environnement de ce lot
    ne joignait ni `publicreporting.cftc.gov`, ni `dev.socrata.com`, ni `www.cftc.gov`. Les autres
    noms (dealer, swap, other_rept, nonrept…) sont donc des CANDIDATS, jamais envoyés à l'aveugle.
  - Requête de découverte sans `$select` (4 dernières lignes du marché ; une colonne inconnue dans
    `$select` ferait échouer toute la requête). Chaque catégorie est résolue contre les clés
    réellement reçues ; l'historique ne sélectionne que des colonnes vues.
  - Catégorie non résolue : « Absente de la réponse CFTC », jamais 0. Aucune colonne de positions
    reconnue : erreur explicite. Marché absent du rapport : message et piste Legacy.
  - Contrôle à chaque rapport : la somme des nets de toutes les catégories (non déclarants
    compris, spreads compensés) vaut 0, tolérance 1 contrat (la CFTC publie des entiers équilibrés).
    Un écart est signalé au-dessus du graphe (« Contrôle en échec… chiffres à vérifier »), pas masqué.
    Aucune colonne de positions reconnue : message propre (« Format CFTC inattendu »), distinct
    d'une panne réseau.
  - **À confirmer** au premier chargement réel : le badge de contrôle doit afficher
    « vaut 0 sur les N rapports » pour un marché TFF et un marché Disaggregated.
- **Cadence hebdomadaire.**
  - Le rapport du mardi T paraît le vendredi T+3 ; le suivant, le vendredi T+10. Heure retenue :
    20 h 30 UTC (15 h 30 à New York en hiver, une heure de marge l'été). Jours lus en composantes
    locales, comme au parsing (`Date.parse` d'un horodatage flottant).
  - Un historique récupéré avant la publication suivante reste à jour jusqu'à elle. Récupéré
    après sans nouveau rapport : relu toutes les 15 min pendant 3 h (mise à jour Socrata), puis
    toutes les 6 h (jour férié). Le statut l'affiche (« prochain rapport ven. 6 nov. vers 15 h 30
    (New York) », « rapport du … attendu, pas encore publié », et après 3 semaines « contrat
    peut-être plus publié »).
  - Tant que l'onglet est affiché, une minuterie relit la CFTC à l'échéance (+ 30 s), 30 min après
    un échec ; aucune minuterie onglet fermé. À la réouverture, un historique périmé est relu.
- **Cache et réseau.**
  - Deux requêtes par (rapport, marché) et par semaine, via `/extapi` (daemon, Vite ou Vercel).
    Historique en `$order DESC` : une troncature par `$limit` (5 000) couperait les plus anciens.
  - localStorage compact `axiom:cot:historique:v1:<dataset>:<marché>` (≈ 10× plus petit que les
    records Socrata), au plus 8 séries, index LRU `axiom:cot:historique-index:v1` ; quota plein :
    éviction des plus anciennes. Chaque entrée porte les identifiants de catégories dans leur
    ordre ; une entrée qui ne correspond plus est rejetée. Changer un candidat de colonne impose
    d'incrémenter `VERSION_CACHE_HISTORIQUE`. Une réponse arrivée après un changement de marché
    est gardée en cache. Dernière sélection : `axiom:cot:graphique:v1`.
  - Échec réseau : la dernière série reste affichée avec un bandeau. Santé : source `cot:cftc`
    partagée avec la synthèse.
- **Fichiers.** `data/cotHistorique.ts` (pur), `store/cotHistorique.ts`,
  `components/cot/GraphiqueCot.tsx`, `components/cot/graphiqueCot.util.ts` (pur), onglets dans
  `CotWindow.tsx` ; tests unitaires associés ; e2e `cot-graphique.e2e.ts` (données fictives
  cohérentes, horloge figée), inscrit dans `scripts/ci.sh --e2e`. `cot-lisibilite.e2e.ts` : l'ordre
  clavier passe désormais par l'onglet « Graphique » avant la zone de rapports.
- **Budget.** Chargement initial **1 188 308 / 355 986** (plafond 1 220 000 / 360 000), quasi inchangé :
  le graphique vit dans le bloc chargé à la demande de la fenêtre COT (≈ 34 Ko bruts).
- **Revue et tests.**
  - Revue indépendante : aucun bloquant. Trois points importants confirmés puis corrigés (relecture
    jusqu'à 6 h après la publication, aucune relance rapprochée, rapport isolé invisible) et les
    mineurs (tolérance, alerte visible, axe, réponse tardive, ordre du cache, tri, abandon, survol
    tactile, colonnes à 390 px, motifs de trait).
  - Calendrier vérifié pour tous les mardis de 2025 à 2027 dans 11 fuseaux, changements d'heure
    compris ; tests unitaires sous 4 fuseaux.
  - Web : 434 fichiers / 6 430 tests verts, typage et build verts ; e2e `cot-graphique` et
    `cot-lisibilite` verts à 1280 et 390 px.
  - `tests daemon (bun)` était rouge sur GitHub depuis c2f757d (préexistant, corrigé dans ce lot
    sur accord du propriétaire) : `vercelProxy.redirection.test.ts` simulait `node:dns/promises`
    sans export nommé `lookup` ; `mock.module` valant pour tout le processus bun, ce fichier exécuté
    en premier sur le runner cassait le chargement des 5 fichiers qui importent `proxy.ts`. Le mock
    expose désormais aussi `lookup` : 786/786 sous bun 1.3.11 (version de la CI) et 1.4.4, y compris
    avec ce fichier forcé en premier.
  - Préexistant, hors lot, reproduit à l'identique sur a2043a1 :
    - `src/chart/orderflow.cadence.test.ts` : erreur non gérée intermittente (WebSocket réelle)
      dans un environnement sans réseau ;
    - `CotWindow.test.tsx` dépend du fuseau (« 14 jours » faux à New York, Pago Pago, Santiago).

## Outils d'analyse et sources (autorisation du 7 novembre 2026)

Le propriétaire répond « Go pour tes suggestions » à l'étude
`docs/outils-analyse-sources-2026-11-06.md` (51 suggestions vérifiées dans le code et notées).
Le chantier en retient neuf lots, développés en parallèle sur zones disjointes, revus par un
agent indépendant puis intégrés en un commit par lot sur `feat/outils-analyse`.
**39 fenêtres (aucune nouvelle), 221 indicateurs (+ `primeVol`), un identifiant aux nouveau
(`dvol`), un fournisseur nouveau (Wikimedia, appel direct), aucune dépendance npm, aucun
secret, pas d'exécution d'ordres ni d'enregistreur continu.** Règles communes : lecture sur
bougies CLÔTURÉES, séries externes datées à l'instant où elles sont connues, causalité par
préfixe testée là où elle s'applique, donnée absente = état explicite (« indisponible »,
« non mesuré ») et libellés honnêtes (« descriptif », « ≈ », couverture affichée).

- **Exceptions ACTÉES.**
  - Gel G100 : surfaces nouvelles dans des fenêtres existantes, sans nouvelle fenêtre :
    - graphe : sélecteur « Unité de calcul » de l'éditeur de paramètres, suffixe « [4h] » des
      légendes et de la liste « Actifs », badge « partiel » (A) ; libellés intrabar du VPVR,
      de la VPFR et du footprint, POC et zone de valeur sur les colonnes footprint intrabar
      (B) ; étiquettes ATR/σ de la règle Maj et lignes des bandes RV (D) ;
    - EQS : « + champ », « + règle », champs Flux et Force relative, unité par condition,
      fenêtre K, presets « Descriptifs (non validés) » (C) ;
    - DIST : bouton « Bandes RV » (D) ;
    - BRIEF : bloc « Historique descriptif » de la largeur (E1), ligne « Régime · coupe
      transversale » (E2) ;
    - CAP : tuile « BTC.D hors USDT/USDC/DAI · CMC » (E1) ;
    - CORR : onglets « Rotation » et « Régime », univers « Top 50 » (E2) ;
    - OMON : bloc « Maturité constante » de Term IV, métrique « ΔOI » de la Heatmap (F) ;
    - CYCLE : section « Attention grand public · Wikipédia » (G) ;
    - CBPREM : correctif de causalité du z et des bandes, pas une extension (H).
  - Catalogue : **221 indicateurs** (220 depuis AXIS S/R le 2026-10-19 ; les comptes « 219 »
    restés dans ce contrat et le README dataient d'avant elle). Ajout : `primeVol`
    (catégorie `volatility`, aux `["dvol"]`, `minTimeframe` 1h, sorties `dvol`, `vrp`,
    `percentile`). `betaRef` gagne une sortie `alpha` et un paramètre `afficherAlpha` (coupé
    par défaut), sans nouvelle définition.
  - `@axiom/types` : `AuxSeriesId` « dvol » (seule modification du paquet) — DVOL Deribit
    quotidien de BTC et ETH, chaque bougie datée à la fin de son jour, jour en cours exclu,
    lu en mode clôture (`AUX_SUR_CLOTURE`), TTL 15 min, 365 j.
  - Fournisseur nouveau : Wikimedia (pages vues Wikipédia), public et sans clé, en appel
    DIRECT sur le précédent OCDE/Eurostat/ONS (cf. Décisions verrouillées). Hôte exact
    `https://wikimedia.org` ajouté à `connect-src` (`vercel.json`, CSP Report-Only ;
    `docs/csp-vercel.md` note aussi que les hôtes OCDE, Eurostat et ONS, appelés en direct
    depuis le 2026-09-06, n'y figurent pas encore). Aucun ajout à `shared/extapi-hosts.ts`.
  - Autres hôtes : aucun nouveau. Déjà utilisés : `api.binance.com/api/v3/klines` (EQS jusqu'à
    `limit=1000` et 2 unités par symbole ; BREADTH à 400 bougies ; intrabar en direct),
    `fapi.binance.com` via `/extapi` (intrabar perp, prévu mais appelé par aucune vue),
    `www.deribit.com` `get_volatility_index_data` en 86400 via `/extapi` (DVOL),
    `/extapi/api.coinmarketcap.com` (tuile CAP, 4 requêtes, mémoire de session 15 min),
    CoinGecko top 250 (`fetchMarketOverview`), adaptateurs des places (bougies supérieures,
    bandes RV, CORR).
  - Clés de stockage nouvelles :
    - `axiom:corr:regime:v1` : résumé du dernier jour du régime Top 50 (réutilisé 12 h au plus,
      seulement s'il porte sur la dernière clôture) ;
    - `axiom:surfaceOptions:<BTC|ETH>:v1` (archive `{ v: 1, points: [{ j, t, v[15] }] }`, 400
      points au plus) et `axiom:oiStrikes:<BTC|ETH>:<AAAA-MM-JJ>` (J-0…J-7), déclarées dans
      `PREFIXES_INSTANTANES_OPTIONS` de `store/persist.ts` : ni exportées, ni remplacées, ni
      purgées par un import ;
    - `axiom:onchain:attentionWiki:v1:<en|fr>:<actif>` (format compact, ≤ 1 096 vues, TTL 6 h).
  - Clés existantes enrichies : `axiom:breadth:v1` (champ `historique`, ≈ 9 Ko ; un cache de
    l'ancien format est recalculé une fois), `axiom:corr:v1` (`univers` « top50 », `onglet`
    « rotation » et « regime »), `axiom:screener:v1` et `axiom:presetAlerts:v1` (conditions
    `kind: "regle"`, champs facultatifs `tf` et `fenetre`, et pour les alertes de scan
    `refSymbol` facultatif ; anciennes entrées relues telles quelles), session persistée (`SESSION_KEY`, booléen `bandesRv`), paramètre réservé
    `unite` dans `IndicatorInstance.params` (persisté par les canaux existants, compris dans
    `computeKey`/`shortHash`).
  - Daemon (KV, écrit seulement si `daemonPret()` après la sonde) : namespaces
    `surface-options` (`<devise>:v1`) et `oi-strikes` (`<devise>:<jour>`, élagué au-delà de
    J-7), clé `attentionWiki:v1:<édition>:<actif>` du namespace `onchain`. Santé : source
    `wikimedia` (libellé « Wikimedia · pages vues »).

- **A — Indicateurs d'unité supérieure sur le graphe (SUG-1, phase 1).**
  - Paramètre réservé `unite` (RSI 4h, EMA 1d sur un graphe 1h). `projeterSurUnite`
    (`@axiom/indicators`, `utils-aux.ts`, prévue pour la phase 2) date chaque valeur à la
    clôture de sa bougie supérieure ; égalité exacte avec le calcul natif sur le même jeu de
    bougies.
  - Couples 1h→4h/1d, 4h→1d/1w, 1d→1w ; places binance, bybit, okx, hyperliquid, mexc,
    kraken, coinbase (unité présente dans `SUPPORTED_TIMEFRAMES`, Coinbase sans 1w) ; Twelve
    Data et synthétique exclus. Définitions sans aux ni auxFacultatives, hors
    `TIMEFRAME_REQUIS` et hors stratégies ; `DEFS_EXCLUES_UNITE` = ichimoku, fractals,
    pivotHighLow, zigzag (lecture différée), vwap, vwapBands, narrowRange, rollingDrawdown,
    downsideVariance, returnAutocorrelation (annotations). Garde-fou sur tout le registre
    (`uniteSuperieure.test.ts`).
  - Bougies closes et alignées UTC seulement (1w : lundi 00:00), sinon refus durable pour la
    session (place, symbole, unité) et unité retirée du sélecteur. Une bougie supérieure n'est
    tenue pour close que 10 s après sa clôture (`MARGE_CLOTURE_MS`).
  - Réseau : `getAdapter(place).fetchKlines(symbole, unité, { limit: 500 ou amorce })`, une
    requête par (place, symbole, unité, profondeur), relancée une fois par clôture supérieure
    au premier recalcul qui suit la marge (aucune minuterie), échec et retard réessayés à 30 s,
    cache mémoire LRU de 16 entrées. Fenêtre FIXE pour la session : le premier chargement fixe
    le début, chaque clôture n'ajoute que les nouvelles bougies closes (pas de repeinture des
    cumulatives) ; elle ne repart qu'après une veille de plus d'environ 500 bougies
    supérieures, ou si plus de 16 clés distinctes l'évincent. Un rechargement en échec garde la
    fenêtre et affiche « partiel » avec son motif. Motif « historique trop court » réservé aux
    places qui servent moins que leur propre plafond (Coinbase 350, OKX 300).
  - Contrat d'unité commun : refus motivé dans le backtest (`run()`), et
    `conditionSupporteTimeframe` (`@axiom/alerts`) refuse toute condition qui porte `unite`
    — alertes du navigateur ET du daemon ; AlertsPanel affiche « non évaluée » avec le motif.
  - Modules différés `chart/bougiesUnite` (import() par `chart/indicators`) et
    `chart/uniteSuperieure`. Écarts de zone entérinés : `components/InstanceParamsEditor.tsx`
    (2 lignes), `chargementInitial.test.ts`.
  - Fichiers : `chart/{bougiesUnite,uniteSuperieure,uniteParam,SelecteurUnite}.ts(x)`,
    `chart/indicators.ts`, `chart/overlayLegend.ts`, `chart/paneHeaders.tsx`,
    `alerts/runtime.ts`, `store/backtest.ts`, `store/indicators.ts`, `AlertsPanel.tsx`,
    `packages/indicators/src/utils-aux.ts`, `packages/alerts/src/engine.ts`, tests associés.
- **B — Profil de volume reconstruit en intrabar (SUG-3, phase 1).**
  - Module différé `data/intrabar.ts` (import() depuis `volumeProfile.ts` et
    `volumeRangeOverlay.ts`, statique depuis le chunk orderflow). Klines Binance spot (perp
    prévu via fapi), volume acheteur taker k[9]. VPVR, VPFR et colonnes historiques du
    footprint remplacent les bougies CLÔTURÉES par leurs sous-bougies quand la somme des
    volumes retrouve celle de la parente (tolérance 1e-6) ; la bougie en cours garde l'ancien
    calcul ; une parente n'est remplacée que 2 s après sa clôture.
  - Constantes : `PLAFOND_REQUETES` = 10 par plage (blocs alignés de 1 000 spot, 1 500
    perp), `CAPACITE_BLOCS` = 32 (LRU mémoire), baux par surface de 30 s (`BAIL_MS`), bloc
    sous bail jamais évincé, admission tout ou rien (« cache saturé »), `ANTI_REBOND_MS` =
    400, `MARGE_CLOTURE_MS` = 2 000, `DELAI_REQUETE_MS` = 15 s, pause globale après échec de
    1 min doublée jusqu'à 10 min (`REESSAI_MS`), au plus 2 requêtes par surface à chaque
    clôture de parente. Résolution : la plus fine parmi 1m, 5m, 15m, 1h, 4h, 1d qui divise
    l'unité du graphe et tient sous le plafond (60 j de 4h passent en 15m). Pas de 1s. Les
    sous-bougies sont datées à l'ENVOI de la requête (une kline close pendant le transit est
    écartée et son bloc reste à rafraîchir).
  - Libellés : « réparti à la minute (1m) · N/M » (et 5m … 1d), « ≈ réparti sur la bougie
    (motif) » : intrabar Binance seulement, unité calendaire, aucune unité plus fine, plage
    trop longue, aucune bougie clôturée, intrabar Xm en chargement, indisponible, incomplet,
    non chargé (cache saturé).
  - Mesure synthétique (20 tirages, 100 bins, oracle tick) : POC à ±1 bin 35 % (uniforme
    4h), 65 % (15m), 90 % (1m) ; corrélation du delta par bin 0,23 / 0,44 / 0,79, cible 0,9
    non atteinte.
  - Fichiers : `data/intrabar.ts`, `chart/{volumeProfile,volumeRangeOverlay,orderflow,
    orderflow.calc,ChartInstance}.ts(x)`, tests associés.
- **C — Screener EQS ouvert (SUG-C4, SUG-12 volet 1, SUG-6 volet 2).**
  - Conditions lues sur bougies clôturées, amorce calculée dans l'unité de chaque condition
    (paramètres en jours : `PARAMS_EN_JOURS`, aujourd'hui `rvolSeasonal.jours`), plafond de
    999 bougies closes avec note « valeurs ≈ » (RVOL saisonnier H1 servi à ≈ 41 jours,
    libellé à l'appui) ; au plus une unité en plus du run ; fenêtre K de 1 à 50 bougies.
  - Règles au modèle du backtest (opérandes ajoutés : `ttmSqueeze.on`, `narrowRange.nr`,
    `narrowRange.inside`) ; champs Flux (RVOL, Taker net, Pente CVD / volume) et Force
    relative (RS Mansfield 52 sem. en 1d par `disparity` sur le ratio, RS z par
    `spreadZScore`) ; `refClose` servi par le worker (alignAux à l'ouverture, LOCF), référence
    `refSymbolStore.refSymbol` chargée une fois par run et par unité, symboles calés sur la
    dernière bougie commune. Référence en retard de plus d'une bougie au chargement : tenue
    pour indisponible (note), aucun calage.
  - Couverture : un symbole arrêté sur une condition NON MESURÉE (état inconnu sur toute la
    fenêtre K : historique ou volume taker insuffisant) est compté par condition dans une
    note, distinct d'une condition fausse.
  - Alertes de scan : la référence de force relative est figée à la création
    (`AlertePreset.refSymbol`, facultatif ; une alerte antérieure lit celle du graphe au
    scan). Une référence non lue (indisponible ou en retard) rend le scan en échec (pastille
    et motif, baseline gardée : son retour ne fait pas « entrer » tout l'ensemble) ; des
    symboles non mesurés marquent le scan « incomplet » avec la note (champ de session
    `avertissement`). Marques partagées des notes : `NOTE_FORCE_RELATIVE_NON_EVALUEE`,
    `NOTE_ECARTES_SANS_EVALUATION` (`data/screener.ts`).
  - Presets « Descriptifs (non validés) » : `builtin:squeeze-4h-supertrend-1d`,
    `builtin:flux-anormal`. Un clic sur un résultat pose les instances des conditions de
    l'unité du run ; ce qui n'est pas posé est dit dans EQS.
  - Contrat du worker : `WorkerRequest.refSymbol`, `WorkerResponse.result.notes`. Ouvrir EQS
    charge aussi `store/backtest` (chunk paresseux partagé avec BT, ≈ 8 Ko gzip).
  - Fichiers : `data/{screenerRegles,screenerOperandes,screenerEtage,screener,screenerRun}.ts`,
    `workers/screener.worker.ts`, `store/screener.ts`,
    `components/ScreenerWindow{,Conditions}.tsx`, `store/presetAlerts.ts`,
    `alerts/runtime.ts`, `components/AlertsPanel.tsx`, tests associés.
- **D — Volatilité attendue contre réalisée (SUG-7).**
  - `primeVol` : DVOL, VRP ex ante = DVOL − RV des clôtures quotidiennes UTC (proxy, pas la
    prime réalisée), percentile du DVOL ; « DVOL indisponible (BTC/ETH seulement) » ailleurs,
    « RV non mesurée (bougies > 1 j ou non alignées sur minuit UTC) » quand aucune clôture
    quotidienne n'est possible. Hors lot : 3600, spotVolCorr, `TIMEFRAME_REQUIS`.
  - Bandes RV (DIST, clé `CleOverlayNiveaux` « bandesRv ») : HAR-RV sur Garman-Klass 1d, OLS
    glissante 500 j, horizons 1 j et 7 j ancrés sur l'ouverture du jour et du lundi UTC,
    k = quantiles 68,27 / 95,45 % des |z| passés (250 origines, minimum 100 pour le jour,
    250 exigées pour la semaine), couverture hors échantillon affichée, k tracés dits dans le
    détail. Minimum ≈ 622 jours contigus pour la bande du jour, ≈ 790 pour la semaine (Kraken,
    plafonné à 720, n'a que la bande du jour ; la semaine ne bouge jamais dans la semaine).
    Chargeur 1d dédié (jusqu'à 8 pages, 1 500 jours) ; un historique tronqué par l'échec d'une
    page sous la profondeur utile est une panne (nouvel essai 5 min), pas un « historique trop
    court ».
  - Modules différés `data/harRv` (import() depuis la règle) et `chart/niveaux/bandesRv`
    (composite paresseux, DistWindow en React.lazy).
  - Fichiers : `packages/types/src/index.ts`, `packages/indicators/src/volatility/primeVol.ts`,
    `registry.ts`, `chart/auxProvider.ts`, `chart/measureTool.ts`,
    `chart/niveaux/{bandesRv,composite}.ts`, `chart/niveauxOverlays.ts`, `data/harRv.ts`,
    `components/DistWindow.tsx`, `store/persist.ts`, tests associés.
- **E1 — Largeur du marché historisée et saison des alts (SUG-41, phase 1).**
  - BREADTH garde 50 requêtes klines, portées de 210 à 400 bougies ; séries journalières
    sur clôtures fermées (la dernière bougie renvoyée est toujours écartée, quelle que soit
    l'horloge locale) : % > MM50 et MM200, plus hauts − bas 20 j et 55 j, ligne A/D et
    oscillateur type McClellan du top 50, alts > BTC sur 90 j et 30 j. Chaque série porte son
    dénominateur ; un jour non mesuré reste un trou. A/D du jour relibellée « A/D jour ·
    univers USDT ». Seuils 75/25 = convention, pas un signal ; biais du survivant affiché.
  - Univers des alts : top 50 BREADTH hors BTC, stables et emballés (listes CORR),
    EUR/EURI/AEUR/XUSD/BFUSD/RLUSD et or tokenisé PAXG/XAUT. **Arbitrage consigné** : les
    autres séries gardent l'univers de l'instantané (stables et emballés compris, seuls
    USDC/FDUSD/TUSD exclus), pour que leur dernier point reste égal à l'instantané.
  - CAP : tuile « BTC.D hors USDT/USDC/DAI » = BTC ÷ (TOTAL − stables), jambes CMC seules,
    chargée par import(), Δ30 j des deux dominances, aucun cache persistant.
  - Fichiers : `data/{breadth,saisonAlts,dominanceStablecoins}.ts`,
    `components/brief/SectionBreadth.tsx`, `components/McapWindow.tsx`, tests associés.
- **E2 — Rotation contre BTC et régimes transversaux (SUG-6 volets 1 et 3, SUG-42).**
  - CORR › Rotation : RS-Ratio / RS-Momentum contre BTC en z-scores sur 52 semaines (14 j de
    momentum, 364 j de fenêtre, 378 jours consécutifs requis), quadrants, traîne de 8
    clôtures, actifs non placés listés ; libellés « approximation ouverte, pas le RRG® » et
    « descriptif ».
  - CORR › Régime : dispersion transversale lissée 7 j, médiane des corrélations alts/BTC
    sur 30 j, corrélation moyenne et ratio d'absorption sur 60 j avec plancher
    Marchenko-Pastur. Seules les paires crypto cotées en dollar entrent dans la coupe (règle
    de `ratio.ts`), BTC reconnu par sa base et compté comme la référence, un actif compté une
    fois. Aucun calcul ni résumé persisté sur des séries d'un autre univers.
  - BRIEF : ligne « Régime · coupe transversale » ; le lien « Détail » bascule l'univers
    persisté de CORR sur Top 50 et le dit (accepté). `MAX_JOURS` de CORR passe de 260 à 400 ;
    cache de session à clôtures seules, invalidé au jour UTC suivant.
  - **Double collecte top 50 maintenue et documentée** : le BRIEF prend le top 50 par
    capitalisation CoinGecko sur 400 j (≈ 51 requêtes klines au premier BRIEF de chaque jour
    UTC), BREADTH le top 50 par volume Binance : univers différents, pas de panneau commun.
  - Fichiers : `data/{rotationRelative,regimeTransversal,corr}.ts`,
    `components/corr/{CorrRotation,CorrRegime,communCorr}.tsx`, `components/CorrWindow.tsx`,
    `components/brief/SectionRegimeTransversal.tsx`, `components/BriefWindow.tsx`,
    `packages/indicators/src/statistical/betaRef.ts`, tests associés.
- **F — Options : surface à maturité constante et ΔOI par strike (SUG-20, SUG-C8 lot 1).**
  - Term IV : ATM, RR25 et BF25 à 7, 30 et 90 j (RR10 et BF10 seulement si les ailes sont
    adossées à au moins 1 M$ d'OI par option d'ancrage), interpolées en delta forward puis en
    variance totale, sans extrapolation ; historique quotidien, sparkline et percentile 1 an
    à partir de 90 instantanés, couverture affichée (date en UTC).
  - Heatmap : métrique « ΔOI » non signée contre J-1 ou J-7, sélecteur d'échéance, top 5 des
    strikes construits et vidés, date de référence toujours affichée ; causalité jugée contre
    la réception de la chaîne (`majTs`). Pas d'étiquette sur le graphe (lot 2 exclu).
  - Règle d'instantané : premier chargement réussi de la chaîne après 08:05 UTC, un par
    devise et par jour UTC, daté de la réception, jamais réécrit ; la sonde du daemon est
    attendue avant l'écriture. Un agrégat par jour, pas un enregistreur. Aucune requête
    nouvelle.
  - Fichiers : `data/{surfaceConstante,deltaOiStrikes}.ts`,
    `components/omon/{SurfaceConstante,DeltaOi,VueHeatmap,VueTermIv,dessins,format}.ts(x)`,
    `components/OptionsWindow.tsx`, `store/persist.ts`, `commands/windowPanels.ts`
    (mots-clés), tests associés.
- **G — Attention du grand public : pages vues Wikipédia (SUG-39).**
  - Table curée actif → article (BTC, ETH, SOL, DOGE ; en, et fr quand le titre est sûr).
    Chemin `/api/rest_v1/metrics/pageviews/per-article/{en|fr}.wikipedia/all-access/user/
    <titre encodé>/daily/AAAAMMJJ/AAAAMMJJ`, en-tête `Api-User-Agent` « AxiomTerminal/1.0
    (personal analysis tool; daily pageviews, cached locally) ».
  - Lecture descriptive au dernier jour complet : z-score 90 j et 365 j de log(1 + vues)
    contre les jours strictement précédents, ratio 7 j / 90 j, épisodes de pic au-delà de 3σ
    (premier jour, un par 30 j ; une étude d'évènements les datera par `disponibleLe`,
    D+2 00:00 UTC), part des vues contre Bitcoin pour une alt (badge si la série BTC vient
    d'un cache périmé). Le jour D n'est lu qu'à D+1 ; un jour absent reste « non mesuré ».
  - Section montée dans le bloc défilant de CYCLE ; code chargé avec la fenêtre.
  - Fichiers : `data/attentionWiki.ts`, `components/cycle/AttentionWiki.tsx`,
    `components/CycleWindow.tsx`, `data/dataCockpit.ts`, `vercel.json`, `docs/csp-vercel.md`,
    tests associés.
- **H — Prime Coinbase : z-score et bandes causaux (SUG-35, volet a).**
  - `bandeGlissante` remplace `bandesPremium` : moyenne, σ et z sur (t − 168 h, t], point
    courant inclus, au moins 30 points et σ non nul, sinon « indisponible ». Bandes tracées
    point par point ; « z glissant 7 j », descriptif, couverture « sur N pts » dans le
    bandeau quand la fenêtre est partielle. API de `data/cbprem.ts` : `bandesPremium`
    supprimée ; `bandeGlissante`, `bandesGlissantes`, `BandeGlissante`, `FENETRE_Z_MS`,
    `MIN_POINTS_Z` exportés ; `statsPremium` renvoie `zGlissant7j` au lieu de `z30j`.
  - Fichiers : `data/cbprem.ts`, `components/CbpremWindow.tsx`, tests associés.
- **Chargement initial.** Tout le code nouveau est différé ; douze modules nouveaux s'ajoutent
  à `MODULES_DIFFERES` (`chargementInitial.test.ts`). Mesure de l'intégration (Node 22.23.4,
  zlib 1.3.1) : **1 196 025 / 358 844**, contre 1 188 308 / 355 986 à la base (fac6129),
  soit +7 717 / +2 858 ; plafonds 1 220 000 / 360 000 inchangés, **marge gzip 1 156**. Les
  lots pesaient de −16 à +1 085 o gzip chacun ; le gros est `primeVol` dans le chunk
  `indicators` (≈ 730 o gzip) et le sélecteur d'unité.
  - Après la revue globale (2608c00) : 1 196 555 / 358 985, marge gzip 1 015.
  - Fusion de `main` le 11 novembre (AXIS S/R du 9 novembre, +1 981 o gzip à lui seul sous
    zlib 1.3.1) : le cumul dépassait le plafond (**1 201 963 / 360 969**). Le pipeline du
    screener (`data/screenerRun`, `data/screener`, ≈ 11,8 Ko minifiés) n'était sur le chemin
    initial que par les alertes de scan : `alerts/runtime.ts` le charge désormais par
    `import()` mémorisé au premier scan (échec de chargement publié comme échec de scan,
    retenté au suivant ; alerte revalidée après le chargement, donc aucun scan pour une
    alerte retirée entre-temps ; `alerts/runtime.pipelineScreener.test.ts`), et les deux
    modules entrent dans `MODULES_DIFFERES`. Gain : −9 686 o bruts / −2 630 o gzip.
    Résultat : **1 192 298 / 358 337, marge gzip 1 663** (Node 22.23.4, zlib 1.3.1).
- **Revue et tests.**
  - Chaque lot a été revu par un agent indépendant (un ou deux tours). À l'intégration : le
    constat majeur restant (EQS confondait « non mesuré » et « faux ») et les mineurs
    raisonnables sont corrigés, un commit par lot. Mineurs laissés : minuterie de relance de
    l'unité supérieure (en-tête corrigé à la place), test d'intégration de la règle Maj, test
    de rendu de la tuile CAP ; le filtre du runtime web des alertes à `unite` est gardé pour
    journaliser le motif, bien que `conditionSupporteTimeframe` le couvre désormais.
  - Typage des 7 projets vert ; indicateurs 1 070, alertes 128, backtest 131, pacte 120,
    daemon 786 (bun 1.4.4) ; web 469 fichiers / 6 863 tests, dont un seul échec
    préexistant, reproduit à l'identique sur fac6129 : `GraphiqueCot.test.tsx` dépend de la
    date réelle (« prochain rapport ven. 6 nov. » attendu le 7 nov.). L'erreur non gérée
    ORCH-1 (`orderflow.cadence.test.ts`, WebSocket réelle, `wsLoop.ts:134-137`) est elle aussi
    identique sur fac6129.
  - Build et budget verts ; e2e hermétiques des zones touchées : 64/64 (niveaux-chart,
    gate-g6-screener.hermetique, gate-lot3-corr, omon-lectures-options, options-carte,
    options-fraicheur, revue-cycle, analyse-brief, gate-v25-cap-dominance,
    revue-outils-avances, dominance-stablecoins, quatre-lots-indicateurs,
    quatre-lots-alertes, quatre-lots-backtest, multivue, cot-lisibilite). Aucun e2e nouveau.
- **Limites.**
  - A : seules les 500 dernières bougies supérieures (ou l'amorce) sont chargées, sans
    pagination ; définitions sans paramètre (OBV, VWAP…) sans sélecteur en phase 1 ; store
    d'indicateurs commun aux slots (une instance [4h] sur un slot 4h y est UNUSABLE) ; place
    en retard : jusqu'à 30 s sans valeur sur la dernière bougie close ; décalage d'horloge
    client > 10 s non couvert. Phase 2 (alertes, backtest) non faite.
  - B : split par niveau approché (volume uniforme sur le bas/haut de chaque sous-bougie) ;
    gain réservé au spot Binance ; une plage froide coûte jusqu'à 10 requêtes en série
    (≈ 5 à 14 s) ; cache partagé de 32 blocs, en mémoire seulement ; deux surfaces muettes
    en alternance peuvent s'échanger la place (au plus un plan par silence).
  - C : parité approchée pour les lissages (amorce heuristique 4 × la longueur, plafond 999),
    non bornée pour le PSAR ; la dernière kline de chaque réponse (bougie en cours) est
    toujours écartée, quelle que soit l'horloge du client, comme pour BREADTH ; jusqu'à 2
    requêtes klines par symbole (60 symboles) plus 1 de référence par unité ; résultats des
    presets existants légèrement différents (lecture stricte à la dernière bougie close).
  - D : Garman-Klass 1d biaisé par les sauts et dépendant de la place ; ≈ 70 à 130 ms de
    calcul par horizon une fois par jour et par marché, sur le fil principal ; DVOL limité à
    365 j sans pagination ; `primeVol` sélectionnable hors BTC/ETH (libellé seul) ; règle Maj
    sans test d'intégration (fonctions pures seules testées).
  - E1 : biais du survivant non corrigé (top 50 du jour appliqué au passé), une seule place,
    ≈ 200 jours d'historique ; ligne A/D à niveau arbitraire ; STABLE.D limité à
    USDT/USDC/DAI (BTC.D hors stables est un minorant) ; tuile CAP sans test de rendu.
  - E2 : lecture descriptive, aucune étude figée ne valide quadrants ni régimes ; calcul du
    Régime ≈ 70 à 170 ms sur le fil principal ; Coinbase et les alts de moins de 378 jours
    restent « non placés » ; actions tokenisées MEXC cotées en USDT comptées comme des alts.
  - F : aucun rattrapage historique (percentile 1 an après 90 instantanés, J-1 seulement si
    OMON a été ouvert la veille après 08:05 UTC, historique propre au navigateur sans
    daemon) ; IV mark modélisée par Deribit, delta non ajusté de la prime ; ΔOI non signé,
    Deribit seul ; ≈ 160 Ko de localStorage pour les instantanés ΔOI.
  - G : z-score sensible aux pics passés, seuils ±1,5 conventionnels ; cache de 6 h même si
    le jour a basculé ; signal concomitant plus que prédictif ; une seule édition par lecture.
  - H : historique limité à ≈ 30 j en 1h et à BTC/ETH (volets b et c hors lot).
- **À confirmer au premier usage réel** (aucun réseau externe dans l'environnement du
  chantier ; aucune vérification sur API réelle ni en navigateur) :
  - alignement des semaines Kraken, Hyperliquid et MEXC et du jour MEXC (une ouverture non
    alignée est refusée avec motif) ;
  - intrabar : validation sur un replay tick BTCUSDT réel, rendu du libellé VPVR sur deux
    lignes et de la légende du footprint sur écran étroit ;
  - poids Binance des requêtes klines à `limit=1000` (EQS) ;
  - bandes RV : critères QLIKE et Diebold-Mariano sur au moins 20 actifs réels, couverture
    réelle affichée au premier chargement ; plafond de points par appel DVOL Deribit ;
  - CMC `data-api` : CGU non vérifiées ; convention Blockchaincenter (75 %, 90 j, top 50) ;
  - Wikimedia : CORS (`Access-Control-Allow-Origin: *`), acceptation d'`Api-User-Agent` au
    pré-vol, licence CC0, plafond de débit, titres canoniques (en particulier « Solana
    (blockchain platform) » ; une redirection donnerait une série quasi nulle sans alerte),
    heure réelle de publication (D+2 retenu par prudence) ;
  - rendu canvas de CBPREM et géométrie de CYCLE en vrai navigateur.

## AXIS S/R — zones classées par force et signal précoce (demande du 9 novembre 2026)

Le propriétaire demande d'« améliorer les signaux d'AXIS », puis précise : « j'aimerais les voir
apparaître suffisamment tôt, que je puisse voir quelle zone marque une forte résistance ou
support ». Parmi les définitions, seule **AXIS S/R** (`stratAxisSr`) change : ses zones sont
classées par force, et un triangle creux marque la bougie qui réagit sur une zone forte.
**Aucun fournisseur, hôte, indicateur, fenêtre ni dépendance nouvelle ; `stratAxis.ts` (AXIS)
n'est pas modifié.** (Vrai le 9 novembre. Depuis le 11 novembre 2026, `stratAxis.ts` porte le
rendu partagé et le début de l'infobulle des signaux change : voir « AXIS — lisible, honnête et
annonciateur ».) Pour une même série, une même référence et les mêmes réglages, les séries
existantes d'AXIS S/R (`etat`, `score`, `prixSignal`, `stop`, `support`, `resistance`), ses
signaux confirmés et ses forts mouvements, marqueurs et étiquettes compris, sont inchangés au
caractère près. Spec : `docs/superpowers/specs/2026-11-09-axis-sr-zones-fortes-design.md`, avec
la référence visuelle « vue C » approuvée par le propriétaire ; plan :
`docs/superpowers/plans/2026-11-09-axis-sr-zones-fortes.md`.

- **Exceptions au contrat** (conception, §5).
  - `@axiom/types` reçoit exactement deux champs optionnels : `creux?: boolean` sur
    `MarqueurAnnotation` (triangle au trait, non rempli, plus petit) et
    `ancrageX?: "centre" | "droite"` sur `LabelAnnotation` (texte à droite de sa bougie, centré
    sur sa valeur). Absents, le rendu est celui d'avant. `chart/annotationsPane.ts` et
    `chart/annotationsPrix.ts` les rendent ; aucun autre indicateur ne change d'aspect.
  - Amorce de **3 000 bougies** pour `stratAxisSr` seul (`AMORCE_AXIS_SR`). `stratAxis` reste à
    1 500 (`AMORCE_AXIS`), qui reste aussi le seuil de la mention « amorce courte » des signaux.
  - `REFCLOSE_LIMIT` = 3 000 dans `chart/auxProvider.ts` (1 500 avant). La constante vaut pour
    toute définition qui lit la référence, `refClose` ou `refCloseStrict` (même cache) : AXIS,
    AXIS S/R et les sept indicateurs statistiques à référence reçoivent jusqu'à 3 000 bougies de
    référence, par pages de 1 000, en quatre appels au plus. Effet visible sur ces sept
    indicateurs : sur un tampon de plus de 1 500 bougies (AXIS S/R affiché, ou défilement
    arrière), leurs courbes s'étendent jusqu'à 3 000 bougies en arrière, là où elles restaient
    indéfinies au-delà des 1 500 plus récentes (Corrélation roulante sur le cas de référence :
    1 450 valeurs au lieu de 0 sur les 1 500 bougies anciennes). Leurs valeurs n'y ont pas été
    vérifiées.
- **Zones classées par force.**
  - Force : touches + rejets sur volume fort + 0,5 si la zone est inversée (formule inchangée).
    Une zone est forte si sa force atteint `forceZoneForte` (réglage nouveau, défaut 6, de 2 à
    50) ; tant qu'elle est active, sa force ne décroît pas.
  - Toutes les zones fortes actives sont tracées : bande pleine d'autant plus opaque qu'elle est
    forte (`min(0,34 ; 0,14 + 0,012 × min(16 ; force))`), bords en trait plein, étiquette
    « S fort · n » ou « R forte · n » au bord droit (n = touches).
  - Zones faibles : les `maxZonesSr` plus proches du cours (défaut 4, de 0 à 12, nouveau libellé
    « Zones faibles tracées (0 = aucune zone) »), moitié supports, moitié résistances. Sans
    remplissage, bords en pointillé, étiquette « faible ».
  - Zones fortes cassées : les 12 zones désactivées les plus récentes qui étaient fortes à leur
    dernière bougie active (clôture de `finIdx`, avant les fusions de la bougie qui les casse).
    Bande estompée (opacité 0,09) arrêtée à cette bougie ; ni bord, ni étiquette, ni infobulle.
  - Une bande part de la confirmation de sa zone et suit, bougie par bougie, les bornes connues à
    la clôture. Vert (`--up`) pour un support, rouge (`--down`) pour une résistance ; la ligne
    médiane pointillée disparaît. `maxZonesSr` = 0 : aucune zone tracée, ni forte, ni faible, ni
    cassée ; les triangles creux et les sorties restent.
  - Infobulle d'une zone : « forte » ou « faible », rôle, bornes, niveau, écart au cours,
    touches, rejets, inversion, puis « touches comptées sur N bougies ». (Réécrite le
    11 novembre 2026 : rôle, force, touches et écart au bord en tête, puis l'âge du dernier
    pivot et de la dernière réaction ; voir « AXIS — lisible, honnête et annonciateur ».)
    L'infobulle du graphe a
    3 lignes au plus : après les marqueurs à 3 bougies ou moins du réticule viennent les zones
    dont la bande couvre la bougie survolée, rangées par distance verticale de leur bande au
    réticule (`chart/indicators.ts`, `createTooltipDataSource`) : la bande sous le réticule
    d'abord. À égalité, ou réticule sur un autre pane que celui des prix, l'ordre du tracé : les
    fortes par proximité au cours de la dernière bougie décidée, puis les faibles. Sur le cas de
    référence, aux réglages par défaut, chacune des 12 zones actives tracées a sa ligne, en tête
    des lignes de zone, le réticule au milieu de sa bande, sauf quand trois marqueurs proches
    prennent les trois lignes (281 des 11 473 bougies couvertes par les 12 bandes). (Exception
    LEVÉE le 11 novembre 2026 : réticule dans une bande, une ligne lui est réservée ; il ne
    reste aucune de ces 281 bougies.) Avant la
    revue finale, les rubans suivaient l'ordre du tracé seul, et 6 de ces 12 zones, dont les
    4 faibles, n'avaient de ligne à aucune bougie. Ce tri vit dans le pont commun à tous les
    indicateurs, hors de la liste de fichiers du plan ; la seule autre définition à rubans
    porteurs d'info, la prime spot/perp, n'en est pas changée : ses rubans ne se chevauchent
    jamais.
- **Signal précoce** (réglage nouveau `signauxPrecoces`, défaut vrai, libellé « Signaux précoces
  sur zone forte (non mesurés) »).
  - Réaction décidée à la clôture de la bougie i, avec les zones connues après i − 1. Sur un
    support (niveau ≤ close[i − 1]) : low ≤ borne haute, close > borne haute, et close dans la
    moitié haute de la bougie. Sur une résistance : le symétrique. Une zone ne réagit pas à moins
    de 4 bougies de sa réaction précédente ; une bougie plate ne réagit jamais.
  - Triangle creux, plus petit que le triangle plein : sous le plus bas pour un support (`--up`),
    au-dessus du plus haut pour une résistance (`--down`). Au plus un par bougie et par sens,
    aucun sur une bougie de signal confirmé, les 120 plus récents.
  - Infobulle, réticule à 3 bougies ou moins : d'abord la mention exacte, juste après
    « AXIS S/R » :
    « signal précoce non mesuré — lecture indicative, jamais une promesse »,
    puis sens, bornes et décompte de la zone et ce que la bougie a fait. L'infobulle ne revient
    pas à la ligne et coupe au bord du graphe une ligne de 223 à 249 caractères : en tête, la
    mention tient dans les 412 premiers pixels (thème par défaut). Placée en fin de ligne
    jusqu'à la revue finale, elle n'était entière pour aucun triangle au bureau en 1 440 px,
    panneau de droite ouvert. Aucun chiffre de performance dans l'interface.
- **Sorties pour les alertes.** `reactionSupport` (« Réaction sur support fort ») et
  `reactionResistance` (« Réaction sur résistance forte »), masquées : 1 sur une bougie close qui
  réagit dans ce sens, 0 sinon, indéfinies sur la bougie en formation. Elles ne dépendent ni de
  `signauxPrecoces` ni de `maxZonesSr`. Une alerte de seuil d'indicateur (`indicateur-seuil`)
  existante les lit ; aucun type d'alerte nouveau. AXIS S/R passe de 21 à 23 réglages et de 6 à 8
  sorties, dont 6 masquées. Ni preset BT ni opérande nouveau dans la fenêtre BT.
- **Profondeur de 3 000 bougies** (décision du propriétaire, conception §3.6).
  - Une zone compte ses touches depuis la première bougie chargée. AXIS S/R actif, le graphe
    remonte de lui-même à 3 000 bougies : cinq pages de 500 après le chargement initial.
  - `MAX_PAGES_SESSION`, plafond d'une extension, passe de 8 à 10 : une source plafonnée à 300
    bougies par appel atteint 3 000 en 9 pages.
  - `refClose` : si une page suivante échoue, les pages déjà reçues sont servies (série
    partielle, bougies récentes) ; si la première échoue, série vide, comme avant. Jamais d'état
    d'erreur.
  - Source plus courte : tout ce qu'elle a.
- **Effet sur les signaux confirmés.** La référence couvre désormais 3 000 bougies. Sur les
  bougies de la 1 500e à la 3 000e plus récente, les signaux d'AXIS et d'AXIS S/R passent donc
  sous le garde-fou de régime quand l'historique chargé est assez long (AXIS S/R affiché, ou
  défilement arrière). Avant, ils y restaient ceux de la v2, faute de référence. C'est
  l'intention de la conception (§3.6). Au-delà des 3 000 plus récentes (défilement arrière), et
  sur la partie non reçue si une page de la référence échoue, ils restent ceux de la v2, et
  l'infobulle le dit (« référence indisponible »).
- **Limites connues.**
  - Zones et triangles creux dépendent de la première bougie chargée : charger plus d'historique
    les redessine. Ce n'est pas un repaint : rien de ce qui est décidé à une bougie ne lit une
    bougie plus récente.
  - Alertes, mécanisme existant pris tel quel :
    - évaluées aux réglages par défaut (`forceZoneForte` = 6), même si l'instance du graphe en a
      d'autres ;
    - seulement l'application ouverte sur le symbole et l'unité de l'alerte, sur le tampon du
      graphe, qui n'a 3 000 bougies que si AXIS S/R y est affiché ;
    - le daemon n'évalue que les alertes en 1 min ou héritées, sur 1 500 bougies ;
    - le formulaire liste les sorties par leur clé ; la notification garde sa formule générique
      (« stratAxisSr(reactionSupport) >= 1 »). (Levée le 12 novembre 2026 : sorties nommées
      dans le formulaire, libellé « AXIS S/R non mesuré · réaction sur support fort » partout ;
      voir « AXIS au téléphone — texte complet sous le doigt et alertes visibles ».)
  - Un triangle creux peut tomber sur la bougie même qui désactive sa zone, une bougie après la
    fin de la bande : la décision lit l'état de la veille.
  - Un triangle creux ancien peut citer une zone forte cassée qui n'est plus tracée (seules les
    12 plus récentes le sont) ; son infobulle en donne les bornes. Cas de référence : 51 des
    120 triangles (bougies 262 à 1 810).
  - L'infobulle du graphe a 3 lignes au plus. Les triangles creux y passent avant les forts
    mouvements et les retournements ↺ : près d'un triangle creux, la ligne d'un fort mouvement
    peut n'apparaître qu'une bougie plus loin, celle d'un ↺ jusqu'à trois (cas de référence, case
    « Détecter les retournements » cochée). Les lignes de zone passent après tous les marqueurs :
    quand trois marqueurs sont à 3 bougies ou moins du réticule, aucune zone n'y a de ligne, même
    réticule sur sa bande (voir l'infobulle d'une zone, plus haut). (Limite LEVÉE le 11 novembre
    2026 pour la bande sous le réticule, qui a sa ligne réservée ; son revers : le troisième
    marqueur perd alors la sienne. Voir « AXIS — lisible, honnête et annonciateur ».)
  - L'infobulle ne revient pas à la ligne : une ligne plus large que le graphe est coupée à son
    bord. Au bureau, la mention d'un triangle creux, en tête, reste entière ; la fin de sa ligne
    (ce que la bougie a fait) peut manquer, par exemple en 1 440 px panneau de droite ouvert. Au
    téléphone, chaque ligne est coupée vers le 55e caractère, après « non mesuré » pour un
    triangle creux, et la première ligne de toute infobulle d'indicateur passe sous le bandeau du
    symbole (`candle.tooltip.offsetTop` de 36 px dans `chart/ChartInstance.tsx`, calé sur le
    bandeau du bureau ; défaut antérieur, hors des fichiers de ce chantier) : la ligne d'un
    triangle creux, le plus souvent la première, n'y est alors pas lisible. (Limite LEVÉE au
    téléphone le 11 novembre 2026 : l'infobulle y commence sous le bas réel de l'en-tête. La
    coupure reste, et « vers le 55e caractère » ne vaut qu'à 390 px en thème par défaut (moins
    sur un écran plus étroit ou en chasse fixe : mesures de la section suivante) ; le bureau
    garde ses 36 px. Voir « AXIS — lisible, honnête et annonciateur ».)
- **« Non mesuré ».** Les signaux précoces n'ont été soumis à aucun test sur données jamais vues.
  Une mesure rapide hors protocole, sur BTC seul et sans valeur probante (conception, §9), ne
  leur trouve aucun avantage ; aucun de ses chiffres ne paraît dans l'interface. Chaque triangle
  creux porte la mention ci-dessus, et le libellé du réglage dit « non mesurés ».
- **Budget.**
  - Chargement initial : **1 193 707 / 356 429** après la vague finale de corrections, dans
    `pnpm check` (Node 26.7.0, zlib 1.2.12).
  - Soit +5 414 / +1 896 depuis le départ de la branche, mesuré le 9 novembre
    (1 188 293 / 354 533). Marge gzip 3 571, au-dessus des 3 000 exigés.
  - Calcul complet d'AXIS S/R à 3 000 bougies, sous le plafond de 10 ms avant comme après.
    Avant le chantier (`a2043a1`) et après la vague finale, même protocole (un calcul
    d'échauffement, puis médiane de 30 calculs, cinq essais, chaque version dans son
    processus) :
    - sous V8 (Node 26.7.0) : environ 1,6 ms avant (1,51 à 1,60 ms) et 2,6 ms après (2,56 à
      2,74 ms), soit environ 60 % de plus ; au premier essai, 2,3 à 2,5 ms avant, 2,8 à 3,0 ms
      après ;
    - sous Bun 1.3.11 (JavaScriptCore) : l'ancien code oscillait de 1,5 à 5,8 ms d'un essai à
      l'autre ; le nouveau donne 1,8 à 2,1 ms, et 3,3 à 3,5 ms au premier essai.
- **Revue et tests.**
  - Revue indépendante des lots 1 à 5 et 4b : conformité, plus des angles contradictoires
    (rendu, équivalence au moteur relancé, non-régression, tracé, identité des signaux,
    pagination, exactitude et rédaction de la documentation). Les corrections arbitrées des
    lots 1 à 4 ont été regroupées en un lot 4b, revu à son tour.
  - Revue finale du diff complet depuis `a2043a1`, en quatre angles : conception, exactitude du
    calcul, application réelle au navigateur (captures au bureau en 1 440 × 900 et au téléphone
    en 390 × 844), tests et documentation. Chaque remarque importante a été soumise à une
    vérification contradictoire (conception, reproduction, impact), puis corrigée dans une vague
    finale : infobulle des zones et des triangles creux, repli de `forceZoneForte`, ligne
    « résistance » de la mesure rapide, documentation. Une seule reste ouverte : au téléphone,
    la première ligne de toute infobulle du graphe passe sous le bandeau du symbole (défaut
    antérieur au chantier, voir les limites plus haut). Le propriétaire l'a laissée en limite
    connue en décidant la fusion le 10 novembre 2026. (Remarque LEVÉE au téléphone le
    11 novembre 2026, lot T de « AXIS — lisible, honnête et annonciateur ».)
  - `pnpm check` vert après la vague finale : typage des 7 projets ; indicateurs 229 fichiers /
    1 078 tests, alertes 129, backtest 131, pacte 120, daemon 786, web 430 fichiers / 6 388
    tests.
  - Tests ajoutés :
    - le moteur en une passe égale une référence lente qui relance le moteur à chaque bougie ;
    - cas de référence BTCUSDT 4h de 3 000 bougies, versé au dépôt
      (`packages/indicators/src/strategy/fixtures/btcusdt-4h-3000.json`) : 8 zones fortes
      actives, 122 réactions (62 sur support, 60 sur résistance), 120 triangles creux ;
    - causalité par préfixes et futur altéré ; série sans volume, bougies plates, historique de
      0, 1 ou 8 bougies, prix × 1e-9 ;
    - une alerte de seuil tire exactement aux 31 réactions depuis l'index 2 700
      (`packages/alerts/src/engine.axisSr.test.ts`) ;
    - extension de 500 à 3 000 bougies, pagination de `refClose` ;
    - infobulle du graphe : rubans rangés par distance verticale au réticule
      (`apps/web/src/chart/indicators.tooltip.test.ts`) ; réserve en tête des 120 triangles
      creux.
  - Vérification avant la fusion, sur `e7189e7` (10 novembre 2026) :
    - `pnpm check` vert, avec les mêmes comptes ;
    - `pnpm check:e2e` : 175 parcours sur 175 ;
    - application réelle (BTCUSDT 4h) : réticule dans une bande, la première ligne de
      l'infobulle décrit cette zone ; réticule sur un triangle creux, la ligne commence par la
      mention « non mesuré », entière au bureau.

## AXIS — lisible, honnête et annonciateur (demande du 11 novembre 2026)

Demande du propriétaire, le 11 novembre 2026 : « Top, merge dans main et poursuit l'amélioration
d'axis ». Elle prolonge celle du 9 novembre (zones classées par force et signal précoce, section
précédente). Le propriétaire a ajouté le même jour : « Top après ça merge directement les pr et
déploie ». Chaque pull request du chantier AXIS est donc fusionnée dans `main` par l'orchestrateur
sans nouvelle demande, une fois sa CI verte et sa revue indépendante sans constat bloquant ; Vercel
déploie `main`. Une cartographie et une critique adverse ont précédé le chantier ; le lot retenu
rend AXIS lisible au téléphone, où le propriétaire l'utilise souvent, dit ce qui n'est pas mesuré,
et annonce l'achat quand une seule condition manque. **Aucun fournisseur, hôte, indicateur, fenêtre, dépendance ni
champ de `@axiom/types` nouveau ; aucune série, aucun signal confirmé, aucune sortie d'alerte ne
change ; aucun chiffre de performance nouveau dans l'interface.** AXIS S/R garde 23 réglages et
8 sorties, AXIS ses 17 réglages. Trois lots, intégrés dans l'ordre 0, T, I sur la branche
`feat/axis-lisible` (base `111df0d`), puis des corrections d'intégration.

- **Exceptions au contrat** (arbitrées par l'orchestrateur pour servir la demande, à confirmer par
  le propriétaire).
  - Affichages ajoutés dans des surfaces existantes, sous le gel G100 : seconde ligne au bord
    droit du graphe et pré-signal (AXIS S/R) ; « inactives » au bandeau de session, ligne
    « alertes » du registre santé et section Alertes en erreur (démarrage des alertes) ; attribut
    `data-chart-entete` sur le bandeau du symbole et l'en-tête d'une vue secondaire.
  - `stratAxis.ts` est modifié (textes, rendu partagé, exports), alors que la section du
    9 novembre disait « `stratAxis.ts` n'est pas modifié » et « signaux confirmés … inchangés au
    caractère près ». Depuis ce chantier, le DÉBUT de l'infobulle d'un signal confirmé d'AXIS et
    d'AXIS S/R change (statut de mesure après le score) ; sa FIN, qui porte les formulations des
    campagnes figées, reste au caractère près.
  - Textes et libellés réécrits : infobulle d'une zone, retournements ↺ (infobulle, étiquette,
    couleur, libellés de l'éditeur), classement des retournements dans EQS (voir le lot I).
  - Tests « au caractère près » modifiés à dessein. Par le lot I : tête de l'infobulle des
    signaux et des zones, infobulle, étiquette et couleur des ↺, libellé et poids EQS. À
    l'intégration, expliqués dans le message de leur commit : « ↺ » sur chaque marqueur (40
    étiquettes au lieu de 10), écart à deux décimales sous 0,1 %, texte du pré-signal réordonné.
- **Lot 0 — alertes chargées après le premier rendu** (constat WEB-3 de la revue du 6 novembre).
  Fichiers : `apps/web/src/alerts/demarrageDiffere.ts`, `App.tsx`, `chargementInitial.test.ts`,
  `components/SessionStrip.tsx`, `data/dataCockpit.ts`, `data/dataActions.ts`,
  `e2e/mobile-alertes-differees.e2e.ts`. `alerts/runtime.ts` n'est pas modifié.
  - Le runtime des alertes part par `import()` juste après le premier rendu
    (`demarrerAlertesDifferees`), hors du chargement initial. Il se calibre sur l'état courant à
    son démarrage, comme avant : définitions et état armé persistés, dernière bougie close,
    régime, CVD, flux de capitaux, on-chain, funding, cascades de liquidations, amorce des
    alertes de preset, détection du daemon. Seul cas non rejoué, comme avant : les ticks de prix
    antérieurs à l'abonnement ; un franchissement « les deux sens » commence donc à être observé
    un chargement de chunk plus tard.
  - Quatre entrées nouvelles de `MODULES_DIFFERES` : `alerts/runtime`, `store/presetAlerts`,
    `store/fluxCapitaux`, `components/liquidationsWindow.util`. Trois modules plus petits sortent
    aussi du chemin initial sans garde (`store/analyseMultidomaine`, `store/cvd-divergence`,
    `data/onchain/fluxCapitaux.contract`).
  - Un échec n'est jamais silencieux : `console.error`, un seul toast « Alertes inactives :
    module non chargé » (bouton « Recharger » quand le navigateur est en ligne), nouvelle
    tentative au prochain `online` et au retour de l'onglet. Module chargé mais démarrage en
    exception : « Alertes inactives : démarrage échoué », sans nouvelle tentative. Au
    rétablissement : toast « Alertes actives ».
  - L'état dure plus longtemps que le toast : après un échec, et tant que le runtime n'est pas
    démarré, le registre santé porte une ligne `alertes` en erreur (seconde ligne qui n'est pas
    une source de marché, après `axiomd`). Depuis la revue globale, la même ligne est posée, sans
    toast, quand le chargement dure plus de dix secondes (« Alertes inactives : chargement en
    cours », `DELAI_CHARGEMENT_LENT_MS`) : sur un réseau dégradé, le bandeau comptait sinon des
    alertes que rien n'évaluait encore. Un chargement ordinaire ne s'affiche pas. Elle alimente la pastille « Santé », la section Santé sources et la fenêtre
    DATA (libellé « Alertes (ce navigateur) », motif « Aucune alerte n'est évaluée dans ce
    navigateur. Si l'état dure, rechargez l'application. » ; « Si l'état dure » depuis la revue de
    la pull request n° 11 : pendant un chargement qui traîne, recharger relancerait les requêtes
    en cours). Le bandeau de session écrit « ALERTES inactives » à
    la place du compteur (correction d'intégration : il affichait encore « ALERTES 1 »).
  - La section Alertes a sa propre `ErrorBoundary` : son chunk dépend de celui du runtime ; s'il
    manque, elle affiche « Alertes indisponible » et « Recharger l'application », le reste du
    terminal reste en place (avant : tout le terminal tombait sur « AXIOM indisponible »).
  - Constat consigné : Chromium mémorise un `import()` échoué pour la vie du document. La
    nouvelle tentative y échoue sans requête ; le rechargement est le seul remède fiable (même
    règle que `ErrorBoundary` pour `React.lazy`). Firefox et WebKit non vérifiés.
- **Lot T — infobulle lisible au téléphone.** Fichiers : `apps/web/src/chart/ChartInstance.tsx`,
  `chart/indicators.ts`, `components/SymbolBanner.tsx`, `e2e/mobile-axis-sr.e2e.ts`,
  `e2e/helpers/axis-sr-telephone.ts`.
  - En mise en page téléphone (frontière de `useMobileLayout`, attribut `data-mobile`), la
    première rangée de l'infobulle d'indicateur du pane des prix commence 2 px sous le bas RÉEL
    de l'en-tête du slot (`data-chart-entete`), jamais au-dessus de 36 px : 52 px sous le bandeau
    du symbole, 54 px sous l'en-tête d'une vue secondaire (Chromium, 390 × 844). Fonction pure
    `hautInfobullePrix(basReplie, basEntete, hauteurPane)` =
    max(36 ; bas replié + 2 ; min(bas + 2 ; tiers du pane)). « Détails » fermé, la hauteur du
    pane ne compte pas. « Détails » ouvert, l'infobulle suit le panneau tant qu'il tient dans le
    tiers haut du pane (portrait : 137 px pour un panneau à 135 px) et s'arrête à ce tiers
    au-delà, sans remonter au-dessus de la part repliée du bandeau. Bureau : 36 px, inchangé.
  - Couplage : `ChartInstance.tsx` lit `#chart-banner-details` de `SymbolBanner.tsx` ; renommer
    l'identifiant casse le plafond, deux parcours le détectent.
  - Ligne réservée (`createTooltipDataSource`, pont commun à tous les indicateurs) : réticule
    DANS la bande d'une zone, une des trois lignes lui est réservée ; segments et marqueurs à
    3 bougies ou moins n'en prennent alors que deux, ordre inchangé. Sur le cas de référence,
    réticule au milieu de la bande : il ne reste aucune des 11 473 bougies couvertes sans ligne
    de zone (281 avant). Rien de réservé hors bande, sur un autre pane, sans ordonnée, ou pour
    une zone cassée ; une seule ligne si deux bandes se chevauchent. La prime spot/perp, seule
    autre définition à rubans porteurs d'info, n'est pas changée.
- **Lot I — AXIS S/R et AXIS : textes, retournements, pré-signal.** Fichiers :
  `packages/indicators/src/strategy/stratAxis.ts`, `stratAxisSr.ts`,
  `apps/web/src/data/signaux.ts`, `components/InstanceParamsEditor.tsx`.
  - **Infobulle d'une zone.** L'essentiel tient en tête, 55 caractères au plus sur les 12 zones
    du cas de référence : rôle, forte ou faible, touches, écart du cours au BORD de la zone
    (« AXIS support fort · 5 touches · bord à -1.3 % », ou « dans la zone »). Suivent les bornes,
    le niveau et son écart, les rejets, l'inversion, la profondeur, puis « dernier pivot confirmé
    (ou inversion) il y a N bougies » et, pour une zone forte, « dernière réaction il y a
    M bougies » ou « aucune réaction ». Des décomptes, aucun taux de réussite.
  - **Seconde ligne au bord droit.** Sous l'étiquette du support fort et de la résistance forte
    les plus proches par leur bord (`fortesProchesAxis`), l'écart en % de la dernière clôture
    DÉCIDÉE à ce bord, ou « dans la zone » : cas de référence, « -1.3 % » et « +10.0 % »,
    14 étiquettes au bord droit au lieu de 12, plus une « pré-signal » quand il est actif. Une
    décimale ; deux sous 0,1 % (« +0.04 % »), pour ne pas écrire un écart nul hors de la zone
    (correction d'intégration). La bougie en formation n'est pas lue.
  - **Signaux confirmés** d'AXIS et d'AXIS S/R : un statut court suit le score (`statutAxis`) :
    « test 4h ≈ EMA 200 seule » en 4h ou sans unité ; « 1h : test échoué », « 1w : non mesuré »
    ailleurs ; « filtre flux, non mesuré » ; « réglage non validé » quand le stop, le filtre ADX,
    un régime hors de 0 et de 100 ou la marge S/R sont actifs. Il abrège la réserve de fin
    d'infobulle sans jamais dire mieux qu'elle. « réussi » n'y figure pas : avec « — score »,
    que `indicators.axisStop.test.ts` épingle, la plus longue tête (« AXIS vente forte — score
    -4/6 · test 4h ≈ EMA 200 seule ») fait déjà 55 caractères ; « test réussi » reste écrit en
    entier à la fin.
  - **Retournements ↺** (constat IND-1 de la revue du 6 novembre : jamais mesurés, seuils fixés
    à la main, score qui n'est pas une probabilité). Marqueurs et étiquettes gris (`--text-dim`) ;
    infobulle ouverte par la réserve des signaux précoces (« AXIS ↺ signal précoce non mesuré —
    lecture indicative, jamais une promesse — … ») ; score écrit « 80/100 », jamais « 80 % » ;
    chaque marqueur porte au moins « ↺ », les dix plus récents ajoutent sens et score
    (correction d'intégration : le gris ne les sépare pas des signaux confirmés dans les thèmes
    Matrix et Bloomberg) ; prix par l'aide commune (lisibles sous un centime). Éditeur :
    « Détecter les retournements ↺ (non mesurés) », « Confiance min. retournement (40–100
    /100) ». EQS : fiabilité « heuristique » et poids 1 quel que soit le score (avant : « fiable »
    et poids 3 dès 75), libellé « AXIS ↺ Achat (80/100) », prix à quatre chiffres significatifs
    sous 100 (avant : poids 2 sous 75, « 80% », quatre décimales). La détection ne change pas
    (403 retournements sur le cas de référence).
  - **Pré-signal** d'AXIS S/R, sous le réglage `signauxPrecoces` (`preSignalAxisSr`, pure, par
    bougie). À la dernière bougie décidée, à plat, hors bougie d'une sortie par stop : tout est
    réuni pour acheter SAUF la clôture au-dessus de l'EMA de tendance. Rendu : un segment
    pointillé gris de 6 bougies au niveau de cette EMA, terminé sur la dernière bougie, et
    l'étiquette « pré-signal » au bord droit. Infobulle : « AXIS pré-signal non mesuré > X —
    si clôture au-dessus et si le score et les filtres tiennent : achat » (« … si le score
    tient » quand aucun filtre n'est lu). « non mesuré » finit au 26e caractère à toute échelle
    de prix ; le niveau finit au 40e au plus pour un prix inférieur à cent millions (onze
    caractères au plus ; douze ou treize au-delà) ; « achat » vient en dernier (revues du
    11 novembre, voir « Revue et tests »).
    L'EMA étant récursive, la bougie suivante clôture au-dessus de son EMA si et seulement si
    elle clôture au-dessus de X : le cas est exact, à l'arrondi d'affichage de X près (deux
    décimales à partir de 100, cinq chiffres significatifs entre 1 et 100, quatre en dessous :
    0,005 % au plus à partir de 1, 0,05 % en dessous), mais conditionnel et **non mesuré**. Sur le cas de référence (données déjà vues, sans valeur probante) :
    63 bougies en pré-signal sur 3 000, en 18 épisodes ; niveau franchi 5 fois à la bougie
    suivante ; 4 achats, soit 4 des 17 achats du cas annoncés d'une bougie. Aucune série, aucune
    alerte, aucun marqueur n'en dépend.
  - **Une seule copie du rendu.** `signauxAxis` et `retournementsAxis`, exportés par
    `stratAxis.ts`, sont appelés par les deux `calc` ; `RESERVE_PRECOCE` y est déplacée.
- **Limites du 9 novembre levées** (annotées sur place dans la section précédente).
  - Au téléphone, la première ligne de l'infobulle ne passe plus sous le bandeau du symbole.
  - Réticule dans une bande, la zone a toujours sa ligne, même près de trois marqueurs.
  - Le libellé d'une zone ne commence plus par ce qui se lit déjà sur le graphe : ses
    55 premiers caractères disent le rôle, la force, les touches et l'écart.
- **Limites qui restent.**
  - (Levée en partie le 12 novembre 2026 : chaque rangée s'arrête à un mot entier suivi de
    « … », et le texte complet de l'annotation visée se lit au téléphone dans l'encart ; les
    rangées restent sans retour à la ligne, et les nombres de caractères ci-dessous ne valent
    plus. Voir « AXIS au téléphone — texte complet sous le doigt et alertes visibles ».)
    L'infobulle ne revient pas à la ligne : au téléphone, une ligne est coupée net, sans points
    de suspension, et un nombre peut l'être en son milieu. Caractères visibles, mesurés par la
    revue globale sur le vrai graphe (Chromium, police du conteneur ; un vrai téléphone peut
    différer d'un ou deux caractères) : 55 à 57 à 390 px en thème par défaut ; 52 à 54 à
    375 px ; 49 à 51 à 360 px ; 42 à 44 à 320 px ; 45 à 390 px dans les thèmes Matrix et
    Bloomberg (chasse fixe) ; thèmes cute et aurora non mesurés. À 390 px en thème par défaut,
    tête d'une zone, statut d'un signal et « non mesuré » d'un triangle creux ou d'un ↺
    tiennent ; ailleurs leur fin est coupée (à 45 caractères, « AXIS résistance forte ·
    4 touches · bord à +1 » pour +13.4 %, et « … test 4h ≈ EMA » pour le statut). En chasse
    fixe, mesuré par la revue de la pull request n° 11 : 34 caractères à 320 px, 40 à 360 px,
    42 à 375 px (45 à 390 px, 51 à 430 px) ; la ligne du pré-signal, riche en chiffres, n'en
    montre que 40 à 41 à 320 px en thème par défaut. Le « non mesuré » du pré-signal (26e
    caractère) se lit dans toutes ces configurations. Texte final remesuré sur le vrai graphe
    par la contre-revue de la pull request n° 11, dans douze configurations : la mention s'y
    lit partout. Son niveau est rogné à 320 px en chasse fixe, et c'est alors la partie
    entière qui est coupée dès 100 000 : « > 94023 » pour 94023.57, mais « > 11302 » pour
    113028.30, dix fois trop petit (11 des 63 bougies en pré-signal du cas de référence ont un
    tel niveau de neuf caractères) ; sous un centième, on lit « > 0.000 ». Ailleurs il est
    entier jusqu'à onze caractères, sans marge à 320 px en thème par défaut et à 360 px en
    chasse fixe (40 caractères visibles) ; un niveau de douze caractères (prix d'au moins cent
    millions) y est rogné. À 390 px en thème par défaut, cette ligne montre 54 caractères.
    Piste relevée, non retenue : sans « AXIS » en tête, un niveau de dix caractères tiendrait
    dans 34. Le détail qui suit n'est lisible qu'au bureau.
  - L'infobulle est dessinée sur le graphe, sans fond. Ses trois rangées recouvrent ce qui se
    trouve dans les 50 px sous l'en-tête : repère du plus haut, bord ou bande d'une zone,
    étiquette de zone ou de signal. Sur les captures d'intégration au téléphone, le repère du
    plus haut recouvre quelques caractères de la deuxième rangée, et une étiquette « faible »
    ou « R forte · n » la fin de la deuxième ou de la troisième. Au bureau, une étiquette
    « R forte · n » et sa seconde ligne placées en haut de la fenêtre de prix recouvrent la fin
    des deux premières rangées.
  - Bureau : l'infobulle reste à 36 px alors que le bandeau descend à 44 px (64 px en vue
    étroite, mesures du lot T) ; la première rangée, celle du pré-signal ou d'un signal, est
    entamée par le bas du bandeau (vu sur les captures d'intégration en 1 440 × 900). Défaut
    antérieur, laissé à l'arbitrage du propriétaire. (Levée le 12 novembre 2026 : l'infobulle
    commence 2 px sous le bas réel du bandeau, au bureau aussi ; arbitrage à confirmer, même
    section que ci-dessus.)
  - « Détails » ouvert sur un pane court (paysage avec un pane d'indicateur : pane de 118 px,
    panneau de 53 à 111 px), les trois lignes passent derrière le panneau ; le refermer suffit.
    « Détails » ouvert, l'ordonnée n'est relue qu'au redimensionnement du conteneur ou de
    l'en-tête, pas à l'ajout d'un pane (mesuré à la revue : 73 px gardés là où la formule donne
    55, les deux derrière le panneau). Même effet, relevé par la revue globale, en paysage sans
    pane d'indicateur (844 × 390) et en 320 × 568 : « Détails » ouvert, les deux premières
    rangées passent derrière le panneau, la troisième seule reste visible.
  - Ligne réservée : réticule dans une bande et trois marqueurs proches, le troisième dans
    l'ordre du tableau (signaux confirmés, triangles creux, forts mouvements, ↺) perd sa ligne à
    cette bougie. Exemple : bougie 2 988 du cas de référence, où la ligne « AXIS forte vente —
    … » laisse la place à la zone ; elle reparaît dès que le réticule sort de la bande.
  - Écart au bord droit : celui de la dernière clôture décidée, donc vieux d'une bougie entière
    au plus pendant l'approche ; une zone hors de la fenêtre de prix n'a pas d'étiquette visible
    (au téléphone, cas de référence : « R forte · 12 » est hors fenêtre) ; sous 0,005 %, l'écart
    s'écrit « +0.00 % ». Une étiquette de signal proche de la dernière bougie peut recouvrir les
    étiquettes du bord droit.
  - Pré-signal : segment et étiquette ne se voient que si le niveau est dans la fenêtre de prix,
    et passent sous le bandeau quand il est tout en haut (bougie 2 288 du cas de référence) ;
    l'infobulle, elle, donne alors le niveau. Il ne lit que la dernière bougie décidée, n'a ni
    alerte ni sortie, et son réglage garde le libellé « Signaux précoces sur zone forte (non
    mesurés) » bien qu'il le gouverne aussi.
  - `statutAxis`, comme la fin de l'infobulle, ne lit ni les réglages du cœur (seuils, EMA de
    tendance, Supertrend) ni ceux de la couche flux : « test 4h ≈ EMA 200 seule » s'affiche
    encore avec une EMA de tendance de 50.
  - Retournements ↺ : `--text-dim` reste proche de `--down` en thème Matrix et de `--up` en
    thème Bloomberg ; c'est le signe « ↺ » qui les distingue. Les étiquettes de retournements
    voisins se chevauchent quand ils sont denses. Sur le graphe, leurs prix gardent deux
    décimales entre 1 et 100, là où EQS en écrit quatre chiffres significatifs.
  - (Levée en partie le 12 novembre 2026 : au téléphone la pile d'avis est posée au-dessus de
    la barre de navigation basse ; l'avis « Alertes inactives » reste éphémère, seul un avis
    de déclenchement reste jusqu'au toucher. Même section que ci-dessus.)
    Alertes : au téléphone, l'avis est éphémère (6 s avec le bouton, 2,5 s sans) et recouvre la
    barre de navigation basse pendant son affichage ; l'état durable est « inactives » au
    bandeau, puis, dans le tiroir Panneaux, la section Alertes en erreur et la ligne « alertes »
    de Santé sources (repliée par défaut). La pastille « Santé » ne distingue pas cette panne
    d'une autre source en erreur. Dans Chromium la ligne dure jusqu'au rechargement. Si un autre
    moteur relance la requête et réussit, la section Alertes déjà tombée reste en erreur jusqu'au
    rechargement alors que les alertes sont actives.
  - Relevé à l'intégration, antérieur au chantier (reproduit sur `111df0d`) : quand les bougies
    arrivent dans l'instant qui suit le montage (réponses immédiates d'un réseau bouchonné), une
    course du moteur du graphe peut figer le canvas du pane des prix jusqu'au prochain
    redimensionnement. KLineChart 9.8.12 abandonne la remise à l'échelle d'un canvas quand une
    peinture est déjà en attente (`Canvas._executeListener`). Mesuré sous Chromium : en mise en
    page téléphone, où la première passe redimensionne les axes, à chaque essai quand les
    réponses sont immédiates (six sur six, dont trois sur `111df0d`) et jamais avec 150 ms de
    latence par réponse ; au bureau, une fois, sur quatre essais d'une série tronquée avec
    cette latence. Précisé par la revue globale : ces essais portaient AXIS S/R (persisté ou
    ajouté), donc la remontée aux 3 000 bougies dans cet instant ; sans indicateur, trois
    essais sans gel. Le canvas de superposition, qui porte le réticule et l'infobulle, se fige
    aussi, parfois seul : l'infobulle ne suit alors plus le doigt. Le lot T ne l'aggrave pas
    (aucune de ses passes ne change la taille d'un canvas). Non corrigé dans ce chantier ;
    correctif reporté (voir « Reporté »). (Requalifié le 12 novembre 2026, à confirmer : le
    gel systématique suit l'horloge de test `page.clock`, que les parcours AXIS n'utilisent
    plus ; voir « Limites qui restent » de la section suivante.)
- **Choix de l'orchestrateur, à confirmer par le propriétaire.**
  - Écart aux zones en % du cours plutôt qu'en ATR.
  - Retournements ↺ classés « heuristique » de poids 1 dans EQS : l'ordre de la boîte de signaux
    change.
  - Pré-signal affiché par défaut, sous le réglage des signaux précoces, sans réglage ni
    libellé propre.
  - Runtime des alertes chargé après le premier rendu : la réserve de budget est comptable,
    voir le budget.
  - Tête d'un signal confirmé sans le mot « réussi ».
  - Choix d'intégration : « ↺ » sur chaque marqueur de retournement ; « inactives » à la place
    du compteur du bandeau.
  - Choix pris après la revue globale : texte du pré-signal ouvert par « non mesuré » puis son
    niveau, sans « S/R » ; « inactives » aussi après dix secondes de chargement.
  - Relevé par la revue, laissé tel quel : le signe « ≈ » de « test 4h ≈ EMA 200 seule ».
    Honnête, mais « ≤ », de même longueur, collerait mieux à « pas mieux que » (en PnL net
    total, AXIS fait 28 à 43 % de moins que l'EMA 200 seule sur 3 actifs sur 4, avec une
    meilleure expectancy par trade partout).
- **Budget.** Chargement initial, octets bruts / gzip, par `scripts/verifier-budget-build.mjs`
  (Node 22.23.4, zlib 1.3.1), plafonds 1 220 000 / 360 000 inchangés.
  - Avant, sur `111df0d` : **1 192 298 / 358 337**, marge gzip 1 663.
  - Après intégration : **1 170 895 / 351 030**, soit −21 403 / −7 307 ; marge gzip **8 970**,
    au-dessus des 3 000 exigés.
  - Chaque lot mesuré seul contre `111df0d` : lot 0, −21 733 / −7 746 ; lot T, +823 / +265 ;
    lot I, −748 / +145 (la factorisation du rendu rend 2 498 / 498).
  - La réserve est comptable. Le runtime des alertes et cinq chunks partagés partent en
    six requêtes juste après le premier rendu : 24 309 / 10 145. Avant que les alertes tournent,
    le navigateur a donc reçu 1 195 204 / 361 175, soit +2 906 / +2 838 par rapport à
    `111df0d` : le chemin gardé par le plafond s'allège, pas le démarrage au téléphone.
  - Fichiers à la demande : 141 (135 avant), 1 724 944 / 635 295.
- **Revue et tests.**
  - Chaque lot a été revu par un agent indépendant du développeur, avec un tour de corrections
    pour les lots 0 et T ; aucun constat bloquant ni majeur ne restait à l'intégration. Les
    mineurs restants ont été corrigés à l'intégration, ou consignés dans les limites ci-dessus.
  - Interactions vérifiées à l'intégration sur le vrai graphe (Chromium, 390 × 844 et
    1 440 × 900, réseau bouchonné, cas de référence BTCUSDT 4h) : la tête d'une zone, le statut
    d'un signal et la réserve d'un ↺ tiennent dans la partie visible d'une ligne au téléphone ;
    le niveau du pré-signal n'y tenait pas (« … achat à la clôture si > 9 »), le texte a été
    réordonné une première fois (puis réécrit après la revue globale, ci-dessous) ; les étiquettes du bord droit, seconde ligne et « pré-signal » compris, tiennent
    dans la marge droite et s'écartent de 11 px (largeur mesurée : 50 px au plus pour 76 px).
  - Tests ajoutés : chargeur des alertes (18 tests : double montage, échec, nouvelle tentative,
    ligne santé, arrêt) ; ordonnée de l'infobulle (11) ; ligne réservée et cas de référence
    (`indicators.tooltip.test.ts`) ; pré-signal (11 : règle exacte, causalité par préfixe et
    futur altéré, rendu, réglages) ; têtes de 55 caractères ; bougie en formation à 90 000
    (tête, écart et âges des 12 infobulles inchangés, contre-épreuves faites) ; écart proche du
    bord ; « inactives » au bandeau ; prix EQS entre 1 et 100.
  - Parcours téléphone ajoutés au gate `scripts/ci.sh --mobile` : `mobile-alertes-differees`
    (4) et `mobile-axis-sr` (3, délai de 120 s par test). Prouvés sur Chromium téléphone ;
    WebKit n'est pas installé dans le conteneur d'intégration et ne tourne qu'en CI.
  - Vérification de l'intégration (11 novembre 2026, Node 22.23.4, sur `fb33d59`, dernier
    commit de code) :
    - typage des 7 projets ; indicateurs 232 fichiers / 1 143 tests, alertes 130, backtest 131,
      pacte 120, daemon 786, web 471 fichiers / 6 937 tests. La suite web est lancée sans
      `chart/orderflow.cadence.test.ts`, qui ouvre une WebSocket réelle et lève une erreur non
      gérée dans un conteneur sans réseau (antérieur au chantier, hors périmètre) ;
    - build du web et budget verts (chiffres ci-dessus) ;
    - parcours hermétiques des zones touchées, 43 sur 43 : `quatre-lots-indicateurs`,
      `quatre-lots-alertes`, `gate-g4-alertes`, `multivue`, `niveaux-chart`,
      `revue-outils-avances`, `gate-g6-screener.hermetique`, `gate-g8-session`,
      `quatre-lots-decisions`, `analyse-expy`, `onchain-complements` ;
    - parcours téléphone sur Chromium, 29 sur 29 ;
    - non lancés ici : `pnpm check:e2e` complet, WebKit, Vercel et daemon réels.
  - Hors chantier, corrigé au passage : le test « appelle l'endpoint public sans clé… » de
    `data/onchain/tresoreriesBtc.test.ts` échouait par intermittence (deux lectures de
    l'horloge à 1 ms d'écart) ; son horloge est figée, le code n'est pas modifié.
  - **Revue globale de la branche intégrée** (11 novembre 2026), par trois réviseurs
    indépendants en lecture seule, chaque constat majeur soumis à un contradicteur. Aucun
    constat bloquant.
    - Calculs, causalité, honnêteté des textes : séries, signaux confirmés, marqueurs et
      détection des retournements identiques à `111df0d` sur 31 152 comparaisons ; pré-signal
      conforme à sa définition sur 7 208 bougies et 14 720 bougies suivantes synthétiques ;
      écart au bord, âges et secondes lignes justes sur 18 494 textes ; statut court jamais
      plus favorable que la fin d'infobulle. Deux mineurs sur la ligne du pré-signal.
    - Alertes différées : ni alerte perdue, ni alerte doublée, ni erreur affichée pendant un
      chargement ordinaire ; garde-fou `MODULES_DIFFERES` vérifié par injection. Verdict
      « corrections », avec deux majeurs confirmés par leur contradicteur, dont aucun n'est un
      défaut du chargeur — le test intermittent (fragilité du test, antérieure au chantier) et
      la CI rouge (panne du runner) — et un mineur (chargement qui traîne).
    - Téléphone, parcours, documentation : géométrie de l'infobulle et ligne réservée conformes
      (seul AXIS S/R est touché) ; chiffres du contrat concordants. Un majeur (niveau du
      pré-signal illisible hors de 390 px en thème par défaut) et deux mineurs de documentation.
  - **Corrections de la revue globale** (pull request de suite, n° 11).
    - Texte du pré-signal : il plaçait son niveau aux caractères 47 à 54, lisible seulement à
      390 px en thème par défaut (« achat si > » sans niveau en Matrix et Bloomberg, « > 940 »
      à 360 px), et sa partie lisible était « achat si > X », sans la clôture ni les conditions.
      Nouveau texte ci-dessus (lot I). Niveau à cinq chiffres significatifs entre 1 et 100
      (« 2.25 » pour un seuil de 2,2534 avant). Tests épinglés modifiés à dessein, un test sur
      des niveaux de six à onze caractères. Une première réécriture plaçait le niveau avant
      « non mesuré » : la revue de la pull request n° 11 a mesuré la mention coupée à 320 px en
      chasse fixe (« … > 94023.57, non me »), là où l'ancien texte la gardait ; « non mesuré »
      est repassé en tête.
    - Alertes : ligne santé après dix secondes de chargement (quatre tests ; par mutation, ils
      échouent sans la minuterie, sans son désarmement au succès ou sans celui de l'arrêt ; le
      désarmement à l'échec est tenu par un test antérieur du même fichier). Vérifié par la
      revue sur le vrai navigateur, module retardé de 14 s : « ALERTES 1 » jusqu'à 9,5 s,
      « inactives » à 11,5 s sans toast, retour au compteur à l'arrivée du module.
    - Test intermittent, antérieur au chantier : `alerts/runtime.test.ts` échouait parfois sur
      une machine chargée (18 appels `fetch` au lieu de 1, lignes 778 et 829 avant le
      correctif, 783 et 834 après). Le mock de
      `data/onchain/fluxCapitaux` était contourné (Vitest sert le vrai module aux `import()`
      concurrents tant que la fabrique asynchrone du mock n'est pas résolue) et la vraie
      collecte, 17 requêtes, tombait dans un test qui compte les fetch. Le module est chargé
      une fois en tête du fichier. Le produit n'est pas en cause.
    - Limites réécrites : caractères visibles par largeur et par thème, « Détails » ouvert,
      canvas figé.
  - **CI à la fusion de la pull request n° 10.** Typage, tests du daemon, des paquets, du web
    et du PACTE, build et budget : verts sur GitHub. Les parcours e2e (bureau, téléphone
    Chromium et WebKit) n'y ont pas tourné : l'installation des navigateurs expirait sur une
    panne du miroir `apt` du runner, quatre fois de suite, sur la branche puis sur `main`.
    Fusion faite sur demande explicite du propriétaire (« déploie sur Vercel et Merge sur
    main »). À cette fusion, WebKit n'avait exécuté aucun des 7 nouveaux parcours téléphone.
    Miroir rétabli le soir même : jobs relancés à 22 h 36 UTC, et l'exécution de `main` sur
    `bb2f77c` (n° 118, troisième tentative) est verte en entier, parcours e2e bureau et
    téléphone compris, sur Chromium et sur WebKit. **Les 7 nouveaux parcours téléphone ont
    passé leur premier passage sur WebKit, sans constat** ; le point relevé à la lecture
    (`mobile-axis-sr.e2e.ts:138`, aucun pane sous le réticule au repos) ne s'est pas produit.
    Ces parcours sont hermétiques : ils ne disent rien d'un vrai téléphone, de sa police ni
    de son réseau.
  - **Pull request n° 11** (corrections ci-dessus). Revue par un agent indépendant, verdict
    « corrections » : code des corrections des alertes et du test sans constat (onze mutants
    tués, six scénarios de plus, vrai navigateur) ; deux majeurs — l'ordre du texte du
    pré-signal, et la CI rouge, condition de fusion et non défaut du diff — et trois mineurs :
    niveaux de onze caractères, phrases de documentation périmées ou imprécises, conseil
    « Rechargez » de la fenêtre DATA pendant un chargement en cours. Tous corrigés dans la même
    pull request, sauf la CI. Contre-revue des corrections : majeur du texte levé, mesure à
    l'appui ; trois mineurs de documentation (borne du niveau, exemple du niveau rogné, ce
    résumé), corrigés. Sa CI est d'abord tombée sur la même panne du runner (typage, tests et
    build verts, parcours e2e sautés) ; elle n'a pas été fusionnée dans cet état. Relancée à
    22 h 36 UTC, miroir rétabli : typage, tests, build et budget, parcours e2e bureau et
    téléphone (Chromium et WebKit) verts sur `e957226`.
- **Reporté.**
  - Mention « réglages hors test » quand les réglages du cœur ou de la couche flux s'écartent
    de ceux des campagnes.
  - Retour à la ligne de l'infobulle (ou fond sous ses rangées), et son ordonnée au bureau.
    Tant que la ligne est coupée net : têtes de zone et statuts plus courts que 45 caractères,
    ou écart placé avant les touches, pour les thèmes à chasse fixe et les écrans étroits.
    (12 novembre 2026 : texte complet dans l'encart du téléphone, coupe aux mots entiers et
    ordonnée du bureau livrés ; le fond sous les rangées reste reporté.)
  - Correctif du canvas figé (remise à l'échelle forcée après le premier chargement des bougies).
  - `chargerFluxCapitauxParDefaut` (`store/fluxCapitaux.ts`) lance la collecte même si le
    dernier consommateur est parti pendant l'`import()` : la requête Coin Metrics part quand
    même (relevé par la revue, antérieur au chantier).
  - Lot alertes : alerte sur le pré-signal ou sur l'approche d'une zone forte, réglages de
    l'instance lus par les alertes, libellés des sorties dans le formulaire. (12 novembre
    2026 : libellés des sorties livrés ; le reste est reporté aux lots suivants de la phase 2.)
  - Amorce du backtest (BT-1).
  - Test prospectif du signal précoce, du pré-signal et des retournements : aucun n'a été
    soumis à des données jamais vues.

## AXIS au téléphone — texte complet sous le doigt et alertes visibles (phase 2, lot 1, 12 novembre 2026)

Demande du propriétaire, le 11 novembre 2026 : « Top, merge dans main et poursuit l'amélioration
d'axis », et le même jour : « Top après ça merge directement les pr et déploie ». Elle prolonge
celle du 9 novembre (voir les zones tôt, savoir laquelle marque un support ou une résistance
forte) et la phase 1 du 11 novembre (section précédente), fusionnée dans `main` (`c8b9897`). Le
propriétaire utilise souvent l'application au téléphone. Une conception et une critique
indépendante ont découpé la phase 2 en lots ; ce premier livre les deux qui se voient le plus à
l'iPhone : le texte complet d'une zone ou d'un signal sous le doigt, et une alerte qui se voit
quand elle sonne. **Aucun fournisseur, hôte, indicateur, fenêtre, dépendance ni champ de
`@axiom/types` nouveau ; aucune série, aucun signal confirmé, aucun marqueur ne change ; aucun
chiffre de performance nouveau dans l'interface.** Deux lots développés en parallèle sur des
fichiers disjoints, chacun revu par un agent indépendant avec un tour de corrections, puis
intégrés dans l'ordre « infobulle », « alertes A1 » sur la branche `feat/axis-telephone-alertes`
(base `c8b9897`), suivis des corrections d'intégration.

- **Arbitrages de l'orchestrateur, à confirmer par le propriétaire.** Aucun n'a été demandé mot
  pour mot ; chacun sert la demande et s'écarte d'une règle écrite.
  - Gel G100 : un affichage ajouté dans une surface existante — le texte de l'annotation visée,
    dans l'encart O/H/L/C du graphe, en mise en page téléphone seulement.
  - Deux non-buts du 9 novembre rouverts (« Modifier le panneau des alertes ou le texte de leurs
    notifications ») : le formulaire et la liste des alertes changent, et le TEXTE d'une alerte
    AXIS ou AXIS S/R existante change partout où il s'écrit — liste, avis, journal, dossiers de
    décision, relais macOS et Telegram du daemon (voir le lot alertes A1). Les autres alertes
    gardent leur texte au caractère près.
  - Un avis d'alerte reste à l'écran jusqu'au toucher (avant : 2,5 s, 6 s avec un bouton).
  - Bureau : l'infobulle d'indicateur du pane des prix, donc les rangées de TOUS les indicateurs
    qui y écrivent, descend de 36 px à 2 px sous le bas réel du bandeau (46 px mesurés à
    1 440 × 900, soit 10 px de plus).
  - Les rangées de l'infobulle sont coupées au dernier mot entier, suivi de « … », pour TOUS les
    indicateurs à annotations, pas seulement AXIS.
  - Les 20 stratégies dont la seule sortie est le prix d'entrée ne sont plus proposées en alerte
    de seuil. Une alerte déjà posée dessus reste dans la liste, avec la pastille « muette » et
    son explication.
  - Une alerte dont l'indicateur déclare une amorce (AXIS : 1 500 bougies, AXIS S/R : 3 000)
    n'est plus évaluée tant que le tampon du graphe ne la compte pas. Avant : évaluée sur le
    tampon présent, 500 bougies à l'ouverture. Recul assumé : sur un marché dont l'historique
    est plus court que l'amorce, l'alerte n'est jamais évaluée, alors que le graphe y dessine
    les signaux (mention « amorce courte »).
  - Convention : ni `def.message` ni le libellé d'une alerte ne portent le symbole ou l'unité ;
    l'hôte les ajoute (« SYMBOLE UNITÉ — libellé » pour l'avis du web, « AXIOM — SYMBOLE » pour
    le daemon). Écrite en tête de `packages/alerts/src/libelles.ts`, à suivre par le lot
    « prix au bord d'une zone ».
  - Écart au brief du lot infobulle, entériné : `texteEncart` ne coupe pas « à 360 caractères
    au plus ». 360 est le seuil sous lequel un texte est rendu entier ; au-delà, ses trois
    premières parties sont rendues quelle que soit leur longueur (voir le lot).
  - Écarts au brief du lot alertes, entérinés : une def réactivée ou prolongée en cours de
    bougie est évaluée aussitôt sur la dernière bougie close, comme une def créée ; trois avis
    d'alerte au plus, les plus anciens fondus en un avis de synthèse.
  - Choix d'intégration : au doigt, l'encart reste après le lever ; un composite lisant AXIS est
    évalué à l'arrivée de son amorce ; un composite ne lit plus les bougies d'un marché que le
    graphe a quitté ; l'encart s'arrête au-dessus de la pile d'avis.
  - Tests « au caractère près » modifiés à dessein, expliqués dans le message de leur commit.
    Antérieurs au chantier : le parcours 2 de `mobile-axis-sr` (ordonnée du bureau : « 36 px »
    devient « sous le bandeau », à 1 280 puis 800 px), une ligne du parcours 3 (rotation par
    `redimensionner`), et les quatre tests du bloc « référence du garde-fou de régime » de
    `alerts/runtime.test.ts` (ils évaluaient AXIS sur 3 bougies ; leur tampon en compte
    1 500). Créé par le lot et modifié à l'intégration : le test du composite lisant AXIS.
    Créé par le lot et modifié à la revue globale : le parcours des quatre déclenchements
    attendait « rsi(rsi) > 50 » à l'ouverture ; il attend ce texte suivi de la clôture de la
    bougie 2 931, où le RSI est passé au-dessus de 50 (voir « Rattrapage »).
    Aucun test désactivé, sauté ou supprimé.
  - Corrections de la revue globale qui changent ce qu'on lit : au retour dans l'application,
    l'avis d'un seuil d'indicateur date la bougie de son signal et « Voir » la marque (avant :
    la dernière bougie close, sans date) ; la liste écrit « condition déjà vraie : sonnera quand
    elle le redeviendra » pour une alerte désarmée qui n'a jamais sonné (avant :
    « déclenchée ») ; un composite lisant AXIS ne sonne plus sur une bougie où le garde-fou de
    régime a bloqué l'achat. `@axiom/alerts` exporte `comparer` (aucun autre changement du
    moteur ; les relais du daemon écrivent le même texte qu'avant).
- **Lot infobulle — texte complet sous le doigt, rangées coupées aux mots entiers, bureau sous
  le bandeau.** Fichiers : `apps/web/src/chart/ChartInstance.tsx`, `chart/indicators.ts`,
  `chart/candleReadout.ts`, leurs tests (`ChartInstance.infobulle.test.ts`,
  `indicators.tooltip.test.ts`, `candleReadout.test.ts`), `e2e/mobile-axis-sr.e2e.ts`,
  `e2e/helpers/axis-sr-telephone.ts` ; à l'intégration, `chart/overlayLegend.ts`.
  - **Encart.** En mise en page téléphone, le doigt sur une zone, un triangle creux ou un signal :
    l'encart O/H/L/C prend la largeur du graphe moins 8 px et écrit sous les prix le texte de
    l'annotation visée (`[data-candle-readout-texte]`), renvoyé à la ligne, sur fond opaque
    (l'encart des prix seuls garde son fond à 92 %). Il commence sous l'ordonnée de l'infobulle
    (2 px sous le bandeau), s'arrête au-dessus du bouton « Indicateurs (n) », et ne recouvre ni
    le bandeau, ni « Détails », ni la barre de navigation — en portrait, « Détails » fermé ; les
    autres cas sont aux limites. Mesuré à l'intégration sur le cas de
    référence (Chromium, 3 000 bougies) : à 390 × 844 en thème par défaut, le texte du support
    fort (248 caractères) tient en 4 lignes, encart de 382 × 116 px, à 8 px du bouton ; celui
    d'un triangle creux (223 caractères) en 4 lignes ; à 320 × 568 en thème Matrix, 6 lignes et
    147 px pour l'un (248 caractères) comme pour l'autre (242). Mesuré par la revue : 5 lignes
    et 131 px à 320 × 568 en thème par défaut. Au bureau l'encart n'a pas de texte.
  - **Texte visé** (`infosSousReticule`, pure ; `ChartIndicators.texteVise`). Sur l'ENSEMBLE des
    indicateurs montés sur le pane des prix : le marqueur à 1 bougie ou moins dont le point est
    à 24 px ou moins du doigt (le plus proche en bougies) ; sinon la bande qui contient le
    réticule ; sinon le premier segment ou marqueur à 3 bougies ou moins ; à rang égal, l'ordre
    de montage. Constat majeur de la revue, corrigé dans le lot : AXIS monté avant AXIS S/R, le
    doigt dans une bande lisait le signal d'AXIS voisin.
  - **`texteEncart`** (pure). Entier jusqu'à 360 caractères, ou s'il compte quatre parties au
    plus (séparées par « — ») ; sinon ses trois premières parties — tête, statut, détail —
    suivies de « … » ; jamais plus de 720 caractères. Zones, triangles creux, retournements,
    forts mouvements et pré-signal du cas de référence sont rendus entiers (334 caractères au
    plus). Un signal confirmé (plus de 800 caractères) s'arrête après ses votes et son flux,
    AVANT les phrases des campagnes figées : ni « test réussi », ni chiffre de campagne sans la
    réserve qui le suit. C'est une règle de structure : une limite en caractères seule rendait
    la tête sans le détail dès que l'OI ou un réglage l'allongeait. Rendus bornés par les tests
    du lot : 360 caractères au plus sur la fixture (sans OI) ; 420 au plus avec l'OI, un filtre
    ADX, un stop ou la marge S/R ; 560 au plus quand l'amorce courte et tous les réglages hors
    test s'y ajoutent (369 et 530 relevés par le lot).
  - **Rangées du canvas** (`couperInfo`, `rangeesInfobulle`, pures). Chaque rangée s'arrête au
    dernier mot entier qui tient dans le pane, suivi de « … » ; un mot visible sous l'ancienne
    coupe nette n'est jamais retiré pour faire place à « … » ; un séparateur resté seul en fin
    (« — », « · », « ; », « : », « > ») est retiré. Largeur d'une rangée : celle du pane moins
    12 px, mesurée sur un canvas hors écran dans la police de l'infobulle. « > 11302 » pour
    113028.30 et « bord à +1 » ne se produisent plus. Vérifié par la revue sur 1 001 rangées
    distinctes dans 12 configurations (quatre écrans de 320 à 390 px, trois thèmes) : aucun
    défaut, et les rangées qui montraient « non mesuré » le montrent encore.
  - **Bureau.** La condition « téléphone seulement » de `hautInfobullePrix` est levée : la
    première rangée commence 2 px sous le bas réel de l'en-tête, 36 px restant le plancher.
    Mesuré à l'intégration à 1 440 × 900 : 46 px. Mesuré par la revue : 46 px sous un bandeau à
    44 px de 900 à 1 440 px de large, 66 px sous un bandeau sur deux rangées à 800 et 768 px.
  - **Corrections d'intégration** (mineurs de la revue).
    - L'encart ne restait qu'après un appui simple : après un glissement, un appui long ou un
      second appui près du réticule, lever le doigt le masquait alors que le réticule restait.
      Au doigt il reste maintenant tant que le moteur garde son réticule. KLineChart n'annonce
      pas qu'il efface un réticule (toucher posé ailleurs) : l'encart est masqué dès le contact
      (`touchstart` en phase de capture) et rouvert dans le même instant quand le réticule suit
      le doigt.
    - Doigt levé, quand le graphe glisse sous un réticule resté au même pixel (rotation,
      défilement lancé, bougie nouvelle), l'encart est masqué plutôt que de décrire une autre
      bougie.
    - Panneau « Indicateurs (n) » déplié : l'encart passait par-dessus ses lignes sans capter
      les touchers. Il s'arrête au haut du panneau ; sans place au-dessus, le panneau passe
      devant (z-index 30 contre 29).
- **Lot alertes A1 — visibles au téléphone, libellés lisibles, jamais évaluées à la mauvaise
  profondeur.** Fichiers : `packages/alerts/src/libelles.ts`, `comparer.ts`, `engine.ts`,
  `index.ts` ; `packages/indicators/src/index.ts` (exports de `statutAxis` et `REGIME_TESTE`) ;
  `apps/web/src/alerts/runtime.ts`, `components/AlertsPanel.tsx`, `alertsPanel.util.ts`,
  `DecisionDossiers.tsx`, `Toasts.tsx`, `store/toasts.ts`, leurs tests,
  `e2e/mobile-axis-alertes.e2e.ts`, `e2e/helpers/axis-alertes-telephone.ts`. Ni `chart/`, ni
  `strategy/`, ni le daemon, ni `store/alerts.ts` ne sont modifiés.
  - **Libellés** (`decrireAlerte`, pure, appelée par le moteur). Le message de la def, sinon
    son libellé. AXIS et AXIS S/R : nom, mention de mesure, évènement — « AXIS test 4h ≈ EMA 200
    seule · signal d'achat », « AXIS 1h : test échoué · signal de vente », « AXIS 1w : non
    mesuré · signal d'achat », « AXIS S/R non mesuré · réaction sur support fort », « AXIS non
    mesuré · Score (−6 à +6) >= 4 ». Seule la sortie `etat` porte le statut des campagnes, par
    `statutAxis`, le même que sur le graphe (« réglage non validé », « filtre flux, non
    mesuré ») ; toute autre sortie est « non mesuré ». Une def sans unité, évaluée sur l'unité
    affichée quelle qu'elle soit, écrit « AXIS non mesuré hors 4h · signal d'achat ». Hors AXIS :
    exactement `decrireCondition` (« rsi(rsi) > 70 »). Le daemon lit le même moteur : ses relais
    écrivent le même texte sous leur titre (« 🔔 AXIOM — BTCUSDT » pour Telegram).
  - **Déclenchement visible.** Chaque déclenchement pousse un avis « SYMBOLE UNITÉ — libellé »
    (sans unité pour une alerte de prix), avec « Voir », qui reste jusqu'au toucher. « Voir »,
    l'appui sur une ligne de la liste et sur une ligne du journal ramènent la vue PRINCIPALE
    sur le marché et l'unité de l'alerte ; « Voir » y marque la bougie du SIGNAL (voir
    « Rattrapage »), le journal la bougie ÉVALUÉE (pas l'instant de l'évaluation). Une alerte
    baleines, portée par un actif et non par un
    marché, n'a ni « Voir » ni navigation. Notification du navigateur titrée « AXIOM — SYMBOLE UNITÉ », onglet
    visible et permission accordée seulement, comme avant.
  - **Pile d'avis** (`empilerToast`, pure). Trois avis ; un avis ordinaire ne chasse jamais un
    avis d'alerte, et garde une place (quatre au pire) ; au-delà de trois avis d'alerte, les
    plus anciens deviennent UN avis « + N alertes plus anciennes — voir le journal », qui reste
    lui aussi. Au téléphone la pile est posée 8 px au-dessus de la plus haute barre du bas
    (barre « Fenêtres ouvertes », sinon navigation basse), mesurée sur la barre elle-même ;
    largeur min(20 rem, largeur de la fenêtre − 2 rem), texte renvoyé à la ligne (avant :
    320 px fixes, 16 px hors d'un écran de 320 px).
  - **Rattrapage.** Quand la bougie du signal a clôturé depuis STRICTEMENT plus d'une durée de
    bougie, le message (journal, avis, notification) reçoit « · bougie close le JJ/MM à HH:MM »,
    en heure locale. Unités à pas fixe, secondes et 3m compris, mois calendaires en UTC ; aucune
    mention pour une unité inconnue. La bougie du signal est la bougie évaluée ; pour un seuil
    d'indicateur (signal d'achat ou de vente, RSI au-dessus d'un niveau), c'est la bougie où la
    condition est devenue vraie quand elle est plus ancienne (`ouvertureSignal`, pure : même
    calcul que le moteur, réglages de la condition et référence du garde-fou compris). Début du
    signal inconnu — condition vraie depuis le début de la série lue, sortie incalculable — :
    la bougie évaluée. En direct rien ne change.
  - **Règles d'évaluation** (`alerts/runtime.ts`, R1 à R6). Chaque def de bougie est évaluée
    UNE fois par bougie close, suivie par def ; jamais sous l'amorce de son indicateur, comptée
    comme le graphe la compte (tampon entier, bougie en formation comprise) ; une def créée,
    réactivée ou prolongée en cours de bougie est évaluée aussitôt sur la dernière close (neuve,
    elle s'y calibre sans tirer : la clôture suivante peut la déclencher, alors que cette
    première clôture était perdue) ; la def est marquée évaluée AVANT l'appel au moteur ; un
    prix sans route ticker garde sa cadence ; un composite reste figé sous l'amorce de ses
    indicateurs. La course de la référence du garde-fou de régime relit les defs par id à son
    retour : elle annulait une pause ou une prolongation posée pendant l'attente. Depuis la
    revue globale : un composite jamais calibré, sur le marché affiché et fait de conditions
    de bougie seules, est calibré à chaque changement de définitions (la règle « évaluée
    aussitôt » ne valait que pour les defs simples). Un composite qui porte une autre condition
    (prix, funding…) garde son calibrage au premier évènement de cette condition : calibré sur
    la dernière clôture, un niveau placé entre elle et le prix en direct sonnait à tort au
    premier tick (régression de la première correction, relevée par la contre-revue). Un
    composite lisant AXIS reçoit la référence du garde-fou de régime, alignée sur
    les bougies de son contexte, et attend son arrivée quand elle est en vol (en échec : évalué
    sans elle, comme une def simple).
  - **Formulaire.** AXIS S/R et AXIS en tête du sélecteur ; sorties nommées, comparateur et
    valeur posés d'office (« Signal d'achat », « Signal de vente », « Non mesuré · réaction sur
    support fort », « Non mesuré · réaction sur résistance forte ») ; les autres sorties d'AXIS
    préfixées « Non mesuré · » ; sorties de prix des stratégies (`prixEntree`, `prixSignal`,
    `stop`) retirées — constat IND-2 : un seuil dessus ne suit pas les signaux. Sous le
    formulaire, une note dit la portée (« Évaluée à chaque clôture 4h, application ouverte sur
    BTCUSDT 4h. »), le libellé exact, la réserve d'une sortie non mesurée, l'historique demandé,
    l'origine des réglages (« Réglages par défaut de l'indicateur, pas ceux de l'instance du
    graphe. ») et « Rien ne sonne application fermée ou téléphone verrouillé. ».
  - **Liste.** Le libellé et l'unité reviennent à la ligne, jamais coupés. Une def de bougie que
    rien n'évalue l'écrit à la place de « armée » : « hors graphe » (le graphe principal
    n'affiche pas son actif ou son unité), « historique insuffisant : N sur A », suivi de
    « , affichez l'indicateur » seulement quand l'afficher peut y remédier. Une alerte
    désarmée qui n'a jamais sonné — posée alors que sa condition était déjà vraie — écrit
    « condition déjà vraie : sonnera quand elle le redeviendra », sur sa propre ligne, au lieu
    de « déclenchée » (`etatArmement`, revue globale). Le dossier de décision
    (`DecisionDossiers.tsx`) écrit le libellé à la place de la formule brute.
  - **Corrections d'intégration** (mineurs de la revue).
    - Un composite fait de conditions de bougie seules et lisant AXIS n'était plus évalué à
      l'ouverture de l'application ni au retour sur le marché : figé à 500 bougies, il
      attendait la clôture suivante. Il est évalué une fois quand l'historique atteint son
      amorce sous la même clôture, sans le frein d'une seconde, et lui seul.
    - R6 : quand le graphe quitte un marché ou une unité, ses bougies sortent du contexte des
      composites. Un composite évalué au tick n'y lit plus des bougies périmées : il reste
      figé, et l'état « hors graphe » de la liste est vrai (avant : la liste l'écrivait, le
      runtime évaluait quand même).
    - Alerte « muette » sous l'amorce : plus de « affichez l'indicateur », qui ne la ferait pas
      sonner.
- **Les deux lots ensemble**, mesurés à l'intégration sur le vrai graphe (Chromium, réseau
  bouchonné, bougies 0 à 2 937 du cas de référence, AXIS et AXIS S/R affichés).
  - Harnais commun : `mobile-axis-alertes` part de `figerDate` (`axis-sr-telephone.ts`), sans
    perdre un test. Chaque test vérifie que `requestAnimationFrame` est natif et la date figée.
  - Un toucher sur une bande forte pendant qu'un avis d'alerte est à l'écran. Un avis :
    l'encart est au-dessus, rien à corriger (390 × 844 en thème par défaut, 320 × 568 en
    Matrix). Deux avis : l'encart d'une bande basse passait sous la pile, de 7,5 px à
    390 × 844 et de 70 px à 320 × 568 en Matrix (quatre de ses sept lignes). Correctif :
    l'encart s'arrête 4 px au-dessus de la pile (`data-pile-avis`, posé par `Toasts.tsx`). À
    390 × 844 il tient au-dessus de deux avis ; à 320 × 568 voir les limites.
  - L'avis reste fermable au toucher, la navigation basse touchable, dans les deux cas.
  - Même évènement, même mention : test `alerts/libellesEtEncart.test.ts`, bougie par bougie
    sur le cas de référence — une réaction est « non mesuré » dans le libellé comme sous le
    doigt, avec le même nom ; un signal confirmé porte le même statut des deux côtés ; hors 4h
    ou sans unité, le libellé ne dit jamais mieux que le graphe.
- **Revue globale du 12 novembre 2026 et ses corrections.** Deux regards indépendants sur
  `912ab1a`, téléphone et alertes, sur le vrai graphe et le vrai moteur ; un constat majeur,
  rejoué par un troisième agent avant correction, dix mineurs, aucun bloquant. Corrigés par un
  agent distinct des réviseurs (`8a24854`, `905af9d`, puis le commit de cette consignation).
  Contre-revue de ces corrections par un quatrième agent : verdict « ok », aucun constat
  bloquant ni majeur, deux mineurs corrigés dans la foulée — un composite portant un prix
  sonnait à tort au premier tick (voir « Règles d'évaluation » ; test du runtime qui échoue
  sans la correction), et deux hachages de commit périmés dans cette section.
  - **Majeur — l'encart survivait au réticule.** KLineChart 9.8.12 efface son réticule chaque
    fois que ses données sont remplacées (`clearData`, `applyNewData` : `ChartStore.clear`),
    sans émettre `OnCrosshairChange`. Après « Voir » d'un avis ou une recherche d'actif vers un
    marché de même unité, l'encart restait à l'écran, doigt levé, avec le texte et les prix du
    marché quitté : deux marchés 4h ouvrent leurs bougies aux mêmes instants, aux mêmes pixels,
    et le garde-fou de l'intégration ne compare que des horodatages. Le petit encart des prix
    seuls restait déjà dans ce cas sur `c8b9897` ; le lot en faisait une boîte opaque de
    382 × 116 px qui décrit une zone, et son propre « Voir » y menait. Correctif : dans l'effet
    DONNÉES de `ChartInstance.tsx`, chaque `clearData` et chaque `applyNewData` passe par une de
    deux aides (`viderGraphe`, `remplacerBougies`) qui masquent l'encart. Trouvé en corrigeant :
    la resynchronisation qui suit une coupure du flux réapplique les bougies, et laissait de
    même l'encart sans réticule.
  - **Graphe qui glisse sous le réticule.** Le garde-fou de l'intégration lisait l'horodatage
    sous le pixel du réticule ; au-delà de la dernière bougie il n'y en a pas, et l'encart
    restait sur une autre bougie que celle où le moteur ramène le réticule. Il compare la
    bougie d'indice borné aux données (`bougieSousReticule`, pure).
  - **Mineur — texte d'une annotation disparue.** Le texte de l'encart n'était lu qu'au
    changement de réticule : AXIS S/R fermé, l'encart gardait le texte d'une zone que le graphe
    ne dessinait plus. `ChartIndicators.apresCalcul` prévient après chaque montage, retrait ou
    recalcul ; l'encart relit son texte, ne garde que les prix quand plus rien n'est visé, et
    se masque si les bougies ont glissé sous l'indice de son réticule.
  - **Mineurs « alertes »** : signal daté au retour (voir « Rattrapage »), composite lisant
    AXIS évalué avec la référence du garde-fou, composite calibré dès sa création (voir « Règles
    d'évaluation »), « condition déjà vraie » dans la liste (voir « Liste »).
  - **Mineurs consignés, non corrigés** : l'encart sous la pile d'avis et l'encart en paysage,
    remesurés et écrits aux limites ; les borner demande de redessiner l'encart en paysage
    (voir « Reporté »).
  - **Documentation corrigée** : la règle du texte visé dans `docs/axis-2026-10-07.md` (« le
    premier segment ou marqueur à 3 bougies ou moins, dans l'ordre des indicateurs », et non
    « le plus proche ») ; ce que la liste écrit sans « affichez l'indicateur » (trois cas, dont
    un chargement en cours) ; ici, les deux chiffres des rangées que la mesure ne retrouvait
    pas ; la phrase « tant que le réticule y est », devenue vraie.
  - **Preuves.** Parcours `mobile-axis-alertes` : « Voir » d'un avis vers ETHUSDT 4h servi aux
    horodatages de BTCUSDT (encart masqué pendant le chargement, puis après) ; coupure du flux
    par la place puis resynchronisation ; « Signal de vente » posé à plat ; retour deux clôtures
    après l'achat, avis lu à 320 puis 390 px, « Voir » sur la bougie d'achat. Parcours
    `mobile-axis-sr` : AXIS S/R fermé encart affiché ; rotation avec le réticule sur
    l'avant-dernière bougie. Tests du runtime sur le cas de référence, vrai moteur
    (`alerts/runtime.test.ts`, 16 tests, dont celui de la contre-revue) : signal daté,
    référence sous sa tendance, en vol et en échec, composite créé en cours de bougie. Contre-épreuves : sept corrections retirées
    une à une, chacune fait échouer son étape de parcours ou ses tests.
- **Limites des sections précédentes levées** (annotées sur place).
  - 11 novembre : la ligne de l'infobulle n'est plus coupée net au milieu d'un nombre, et son
    texte complet se lit au téléphone, dans l'encart.
  - 11 novembre : au bureau, la première rangée n'est plus entamée par le bandeau.
  - 11 novembre : au téléphone, un avis ne recouvre plus la barre de navigation basse ; un avis
    d'alerte n'est plus éphémère.
  - 9 novembre : le formulaire ne liste plus les sorties d'AXIS par leur clé ; la notification
    n'écrit plus « stratAxisSr(reactionSupport) >= 1 ».
  - Reports du 11 novembre soldés : le retour à la ligne (par l'encart), l'ordonnée au bureau,
    les libellés des sorties dans le formulaire.
- **Limites qui restent**, dites sans détour.
  - **Rien ne sonne Safari fermé ou téléphone verrouillé.** Une alerte n'est évaluée que par
    l'application ouverte, au premier plan. Au retour, seule la dernière clôture est évaluée.
    Un seuil d'indicateur encore vrai y sonne en datant son signal (revue globale) ; un achat
    suivi d'une vente pendant l'absence ne laisse ni avis ni journal (épinglé par un test,
    « LIMITE »). Quand l'état dure depuis le début de l'historique chargé, le début du signal
    n'est pas connu : pas de date, « Voir » marque la dernière bougie close. Pour les autres
    types d'alerte, si le tampon s'est rafraîchi entre-temps la mention de rattrapage ne paraît
    pas (relevé par la revue du lot).
  - Lu dans le code, non mesuré : dater un signal recalcule l'indicateur une fois par
    déclenchement ; un composite lisant AXIS redemande la référence du garde-fou à chaque
    évaluation (une par seconde au plus), dont le cache dure 60 s — le même que celui du graphe
    quand AXIS y est affiché — et attend son retour chaque fois qu'il expire.
  - Un composite ne date pas son signal, et son « Voir » marque l'instant de l'avis, pas une
    bougie (inchangé). La ligne du journal porte le texte de l'avis mais son appui marque la
    bougie ÉVALUÉE, pas celle du signal quand elles diffèrent : le journal garde le contexte de
    l'évaluation, que les dossiers de décision relisent.
  - **L'application déployée ne voit jamais le daemon** (`detectDaemon` rend faux sur Vercel) :
    une alerte posée sur l'iPhone n'atteint ni Telegram ni macOS. Seule une alerte posée sur le
    Mac, daemon lancé, y arrive ; il n'évalue que le 1m ou les defs sans unité sur Binance, sur
    1 500 bougies — une alerte AXIS S/R 1m y est donc évaluée sous son amorce de 3 000
    (inchangé, à corriger côté daemon).
  - **Une alerte d'indicateur n'est évaluée que si le graphe principal affiche son actif et son
    unité**, avec les réglages PAR DÉFAUT de l'indicateur, pas ceux de l'instance du graphe.
  - **Une alerte AXIS S/R sans l'indicateur affiché reste en « historique insuffisant »** : le
    graphe ne charge 3 000 bougies que pour lui (1 500 pour AXIS). Sur un marché plus court que
    l'amorce — unité 1w, actif récent — elle n'est jamais évaluée, et la liste l'écrit sans
    remède. Chargement de l'historique pour l'alerte : lot A2.
  - Une alerte de réaction sonne aussi sur une bougie de signal confirmé, où le graphe ne
    dessine pas de triangle creux (bougie 2 850 du cas de référence).
  - `statutAxis` ne lit pas les réglages du cœur : le libellé non plus (inchangé).
  - Rangées du canvas toujours SANS FOND : bougies, pointillés des zones et étiquettes passent
    dessous ou dessus (vu sur les captures d'intégration : le repère du plus haut sur la
    deuxième rangée au téléphone ; « R forte · 8 » sur la fin de la quatrième au bureau). « … »
    est rogné quand le dernier mot finit près du bord : de 2 % des rangées (360 px en chasse
    fixe) à 41 % (320 px en chasse fixe) ; en thème par défaut 31 % à 390 px, 15 % à 375 px,
    26 % à 360 px, 22 % à 320 px. Une unité peut être séparée de son nombre (« bord à
    -1.3… ») : 5 rangées sur 233 à 320 px en thème par défaut, aucune à 360, 375 et 390 px dans
    ce thème, 15 sur 233 à 390 px en Matrix et en Bloomberg, 14 sur 233 en paysage 844 × 390
    dans ces deux thèmes. Mesure refaite après la revue globale : 233 rangées distinctes par
    configuration (AXIS S/R et ses retournements, chaque bougie, marqueur et bande du cas de
    référence), 25 configurations (cinq écrans dont le paysage, cinq thèmes). Les chiffres
    écrits ici avant elle (« 10 à 40 % », « 79 rangées sur 1 001 ») ne se rejouaient pas. Deux
    indicateurs écrivent quatre rangées, parfois deux identiques (AXIS et AXIS S/R sur le même
    signal ; deux triangles creux voisins).
  - Encart : un seul texte, celui visé. À 320 × 568 il recouvre le point touché et les rangées
    du canvas. « Détails » ouvert sur ce même écran, il recouvre 32 px du bas du panneau (mesure
    de la revue, épinglée par un parcours). Un signal confirmé aux réglages hors test sur une
    série courte fait 11 lignes à 320 × 568 en Matrix et recouvre 12 px du bouton
    « Indicateurs (n) » (mesure de la revue). Doigt reposé exactement au même pixel : le
    réticule ne change pas, l'encart reste masqué jusqu'au toucher suivant. Il ne se replace
    pas quand un avis paraît après lui. Pas d'encart de texte au bureau.
  - **Encart en paysage** (remesuré après la revue globale, texte d'une zone du cas de
    référence). Le pane des prix y est court, et la borne du haut prime : l'encart déborde vers
    le bas. Avec un pane d'indicateur (RSI) : à 844 × 390 (pane de 118 px) il dépasse de 19 px
    dans ce pane en thème par défaut, de 35 px en Matrix et en Bloomberg ; à 740 × 360 (88 px)
    de 49 à 65 px, et recouvre 12 px du bouton « Indicateurs (n) » ; à 667 × 375 (103 px) de
    50 px en thème par défaut, jusqu'à 65 px et 12 px du bouton en Matrix ; à 568 × 320 (65 px)
    de 88 à 103 px, bouton entier (40 px). « Détails » ouvert, sans pane d'indicateur : 37 px
    du panneau à 844 × 390 (et 3 px du bouton en Matrix), 47 px du panneau et 23 px du bouton
    à 740 × 360 en Bloomberg, 42 px et 13 px à 667 × 375. Sans pane d'indicateur, « Détails »
    fermé et un avis au plus, il tient à 844 × 390 (thème par défaut et Matrix).
  - **Encart et avis** (remesuré après la revue globale ; avis « BTCUSDT 4h — AXIS S/R non
    mesuré · réaction sur support fort » puis « … sur résistance forte », bouton « Voir »). À
    390 × 844, 375 × 667 et 360 × 740, thème par défaut et chasse fixe, l'encart tient
    au-dessus d'un, deux et trois avis. À 320 × 568 la zone libre est plus courte que l'encart
    dès deux avis : 12 px passent sous la pile en thème par défaut (encart de 132 px), 27 px en
    Matrix (147 px), 59 px quand le libellé fait trois lignes (avis de 90 px, libellé de
    résistance en Matrix ; l'intégration avait relevé 42 px avec d'autres avis) ; avec trois
    avis, 94 px en thème par défaut, 109 px en Matrix, l'encart entier avec le libellé de
    résistance. En paysage 844 × 390 la pile occupe les 320 px de droite : avec deux avis,
    58 px de la hauteur de l'encart (85 px) y passent dessous en thème par défaut, 74 px sur
    101 en Matrix ; avec trois avis, toute sa hauteur — le texte y est caché, coupé au milieu
    d'un nombre (« +2.2 » pour +2.21 %, vu sur la capture). Fermer un avis le découvre.
  - Avis d'alerte, tant qu'il n'est pas touché : au téléphone il recouvre le bouton
    « Indicateurs (n) » du graphe et l'axe du temps (vu sur les captures d'intégration), et le
    bas du tiroir Panneaux, où il intercepte les touchers ; au bureau, en bas à droite, deux
    titres de section du panneau latéral (mesures de la revue). La synthèse ne dit pas quelles
    alertes elle remplace et n'ouvre pas le journal. La pile est bornée en nombre d'avis, pas
    en pixels.
  - Relevé par le lot, antérieur, non corrigé : le formulaire met le symbole en capitales, ce
    qu'une série synthétique (ratio) ne supporte pas — une alerte créée sur un ratio ne
    correspondrait pas au graphe (lu dans le code, non vérifié sur le vrai graphe) ;
    `NouveauxTokensPanel.tsx` écrit le symbole du jeton dans `def.message`, contre la
    convention : l'avis le dira deux fois.
  - **WebKit n'a rien exécuté de ce chantier ici** : il n'est pas installé dans le conteneur
    d'intégration et ne tourne qu'en CI. Attendent leur premier passage : `figerDate` (une
    fonction qui lit `new.target`), la mesure des espaces insécables de fin de rangée,
    l'apparition de l'encart après un appui, la lecture de l'alpha de son fond, le masquage au
    `touchstart`, la position de la pile d'avis ; et, depuis la revue globale, la fermeture d'un
    flux par le test (`WebSocketRoute.close`) suivie de la reconnexion, la route d'un second
    marché tenue par une promesse, la mention de rattrapage écrite en heure locale par le
    moteur de rendu. Ces passages ont eu lieu en CI le 12 novembre (voir « Première exécution
    de la CI », plus bas) : trois échecs, corrigés. **Rien n'a été prouvé sur un vrai iPhone**
    (police, zone de sécurité, barre d'outils de Safari, bip, retour d'arrière-plan) **ni sur
    les API réelles** : flux bouchonnés, cas de référence déjà vu. Sous l'émulation Chromium le
    canvas est dessiné à l'échelle 1 : son texte paraît plus flou que sur un appareil réel.
  - **Canvas figé** (limite du 11 novembre) : non corrigé. La conception de la phase 2 l'a
    requalifié : gel à chaque chargement sous l'horloge de test (`page.clock`, qui remplace
    aussi `requestAnimationFrame` : 13 chargements sur 13), aucun sans elle (0 sur 17), sur
    Chromium seulement. La revue du lot va dans le même sens (9 chargements téléphone sur 9
    sans gel sous le `requestAnimationFrame` du navigateur). Les parcours AXIS ne passent plus
    par `page.clock`. À confirmer sur WebKit et sur un vrai téléphone avant de retirer la
    limite : le gel systématique viendrait du harnais, pas du produit.
- **Budget.** Chargement initial, octets bruts / gzip, par `scripts/verifier-budget-build.mjs`
  (Node 22.23.4), plafonds 1 220 000 / 360 000 inchangés ; quatre builds dans le même dépôt.
  - Avant, sur `c8b9897` : **1 171 072 / 351 140**, marge gzip 8 860. (La section précédente
    donne 351 030 à l'intégration de la phase 1, avant ses corrections. Le brief de ce chantier
    donnait 351 148 pour `main` : 8 octets d'écart avec cette mesure, non expliqués.)
  - Après le lot infobulle : 1 173 046 / 352 029, soit +1 974 / +889.
  - Après le lot alertes A1 : 1 175 988 / 353 077, soit +2 942 / +1 048 de plus.
  - Après les corrections d'intégration : **1 176 672 / 353 276**, soit +684 / +199 de plus.
  - Après les corrections de la revue globale : **1 177 240 / 353 534**, soit +568 / +258 de
    plus (mesuré sur `912ab1a` juste avant : 1 176 672 / 353 276, la ligne précédente).
  - Après la correction de la pile d'avis trouvée par la CI (`Toasts.tsx`), sur la tête de la
    branche : 1 177 441 / 353 577, soit +201 / +43 de plus.
  - Après la correction de la contre-revue (`alerts/runtime.ts`, chargé à la demande : seul le
    nom de son fichier change dans le chargement initial) : **1 177 441 / 353 593**, soit
    +0 / +16 de plus.
  - Chantier entier : **+6 369 / +2 453** ; marge gzip **6 407**, au-dessus des 3 000 exigés.
  - Fichiers à la demande : 141, 1 734 113 / 638 860 (+9 152 / +3 581 sur le chantier, dont
    +1 299 / +414 pour la revue globale) : le runtime des alertes et leur panneau, chargés
    après le premier rendu.
- **Revue et tests.**
  - Chaque lot a été revu par un agent indépendant du développeur, sur le vrai graphe, avec un
    tour de corrections : un constat majeur par lot (texte visé avec deux indicateurs ; avis
    d'alerte chassé de l'écran), corrigés et contre-éprouvés. Aucun constat bloquant ni majeur
    ne restait à l'intégration ; les neuf mineurs restants ont été corrigés à l'intégration ou
    consignés ci-dessus.
  - Tests ajoutés par les lots : rangées et texte visé (`indicators.tooltip.test.ts`),
    `texteEncart` et sa doctrine (`candleReadout.test.ts`), libellés (`libelles.test.ts`),
    pile d'avis (`toasts.test.ts`), règles d'évaluation, avis, « Voir » et rattrapage
    (`runtime.test.ts`), formulaire et états de la liste (`alertsPanel.util.test.ts`,
    `alertsPanel.amorce.test.ts`). À l'intégration : composite à l'arrivée de l'amorce,
    composite hors graphe, levée de la marque d'une def en pause, alerte muette, libellé et
    encart d'un même évènement.
  - Parcours téléphone, gate `scripts/ci.sh --mobile` (ils y entrent par leur nom,
    `mobile*.e2e.ts`) : `mobile-axis-sr` passe de 3 à 5 parcours, `mobile-axis-alertes` en
    ajoute 7.
  - Contre-épreuves de l'intégration : onze corrections retirées une à une, chacune fait
    échouer au moins un test ou une étape de parcours.
  - Vérification de l'intégration (12 novembre 2026, Node 22.23.4, sur `754f525`, dernier
    commit de code) :
    - typage des 7 projets ; indicateurs 232 fichiers / 1 144 tests, alertes 147, backtest 131,
      pacte 120, daemon 786, web 473 fichiers / 7 072 tests (sans
      `chart/orderflow.cadence.test.ts`, voir la section précédente) ;
    - build du web et budget verts (chiffres ci-dessus) ;
    - parcours hermétiques du bureau des zones touchées, 33 sur 33 en 120 s :
      `quatre-lots-indicateurs`, `quatre-lots-alertes`, `gate-g4-alertes`, `multivue`,
      `niveaux-chart`, `revue-outils-avances`, `analyse-expy`, `quatre-lots-decisions` ;
    - parcours téléphone sur Chromium, 38 sur 38 en 136 s (29 à la phase 1) ; les deux
      fichiers AXIS en font 76 s (`mobile-axis-sr` 40 s, `mobile-axis-alertes` 36 s). L'étape
      mobile de la CI joue les deux moteurs à la suite et est plafonnée à 9 minutes : sa durée
      réelle, WebKit compris, reste à lire sur la première exécution, avant d'ajouter d'autres
      parcours ;
    - non lancés ici : `pnpm check:e2e` complet, WebKit, Vercel et daemon réels.
  - Vérification après les corrections de la revue globale (12 novembre 2026, Node 22.23.4,
    sur `905af9d`, alors dernier commit à changer le code exécuté ; celui de cette consignation
    n'y touche que deux commentaires) :
    - typage des 7 projets ; indicateurs 232 fichiers / 1 144 tests, alertes 147, backtest 131,
      pacte 120, daemon 786, web 473 fichiers / 7 093 tests (21 de plus, même exclusion) ;
    - build du web et budget verts (chiffres ci-dessus) ;
    - les mêmes parcours hermétiques du bureau, 33 sur 33 en 84 s ;
    - parcours téléphone sur Chromium, 39 sur 39 en 150 s (38 en 136 s à l'intégration) :
      `mobile-axis-sr` garde 5 parcours (45 s, 40 s avant), `mobile-axis-alertes` passe de 7 à
      8 (43 s, 36 s avant). L'étape mobile de la CI, plafonnée à 9 minutes pour les deux
      moteurs, reçoit donc environ 14 s de plus par moteur ; sa durée réelle reste à lire ;
    - mesures hors dépôt refaites sur le vrai graphe (Chromium, réseau bouchonné) : l'encart
      face à un, deux et trois avis dans 10 configurations, « Détails » ouvert dans 6, le
      paysage avec un pane d'indicateur dans 9, les rangées de l'infobulle dans 25 ;
    - non lancés ici : `pnpm check:e2e` complet, WebKit, Vercel et daemon réels.
  - Première exécution de la CI (12 novembre 2026), seul endroit où WebKit joue ces parcours :
    - sur `912ab1a`, le job `mobile` était rouge : trois parcours de `mobile-axis-alertes`
      échouaient sur WebKit, aucun sur Chromium ;
    - un défaut réel : la pile d'avis ne mesurait le haut des barres du bas qu'à son
      apparition, au redimensionnement de la fenêtre et quand une barre paraît ou disparaît.
      À 320 px, au retour d'un thème à chasse fixe vers le thème par défaut, la navigation
      basse change de hauteur sur WebKit sans que la fenêtre change : l'avis gardait sa place
      et en recouvrait 2 px (bas de l'avis à 458 px, haut de la navigation à 456).
      `Toasts.tsx` suit maintenant la taille de chaque barre, bordure et marges intérieures
      comprises ; une étape du parcours épaissit la navigation sans toucher à la fenêtre et
      échoue sans la correction, sur Chromium aussi ;
    - deux attentes trop strictes : WebKit rend 0,9999 à « entièrement dans l'écran » pour un
      avis dont la largeur n'est pas entière (il lui manque un soixante-quatrième de pixel,
      son unité de mise en page). L'attente accepte 0,999 ; les bords de la boîte restent
      mesurés au demi-pixel juste après ;
    - sur `08944a0` (ces corrections), les jobs `check` et `mobile` sont verts ; sur `905af9d`
      (corrections de la revue globale comprises), le job `mobile` l'est aussi : 77 parcours
      passés et 1 sauté sur les deux moteurs, en 5,3 minutes pour une étape plafonnée à 9 ;
    - ces échecs n'ont pas pu être rejoués dans le conteneur : WebKit ne s'y installe pas,
      son hôte de téléchargement est refusé par la politique réseau de l'environnement. La
      correction du défaut est prouvée ici sur Chromium, et sur WebKit par la CI seule.
- **Reporté.**
  - Alerte de prix au bord d'une zone forte, posée au toucher : le seul avertissement plus tôt
    que la clôture (lot suivant).
  - Alertes A2 : historique chargé pour l'alerte sans l'indicateur affiché, amorce courte,
    réglages de l'instance lus par l'alerte, pastille « ≠ graphe », sortie `preAchat` du
    pré-signal.
  - Amorce du backtest (BT-1).
  - Daemon : alertes sur plusieurs unités, fenêtre à la profondeur de l'amorce.
  - Notification du navigateur onglet masqué.
  - Un chemin vers l'iPhone verrouillé : il n'existe dans aucun lot et ne peut pas exister sous
    les contraintes actuelles (pas de daemon sur Vercel, pas de notification dans un onglet
    Safari, pas d'hôte nouveau). À décider par le propriétaire.
  - Fond sous les rangées du canvas ; borne de l'encart sur le bas réel de « Détails ».
  - Encart en paysage : prix sur une rangée, hauteur bornée, place à côté de la pile d'avis ;
    pile d'avis bornée en pixels. Les mesures de la revue globale montrent qu'aucune borne
    seule ne suffit (à côté de la pile, l'encart plus étroit gagne des lignes et recouvre le
    bouton « Indicateurs (n) ») : c'est un dessin à refaire, pas une retouche.
  - Journal : marquer la bougie du signal, comme « Voir » ; dater le signal d'un composite.
  - Correctif du moteur pour le canvas figé, si WebKit ou un vrai téléphone le montrent encore.
  - Test prospectif du signal précoce, du pré-signal et des retournements : aucun n'a été
    soumis à des données jamais vues.
