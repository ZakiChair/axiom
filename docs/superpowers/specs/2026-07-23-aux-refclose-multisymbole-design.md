# Série aux `refClose` & indicateurs multi-symbole (design)

Date : 2026-07-23 · Statut : périmètre validé par Zaki (AskUser), spec à relire. Lot v1.4, branche `feat/aux-refclose`.

## But

Débloquer le trou n°1 du registre — les indicateurs **cross-asset** (corrélation roulante, beta, spread z-score) — SANS toucher au contrat `calc(candles, params, ctx)`, en réutilisant le mécanisme de séries auxiliaires éprouvé par `perpDelta` : une série `refClose` porte le close d'un **symbole de référence** aligné sur les bougies du chart.

## Non-buts

- Pas de refonte du moteur ni du contrat `IndicatorDef`.
- Pas de sélecteur de référence par instance d'indicateur dans ce lot (voir « Référence » ci-dessous) — un réglage global suffit pour v1.
- Pas de cointégration/demi-vie (Engle-Granger…) — v2 si l'usage le demande.
- Référence = Binance uniquement (spot), cohérent avec l'archi fapi/aux existante.

## Données — série aux `refClose`

- `AuxSeriesId += "refClose"` (`packages/types`).
- **Symbole de référence** : nouveau champ persisté `refSymbol` (défaut `"BTCUSDT"`) dans le store de réglages approprié (regarder où vivent les réglages globaux persistés — settings store) + champ dans le panneau Réglages (« Symbole de référence (indicateurs croisés) », input texte patron watchlist).
- **Leçon flux/niveau du lot v1.2** : `refClose` est un NIVEAU → le LOCF d'`alignAux` est correct ici. MAIS le fetch doit être à l'interval du chart quand même (un close 1h forward-fillé sur du 1m fabrique des plateaux qui écrasent la corrélation) → même mécanique que `perpDelta` : fetch klines spot Binance à l'interval du chart, clé cache `(id, refSymbol, timeframe)`, pagination arrière 3×1500, `timeframeToFapiInterval` réutilisée (spot accepte les mêmes intervals ; vérifier l'URL klines spot existante de `data/binance.ts` et la réutiliser).
- Chart affichant le symbole de référence lui-même (BTCUSDT sur BTCUSDT) → la série est quand même servie (corrélation = 1, beta = 1 : honnête et attendu).
- Dégradation : refSymbol invalide/échec → série vide → outputs undefined, jamais de throw.

## Les trois indicateurs (`packages/indicators/src/statistical/`)

Catégorie : **nouvelle valeur d'enum `statistical`** ajoutée à `IndicatorCategory` (`packages/types`) + libellé « Statistiques » dans `IndicatorMenu` (ordre : après Volatilité). Décision assumée : `custom` existe mais est vide et sémantiquement faux pour des indicateurs standard ; l'ajout d'enum est le seul écart de types du lot, petit et exhaustivité TypeScript à l'appui.

1. **`rollingCorrelation`** — inputs `length` (défaut 50, 10-500), `source` (close par défaut). Corrélation de Pearson roulante entre les RENDEMENTS log du symbole courant et de la référence (corréler les prix bruts est un piège classique — les rendements sont bindants). Outputs : `corr` (ligne, [-1,1]) + repères constants `+1`/`0`/`-1` discrets. Undefined si fenêtre incomplète, si stdev nulle d'un côté, ou si refClose absent.
2. **`betaRef`** — mêmes inputs. Beta roulant = cov(r, rRef)/var(rRef) sur `length` rendements log. Output `beta` (ligne) + repère `1`. Mêmes gardes (var(rRef)=0 → undefined).
3. **`spreadZScore`** — inputs `length` (défaut 100). Spread = log(P) − log(PRef) (ratio log — insensible aux échelles) ; output `z` = z-score roulant du spread (stdev population, convention priceZScore) + bandes `+2`/`−2`. Lecture : divergence de la paire vs sa référence.

Tous : precision 2, pane separate, dégradation refClose absent → tout undefined sauf rien (pas de repli trompeur), commentaires français, TDD avec fixtures aux valeurs commentées (corrélation exacte sur séries construites : corr = 1 sur séries identiques, −1 sur opposées, 0 sur orthogonales ; beta = 2 sur rRef ×2 ; spread z borné).

## Enregistrement & UI

- Registry : 3 imports + 3 entrées zone `statistical` (compte 150 → 153, test registre du lot v1.3 mis à jour).
- Menu : libellé « Statistiques » ; rien d'autre.

## Cas limites

- Rendements : premier point undefined (pas de rendement) ; trous de refClose (bougie manquante) → rendement du trou undefined, fenêtres glissantes l'excluent (pas de 0 fantôme — même discipline que lisserDeltas).
- refSymbol == symbole courant : séries valides triviales (corr 1) — pas de garde spéciale.
- Timeframes non supportés fapi/spot : série vide (message via description du def, comme cvdSpotPerp).

## Tests / validation

TDD complet sur les 3 calcs + le mappage interval (réutilisé) ; test d'alignement (refClose décalé d'une bougie → corrélation dégradée mesurable — fige la sensibilité à l'alignement) ; gate visuel : ETHUSDT vs réf BTCUSDT en 1h (corr ~0.7-0.9 plausible, beta ~1, spread z oscillant), changement de refSymbol dans les réglages → recalcul.

## Contraintes

Français ; moteur pur (réseau dans auxProvider) ; `git -C` ; gates habituels.
