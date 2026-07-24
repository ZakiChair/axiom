# AXIOM — Roadmap « Bloomberg terminal perso » (analyse + pistes consolidées)

> **Doc de recherche · 2026-07-01.** Issu d'une analyse multi-agents du code (data layer, chart, indicateurs, UX, docs) croisée avec un référentiel des fonctions Bloomberg et un recensement de sources de données 2026. Complète `01-fournisseurs-api-indicateurs.md` et `02-indicateurs-edge-crypto.md` — ne re-propose pas ce que ces docs ont écarté.
> Cadre inchangé : **BUILD-CONTRACT.md** (mono-utilisateur, renderer-first, KLineChart figé, indicateurs TS pur, dérivés achetés). Une seule évolution de contrat est proposée (§Phase 2 : daemon localhost).

---

## Suite programme (2026-07-13) — Cible WTP 100 $/mois

> **Plan multi-agent exécutable :** [`docs/superpowers/plans/2026-07-13-cible-100-usd-mois.md`](../superpowers/plans/2026-07-13-cible-100-usd-mois.md)
>
> Beaucoup des phases 0–2 de ce doc sont **déjà livrées** (resync, watchdog, health, ⌘K, workspaces, daemon, alertes moteur, 21 fenêtres…). Le programme G100 se concentre sur : confiance résiduelle, productisation de l’edge (alertes/screener/playbooks), liens inter-modules, boucle trader, packaging, gate binaire G1–G10.

## Verdict d'ensemble

La base est **excellente** : architecture par interfaces (`IExchangeAdapter`/`IDerivedDataProvider`/`IMacroProvider`), 86 indicateurs testés (221 tests, hand-calc documentés), pattern contrôleur uniforme côté chart, discipline renderer-first respectée (zéro re-render React sur tick), persistance localStorage rigoureuse. AXIOM est déjà un très bon **outil de charting**.

Ce qui manque pour en faire un **terminal** :
1. **Confiance dans la donnée** — trous silencieux après reconnexion WS, pas de watchdog, erreurs de polling avalées.
2. **L'identité Bloomberg** — pas de command line, quasi aucun raccourci clavier, layout mono-chart figé, pas de workspaces.
3. **Le contexte** — pas de news, pas de calendrier éco, pas de sentiment, on-chain quasi absent.
4. **La durabilité** — l'app ne tourne qu'en `vite dev` (proxys CORS dev-only), rien ne survit à un vidage du cache navigateur, aucune alerte onglet fermé.

---

## Phase 0 — Fondations de confiance (à faire AVANT toute nouvelle feature)

| # | Piste | Effort | Détail |
|---|---|---|---|
| 0.1 | **Sortir les clés du source** | XS | `DEFAULT_FRED_KEY` (`data/macro/fred.ts:50`) et `DEFAULT_COINALYZE_KEY` (`store/coinalyze.ts:16`) sont committées en clair. Repo local sans remote aujourd'hui → risque contenu, mais **avant tout push distant : régénérer les 2 clés** (elles sont dans l'historique git, un simple déplacement vers `.env` ne suffit pas). Pattern cible : injection côté proxy comme `/tdapi`. |
| 0.2 | **Intégrité du flux live** | S | (a) Resync post-reconnexion : re-fetch REST des klines depuis la dernière bougie connue + re-seed CVD (`binance.ts:235-240`, `Chart.tsx:236-267`) ; (b) watchdog staleness ~60 s sans message → close forcé (écouter aussi les heartbeats Kraken) ; (c) fix du backoff remis à 0 dans `onopen` (boucle 1 s sur connect/drop immédiat, `binance.ts:221`) ; (d) `pollLoop` : surfacer les erreurs + garde anti-chevauchement (`pollLoop.ts:22-25`). **Un chart avec des trous silencieux et un CVD faussé disqualifie tout le reste.** |
| 0.3 | **Panneau « santé des sources »** | S/M | Statut par source : WS connecté/stale, quota restant (Coinalyze 40/min, Twelve Data 8/min & ~800/j, CoinGecko 10k/mois), dernière MAJ, dernière erreur. Feature transversale qui matérialise la « règle d'or de présentation » du doc 02 et absorbe 0.2d. Bonus : couper le polling tradfi marché fermé (nuit/week-end = crédits Twelve Data gaspillés). |
| 0.4 | Quick fixes data | S | `QUOTE_ASSETS` incomplet (JPY/CHF/CAD… → dériver base/quote des catalogues `pairs.ts`) ; watchlist routée 100 % Binance (router par exchange d'origine) ; repli silencieux bybt/okx→Binance à signaler. |

## Phase 1 — L'identité terminal (100 % front, zéro source nouvelle)

| # | Piste | Effort | Détail |
|---|---|---|---|
| 1.1 | **Command palette (⌘K) + mnémoniques** | S | LE multiplicateur : registre de commandes type Bloomberg (`NEWS`, `ECO`, `EQS`, `ALRT`, `MON`, `CORR`, `TERM`, `PORT`…), parsing « SOL 4H RSI », fuzzy search paires+indicateurs+actions, historique. À faire TÔT : chaque nouveau panneau s'enregistre ensuite dans ce registre. Les stores vanilla rendent tout appelable hors React. |
| 1.2 | Raccourcis clavier globaux | S | TF au clavier, `/` = recherche, O/V/R = toggles orderflow/VP/revenus, F = plein écran chart, flèches = watchlist. Un seul hook keydown au niveau App. |
| 1.3 | **Quick wins chart** (indépendants) | S chacun | Pagination historique (callback `loadMore` KLineChart + `endTime` déjà supporté par Binance) · préservation du viewport au changement de TF (réutiliser l'instance au lieu de dispose/init) · **instances multiples d'un même indicateur** (clé `defId+params` au lieu de `defId` — débloque EMA20+EMA50) · échelle log/percentage · bandeau symbole (prix, var, H/L 24h, volume) · compte à rebours de bougie · export image (`getConvertPictureUrl`) · footprint thémé via tokens (couleurs en dur `orderflow.ts:562-597`) · clé de dessins `exchange:symbol` (collision Binance/Coinbase actuelle). |
| 1.4 | **Monitor / quote board (MOST)** | S/M | Watchlist → grille dense : colonnes configurables et triables (var 1h/24h/7j, volume, funding/OI Coinalyze), sparklines canvas, Fear & Greed (api.alternative.me, gratuit sans clé). Un seul stream `miniTicker` Binance couvre tout. Meilleur ratio « feature visible ». |
| 1.5 | Workspaces nommés | S | Étendre `persist.ts` aux stores session-only (compare, toggles, overlays macro, sections repliées) sous des presets commutables (« scalp BTC », « macro », « DeFi »). |
| 1.6 | Dérivés non-modaux | S | La fenêtre Dérivés (slide-over bloquant) → panneau dockable ; impossible aujourd'hui de surveiller OI/funding en analysant le chart. |
| 1.7 | Alertes v1 (app ouverte) | M | Moteur d'évaluation de conditions (cross prix, seuil/croisement d'indicateur, funding extrême) **dans un package TS pur** (`packages/alerts`) pour être réutilisé tel quel par le daemon en Phase 2 — évite de coder le moteur deux fois. Notification API + son, création par clic droit au niveau visé, journal des déclenchements. |

## Phase 2 — Le daemon `axiomd` (déblocage structurel)

Amendement BUILD-CONTRACT proposé : « aucun backend **réseau/multi-tenant** ; un daemon **localhost mono-process** est autorisé, hors chemin chaud du renderer ». Le proxy Vite est déjà un backend de fait, dev-only et non buildable.

| # | Piste | Effort | Détail |
|---|---|---|---|
| 2.1 | **E1 — proxy + cache** | M | `apps/daemon` : UN process Bun/Node + UN fichier SQLite. Reprend les 4 proxys de `vite.config.ts` (clés servies depuis `.env` → règle 0.1 définitivement), cache TTL des APIs à quota. Vérif : `vite build` + daemon servent l'app en prod locale. **Prérequis avoué de ~8 features news/calendrier/scraping des phases suivantes.** |
| 2.2 | E2 — persistance durable | M | Endpoints `/kv` + `/candles` SQLite ; `persist.ts` écrit au daemon avec fallback localStorage (feature-detect `/health`). Accumuler aussi l'historique Coinalyze (purgé chaque jour côté fournisseur, ~1500-2000 pts) et les échantillons mcap CoinGecko. Arbitrage : **SQLite = source de vérité, IndexedDB seulement en fallback sans daemon** (ne pas construire les deux). |
| 2.3 | E3 — alertes onglet fermé | M | Boucle d'évaluation daemon réutilisant `packages/alerts` (1.7), notifications macOS (osascript), **option relais Telegram** = 90 % du besoin mobile pour 1 % de l'effort. |

Le front garde ses **WS directs** vers les exchanges (le daemon ne proxifie jamais le chemin chaud).

## Phase 3 — Les fonctions Bloomberg (ordre valeur/effort ; ⚑ = dépend du daemon)

| Fonction | Source | Effort | Notes |
|---|---|---|---|
| **ECO** calendrier éco | FRED `/releases/dates` (clé+proxy existants) + ForexFactory JSON (`nfs.faireconomy.media`, max 2 fetch/5min, cache semaine) + dates FOMC statiques | S ⚑ | Marqueurs verticaux sur le chart (infra overlays existante). Meilleur ratio de la liste. |
| **NEWS** | Flux RSS CoinDesk/Cointelegraph/The Block/Decrypt/Blockworks via proxy (pas de CORS sur les RSS) | S/M ⚑ | **CryptoPanic free tier supprimé au 01/04/2026** — RSS = plan A. Panneau horodaté + marqueurs news optionnels. |
| **CORR** corrélations | Aucune nouvelle (klines Binance + Twelve Data) | S | Pearson/Spearman sur log-returns, matrice N×N sur la watchlist + corrélation glissante BTC–Nasdaq/DXY en sous-pane. |
| **Dérivés enrichis** | Coinalyze endpoints non exploités (predicted funding, L/S agrégé multi-exchanges, liq longs/shorts séparées, OHLCV perp agrégé) + Binance `fapi /futures/data` gratuit (top trader L/S, taker buy/sell) | S | À faire AVANT d'envisager tout abonnement. Afficher OI/funding en sous-panes **sur le chart** (pattern `extendData` de macro.ts, données déjà payées). |
| **EQS** screener | Binance `/ticker/24hr` (1 req, tous symboles, CORS *) + CoinGecko demo + Coinalyze | M | Filtres indicateurs via `@axiom/indicators` en Web Worker. Screener **funding** = le seul screenable à ~1000 symboles en gratuit (doc 02). OI limité à ~150-250 symboles (bucket 1000 req/5min). |
| **Term structure** | Binance COIN-M dapi (trimestriels, CORS *) + Deribit public (sans clé, CORS OK) | M | Basis annualisé par échéance, snapshots J-1/J-7. Quasi introuvable en retail gratuit — vraie différenciation. |
| **OMON** options | Deribit (même client que term structure) | M | IV par strike, DVOL, skew 25Δ, max pain calculé client. |
| **On-chain** | Coin Metrics Community (sans clé, 10 req/6s : NVT, realized cap, adresses actives) · BGeometrics (MVRV-Z, SOPR, NUPL — 15 req/jour → cache 1/jour) · mempool.space + blockchain.info (`&cors=true`, appel direct) | S-M | Le « Glassnode gratuit ». Résolution daily = suffisant pour l'analyse de fond. |
| **ETF flows** | DefiLlama `/etfs` (plan A) ; Farside = scraping Cloudflare fragile (plan B seulement) | S ⚑ | Barres quotidiennes par émetteur + cumul, croisées avec le prix. |
| **IMAP** treemap | CoinGecko demo (top 250 + catégories) | S | Treemap squarified canvas maison (~150 lignes), couleur = variation, taille = mcap. |
| **PORT v1 + journal** | Saisie manuelle, valorisation par les WS existants | S/M | Positions, PnL latent, exposition. + **Notes ancrées** (symbole, timestamp, prix) sur le chart — l'équivalent solo du chat IB. v2 (lecture soldes Binance signée) : CORS des endpoints signés **non vérifié** → probablement via daemon. |
| DefiLlama étendu | volumes DEX, TVL chaînes, yields | S | Adaptateur existant. Liquidations on-chain par niveau de prix : endpoint API **non documenté** — à tester avant de compter dessus. |

## Phase 4 — Gros chantiers différenciants

| # | Piste | Effort | Notes |
|---|---|---|---|
| 4.1 | **Multi-chart grid 2×2** + multi-fenêtres | M/L | Casser 3 singletons : `activeChart` (drawing.ts:76), `marketStore` mono-symbole, contrôleurs lisant l'état global. Extraire un `ChartInstance` autonome ; throttle rAF 5-10 upd/s par chart ; orderflow réservé au chart focus. Multi-fenêtres : `BroadcastChannel` (~100 lignes) + mode `--app` de Chrome. Vérif : 6 charts 1m live 30 min sans chute de FPS. **Electron : non. Tauri : seulement si besoin prouvé après usage.** |
| 4.2 | DOM / depth chart + tape | M/L | Flux `@depth`/level2 déjà disponibles sur les WS connectés — coût 100 % rendu. Complément naturel du footprint, prérequis du paper trading. |
| 4.3 | Backtest simple (BT) | L | `packages/backtest` TS pur, règles composables sur les sorties de `@axiom/indicators` (PAS de langage Pine-like). Sorties : equity curve, win rate, max DD. **Dépend de** : pagination klines (1.3) + cache candles daemon (2.2). Mutualisé avec le futur paper trading. |
| 4.4 | Replay | L | Dumps officiels `data.binance.vision` téléchargés **à la demande** par le daemon (pas de recorder 24/7 — ce serait l'AggregationEngine interdit déguisé). Commencer JSONL/SQLite ; DuckDB/Parquet seulement si le besoin est prouvé. |

## Indicateurs — dettes et extensions (package `@axiom/indicators`)

> **Audit 2026-07-24 — les 6 dettes de cette section sont SOLDÉES.** Elles étaient listées
> comme ouvertes alors que le code et les tests étaient livrés depuis plusieurs lots. Les
> lignes ci-dessous sont conservées telles quelles avec leur preuve de livraison, plutôt que
> supprimées, pour que la trace reste lisible. **Ne pas les reprendre comme du travail à faire.**

| Dette d'origine | Statut | Preuve |
|---|---|---|
| Rafraîchissement **intra-bougie throttlé** (250 ms–1 s) | **Livré** | `chart/indicators.ts` — `RECOMPUTE_THROTTLE_MS = 500`, throttle leading+trailing ; 4 tests dans `indicators.throttle.test.ts` |
| Câbler l'input `source` (RSI sur hlc3…) | **Livré** | `engine.ts` — `buildCalcContext(candles, sourceKey)`, `open/high/low/hl2/hlc3` ; `engine-source.test.ts` = test de conformité **dynamique** (tout def déclarant `source` doit réellement consommer `ctx.source`) |
| Pivots **sessionnés** + VWAP à reset de session ; AVWAP ancrée par **timestamp** + ancrage par clic | **Livré** | `utils-session.ts` (`utcDayOf`, `sessionExtents`) consommé par les **5** variantes de pivot ; `volume/vwap.ts` reset au jour UTC ; `volume/anchored-vwap.ts` sur `anchorTime` (+ compat de l'ancien `anchorIndex` persisté) ; picker de clic `chart/drawing.ts:150` |
| Séries auxiliaires → catégorie `derivatives` « vide » ; NVT/MVRV | **Livré** | `derivatives/` compte **27 defs**, dont `nvt`, `mvrv`, `mvrvZScore`, `nupl`, `rhodlRatio`, `realizedPrice`, `balancedPrice` ; `ctx.aux` câblé (`utils-aux.ts`, `chart/auxProvider.ts`) |
| Golden tests ADX/SuperTrend/Ichimoku/PSAR ; validation min/max dans `resolveParams` | **Livré** (oracle reformulé, cf. ci-dessous) | `golden/` — 4 fixtures + `golden.test.ts` (comparaison point à point `toBeCloseTo(v, 6)`) ; clamp `[min, max]` + repli sur défaut si non-fini dans `resolveParams` |
| Tier 1 doc 02 : divergence **CVD spot vs perp**, z-score de funding, ATR/vol réalisée | **Livré** | `chart/cvdSpotPerp.ts` + `utils-divergence.ts` ; `derivatives/fundingZScore.ts` ; `volatility/` — `atr`, `atrPct`, `atrRegime`, `rv`, `historicalVol`, `parkinsonVol` |

### Les deux points restants — TRANCHÉS le 2026-07-24

1. **Oracle golden pandas-ta et non TradingView → CLASSÉ SANS SUITE.** La dette visait à
   réconcilier les conventions d'**amorce** divergentes de TradingView ; pandas-ta ne répond pas à
   cette question-là. Mais `BUILD-CONTRACT.md` désigne explicitement pandas-ta comme oracle
   autorisé et interdit toute dépendance Python au runtime — la formulation d'origine était hors
   contrat. Des goldens TradingView exigeraient un export CSV manuel. **Décision de Zaki : la
   divergence d'amorce ne gêne pas à l'usage.** Ne pas rouvrir sans besoin constaté.
2. **Composante vol réalisée dans le score de régime → LIVRÉE.** `data/regime.ts` compose
   désormais **7** composants : `btc24h · fearGreed · funding · dvol · volRealisee · etf ·
   stables`. La vol réalisée vient de `data/referentiels.ts::histVolRealisee` (bougies 1 j Binance
   + def `rv` de `@axiom/indicators`, 130 bougies pour ~100 points de référentiel), notée sur les
   **mêmes paliers que `dvol`** à dessein (deux mesures du même phénomène doivent rester
   commensurables — un test le verrouille).

   **Conséquence de pondération, assumée et testée** : la volatilité pèse maintenant 2 notes sur 7
   (~29 % du score contre ~17 % avant) et les deux composantes sont corrélées — en régime de
   stress elles chargent le score dans le même sens. C'est le comportement voulu (implicite ET
   réalisée élevées = environnement réellement hostile), mais **toute relecture historique de la
   pastille REGIME doit en tenir compte**. Un test fige le diviseur à 7 pour qu'un futur ajout de
   composant force à reconsidérer la pondération.

   *Note* : `lib/volCone.ts::realizedVolSeries` est une seconde implémentation de la vol réalisée,
   antérieure, avec une convention `null` vs `undefined` documentée comme requise par ce module.
   Non touchée ici (le nouveau chemin passe par le def canonique du package) — signalée, pas
   corrigée.

**Leçon de méthode** (généralisable) : cette section a été citée comme « travail restant » dans la
revue du 2026-07-24 avant vérification. Rien ne relie le code livré à ce catalogue — c'est le même
défaut que celui identifié en P5 de cette revue (une doctrine sans verrou dérive). Dans ce dépôt,
**les tests sont plus fiables que les docs** : vérifier une affirmation de doc contre le code avant
de la citer.

## Anti-recommandations (garde-fous, à reporter dans BUILD-CONTRACT)

1. Electron (150 Mo pour rien) · 2. Docker/Redis/TimescaleDB/Postgres (SQLite + fichiers suffisent à UN utilisateur) · 3. Proxifier les WS de marché via le daemon (latence + SPOF sur le chemin chaud) · 4. SharedWorker de mutualisation WS (complexité pour économiser des connexions non contraintes) · 5. Recorder tick 24/7 multi-exchange · 6. Toute abstraction de moteur de chart · 7. Reconstruction maison de la liquidation heatmap (modèle propriétaire — déjà écarté au doc 02 ; CoinGlass la gate au plan **699 $/mois** → renoncer ou étiqueter toute estimation comme telle) · 8. LunarCrush API (240 $/mois) et Santiment free (données J-30) · 9. Scripting Pine-like complet.

## Budget & déclencheurs d'achat (pré-arbitrés)

- **Cible : 0 $/mois** — tout ce qui précède est faisable en gratuit. Fixer un plafond (ex. 30 $/mois) comme critère d'arbitrage.
- CoinGlass Hobbyist 29 $ : seulement si ETF flows + exchange balances deviennent critiques ET que les sources gratuites échouent (la heatmap n'y est PAS incluse).
- Coinank 25-30 $ : seulement si CVD agrégé multi-exchange clés-en-main devient indispensable.
- CryptoPanic payant : seulement si le tagging par coin manque vraiment aux RSS.
- Tardis.dev : achats ponctuels pour golden files/replay, jamais en source live.

## Arbitrages à trancher (décisions de Zaki)

1. **Daemon oui/non** (Phase 2) — recommandation : oui, c'est le déblocage du plus grand nombre de features ; sinon les phases 3 ⚑ restent en mode `vite dev` éternel.
2. **Persistance** : SQLite-daemon comme source de vérité (reco) vs IndexedDB partout.
3. **Mobile** : relais Telegram depuis le daemon (reco, quasi gratuit) vs rien.
4. **Plafond budget API mensuel** (reco : 0 $ jusqu'à preuve du besoin, max 30 $).
5. Stratégie de test applicatif : ajouter au moins un smoke test Playwright (chart s'affiche, indicateur s'ajoute, dessin persiste) avant d'empiler daemon + multi-chart + alertes.
