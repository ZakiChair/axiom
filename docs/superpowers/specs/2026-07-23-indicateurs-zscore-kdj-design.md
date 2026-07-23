# Indicateurs Z-score de prix & KDJ (design)

Date : 2026-07-23 · Statut : validé sur périmètre par Zaki (sélection AskUser), spec à relire.

## But

Deux quick wins mécaniques comblant des trous standard du registre (147 defs) : un **z-score de prix générique** (il n'existe que des z-scores spécialisés funding/MVRV/volume) et **KDJ** (oscillateur très répandu en crypto, absent alors que stochastic/stochRsi existent).

## Non-buts

- Pas de percentile-rank roulant dans ce lot (le z-score couvre le besoin mean-reversion ; percentile notable en suite si l'usage le demande).
- Pas d'alertes ni de signaux automatiques.

## Indicateur 1 — `priceZScore`

- `id: "priceZScore"`, `category: "volatility"`, `pane: "separate"`.
- **Inputs** : `length` (défaut 100, min 10, max 500), `source` (défaut close, sélecteur standard `ctx.source`).
- **Calcul** : `z[i] = (source[i] − SMA(source, length)[i]) / stdev(source, length)[i]` ; undefined tant que la fenêtre est incomplète ou si stdev = 0.
- **Outputs** : `z` (ligne, accent) + bandes fixes de repère `+2` et `−2` (style band/lignes pointillées, tokens up/down) ; ligne zéro implicite du pane.
- Précision 2.

## Indicateur 2 — `kdj`

- `id: "kdj"`, `category: "momentum"`, `pane: "separate"`.
- **Inputs** : `length` (défaut 9), `signalK` (défaut 3), `signalD` (défaut 3).
- **Calcul** (convention standard) : `RSV = 100 × (close − LL(length)) / (HH(length) − LL(length))` ; `K = SMMA(RSV, signalK)` (lissage 1/3 classique : `K[i] = (2/3)·K[i−1] + (1/3)·RSV[i]`, seed 50) ; `D` idem sur K (seed 50) ; `J = 3K − 2D`.
- **Outputs** : `k` (ligne accent), `d` (ligne down), `j` (ligne up). `HH == LL` (bougie plate) → RSV undefined, K/D portent la valeur précédente.
- Bornes visuelles 0-100 (J peut dépasser — c'est sa nature, ne pas clamper).
- Précision 2.

## Tests / validation

- TDD par def : fixtures à la main avec valeurs attendues calculées dans le test (commentées), fenêtre incomplète → undefined, stdev nulle / bougie plate, seeds KDJ.
- Golden files si convention de la catégorie.
- Enregistrement registry (+ imports, + entrées), `registry.test` compte 147 → 149 mis à jour.
- Gate visuel rapide : les deux panes s'affichent sur BTCUSDT, params modifiables, deux thèmes.

## Contraintes

Français, moteur pur, pattern d'ajout standard (fichier + test + registry, commit modèle `31bbee4`), branche `feat/ind-zscore-kdj`.
