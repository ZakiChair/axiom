# Heatmap de liquidations (profil par prix) — Design

## Contexte

La fenêtre LIQ et le toggle « Sur le graphe » (store `liqMarksStore`) affichent
aujourd'hui les liquidations comme des **points individuels** au prix/temps de chaque
événement. L'utilisateur veut plutôt une **heatmap** façon CoinGlass : des bandes
horizontales par niveau de prix, d'intensité proportionnelle à la quantité liquidée.

**Contrainte data** : le heatmap CoinGlass est un modèle propriétaire (payant) de
niveaux de liquidation *estimés* (levier + OI). Inaccessible. On bâtit l'équivalent
honnête à partir du **vrai flux Bybit `allLiquidation`** (déjà câblé) : un **profil des
liquidations réellement exécutées**, agrégées par niveau de prix, accumulé en LIVE.

## Décision

Le toggle « Sur le graphe » affiche désormais le **heatmap** (remplace les points).

## Données & accumulation

- Chaque liquidation ajoute son `notionalUsd` à un **bucket de prix** :
  `accumulateur: Map<bucketIndex, notionnelTotal>`.
- `bucketIndex = floor(prix / tailleBucket)` ; bande de prix = `[idx·taille, (idx+1)·taille]`.
- `tailleBucket` = ~0,1 % du prix arrondi à un pas « joli » (1/2/5 × 10ⁿ), calculée une
  fois à la souscription (ex. BTC 65 000 → 50).
- Accumulateur **remis à zéro au changement de symbole** (comme le flux). Cumulatif
  depuis la souscription (profil, pas fenêtre glissante).

## Rendu (réutilise l'infra overlay KLineChart, pas de nouveau Canvas)

- Pour chaque bucket ayant du volume : un overlay custom `liqHeat` avec 2 points
  `[(premierTemps, prixHautBucket), (dernierTemps, prixBasBucket)]`.
- `createPointFigures` dessine un **rect pleine largeur** entre les 2 coords, rempli
  d'une couleur **viridis** (violet→bleu→teal→vert→jaune) selon l'intensité
  `t = notionnel / maxNotionnel`, alpha `0,2 + 0,6·t`.
- Ancrage à 2 points de prix → la bande **se repositionne au pan ET au zoom**
  automatiquement (KLineChart recalcule les coords ; pas de redraw sur pan/zoom).
- On ne peint QUE les niveaux avec liquidations (fond du chart visible) → lisible en
  thème clair comme sombre.
- Redraw uniquement : arrivée d'une liquidation (sparse), changement de symbole, thème,
  bascule du toggle.

## Fonctions pures (testées)

- `tailleBucket(prix): number` — pas de bucket « joli ».
- `bucketIndex(prix, taille): number` — `floor(prix/taille)`.
- `couleurViridis(t: number): [r,g,b]` — interpolation sur 5 arrêts viridis, clampé 0-1.
- Agrégation/normalisation : dérivées de l'accumulateur (max, intensité par bucket).

## Nettoyage

Retirer le code mort des points : `tierRayon`, `elaguerLiquidations`, `snapToCandleTime`,
`couleurLiquidation`, la figure « pastille » + leurs tests. La fenêtre LIQ (feed + totaux)
et son abonnement restent inchangés (buffer séparé).

## Limites assumées

Liquidations **exécutées** (pas le modèle de levier CoinGlass), **accumulées en live**
(le heatmap se construit tant que c'est activé), **Bybit** uniquement.

## Vérification

- Tests unitaires purs (bucket/viridis).
- Vérif visuelle navigateur (chrome-devtools) : injection de liquidations à divers prix
  → bandes viridis d'intensité croissante, repositionnées au pan/zoom, sur 1m et 1d.
