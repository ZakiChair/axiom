# Lot v2.1 — Divergences visuelles (canal d'annotations + 8 indicateurs)

Date : 2026-07-27 · Registre indicateurs : 155 → 160 · Origine : demande Zaki
(« indicateurs plus visuels sur le graphique : divergences spot/futures,
divergences RSI, etc. — initiative pour les autres »). Design validé en
brainstorming (rendu « segments + labels + tooltip », architecture « canal
d'annotations générique »).

**Constat fondateur** : AXIOM détecte déjà les divergences (`utils-divergence.ts`,
defs `rsiDivergence`/`cvdDivergence`) mais les rend en simples points — le pont
générique (`apps/web/src/chart/indicators.ts:96-102`) ne dessine que
`line`/`bar`/`circle`, et une figure KLineChart ne voit que ±1 barre
(`prev/current/next`), donc AUCUN segment pivot→pivot n'est possible sans
`draw`. Le patron `draw` custom est déjà prouvé en prod (triangles CVD
spot/perp, `apps/web/src/chart/orderflow.ts:175-208`). Ce lot ne crée pas un
N-ième détecteur : il donne un CANAL DE RENDU aux détections existantes.

Invariants BUILD-CONTRACT : calculs PURS dans `packages/indicators` (les
annotations sont calculées dans le `calc`, testables sans navigateur) ;
rendu app-side uniquement sur patrons prouvés (`draw` façon orderflow.ts,
overlays façon WHALE/ECO) ; couleurs = tokens CSS résolus AU RENDU via
`lireTokenCanvas`/`rgbaTokenCanvas` (jamais au montage) ; dégradation
gracieuse (aux absent → séries `undefined`, zéro annotation, zéro throw) ;
zéro nouvelle source de données (aux `mark` et `perpDelta` existants) ; zéro
nouvelle fenêtre ; commentaires FR ; `pnpm check` vert par branche.

Branches (C1 fondation d'abord, puis C2/C3/C4 parallélisables) :
`feat/canal-annotations` → `feat/divergences-oscillateurs` ∥
`feat/cvd-spotperp-annotations` ∥ `feat/premium-spotperp`.
Conflits attendus : `registry.ts` (ajouts de defs, résolution triviale),
`packages/types/src/index.ts` si C3/C4 touchent les types (ils ne DOIVENT pas —
tous les types d'annotation sont posés par C1).

---

## 1. C1 — Canal d'annotations (fondation, bloquant)

### 1.1 Types (`packages/types/src/index.ts`)

`IndicatorResult` gagne un champ optionnel `annotations?: AnnotationsIndicateur`.
Tous les index (`idx`) sont des index de bougie dans le tableau `candles` passé
au `calc` — le pont convertit en timestamp/pixel au rendu.

```ts
type CibleAnnotation = "prix" | "pane";        // chart maître ou pane propre
type TraitAnnotation = "plein" | "pointille";  // plein = régulière, pointillé = cachée

interface SegmentAnnotation {
  deIdx: number; deValeur: number;   // pivot de départ (idx bougie, valeur dans l'échelle de la cible)
  aIdx: number;  aValeur: number;    // pivot d'arrivée
  trait: TraitAnnotation;
  couleur: string;                   // token CSS, ex. "--up" (résolu au rendu)
  cible: CibleAnnotation;
  info?: string;                     // texte du tooltip, généré dans le calc
}

interface MarqueurAnnotation {
  idx: number; valeur: number;
  forme: "triangleHaut" | "triangleBas";
  couleur: string; cible: CibleAnnotation; info?: string;
}

interface LabelAnnotation {
  idx: number; valeur: number;
  texte: string;                     // ex. "Div ▼"
  couleur: string; cible: CibleAnnotation; info?: string;
}

interface RubanAnnotation {
  deIdx: number;                     // index de la 1re bougie du run
  hauts: number[]; bas: number[];    // bornes du remplissage, alignées depuis deIdx
  couleur: string; alpha: number;    // ex. "--up", 0.15
  cible: "prix";                     // le ruban n'a de sens que sur le chart maître
  info?: string;
}

interface AnnotationsIndicateur {
  segments?: SegmentAnnotation[];
  marqueurs?: MarqueurAnnotation[];
  labels?: LabelAnnotation[];
  rubans?: RubanAnnotation[];
}
```

Règles : `couleur` est TOUJOURS un nom de token (`"--up"`, `"--down"`,
`"--accent"`, `"--serie-N"`), jamais un hex — le rendu résout par thème.
`info` est du texte brut FR (pas de HTML). Un def sans annotations reste
strictement identique à avant : le champ est optionnel de bout en bout.

### 1.2 Moteur commun (`packages/indicators/src/utils-annotations.ts`)

`construireAnnotationsDivergence(candles, osc, opts)` : s'appuie sur
`detecterPivots`/`detecterDivergences` EXISTANTS (`utils-divergence.ts`, aucun
changement de détection, `ECART_APPARIEMENT = 3` reste une constante).
Pour chaque `Divergence {idxFrom, idxTo, type}` produit :

- 1 segment cible `"prix"` reliant les pivots sur le prix (haussières →
  ancrage sur les `low`, baissières → sur les `high`, règle déjà appliquée par
  `placerPointsDivergence`) ;
- 1 segment cible `"pane"` reliant les MÊMES index sur `osc` ;
- 1 label cible `"prix"` au pivot d'arrivée : `"Div ▲"` (haussières, `--up`)
  ou `"Div ▼"` (baissières, `--down`). Les cachées n'ont PAS de label dédié
  (anti-encombrement) : elles se lisent au pointillé et au tooltip ;
- `trait` : `"plein"` pour régulières, `"pointille"` pour cachées ;
- `info` : phrase FR complète, ex. « Divergence baissière régulière — prix
  67 250 → 68 100 (plus haut plus haut) vs oscillateur 71,4 → 63,2 (plus haut
  plus bas) ». Nombres formatés avec la précision du def.

Option `cachees: boolean` (défaut `true`) : à `false`, les divergences cachées
ne produisent AUCUNE annotation.

### 1.3 Fabrique (`packages/indicators/src/utils-fabrique-divergence.ts`)

`defDivergenceOscillateur({ id, name, category, oscillateur, inputsOsc,
serieOsc, precision })` → `IndicatorDef` complet :

- `pane: "separate"` ; output principal = la courbe de l'oscillateur
  (`style: "line"`) ;
- inputs communs ajoutés d'office : `gauche` (déf. 5, min 1), `droite`
  (déf. 5, min 1), `maxEcart` (déf. 60, min 5, max 300), `cachees`
  (boolean, déf. `true`) ;
- `calc` : calcule l'oscillateur via `oscillateur(candles, params, ctx)`,
  puis `construireAnnotationsDivergence` ; dégradation : oscillateur vide
  → séries `undefined`, pas d'annotations.

### 1.4 Rendu pane propre (`apps/web/src/chart/indicators.ts`)

Le template d'`ensureRegistered` gagne un `draw` (patron `orderflow.ts:175`) :

- lit `indicator.extendData.annotations`, filtre `cible === "pane"` ;
- segments : `ctx.setLineDash([4,4])` si `pointille` ; marqueurs : triangles
  (même géométrie que orderflow.ts) ; labels : texte + fond `rgbaTokenCanvas`
  (surface, 0.85) ;
- ne dessine que ce qui intersecte `visibleRange` ; `return false` (les
  figures séries se dessinent par-dessus, comportement prod existant) ;
- `createTooltipDataSource` : si le crosshair est à ≤ 3 barres du pivot
  d'arrivée d'une annotation porteuse d'`info`, ajoute une légende avec ce
  texte.

Un def sans annotations traverse ce `draw` en no-op — aucun impact sur les
152 defs existants.

### 1.5 Rendu chart maître (`apps/web/src/chart/annotationsPrix.ts`, nouveau)

Patron WHALE/ECO : `registerOverlay("axiomAnnotation")` UNIQUE (module-scope,
idempotent) dont `createPointFigures` rend, selon `extendData.genre` :
segment (`line` 2 points + dash), label (`text`), marqueur (`polygon`
triangle), ruban (`polygon` fermé : points `hauts` aller + `bas` retour,
`alpha` en fill). `lock: true`, `needDefaultPointFigure: false`, points
ancrés `{timestamp, value}`.

Contrôleur `AnnotationsPrixController` (câblé dans `ChartInstance.tsx` comme
les contrôleurs existants) :

- à chaque `overrideIndicator` (extendData neuf), rejeu : `removeOverlay` des
  ids suivis de l'instance puis recréation (patron `ecoMarkers.ts:119`) ;
- caps : 150 annotations par instance, les plus récentes d'abord ; rubans :
  40 runs max ; throttle 500 ms (constante partagée existante) ;
- tooltip : `onMouseEnter`/`onMouseLeave` d'overlay → div flottante unique
  (tokens `--surface`/`--border`/`--text`), positionnée près du curseur,
  masquée au leave ; aucun tooltip si `info` absent ;
- cleanup : suppression d'instance → `removeOverlay` de ses ids ; démontage
  chart → tout retirer.

### 1.6 Anti-repaint

Garantie héritée : `detecterPivots` ne confirme un pivot qu'après `droite`
barres. Aucune annotation ne peut donc apparaître puis disparaître sur la
dernière bougie. Aucun mécanisme nouveau à inventer — le documenter dans le
docblock du moteur.

---

## 2. C2 — Divergences oscillateurs (upgrades + 4 nouveaux)

Tout passe par la fabrique §1.3. Cœurs d'oscillateur : RÉUTILISER les cœurs
exportés existants (`rsiOf` l'est déjà, `rsi.ts:32`) ; si un cœur (MACD,
Stoch, OBV, MFI) n'est pas exporté séparément de son def, l'EXTRAIRE d'abord
(patron `rsiOf`) sans changer le def d'origine — refactor chirurgical, tests
existants inchangés.

| Def | Statut | Catégorie | Oscillateur | Inputs propres (défauts) |
|---|---|---|---|---|
| `rsiDivergence` v2 | upgrade | momentum | `rsiOf(source, length)` | `length` 14, `source` close |
| `cvdDivergence` v2 | upgrade | orderflow | `cvdOf(candles)` | — |
| `macdDivergence` | nouveau | momentum | ligne MACD ou histogramme | `rapide` 12, `lent` 26, `signal` 9, `oscSource` select ["ligne","histogramme"] déf. "ligne" |
| `stochDivergence` | nouveau | momentum | %K lissé | `longueurK` 14, `lissageK` 3 |
| `obvDivergence` | nouveau | volume | OBV | — |
| `mfiDivergence` | nouveau | volume | MFI | `length` 14 |

Points d'attention :

- **Changement de pane des upgrades** : `rsiDivergence`/`cvdDivergence`
  passent d'`overlay` (points) à `separate` (courbe + segments). Vérifier que
  le pane est résolu depuis la def à la création d'instance (pas persisté) ;
  si le pane est persisté, migration à la lecture (une ligne). Les 4 sorties
  « points » historiques sont REMPLACÉES par : 1 sortie courbe + annotations.
- `engine-source.test.ts` : `POINT_VALUE_INVARIANTS` contient `rsiDivergence`
  (`:90`, `:160`) — à retirer/adapter puisque le def ne pose plus de points.
- Les annotations cible `"prix"` de ces defs `pane: "separate"` sont rendues
  par le contrôleur §1.5 — c'est PRÉCISÉMENT le cas d'usage qui impose les
  deux canaux.

---

## 3. C3 — `cvdSpotPerp` v2 (marqueurs de divergence spot/perp)

Le def (`packages/indicators/src/orderflow/cvdSpotPerp.ts`) GARDE ses 3 séries
(cvdSpot, cvdPerp, divergence histogramme) et son contrat aux `perpDelta`
inchangé. Il gagne des annotations :

- **Détection** : port PUR de `detectCvdDivergences`
  (`apps/web/src/chart/cvdSpotPerp.ts:55-91` — mismatch de signe sur
  `Δ lookback`, filtre médiane anti-bruit, garde zéro-delta symétrique) vers
  `packages/indicators`, avec ses constantes actuelles comme défauts
  (`lookback` = input existant `fenetre`) et tests à la main. Le module
  app-side WS (triangles live du toggle orderflow) N'EST PAS touché — les deux
  coexistent comme aujourd'hui, REST/def d'un côté, WS/toggle de l'autre.
- **Rendu** : marqueurs cible `"pane"` — `triangleHaut` `--up` quand le spot
  achète pendant que le perp vend (accumulation spot), `triangleBas` `--down`
  à l'inverse. `info` : « Spot acheteur vs perp vendeur sur N bougies —
  z(spot) +1,2 / z(perp) −0,8 ». Pas d'annotations cible `"prix"` (le signal
  est un flux, pas un niveau — il vit dans son pane).

---

## 4. C4 — `premiumSpotPerp` (ruban de prime sur le chart maître)

Nouveau def, catégorie `derivatives`, `pane: "overlay"`, `aux: ["mark"]`
(chemin existant de `basisPct` — mark price 1 h fixe, LOCF, Binance USDT-M).

- **Sortie série** : `mark` (`style: "line"`) — la ligne mark price du perp
  sur l'échelle du prix. C'est elle qui rend le ruban lisible (on voit QUI
  est au-dessus).
- **Annotations** : rubans entre `close` spot et `mark` sur chaque run
  contigu où `|prime| ≥ seuilPct`, avec `prime = (mark − close) / close × 100`.
  Couleur `--up` si prime > 0 (perp au-dessus, contango), `--down` sinon
  (discount), `alpha` 0.15. `info` : « Prime perp moyenne +0,12 % sur 14
  bougies (max +0,31 %) ».
- **Inputs** : `seuilPct` (déf. 0,05, min 0, max 5). Le défaut 0,05 % est une
  HYPOTHÈSE à calibrer au gate visuel (règle SQZ : consigner le calibrage) —
  en marché calme la prime perp vit sous ±0,05 %, le ruban doit apparaître
  sur les phases directionnelles, pas en permanence.
- **Honnêteté d'affichage** : `mark` étant un niveau horaire LOCF, sous H1 le
  ruban est en marches d'escalier — assumé, même situation que `basisPct` ;
  aucun `minTimeframe` nouveau. Aux absent → ligne et ruban absents,
  libellé « (indisponible) » standard du pont.

---

## 5. Tests, gates, hors-scope

**Tests** (conventions du repo : valeurs attendues DÉRIVÉES À LA MAIN dans le
docblock, helper `candlesFromCloses`, co-localisation) :

- `utils-annotations.test.ts` : géométrie des segments (idx/valeurs exacts sur
  séquence construite avec divergence connue), bascule `cachees`, textes `info` ;
- fabrique : un def généré expose bien inputs communs + propres, dégradation
  oscillateur vide ;
- 1 test par def (les 4 nouveaux + les 2 upgrades re-dérivés) ; port
  `detectCvdDivergences` : mêmes cas que le module app-side d'origine ;
- `premiumSpotPerp` : runs/couleurs/prime moyenne sur aux `mark` synthétique ;
- `registry.test.ts` : 155 → 160 ; `engine-source.test.ts` :
  `POINT_VALUE_INVARIANTS` mis à jour (§2) ;
- pont : `vi.mock("klinecharts")`, vérifier création/rejeu/cleanup des
  overlays et le no-op des defs sans annotations ;
- gate visuel in-page par branche (vérification via DOM/`getImageData`, pas de
  screenshot MCP — leçon v1.4) + gate `pnpm check` post-merge (leçon v1.8 :
  jamais le sauter).

**Hors-scope (frigo)** : alertes sur divergence ; jambe perp non-Binance ;
`ECART_APPARIEMENT` paramétrable ; refonte du détecteur du screener
(`data/signaux.ts`) ; divergences prix/OI (l'aux Open Interest historique
n'existe pas — nouvelle source, autre lot) ; tooltip riche (mini-graphe).
