# AXIOM Terminal

Terminal de charting, orderflow et contexte macro **mono-utilisateur** (un opérateur, ses propres clés API). Crypto d’abord (spot + perp) ; tradfi / commodités en complément.

Décisions figées : voir **`BUILD-CONTRACT.md`** (renderer-first, KLineChart, indicateurs TS pur, daemon localhost hors chemin chaud, pas de multi-tenant / Electron / AggregationEngine).

![AXIOM Terminal — graphe BTCUSDT 4 h avec profil de volume et heatmap de liquidations, fenêtres FUNDX (funding cross-exchange), DOM (carnet d’ordres) et ECO (calendrier économique), watchlist et santé des sources](assets/apercu-terminal.png)

## Présentation

AXIOM est un **poste de marché local**, dans l’esprit d’un terminal Bloomberg ramené à un seul
opérateur : une command line (`⌘K`), des **mnémoniques** courtes (`ECO`, `DOM`, `FUNDX`, `SCEN`…),
des fenêtres flottantes avec snap et taskbar, des workspaces commutables — le tout servi par un
process local unique et **vos** clés API.

**Pour qui.** Un opérateur qui veut lire le marché crypto (spot + perp) *et* son contexte macro
depuis un seul écran, avec des sources publiques et ses accès personnels optionnels. Ce n’est
pas un SaaS : pas de multi-tenant ni d’auth réseau. Les appels aux fournisseurs utilisent les
droits de l’opérateur ; certains historiques exigent une clé ou un abonnement.

| | |
|---|---|
| **Lire le prix** | orderflow / CVD / footprint, profil de volume, heatmap de liquidations, **189 indicateurs** testés |
| **Lire le contexte** | **39 fenêtres** à mnémonique : calendrier éco, news, corrélations, on-chain, mouvements de baleines, treemap, options, COT, taux (dont 24 familles macro sur 8 zones) & liquidité Fed, saisonnalité, stablecoins, cycle halving… |
| **Décider** | screener, playbooks 1-clic, alertes (dont composite ET), backtest en R (stop ATR / sizing risque), coût d’exécution L2 (DOM), stress-test, étude d’évènements, journal, paper trading |
| **Ne pas décrocher** | alertes onglet fermé (macOS + Telegram optionnel), replay sur dumps officiels Binance, panneau de santé des sources |

Deux partis pris structurent le produit :

1. **Le chemin chaud reste direct.** Le front parle **directement** aux WebSockets des exchanges ;
   le daemon `axiomd` ne prend en charge que le lent (APIs à quota, cache, persistance SQLite,
   alertes). L’UI reste utilisable **sans** daemon.
2. **Les calculs sont du TypeScript pur et testés.** Les 189 indicateurs vivent dans
   `@axiom/indicators` — pas de WASM, pas de service Python — et sont couverts par des tests
   unitaires et structurels, dont **4 indicateurs comparés à un oracle `pandas-ta`** (ADX,
   SuperTrend, Ichimoku, PSAR ; `scripts/golden/`), des oracles analytiques ATR/RSI/Bollinger/RVOL
   et des vérifications de causalité par préfixe.

**Hors périmètre assumé** : pas d’exécution d’ordres réels (aucune clé de trading). Le paper
trading (`PAPER`) est une simulation locale déjà présente ; pas de multi-utilisateur, pas
d’Electron.

## Architecture

```
packages/
  types/         @axiom/types       — contrat de données partagé
  indicators/    @axiom/indicators  — 189 indicateurs TS pur + golden tests
  alerts/        @axiom/alerts      — moteur d’alertes pur (front + daemon)
  backtest/      @axiom/backtest    — moteur de backtest pur
apps/
  web/           @axiom/web         — front Vite + React + KLineChart
  daemon/        @axiom/daemon      — axiomd (Bun + SQLite, 127.0.0.1:8787)
shared/
  extapi-hosts.ts                   — whitelist unique du proxy /extapi
docs/
  research/      notes fournisseurs, edge, roadmap
  superpowers/   specs & plans d’implémentation
```

**Invariant** : le front parle en **direct** aux WebSockets des exchanges. Le daemon ne proxifie / cache / persiste **que** les APIs lentes à quota et les services annexes (alertes, globe, replay…). L’UI reste utilisable **sans** daemon (feature-detect `/health` + repli localStorage).

## Prérequis

- **Node.js** 22 (référence CI) et **pnpm** 9 (`packageManager` piné dans `package.json`)
- **Bun 1.3.11** (version épinglée pour le daemon et ses tests) : https://bun.sh
- Clés API optionnelles dans `apps/web/.env` (voir `apps/web/.env.example`)

## Installation

```bash
pnpm install
cp apps/web/.env.example apps/web/.env   # puis renseigner les clés utiles
```

## Démarrage

One-shot (recommandé) — cold-start en une commande :

```bash
pnpm run up       # daemon + Vite dev → http://localhost:5173
pnpm run up:prod  # build front + daemon → http://127.0.0.1:8787
```

> ⚠️ `run` obligatoire : `pnpm up` **nu** résout vers le builtin pnpm `update`
> (alias réservé `up`) — il ne lance pas le stack et peut muter le lockfile.

`pnpm run up` vérifie `pnpm`/`bun`, lance `pnpm install` si besoin, démarre le daemon
(log `logs/daemon.log`), attend `/health` (15 s), puis le front. Ctrl+C arrête
les process lancés par le script.

## Commandes

| Commande | Effet |
|---|---|
| `pnpm run up` | One-shot dev (daemon + Vite) |
| `pnpm run up:prod` | One-shot prod (build + daemon sert le dist) |
| `pnpm dev` | Front Vite seul (dev, proxys CORS intégrés) |
| `pnpm daemon` | Daemon localhost `127.0.0.1:8787` |
| `pnpm prod` | Build front + sert le dist via le daemon |
| `pnpm test` | Tests de tous les packages / apps |
| `pnpm typecheck` | `tsc --noEmit` sur le monorepo |
| `pnpm build` | Build récursif |
| `pnpm check` | Contrôle qualité local (typecheck + test + build web) |
| `pnpm check:e2e` | Parcours navigateur hermétiques utilisés en CI (Chromium Playwright requis) |

Fallback dual-terminal (si besoin de séparer les logs) :

```bash
pnpm daemon       # http://127.0.0.1:8787  (optionnel en dev)
pnpm dev          # http://localhost:5173
```

Prod locale (équivalent manuel de `pnpm run up:prod`) :

```bash
pnpm prod
# ouvrir http://127.0.0.1:8787
# (Chrome mode app : open -a "Google Chrome" --args --app=http://127.0.0.1:8787)
```

## Déploiement Vercel

Le build Vercel sert le front et un proxy serverless restreint aux hôtes de
`shared/extapi-hosts.ts`. Aucun secret partagé n'est injecté dans ce proxy public : les **dix
clés** saisissables dans **Réglages** (Coinalyze, Twelve Data, FRED, BGeometrics, SoSoValue,
Finnhub, Etherscan v2, CoinDesk Data/CCData, CoinGecko et DefiLlama Pro) restent dans le `localStorage` du
navigateur. OI et funding du graphe disposent d'un repli Binance sans
clé ; NVT utilise directement les charts publics Blockchain.com.

Le catalogue conserve les 189 indicateurs. Une entrée impossible pour la source, le symbole ou
le timeframe courant est désactivée et marquée **UNUSABLE** au lieu de produire un pane vide.
Les fonctions intrinsèquement locales sont également nommées : REPLAY et WHALES sont
**UNUSABLE** sur Vercel ; l'historique LIQ et les couches GDELT/UCDP de GLOBE sont **PARTIAL**.
Les snapshots, LIQHL, les alertes baleines et les notifications onglet fermé nécessitent toujours
`axiomd`.

## Fonctionnalités (aperçu)

- **Chart** : multi-grille (1 / 2h / 2v / 2×2), orderflow / CVD / footprint, volume profile, fibo, dessins, 189 indicateurs
- **Terminal** : palette ⌘K, raccourcis, workspaces, fenêtres flottantes + snap + taskbar
- **Sources** : Binance, Bybit, OKX, Coinbase, Kraken, MEXC, Deribit, Twelve Data, Coinalyze, FRED, etc.
- **Panneaux** : 39 fenêtres — DES, FUNDX, LIQ, ECO, NEWS, CORR, CHAIN, MAP, PORT, NOTE, EQS, TERM, OMON, DOM, BT, REPLAY, RATE, COT, SEAG, VOL, FUND, BRIEF, GLOBE, STBL, SQZ, CBPREM, NETLIQ, DATA, DIST, EXPY, PAPER, MINE, WHALES, CYCLE, BPL, EVTS, SCEN, CAP, SECT
- **Daemon** : proxy+cache, KV/candles SQLite, alertes (macOS + Telegram optionnel), replay dumps Binance, couches GDELT/UCDP, collecte des mouvements baleines (BTC + stables)

[Bilan des ajouts, sources et vérifications du 7 septembre](docs/revue-2026-09-07.md).

### Fonction MACRO et nouveaux indicateurs

`⌘K → MACRO` ouvre **RATE → Indicateurs**. Choisir une famille, les zones et un
historique de **1, 5 ou 10 ans**. Huit zones : États-Unis, zone euro, Royaume-Uni,
Japon, Chine, Inde, Canada et Suisse. `MONEY` conserve l'ancien panneau monétaire.

Les vingt-quatre familles couvrent CPI annuel/mensuel, inflation sous-jacente, PPI, PIB
réel annuel, chômage, production industrielle, change effectif réel, monnaie large,
taux réel US, breakeven, NFCI, spread HY, inscriptions chômage et SOFR−IORB, ainsi que
PCE sous-jacent (niveau, annuel, trois/six mois annualisés), emploi non agricole
(variation mensuelle, moyenne trois mois) et ventes au détail nominales (niveau, mensuel, annuel).
Le catalogue contient 88 définitions, dont 86 raccordées ; deux absences restent explicites.
Les sources, périodes, unités, estimations et retards apparaissent par série.
Les historiques ont la profondeur réellement publiée ; une sélection de dix ans
ne crée pas dix ans de données. Les périmètres nationaux restent distincts
(IPCH/IPC, M2/M3/M4, enquêtes de chômage). ECO ouvre les séries équivalentes et
BRIEF reprend la sélection, ses périodes et ses réserves.

- **GLOBE** : historiques GPR, TPU, GSCPI et trafic PortWatch par détroit, moyenne
  sur sept jours et comparaison saisonnière. Sources officielles et millésimes visibles.
- **CHAIN** : cohortes STH/LTH, capitalisation réalisée et variations 30/90 jours,
  offre BTC en profit/perte, réserves et netflows des exchanges, historique ETF
  5/20 séances et files de staking ETH. Les accès BGeometrics/SoSoValue dépendent
  des droits de la clé ; les groupes partagent les données avec la vue commune des flux.
- **Graphique / DOM** : RVOL saisonnier H1, parts de variance baissière/haussière,
  OFI, microprix et reconstitution du carnet après retrait de liquidité. Cette dernière
  mesure reste une heuristique L2 : annulations et exécutions ne sont pas distinguées.
- **Sauvegardes** : snapshots étendus aux notes, dessins, alertes, journal,
  portefeuille et espaces de travail ; restauration du périmètre exact. Les clés API
  sont exclues des snapshots et de l’export JSON. Importer une ancienne sauvegarde
  ne remplace pas les clés déjà configurées localement. Le daemon reste nécessaire
  pour les sauvegardes durables.

Les deux indicateurs OHLCV sont utilisables dans les alertes et le backtest ; le
RVOL exige H1 et suffisamment de références antérieures. Les mesures L2 et les
historiques macro/on-chain de ces panneaux ne deviennent pas des signaux de
backtest. Les 30 stratégies du catalogue restent **non validées**. Les séries
révisables courantes ne simulent pas ce qui était connu à une ancienne date de publication ;
la vue ALFRED décrite ci-dessous utilise explicitement un millésime.

### Lectures et vérifications du 9 septembre

| Ouvrir | Utilisation et limites |
|---|---|
| **DATA / BRIEF / CHAIN** | Consulter source effective, date d’observation, récupération, couverture et droits. Un cache ancien conserve sa date, le badge vieillit même sans nouvelle collecte et une donnée absente ne vaut pas zéro. Les heures affichées sont en UTC. |
| **MACRO / EVTS** | Choisir une date « connue au » pour FRED/ALFRED et comparer première publication et révision. ALFRED fournit un jour, sans heure intrajournalière. |
| **NETLIQ** | Lire TGA Treasury DTS et les contributions Fed/RRP/TGA avec leurs dates ; la comparaison hebdomadaire utilise une période commune. |
| **CHAIN / BRIEF / STBL** | Comparer flux ETF, stock stablecoin et capital réalisé. Les ratios ETF utilisent l’encours de leur séance ; les percentiles exigent une profondeur suffisante. Les alertes de flux conservent leur observation et leur source dans le journal, avec le front actif même si les panneaux sont fermés. |
| **CHAIN / STBL / SECT** | Comparer Ethereum, Solana, Base et Arbitrum : TVL, DEX, stablecoins USD, frais et revenus, dates et variations 30/90/365 jours. Les séries monétaires ne représentent pas des quantités corrigées de l’effet de prix. |
| **ECO → EVTS** | Ouvrir une annonce comparable, importer des archives sourcées, consulter consensus daté et surprise, puis réaction BTC/ETH avant/après 5/15/60 minutes et 24 heures. L’heure est explicite en UTC ; une fenêtre OHLC trouée reste partielle. [Schéma d’import](docs/guides/archives-publications.md). |
| **DOM / EQS** | Diagnostic du symbole maître Binance : prix/CVD spot 5 min et OI perp en quantité, période commune, seuils et persistance réglables. Les coûts L2 sont distincts, hors frais, et deviennent indisponibles si le carnet vieillit. |
| **OMON / BRIEF** | Comparer les hypothèses gamma calls+/puts−, tous longs et tous shorts sur le même univers. Leur désaccord signale une sensibilité au modèle ; la couverture n’est pas une probabilité de réussite. |
| **WHALES** | Examiner entités, origine et ancienneté des labels, transferts internes et trous de collecte. Un transfert vers un exchange ne prouve pas une vente. |
| **CAP / SECT** | Utiliser unlocks et bridges avec une clé DefiLlama Pro, ou importer un [calendrier sourcé](docs/guides/calendriers-unlocks.md). Ratios au flottant et au volume uniquement avec dénominateurs disponibles et datés. |
| **BT** | Inclure les règlements de funding vérifiés et les coûts ; comparer bootstrap par blocs, franchissement d’un seuil de ruine et capital terminal négatif. Les règles utilisant des sorties anticipatrices sont refusées. Le funding réel couvre BTCUSDT/ETHUSDT, les mois clos uniquement et au plus 26 mois ; une preuve d’archives ou de couverture incomplète bloque le calcul. |

La campagne hors échantillon figée porte sur BTC/ETH, 1 h/4 h, du 29 juillet au
9 septembre 2026, avec trois règles, coûts et sensibilité des paramètres. Son résultat
est **non concluant** ; les 30 stratégies restent non validées. Le manifeste et les
résultats sont dans `scripts/oos/`. Les contrôles et accès réellement éprouvés sont
consignés dans le [bilan de réalisation](docs/superpowers/progress/2026-09-09-revue-integrale.md).
Le mode funding réel vérifie les sommes CHECKSUM des archives mensuelles et la
concordance des échéances et taux avec le REST Binance ; il ne simule ni marge
ni liquidation. La fréquence de règlement vient des données, pas d’une hypothèse
systématique de huit heures.

Pour reproduire l’audit figé avec Bun : `bun scripts/valider-hors-echantillon.ts`.
Le script vérifie le hash du manifeste, réutilise son cache OHLCV contrôlé ou
télécharge les bougies publiques Binance, puis réécrit
`scripts/oos/resultat-2026-09-09.json` et `scripts/oos/rapport-2026-09-09.md`.
Les hashes du code et la date de recalcul sont enregistrés ; relancer la campagne
ne crée pas un nouvel échantillon réservé.

### Programme G100 — protocole d’usage

Les vagues **W0–W3** du plan `docs/superpowers/plans/2026-07-13-cible-100-usd-mois.md` sont **mergées en main** (confiance CVD/badges, `pnpm run up`, onboarding, session strip, alertes edge + funding daemon, playbooks, screener positionnement, bus panneau→chart, import CSV, brief review).

Les tests Playwright de gate et scripts G5/G9 couvrent les parcours automatisables.
La tenue de trente minutes, la coupure réelle de quatre-vingt-dix secondes, la bannière
macOS et les observations visuelles ont des critères propres. Le
[registre G100](docs/superpowers/plans/2026-07-22-gate-g100-qa.md) est l’unique référence
de leurs résultats et de la décision WTP. Les extensions demandées par le propriétaire
et leurs limites sont consignées dans `BUILD-CONTRACT.md`.

## Secrets

En local, `apps/web/.env` (gitignoré) est lu par Vite et par le daemon ; ses clés de repli sont injectées côté proxy et restent hors du bundle navigateur.

Sur Vercel, aucune clé serveur partagée n'est utilisée. Les clés personnelles sont stockées dans le `localStorage` du navigateur et envoyées uniquement au fournisseur concerné via le proxy restreint, ou directement à Twelve Data (CORS public).

Modèle sans valeurs : `apps/web/.env.example`.

Variables optionnelles du process daemon : `AXIOMD_PORT` (défaut `8787`).

## Conventions de calcul et de notification

Le backtest valorise l'équité à chaque clôture de bougie, positions ouvertes comprises.
Le drawdown mesure la baisse depuis le plus haut de cette équité ; il ne mesure pas les
extrêmes intrabar. Les frais d'entrée sont déduits dès l'entrée, les frais de sortie lors
de la sortie. Les décisions restent exécutées à l'ouverture de la bougie suivante.

Le heartbeat indique la visibilité de l'onglet et sa permission de notification.
Le navigateur prend en charge la notification native lorsqu'il est visible et autorisé ;
le daemon assure le relais macOS sinon, ou après expiration du heartbeat. Un ancien
heartbeat sans capacité déclarée conserve ce relais. Telegram, s'il est configuré,
reste un canal du daemon indépendant de la présence de l'onglet.

## Tests & qualité

```bash
pnpm check
# équivalent : typecheck monorepo + tests (vitest / bun:test) + build @axiom/web
pnpm check:e2e
# parcours navigateur hermétiques, après installation de Chromium Playwright
```

Le gate local **`pnpm check`** reste la référence ; un filet de sécurité distant
existe en plus dans `.github/workflows/ci.yml` (typecheck + tests + build web sur
chaque push `main` et PR, étapes découpées avec timeouts individuels, Node 22 / Bun 1.3.11),
complété par `pnpm check:e2e`. Les playbooks et les régressions de la revue du 2026-09-04
sont inclus dans cette sélection sans accès aux API de marché réelles.

Les résultats datés des tests, du build et de l'audit des dépendances sont consignés
dans le [rapport de corrections du 2026-09-04](docs/superpowers/audits/2026-09-04-corrections-revue.md).
Les tests unitaires couvrent indicateurs, data layer, stores, backtest et daemon.

## Documentation

| Doc | Contenu |
|---|---|
| `BUILD-CONTRACT.md` | Conventions et anti-objectifs (source de vérité agents) |
| `docs/research/03-roadmap-bloomberg-perso.md` | Roadmap produit consolidée |
| `docs/superpowers/plans/2026-07-13-cible-100-usd-mois.md` | Programme multi-agent « WTP 100 $/mois » (DAG + gate G100) |
| `docs/research/02-indicateurs-edge-crypto.md` | Catalogue indicateurs à edge |
| `docs/superpowers/specs/` | Specs de design par lot |
| `scripts/golden/README.md` | Oracle pandas-ta pour golden files |

## Licence / usage

Build **personnel**. Pas de multi-tenant, pas d’auth réseau, aucune clé de trading réelle
(le paper trading est une simulation locale ; `PAPER` est inclus mais hors gate G100).
