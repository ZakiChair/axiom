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
depuis un seul écran, sans abonnement ni compte. Ce n’est pas un SaaS : pas de multi-tenant, pas
d’auth réseau, rien ne quitte la machine en dehors des appels aux APIs publiques.

| | |
|---|---|
| **Lire le prix** | orderflow / CVD / footprint, profil de volume, heatmap de liquidations, **155 indicateurs** testés |
| **Lire le contexte** | **35 fenêtres** à mnémonique : calendrier éco, news, corrélations, on-chain, treemap, options, COT, taux & liquidité Fed, saisonnalité, stablecoins, cycle halving… |
| **Décider** | screener, playbooks 1-clic, alertes, backtest, stress-test multi-facteurs, étude d’évènements (CPI/NFP/FOMC), journal de trades, paper trading |
| **Ne pas décrocher** | alertes onglet fermé (macOS + Telegram optionnel), replay sur dumps officiels Binance, panneau de santé des sources |

Deux partis pris structurent le produit :

1. **Le chemin chaud reste direct.** Le front parle **directement** aux WebSockets des exchanges ;
   le daemon `axiomd` ne prend en charge que le lent (APIs à quota, cache, persistance SQLite,
   alertes). L’UI reste utilisable **sans** daemon.
2. **Les calculs sont du TypeScript pur et testés.** Les 155 indicateurs vivent dans
   `@axiom/indicators` — pas de WASM, pas de service Python — et sont vérifiés par golden tests
   contre un oracle `pandas-ta` (`scripts/golden/`).

**Hors périmètre assumé** : pas d’exécution d’ordres (`PAPER` est une simulation locale), pas de
multi-utilisateur, pas d’Electron.

## Architecture

```
packages/
  types/         @axiom/types       — contrat de données partagé
  indicators/    @axiom/indicators  — 155 indicateurs TS pur + golden tests
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

- **Node.js** 20+ et **pnpm** 9 (`packageManager` piné dans `package.json`)
- **Bun** (daemon + ses tests) : https://bun.sh
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

## Fonctionnalités (aperçu)

- **Chart** : multi-grille (1 / 2h / 2v / 2×2), orderflow / CVD / footprint, volume profile, fibo, dessins, 155 indicateurs
- **Terminal** : palette ⌘K, raccourcis, workspaces, fenêtres flottantes + snap + taskbar
- **Sources** : Binance, Bybit, OKX, Coinbase, Kraken, MEXC, Deribit, Twelve Data, Coinalyze, FRED, etc.
- **Panneaux** : 35 fenêtres — DES, FUNDX, LIQ, ECO, NEWS, CORR, CHAIN, MAP, PORT, NOTE, EQS, TERM, OMON, DOM, BT, REPLAY, RATE, COT, SEAG, VOL, FUND, BRIEF, GLOBE, STBL, SQZ, CBPREM, NETLIQ, DATA, DIST, EXPY, PAPER, MINE, CYCLE, EVTS, SCEN
- **Daemon** : proxy+cache, KV/candles SQLite, alertes (macOS + Telegram optionnel), replay dumps Binance, couches GDELT/UCDP

### Programme G100 (WTP 100 $/mois) — W0–W3 landés

Les vagues **W0–W3** du plan `docs/superpowers/plans/2026-07-13-cible-100-usd-mois.md` sont **mergées en main** (confiance CVD/badges, `pnpm run up`, onboarding, session strip, alertes edge + funding daemon, playbooks, screener positionnement, bus panneau→chart, import CSV, brief review). **W4 / gate G100** (E1 polish + E2 QA checklist G1–G10) reste à valider manuellement — voir section 14 du plan (statut provisoire *code-complete · manual QA*).

## Secrets

**Source unique** : `apps/web/.env` (gitignoré), lue par Vite **et** par le daemon. Les clés sont injectées côté proxy — elles ne partent pas dans le bundle navigateur.

Modèle sans valeurs : `apps/web/.env.example`.

Variables optionnelles du process daemon : `AXIOMD_PORT` (défaut `8787`).

## Tests & qualité

```bash
pnpm check
# équivalent : typecheck monorepo + tests (vitest / bun:test) + build @axiom/web
```

Pas de CI distante imposée : le script local suffit pour un usage perso. Les tests unitaires couvrent indicateurs, data layer, stores, daemon (parse, cache, globe…).

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

Build **personnel**. Pas de multi-tenant, pas d’auth réseau, pas de clés de trading dans le MVP (paper trading hors scope actuel).
