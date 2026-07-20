# Uniformisation des interactions sur les graphes canvas — zoom, plage, curseur

**Date** : 2026-07-20
**Statut** : validé (design approuvé par Zaki, à décliner en plan d'implémentation)

## Problème

Les graphes canvas custom d'AXIOM (hors graphe de prix klinecharts) manquent d'uniformité :
chaque fenêtre réimplémente (ou omet) ses contrôles de période, son survol et ses labels
d'axe. Aucun graphe custom ne permet de zoomer ni de choisir une plage arbitraire.
Inventaire 2026-07-20 : 14 composants canvas, **aucune brique partagée d'interaction** ;
seul GLOBE a un zoom molette (géographique), seul STBL a périodes + curseur + dates.

## Objectif

Un kit d'interaction unique appliqué à 7 fenêtres :

- **Zoom** : molette centrée sur le curseur, clampée aux bornes des données.
- **Pan** : cliquer-glisser horizontal.
- **Reset** : double-clic.
- **Périodes** : boutons uniformes 30 j / 90 j / 1 a / Tout (presets du domaine).
- **Curseur** : trait vertical + infobulle avec les valeurs du point survolé.
- **Labels d'axe X** systématiques (dates ou valeur d'axe), tokens thème.

## Périmètre

**Séries temporelles (plage de dates)** : STBL (impression, réf.), CHAIN (hashrate),
VOL (RV/DVOL), BT (equity/drawdown).
**Zoom d'axe non temporel** : OMON (strike), TERM (échéances), RATE/CourbeTaux (maturités)
— mêmes gestes, pas de boutons de période, curseur affichant les valeurs au point d'axe.
**Exclus** : sparklines Watchlist, heatmaps/treemaps (CORR, SEAG, MAP, DOM), GLOBE
(zoom géo déjà en place), graphe de prix klinecharts (zoom natif).

## Architecture (approche retenue : hook partagé + fonctions pures)

Trois briques nouvelles, chaque fenêtre **garde sa fonction de dessin custom** et reçoit
le domaine visible au lieu de le déduire de la série complète.

### 1. `apps/web/src/lib/domaineAxe.ts` — maths pures (testées vitest)

- `interface Domaine { min: number; max: number }` (nombres : ms epoch, strike, années…).
- `zoomerDomaine(d, facteur, pivot, bornes)` : zoom autour du pivot, clampé à `bornes`
  (domaine total des données) et à une largeur minimale (fraction de la plage totale).
- `deplacerDomaine(d, delta, bornes)` : pan clampé.
- `pixelVersValeur(d, xPix, largeurPix)` / `valeurVersPixel` : conversions.

### 2. `apps/web/src/hooks/useDomaineZoom.ts` — hook React (nouveau dossier hooks/)

- Entrées : `bornes` (domaine total), `domaineInitial`.
- Sorties : `{ domaine, setDomaine, reinitialiser, refCanvas }`.
- Branche sur le canvas : `wheel` natif `{ passive: false }` (pattern GLOBE,
  `preventDefault`), pointer capture pour le pan, `dblclick` pour reset.
- Les listeners sont retirés au démontage. Le domaine se réinitialise quand `bornes`
  change (nouvelle série : changement de pays RATE, de devise OMON, de période de
  backtest…).

### 3. Composants partagés dans `apps/web/src/components/ui.tsx`

- `BarrePeriodes` : wrapper d'`Onglets` avec presets 30 j/90 j/1 a/Tout ; aucun bouton
  actif quand l'utilisateur a zoomé manuellement (état « plage personnalisée »).
- `InfobulleGraphe` : généralisation du curseur STBL — trait vertical + infobulle
  overlay positionnée, lignes `{ label, valeur, couleur? }`, `pointer-events-none`,
  clampée au bord droit.

### Adaptation par fenêtre (7)

Chaque fonction de dessin prend un paramètre `domaine` et trace la partie visible
(filtrage des points + scale X sur le domaine, plus sur min/max de la série) :

1. **STBL** `dessinerImpression` — migre vers le kit (remplace PERIODES/tronquerSerie
   locaux et le tooltip ad hoc ajouté le 20/07) ; sert de référence.
2. **CHAIN** courbe hashrate — kit complet (aucun contrôle aujourd'hui) + labels dates
   canvas (aujourd'hui en spans DOM).
3. **VOL** `drawSeries` RV30/DVOL — kit complet (fixe 365 j aujourd'hui).
4. **BT** `dessinerEquity` — kit complet sur l'equity curve + drawdown.
5. **OMON** smile IV + histogramme OI — zoom/pan sur l'axe strike, curseur = IV/OI au
   strike survolé. Pas de BarrePeriodes.
6. **TERM** basis par échéance — zoom d'axe, curseur = basis à l'échéance survolée.
7. **RATE** CourbeTaux — zoom d'axe maturités, curseur = rendement à la maturité
   survolée (multi-pays : une valeur par couche affichée).

## Garde-fous

- Zoom clampé : jamais au-delà des bornes des données, largeur minimale pour éviter le
  zoom infini ; molette `preventDefault` uniquement au-dessus du canvas.
- Série < 2 points : interactions inertes (pas de crash, pas d'infobulle).
- Les valeurs affichées par l'infobulle réutilisent les formatters de `lib/format.ts`
  (`formatDateCourte`, `formatUsd`, `formatPct`…) et les tokens couleur via
  `lireTokenCanvas` — aucune couleur en dur (contrainte thème Cute, AA).

## Tests

- vitest purs sur `domaineAxe.ts` : zoom pivot (le point sous le curseur reste sous le
  curseur), clamp aux bornes, largeur minimale, pan aux extrémités, conversions
  aller-retour.
- Tests existants (`stablecoinsWindow.util.test.ts`…) inchangés ou adaptés si une
  signature bouge.
- Vérification visuelle navigateur (chrome-devtools) des 7 fenêtres × 2 thèmes
  (Dark, Cute) : zoom, pan, reset, périodes, curseur, labels.

## Non-objectifs

- Pas de refonte du rendu des fenêtres (les dessins custom restent).
- Pas de zoom vertical (axe Y auto-scale sur la plage visible, comportement inchangé
  sauf recalcul sur le domaine affiché).
- Pas de persistance du domaine zoomé entre sessions.
