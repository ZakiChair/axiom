# AXIOM Terminal

Terminal de charting, orderflow et contexte macro **mono-utilisateur** (un opérateur, ses propres clés API). Crypto d’abord (spot + perp) ; tradfi / commodités en complément.

Décisions figées : voir **`BUILD-CONTRACT.md`** (renderer-first, KLineChart, indicateurs TS pur, daemon localhost hors chemin chaud, pas de multi-tenant / Electron / AggregationEngine).

## Architecture

```
packages/
  types/         @axiom/types       — contrat de données partagé
  indicators/    @axiom/indicators  — ~98 indicateurs TS pur + golden tests
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

## Commandes

| Commande | Effet |
|---|---|
| `pnpm dev` | Front Vite (dev, proxys CORS intégrés) |
| `pnpm daemon` | Daemon localhost `127.0.0.1:8787` |
| `pnpm prod` | Build front + sert le dist via le daemon |
| `pnpm test` | Tests de tous les packages / apps |
| `pnpm typecheck` | `tsc --noEmit` sur le monorepo |
| `pnpm build` | Build récursif |
| `pnpm check` | Contrôle qualité local (typecheck + test + build web) |

Dev typique (deux terminaux) :

```bash
pnpm dev          # http://localhost:5173
pnpm daemon       # http://127.0.0.1:8787  (optionnel en dev)
```

Prod locale :

```bash
pnpm prod
# ouvrir http://127.0.0.1:8787
# (Chrome mode app : open -a "Google Chrome" --args --app=http://127.0.0.1:8787)
```

## Fonctionnalités (aperçu)

- **Chart** : multi-grille (1 / 2h / 2v / 2×2), orderflow / CVD / footprint, volume profile, fibo, dessins, ~98 indicateurs
- **Terminal** : palette ⌘K, raccourcis, workspaces, fenêtres flottantes + snap + taskbar
- **Sources** : Binance, Bybit, OKX, Coinbase, Kraken, MEXC, Deribit, Twelve Data, Coinalyze, FRED, etc.
- **Panneaux** : DES, ECO, NEWS, CORR, CHAIN, MAP, PORT, NOTE, EQS, TERM, OMON, DOM, BT, REPLAY, RATE, COT, SEAG, VOL, FUND, BRIEF, GLOBE
- **Daemon** : proxy+cache, KV/candles SQLite, alertes (macOS + Telegram optionnel), replay dumps Binance, couches GDELT/UCDP

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
