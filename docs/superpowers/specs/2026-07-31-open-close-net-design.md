# OCN — Open/Close Net (façon Flux)

**Date** : 2026-07-31 · **Statut** : approuvé (design validé en session)

## Objectif

Reproduire l'indicateur « Open/Close Net » de Flux sur le graphique principal :
barres horizontales par niveau de prix montrant les positions nettes **encore
ouvertes** (blanc = shorts, jaune = longs), ligne POC, profil latéral droit.
Lecture cible : « grosse barre blanche à 64 600 = shorts nets piégés → support
mécanique au breakeven ».

Périmètre v1 (validé) : barres par niveau + POC + profil latéral. Hors
périmètre : bandes « Open Lev Delta » et les deux histogrammes bas de l'image.

## Méthode d'estimation (approche A validée)

L'OI par niveau de prix n'est **pas observable** — c'est une estimation, comme
chez Flux. Deux flux croisés :

- **Footprint tick par niveau** : buckets `tickSize` du contrôleur orderflow
  existant (`FootprintBar.rows` : `buyVol`/`sellVol` par prix).
- **ΔOI par bougie** : `openInterestHist` Binance Futures (period aligné sur
  l'intervalle du chart, ≤ 30 j d'historique). Actif uniquement sur les perps
  Binance (même contrainte que `cvdSpotPerp`) ; ailleurs, inerte avec mention.

Règles par bougie de la fenêtre d'analyse (défaut 32 bougies, réglable) :

1. **ΔOI > 0 (ouvertures)** : `|ΔOI|` réparti sur les niveaux au prorata de
   leur volume total ; le sens par niveau = signe de son delta agressif
   (sell net + OI↑ → shorts ouverts à ce niveau ; buy net → longs).
2. **ΔOI < 0 (fermetures)** : consommation du registre des positions encore
   ouvertes, proportionnelle sur tous les niveaux du côté racheté (couper un
   short = achat agressif). Proportionnelle et non par prix : une position se
   ferme au prix courant, pas à son niveau d'origine — limite documentée.
3. Sur-consommation clampée à 0 (l'OI peut baisser sous ce que la fenêtre a vu
   s'ouvrir).

Sortie par niveau : `{ openLong, openShort, closedLong, closedShort }` + POC
(niveau au plus gros volume total de la fenêtre).

**Invariant testable** : Σ(ouvert restant) = Σ(attribué) − Σ(consommé), et
chaque valeur ≥ 0.

## Architecture

Patron existant respecté (BUILD-CONTRACT) : les données tick/OI ne transitent
jamais par les stores ; frontière pur/impur = frontière de fichier.

- `apps/web/src/chart/openCloseNet.calc.ts` — calcul PUR (répartition,
  registre, POC). Testé dans `openCloseNet.calc.test.ts`.
- `apps/web/src/chart/openCloseNet.ts` — rendu canvas (barres, alpha réduit
  pour la part consommée, ligne POC + label, profil latéral droit, légende
  `Open/Close Net · N bougies` en `POLICE_CANVAS_MONO`), branché dans le
  contrôleur orderflow existant (même overlay, même sync viewport).
- Source OI : fetch dans le contrôleur (comme le flux perp de `cvdSpotPerp`),
  rafraîchi périodiquement.
- `orderflowStore` : `showOpenCloseNet: boolean` (défaut false) +
  `ocnLookback: number` (défaut 32). Session-only, comme les autres réglages
  footprint. Toggle + lookback exposés dans `FootprintSettingsPanel`.

## Erreurs / bords

- Symbole non-perp ou OI indisponible → rien n'est dessiné, mention discrète
  dans la légende. Pas d'autre gestion spéculative.
- ΔOI = 0 → aucune attribution pour la bougie.

## Tests

- Calc pur : répartition prorata, classement des sens, consommation
  proportionnelle + clamp, invariant de conservation, POC, ΔOI = 0,
  OI manquant (série trouée), fenêtre vide.
- Rendu : suivant le patron de test des modules chart existants.
