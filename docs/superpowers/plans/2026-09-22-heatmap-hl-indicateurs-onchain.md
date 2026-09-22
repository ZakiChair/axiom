# Carte thermique des liquidations Hyperliquid (niveaux réels) et nouveaux indicateurs on-chain — plan

> **Pour les agents :** chantier orchestré le 2026-09-22 (orchestrateur + un implémenteur sur brief,
> revue du diff par l'orchestrateur avant chaque commit). Fait suite à la demande du propriétaire :
> « fais-moi une revue d'AXIOM, intègre correctement les liquidations sur le graphique venant
> d'Hyperliquid (carte thermique des liquidations) et trouve et ajoute de nouveaux indicateurs on-chain
> basés sur nos sources déjà disponibles ». Les trois lots ont été validés par le propriétaire le
> 2026-09-22 (heatmap avec collecteur daemon ; les 10 indicateurs proposés ; libération du budget par
> `AlertsPanel` paresseux + `backtestFunding` en `import()`).

## 1. Constats de la revue (mesurés le 2026-09-22, daemon + Vite locaux)

1. **Couches LIQEST / LIQHL muettes** après changement de symbole ou rechargement quand LIQMARK est
   OFF : `apps/web/src/chart/ChartInstance.tsx` n'instancie `LiquidationHeatController` que si
   `liqMarksStore.actif`, alors que les trois couches (RÉELLE, ESTIMÉE, HL) partagent ce contrôleur.
   Reproduit : EST « ON » persisté, PUMPUSDT → BTCUSDT 15m : plus aucune ligne ni légende.
2. **LIQHL non persisté** (`store/persist.ts` ne connaît que LIQMARK/LIQEST) et **quasi invisible** :
   pool = top-150 du leaderboard par `accountValue` → 18 positions BTC dont **2 dans ±40 %** du prix
   (gros comptes peu leviérisés : `liquidationPx` lointain ou `null`). Aucune dimension temporelle.
3. **Heatmap « exécutée » dépendante de l'uptime du daemon** : BTCUSDT compte 2 lignes sur 7 jours
   (8 873 au total, rafales 25–30/08 et 10–13/09). Collecteur « vivant » → le repli Coinalyze ne joue
   pas → heatmap « 7 j » quasi vide sans avertissement.
4. **Liquidations HL exécutées : 0 ligne** en base depuis le lot du 21/09 (couverture mesurée ≈ 52 % du
   flux makers, événements sporadiques, daemon peu allumé). Attendu par construction, mais invisible.
5. **Budget d'entrée au plancher** : 1 210 126 / 1 220 000 octets bruts, 356 979 / 360 000 gzip
   (marge 3 021). Attribution par sourcemap (99,2 % des octets attribués) : `AlertsPanel.tsx` 23 602
   octets bruts dans le chunk initial (les fenêtres sont en `React.lazy`, pas ce panneau),
   `data/backtestFunding.ts` 10 563 importé statiquement par `store/backtest.ts`,
   `brief.ts` + `catalogueMacro.ts` ≈ 20 700 tirés par `store/regime.ts`, `publicationArchive.ts`
   12 030 tiré par `data/eco.ts`. `packages/indicators` = 162 333 octets pour 212 fichiers
   (766 octets en moyenne par fichier).

Mesures Hyperliquid (API publique, 2026-09-22) : 100 adresses du top volume hebdomadaire **hors** du pool
actuel portent 35 positions BTC à `liquidationPx` exploitable (418 M$), 32 ETH (395 M$), 15 SOL
(17,9 M$) ; l'intersection top-150 `accountValue` ∩ top-150 volume jour n'est que de 19 adresses.
`metaAndAssetCtxs` : OI BTC 45 570 BTC ≈ 3,92 Md$ (un côté), ETH ≈ 3,14 Md$, SOL ≈ 0,72 Md$ ;
`fundingHistory` BTC rend un pas horaire complet (240 points sur 10 j, `fundingRate`, `premium`, `time`).

## 2. Lot 0 — libérer le budget d'entrée (préalable obligatoire)

- `apps/web/src/App.tsx` : `AlertsPanel` chargé par `lazy(() => import("./components/AlertsPanel"))`
  dans un `Suspense` dont le repli est l'en-tête de section « Alertes » (même patron que les fenêtres).
  Vérifier qu'aucun effet de bord au chargement du module n'est perdu (commandes, runtime d'alertes :
  `alerts/runtime.ts` est démarré ailleurs et reste statique).
- `apps/web/src/store/backtest.ts` : `import("../data/backtestFunding")` dans le bloc asynchrone du
  run (le `finFenetreFundingArchivee` synchrone passe dans ce bloc) ; import de type conservé.
- Mesure avant/après par `pnpm --filter @axiom/web build` (JSON du budget), consignée au rapport.

## 3. Lot 1 — heatmap Hyperliquid des niveaux de liquidation RÉELS

### 3.1 Daemon (`apps/daemon`)

- **Pool élargi** (`hyperliquid.ts`) : `extrairePool(donnees, nValeur = 150, nVolume = 350)` = top
  `nValeur` par `accountValue` ∪ top `nVolume` par `windowPerformances["week"].vlm` (tri numérique,
  dédoublonné, ≤ 500). `chargerPool` l'utilise. Cadence des `clearinghouseState` abaissée à
  `CONCURRENCE = 2`, `PAUSE_LOT_MS = 200` (≈ 600 poids/min en pointe, 200/min en moyenne, quota 1 200)
  ; un 429 amont interrompt le reste de l'instantané (les adresses restantes ne comptent pas dans
  `adressesScannees`). `obtenirInstantane(d, fetchImpl, now, { forcer })` exportée.
- **Collecteur** `hlLiqHeat.ts` (nouveau, à froid, opt-in) : table
  `hl_liq_instantanes(ts, coin, niveaux JSON [[px, side01, usd]…] trié px croissant, long_usd,
  short_usd, n_long, n_short, oi_usd NULL, adresses, PRIMARY KEY (coin, ts))` + index `(ts)`.
  Toutes les `PERIODE_INSTANTANE_MS = 5 min` quand le drapeau KV `hl/heat` vaut `{ actif: true }` :
  instantané forcé, `metaAndAssetCtxs` (une requête, `oi_usd = openInterest × markPx` par coin), une
  ligne par coin surveillé (symboles = même jeu que `liqFeed` : KV `liq/symboles` ∪ alertes
  `liq-cascade`, défaut BTC/ETH/SOL, mappés par `coinHl`). Rétention 14 j, purge quotidienne. Drapeau
  et symboles relus toutes les 60 s ; drapeau absent/illisible = inactif. Santé exposée dans
  `/health` → `collecteurs.hlHeat = { actif, dernierInstantaneTs, derniereErreur, coins, adresses }`.
  Le drapeau est écrit par le front à l'activation de LIQHL (jamais remis à `false` par la
  désactivation de la couche) ; la fenêtre LIQ porte le bouton « Collecte daemon » (arrêter/reprendre).
- **Route** `GET /hl/liqheat/:coin?depuis&jusqua&pas` : `depuis` défaut = maintenant − 14 j ;
  `pas` (ms, ≥ 5 min) ne garde que le DERNIER instantané de chaque seau `floor(ts / pas)` ; plafond
  2 000 instantanés. Réponse :
  `{ coin, pas, collecte: { actif, dernierInstantaneTs, periodeMs, retentionMs, premierTs },
  instantanes: [{ ts, niveaux: [[px, side01, usd]…], longUsd, shortUsd, nLong, nShort, oiUsd, adresses }] }`.
  `couverture = (longUsd + shortUsd) / (2 × oiUsd)` bornée à [0, 1], `null` sans OI.
- Tests `bun test` : `extrairePool`, `parserOiParCoin`, sérialisation des niveaux, sous-échantillonnage
  par `pas`, `parseRequeteHeat`, lecture du drapeau, cycle d'instantané sur base injectée (coins
  surveillés seulement, purge), arrêt sur 429, route sur base injectée.

### 3.2 Front (`apps/web`)

- `data/hyperliquidHeat.ts` (nouveau, chunk paresseux — importé seulement par `chart/liquidationHeat.ts`
  et la fenêtre LIQ) : `mapperReponseHeat` (pure, tolérante), `couvertureOi`, store `hlHeatStore`
  `{ etat: "ok" | "sans-daemon" | "inactif" | "vide" | "erreur", coin, pas, instantanes, collecte }`,
  `assurerHeat({ coin, pasMs, depuisMs })` idempotente (clé `coin:pas`, refetch si `depuis` recule
  d'au moins un pas, rafraîchissement incrémental toutes les 5 min depuis `dernierTs − pas`, fusion
  dédoublonnée par `ts`), `definirCollecte(actif)` → `kvPut("hl", "heat", { actif, majTs })`.
  `data/hyperliquidLiq.ts` : à l'activation de LIQHL avec capability `hl`, écrit le drapeau à `true`.
- `chart/liquidationHeat.ts` : `construireGrilleHl(instantanes, candles, from, to, facteurTaille)`
  (pure) → `LiqGrid` : pour chaque bougie visible, le DERNIER instantané dont `ts` ≤ fin de bougie et
  ≥ `time − 2 × pas` (report d'au plus deux pas ; au-delà, colonne vide = trou visible), somme des
  niveaux par bucket `tailleBucket(close) × facteurTaille` (long → `longUsd`, short → `shortUsd`,
  `count`). Rendu AVANT la heatmap exécutée avec la rampe `RAMPE_HL_AMBRE` (`rampesHeat.ts`, ambre
  sombre → jaune pâle, inversée sur fond clair), intensité `log1p` normalisée sur la grille, barres du
  dernier instantané au bord droit conservées, tooltip HL quand aucune cellule exécutée n'est sous le
  curseur (« HL niveaux réels · bucket · longs $ (n) · shorts $ (n) · instantané HH:MM »), légende
  `libelleLegendeHlHeat` : « HL HEATMAP (niveaux réels) — N instantanés · X adresses · couverture ≈
  Y % OI · pas 5 min [· T trous = daemon éteint] », ou la raison (« nécessite le daemon axiomd »,
  « collecte daemon arrêtée — reprendre dans LIQ », « aucun instantané encore »). Un trou = écart
  > 3 × pas entre deux instantanés dans la plage visible. Le contrôleur demande
  `assurerHeat({ coin: basePerp(symbole), pasMs: max(5 min, durée de bougie), depuisMs: temps de la
  première bougie visible − 2 pas })` à chaque rendu quand LIQHL est active.
- `chart/ChartInstance.tsx` : le contrôleur est créé dès qu'UNE des trois bascules (LIQMARK, LIQEST,
  LIQHL) est active au montage ou le devient (correction du constat 1).
- `store/persist.ts` : LIQHL persisté (`liqHl`) et hydraté comme `liqEstimates`.
- `chart/liquidationMarkers.ts` : repli Coinalyze **par jour UTC sans aucun événement daemon** dans la
  fenêtre de 7 j (`joursSansEvenements`, `filtrerSeedSurJours`, pures) quand le collecteur est vivant
  mais son historique lacunaire ; légende exécutée complétée « · Coinalyze ≈ sur N j ».
- Fenêtre LIQ : bloc « Heatmap HL : collecte daemon active depuis <date> · N instantanés (14 j) ·
  dernier il y a … · couverture ≈ X % OI » + `BoutonBascule` « Collecte daemon ».
- Tests vitest : grille HL (dernier instantané par bougie, report ≤ 2 pas, trou au-delà, buckets
  long/short, bornes de plage), `mapperReponseHeat`, `couvertureOi`, légende, comptage des trous,
  persistance LIQHL, repli Coinalyze par jours, libellés LIQ. Preuve réelle : `/hl/liqheat/BTC` non
  vide après deux instantanés, captures Playwright (heatmap visible sur BTC 15m ; LIQEST seule après
  changement de symbole ; LIQHL conservée au rechargement).

## 4. Lot 2 — dix indicateurs (catalogue 200 → 210)

Séries aux ajoutées à `AuxSeriesId` (`@axiom/types`, écart signalé comme aux lots précédents) :
`liqLongUsd`, `liqShortUsd`, `hashrate`, `sthMvrv`, `lthMvrv`, `nrplUsd`, `vddMultiple`, `aviv`,
`supplyProfit`, `supplyLoss`, `hlFunding`, `hlWhalesNet`.

| Id | Nom | Aux | Source et calcul | Limites affichées |
|---|---|---|---|---|
| `liqParBougie` | Liquidations par bougie | `liqLongUsd`, `liqShortUsd` | Coinalyze `liquidation-history` à l'intervalle du chart (flux, clé `id:symbole:tf`, apparié 1:1 comme `perpDelta`) ; histogrammes shorts (+, `--up`) / longs (−, `--down`) + ligne `net` | clé Coinalyze requise ; intervalle non couvert → UNUSABLE ; perp Binance |
| `hashRibbons` | Hash Ribbons | `hashrate` | mempool.space `/mining/hashrate/1y` (sans quota) ; SMA 30 / SMA 60 du hashrate ; sortie `regime` (−1 capitulation quand SMA30 < SMA60, +1 reprise pendant 10 barres après le croisement haussier, 0 sinon) | BTC seul ; 1 an d'historique ; ≥ 1d |
| `mvrvCohortes` | MVRV STH / LTH | `sthMvrv`, `lthMvrv` | BGeometrics `sth-mvrv`, `lth-mvrv` (recopie) | BTC seul ; embargo J-7 possible |
| `nrpl` | Profits / pertes réalisés nets | `nrplUsd` | BGeometrics `nrpl-usd` ; histogrammes `profit` (≥ 0) / `perte` (< 0) + SMA 7 | BTC seul |
| `vddMultiple` | VDD Multiple | `vddMultiple` | BGeometrics `vdd-multiple` (recopie) | BTC seul |
| `aviv` | AVIV | `aviv` | BGeometrics `aviv` (recopie) | BTC seul |
| `offreEnProfit` | Offre en profit (%) | `supplyProfit`, `supplyLoss` | BGeometrics `supply-profit` / `supply-loss` (défs existantes, cache partagé avec CHAIN) ; `100 × sp / (sp + sl)`, indéfini si somme ≤ 0 | BTC seul |
| `hlFunding` | Funding Hyperliquid | `hlFunding` | `fundingHistory` HL (horaire, pagination 500, 90 j, appel direct) ; APR % = taux × 24 × 365 × 100 | actif coté sur HL ; série alignée sur la clôture |
| `fundingSpreadHl` | Écart de funding HL − Binance | `hlFunding`, `funding` | (taux HL × 24 − taux Binance × 3) × 365 × 100, en points de % annualisés | idem + convention 8 h Binance |
| `hlWhalesNet` | Positionnement net gros comptes HL | `hlWhalesNet` | daemon `/hl/liqheat/:coin?pas=…` → `100 × (longUsd − shortUsd) / (longUsd + shortUsd)` par instantané | daemon + collecte HL requis ; échantillon (≤ 500 adresses) ; couverture affichée en légende HL |

Câblage : `auxProvider.ts` (TTL 60 s pour `liqLongUsd`/`liqShortUsd`/`hlFunding`/`hlWhalesNet`, 1 h
pour les séries journalières ; `hlFunding`, `hlWhalesNet` alignés sur la clôture ; `hashrate` via le
client mempool existant ; défs BG nouvelles `BG_STH_MVRV`, `BG_LTH_MVRV`, `BG_NRPL_USD`,
`BG_VDD_MULTIPLE`, `BG_AVIV` avec champ JSON VÉRIFIÉ par un appel réel chacun — 5 appels du quota
journalier consommés une fois), `lib/indicatorUsability.ts` (`ONCHAIN_BTC` ∪ nouveaux ids BTC ;
raisons « Nécessite une clé Coinalyze » pour `liqParBougie`, « Nécessite le daemon axiomd et la
collecte HL » pour `hlWhalesNet`), `registry.ts` (210), `IndicatorMenu` sous-groupes dérivés
(test d'exhaustivité), un fichier + un test par def.

## 5. Vérification

- Lot 0 : typecheck web, tests `store/backtest`, `alertsPanel.util`, `budgetBuild`, `viteConfig`,
  build + budget avant/après.
- Lot 1 : `pnpm --filter @axiom/daemon typecheck && pnpm --filter @axiom/daemon test` ; typecheck web,
  tests ciblés (`liquidationHeat`, `liquidationMarkers`, `hyperliquidHeat`, `persist`,
  `liquidationsWindow.util`) ; preuve réelle daemon + captures Playwright.
- Lot 2 : `pnpm --filter @axiom/indicators test`, typecheck monorepo, tests `auxProvider`,
  `IndicatorMenu.sousGroupes`, `indicatorUsability` ; build + budget.
- Porte finale : `pnpm check` ; mesures consignées dans
  `docs/superpowers/progress/2026-09-22-heatmap-hl-indicateurs-onchain.md` ; amendement du contrat.

## 6. Ce que ce chantier N'EST PAS

- Pas d'AggregationEngine (une seule venue, consommée telle quelle), pas de fournisseur nouveau
  (`EXCHANGE_IDS` à 9 ; Hyperliquid, Coinalyze, BGeometrics, mempool.space déjà admis), pas de
  fenêtre nouvelle (39), pas de dépendance, `package.json` intacts.
- La heatmap HL est un ÉCHANTILLON (≤ 500 adresses du leaderboard) : couverture MESURÉE en % de l'OI,
  jamais présentée comme exhaustive ; trous d'historique = daemon éteint, affichés comme tels ;
  indisponible sans daemon (Vercel).
- Le collecteur est opt-in (drapeau KV posé par l'activation de LIQHL) : le daemon ne télécharge le
  leaderboard (34 Mo / 6 h) et n'interroge les 500 comptes que si l'utilisateur a demandé la couche.
