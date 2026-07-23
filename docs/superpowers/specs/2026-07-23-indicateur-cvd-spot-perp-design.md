# Indicateur CVD spot vs perp — divergence de flux (design)

Date : 2026-07-23 · Statut : validé sur périmètre par Zaki (sélection AskUser), spec à relire.

## But

Livrer l'item ⭐ Tier 1 du catalogue maison (`docs/research/02-indicateurs-edge-crypto.md`) : un indicateur de **divergence entre le flux agresseur spot et le flux agresseur perp** du même sous-jacent. Lecture : spot qui achète pendant que le perp vend (ou l'inverse) = information de composition du mouvement (accumulation réelle vs levier), invisible dans un CVD simple.

## Non-buts

- Pas de refonte du contrat `IndicatorDef` (mono-symbole conservé) — la jambe perp arrive par série auxiliaire.
- Pas de multi-exchange : jambe perp = Binance USDT-M (fapi), cohérent avec le reste du repo.
- Pas de détection de « signaux » automatiques (alertes) dans ce lot — l'indicateur rend les séries et un histogramme de divergence, l'œil fait le reste.

## Données — nouvelle série auxiliaire `perpDelta`

`apps/web/src/chart/auxProvider.ts` :
- Nouvel `AuxSeriesId` : `perpDelta` (`packages/types`) — **delta agresseur perp par bougie**, en unités base.
- Source : `fapi/v1/klines` du perp de même base (résolution du symbole perp : même convention que les features existantes spot→perp du repo). Delta = `2 × takerBuyBaseVolume − volume` par bougie.
- **Fetché à l'interval du timeframe COURANT du chart** (un FLUX, pas un niveau : le LOCF d'`alignAux` fabriquerait un flux faux — delta horaire jeté en 1d, répété/cumulé en 1m). À interval identique l'alignement tombe 1:1 (mêmes openTime UTC klines spot/perp Binance). La clé de cache single-flight de `perpDelta` intègre donc le timeframe (les séries de niveaux gardent `(id, symbole)`). Timeframes AXIOM absents de fapi (sous-minute `1s/5s/15s`, agrégats client `3M/6M/12M`) → série vide.
- TTL cohérent avec les séries fapi existantes, single-flight.
- Dégradation : pas de perp pour la base, ou exchange ≠ binance → série vide (convention défensive existante, l'indicateur doit le tolérer).

## L'indicateur (`packages/indicators/src/orderflow/cvdSpotPerp.ts`)

- `id: "cvdSpotPerp"`, `category: "orderflow"`, `pane: "separate"`, `aux: ["perpDelta"]`.
- **Inputs** : `fenetre` (défaut 100, min 20, max 500) — fenêtre de rebase/normalisation ; `lissage` (défaut 3, EMA appliquée aux deltas avant cumul, 1 = brut).
- **Calcul** :
  - Delta spot par bougie = `buyVolume − sellVolume` (champs enrichis de `Candle` ; si absents → série spot vide).
  - CVD spot et CVD perp = cumuls des deltas lissés depuis la **première bougie chargée** (convention `cvd` existante du registre — le rebase suit le chargement, pas le viewport).
  - **Normalisation** (les volumes spot et perp ont des ordres de grandeur différents) : chaque CVD est divisé par l'écart-type roulant de ses propres deltas sur `fenetre` → les deux courbes deviennent comparables sans unité.
  - **Divergence** = `cvdSpotNorm − cvdPerpNorm`, rendue en histogramme signé (up quand le spot domine, down quand le perp domine).
- **Outputs** : `cvdSpot` (ligne, couleur up), `cvdPerp` (ligne, couleur down), `divergence` (histogramme, alpha réduit). Précision 2.
- **Dégradation** : `perpDelta` vide → `cvdPerp` et `divergence` vides (undefined), `cvdSpot` seul tracé — jamais de throw (modèle `fundingRate.ts`).

## Cas limites

- Bougies sans `buyVolume/sellVolume` (exchange sans données taker) → tout vide, pas de crash.
- Fenêtre > nb bougies → normalisation sur ce qui existe (min 20 points, sinon undefined).
- Écart-type nul (marché figé) → division gardée, points undefined.

## Tests / validation

- TDD (`cvdSpotPerp.test.ts`) : cumul/rebase corrects sur fixtures ; normalisation (×10 sur tous les volumes d'une jambe → mêmes courbes normalisées) ; divergence signée attendue sur un scénario spot-achète/perp-vend ; dégradations (aux vide, taker absents).
- Golden file si la convention du repo l'exige pour la catégorie.
- Enregistrement registry + entrée menu (catégorie Order Flow) ; `registry.test` compte mis à jour.
- Gate visuel : BTCUSDT — deux courbes lisibles, histogramme cohérent avec un mouvement connu ; symbole sans perp (paire exotique) → CVD spot seul.

## Contraintes

Français, moteur pur (aucun fetch dans le def), pattern d'ajout standard (fichier + test + registry), branche `feat/ind-cvd-spot-perp`.
