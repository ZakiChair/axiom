# OMON — Flux du jour, Term structure IV, Gamma flip (design)

Date : 2026-07-23 · Statut : validé sur périmètre par Zaki (sélection AskUser), spec à relire.

## But

Trois enrichissements de l'analyse d'options, à **zéro nouvelle source** (tout vient du payload Deribit déjà pollé 60 s par OMON, ou de calculs locaux) :

1. **Flux du jour** : distinguer le flux (volume 24 h) du stock (OI) par strike, et valoriser les positions en dollars.
2. **Term structure d'IV** : courbe IV ATM par échéance — comble le trou entre DVOL (30 j unique) et le smile (mono-échéance).
3. **Gamma flip** : niveau de spot où le GEX net **toutes échéances** change de signe, et net GEX/DEX agrégés toutes échéances.

## Non-buts

- Pas de greeks serveur (`public/ticker` par instrument — écarté, 1 appel/instrument).
- Pas de bid/ask (spread/liquidité par strike) dans ce lot — matière notée pour plus tard.
- Pas de VEX (vega exposure) dans ce lot.
- Pas de nouvelle fenêtre ni de nouveau mnémonique : tout vit dans OMON.

## Données

`data/deribit.ts` : étendre `DeribitOptionSummary` et `OptionPoint` de deux champs déjà présents dans le payload `get_book_summary_by_currency` mais jamais mappés :
- `volume` (volume 24 h en unités base) → `OptionPoint.volume24h: number` (NaN si absent).
- `mark_price` (prix de l'option en base) → `OptionPoint.markPrice: number` (NaN si absent).

Aucun autre appel, aucune fréquence modifiée.

## Design

### 1. Flux du jour

- **Heatmap OI** : la sous-bascule métrique passe de 2 à 3 options — `OI | |GEX| | Volume`. Métrique `volume` : intensité log du volume 24 h par cellule (rampe accent, comme OI). Tooltip enrichi partout : `Vol 24h` et ratio `V/OI` de la cellule.
- **Agrégations** (`data/oiHeatmap.ts`) : `CelluleOi` gagne `volume24h` (fusion call+put) ; `GrilleOi` gagne `volumeMax`.
- **Métriques d'en-tête (vue Smile)** : ajouter `P/C (Vol)` (put/call ratio sur volume 24 h, à côté du P/C OI existant) et `Notionnel OI` = Σ(OI × spot) formaté `$`. La valeur de prime (OI × mark × spot) est affichée dans le tooltip de la heatmap, pas en en-tête (YAGNI).

### 2. Term structure d'IV

- **4ᵉ vue OMON** : `Segmente` passe à 4 options — `Smile | GEX/DEX | Heatmap OI | Term IV`. Canvas monté en permanence masqué CSS (convention OMON).
- **Calcul pur** (`data/oiHeatmap.ts` ou nouveau `data/termIv.ts`) : `termStructureIv(chain, spot, nowMs)` → par échéance : `ivAtm` (IV du strike le plus proche du spot, moyenne call/put quand les deux existent) et `rr25` (réutilise `calculerSkew25d` par échéance). Échéances expirées exclues (convention `echeancesDispo`).
- **Rendu** : X = échéances (étiquettes courtes existantes), deux séries — ligne IV ATM (accent) et ligne RR25 (up/down selon signe) sur axe secondaire ou pane bas ; repère horizontal DVOL (même horizon 30 j, pour ancrage visuel). Tooltip par échéance : IV ATM, RR25, nb strikes. Contango/backwardation d'IV annoté (pente premier→dernier point).

### 3. Gamma flip + net toutes échéances

- **Calcul pur** : `gexParStrikeToutesEcheances(chain, spot, nowMs)` (réutilise la convention `computeCryptoGexDex` par délégation, fusion par strike) ; `gammaFlip(gexParStrike)` = strike où le **cumul** du GEX net (parcours strikes croissants) change de signe — méthode retail standard ; `null` si pas de changement de signe.
- **Vue GEX/DEX** : les métriques d'en-tête `GEX net` / `DEX net` deviennent **toutes échéances** (libellé explicite « toutes éch. ») ; la bascule d'échéance continue de piloter l'histogramme seul. Nouvelle métrique `Gamma flip` + **ligne verticale pointillée** au niveau du flip sur l'histogramme (couleur accent) quand il est dans la plage affichée.
- **Heatmap OI** : en métrique |GEX|, le ◆ max pain reste ; pas de surcharge supplémentaire (YAGNI).

## Cas limites

- `volume`/`mark_price` absents (instrument illiquide) → NaN, exclus des agrégations (convention `Number.isFinite` du repo).
- Chaîne vide / spot NaN → mêmes replis que la heatmap actuelle (message vide, pas de crash).
- Échéance sans strike ATM exploitable (IV NaN) → point omis de la courbe.
- Gamma flip inexistant (GEX de même signe partout) → métrique « — », pas de ligne.

## Tests / validation

- TDD sur toutes les fonctions pures : `termStructureIv` (ATM le plus proche, moyenne call/put, échéances triées), `gexParStrikeToutesEcheances` (cohérence avec `computeCryptoGexDex` sommé par échéance — comparaison directe), `gammaFlip` (flip simple, aucun flip, flip multiple → premier passage), volume dans `construireGrilleOi` (fusion, volumeMax).
- Non-régression : tests OMON existants inchangés ; `registry.test` inchangé (pas de mnémonique).
- Gate visuel : 4 vues + bascule Volume + ligne flip + tooltips, BTC et ETH, deux thèmes.

## Contraintes

Français, tokens couleur au dessin, `nowMs` injecté, zéro fetch nouveau, canvas montés en permanence, branche `feat/omon-flux-term-iv`.
