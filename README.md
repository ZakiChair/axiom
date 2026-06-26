# AXIOM Terminal

Terminal de charting & d'orderflow crypto — **build perso mono-utilisateur** (un seul opérateur, ses propres clés). Crypto d'abord (spot + perp) ; tradfi/commodités plus tard.

Issu de la critique de la spec v1.0 (`~/AXIOM-revue-critique-2026-06-26.md`). Décisions clés : renderer-first (pas de backend pour le MVP), KLineChart figé, indicateurs en TS pur, données dérivées achetées (Coinalyze) plutôt que reconstruites. Voir `BUILD-CONTRACT.md`.

## Structure (monorepo pnpm)
```
packages/
  types/        @axiom/types — contrat de données partagé (§5)
  indicators/   @axiom/indicators — moteur générique + catalogue (TS pur)
apps/
  web/          @axiom/web — front Vite + React + KLineChart
docs/research/  notes de recherche (fournisseurs API, indicateurs)
```

## Développement
```bash
pnpm install
pnpm dev          # lance l'app web (Vite)
pnpm test         # tests (indicateurs)
pnpm typecheck
```

## Jalons MVP
M1 chart Binance live · M2 moteur + 7 indicateurs · M3 watchlist+persistance · M4 spike sync WebGL · M5 CVD+footprint · M6 dérivés via Coinalyze.
