# Lot v2.2 — Menu « Stratégies » + stratégies à points d'entrée/sortie

Date : 2026-07-28 · Registre indicateurs : 160 → 167 · Origine : demande Zaki
(« ajouter ces indicateurs qui correspondent à des stratégies dans un nouveau
menu : strategy, et ajoute également des stratégies qui affichent les points
d'entrées et de sortie sur le graphique »). Design validé en brainstorming
(approche « fabrique defStrategie », catalogue complet, déplacement des 8 defs
v2.1 dans la nouvelle catégorie).

**Constat fondateur** : le canal d'annotations du lot v2.1 rend déjà marqueurs,
labels, segments et tooltips sur le chart maître pour un def `pane: "overlay"`
(prouvé en prod par les rubans de `premiumSpotPerp` — même fonction
`dessinerAnnotationsPane`, branches marqueurs/labels identiques). Une stratégie
= un `IndicatorDef` comme un autre : elle hérite gratuitement du menu, des
params éditables, du multi-instances, de la persistance, de la palette ⌘K
(les mots-clés incluent `def.category`) et du grisage `minTimeframe`.

**Contrainte structurante** : `@axiom/backtest` dépend d'`@axiom/indicators` —
une stratégie-indicateur ne peut PAS importer le moteur de backtest (cycle).
Les stratégies chart sont AUTONOMES (fonctions d'état pures sur les cœurs
existants). Le pont vers le builder BT est au frigo.

Invariants BUILD-CONTRACT : calculs PURS dans `packages/indicators` ;
annotations calculées dans le `calc` ; couleurs = tokens CSS résolus au rendu ;
dégradation gracieuse ; commentaires FR ; `pnpm check` vert par branche ;
fixtures de test PROUVÉES non vides (leçon v2.1 : une rampe linéaire ne produit
aucun pivot ni croisement — fixtures en V/zigzag vérifiées empiriquement avant
d'être figées).

---

## 1. Catégorie « Stratégies » et menu

- `IndicatorCategory` gagne `"strategy"` (`packages/types/src/index.ts` —
  amendement d'orchestrateur du type figé, comme `annotations` en v2.1).
- `registry.test.ts` : `VALID_CATEGORIES` + `"strategy"`.
- `IndicatorMenu.tsx` : `CATEGORY_LABELS.strategy = "Stratégies"` et
  `CATEGORY_ORDER` avec `strategy` en PREMIÈRE position (avant `orderflow`).
  Rappel mécanique : un id absent de `CATEGORY_ORDER` rend la catégorie
  invisible (le menu itère sur l'ordre, pas sur les clés).
- **Déplacement des 8 defs v2.1** → `category: "strategy"` : `rsiDivergence`,
  `cvdDivergence`, `macdDivergence`, `stochDivergence`, `obvDivergence`,
  `mfiDivergence` (6 via le param `category` de leur spec de fabrique),
  `cvdSpotPerp`, `premiumSpotPerp` (une ligne chacun). Aucun autre code ne
  dépend des catégories de ces defs (vérifié : seuls le menu et la palette les
  consomment, dynamiquement).
- Rien d'autre à câbler : palette ⌘K, persistance et grisage TF suivent.

## 2. Fabrique `defStrategie` (`packages/indicators/src/utils-fabrique-strategie.ts`)

### 2.1 Contrat

```ts
interface SpecStrategie {
  id: string;
  name: string;                       // ex. "Stratégie croisement MM"
  inputsStrategie: IndicatorInput[];  // inputs propres, AVANT les communs
  precision?: number;
  minTimeframe?: Timeframe;
  /** État de position DÉSIRÉ par bougie, décidé à la CLÔTURE de la bougie i :
   *  1 = long, -1 = short, 0 = flat, undefined = données insuffisantes
   *  (warm-up). PURE, même longueur que candles. */
  position: (
    candles: Candle[],
    params: Record<string, number | boolean | string>,
    ctx: CalcContext
  ) => Array<1 | 0 | -1 | undefined>;
  /** Textes FR des tooltips, résolus avec les params effectifs. */
  libelles: (params: Record<string, number | boolean | string>) => {
    long: string;    // ex. "croisement EMA 9 > EMA 21"
    short: string;
    sortie: string;  // ex. "croisement inverse"
  };
}
function defStrategie(spec: SpecStrategie): IndicatorDef
```

Le def généré : `category: "strategy"`, `pane: "overlay"`, input commun
`lignesTrades` (boolean, défaut `true`) ajouté APRÈS `inputsStrategie`.

### 2.2 Sortie série — JAMAIS de −1/0/+1 en overlay

Sortie unique `prixEntree` (`style: "line"`, échelle prix) : le prix d'entrée
du trade en cours, répété sur chaque bougie en position, `undefined` à plat.
Une série −1/0/+1 sur le pane prix écraserait l'auto-scale de l'axe
(`calcRange` inclut les figures de tout indicateur du pane prix — piège
documenté du pont). La ligne de prix d'entrée est, elle, à l'échelle ET
utile (niveau de breakeven visuel).

### 2.3 Événements et annotations (dérivés des TRANSITIONS de `position`)

Pour chaque transition entre bougies clôturées (voir 2.4) :

- **flat→long** : marqueur `triangleHaut` `--up`, `valeur = low` de la bougie
  de signal, cible `"prix"`, `info = "Entrée long <close> — <libelles.long>"` ;
- **flat→short** : `triangleBas` `--down` au `high`,
  `info = "Entrée short <close> — <libelles.short>"` ;
- **long→flat / short→flat** : label texte `"+2,45 %"` / `"−1,10 %"`
  (`fmtSigne`, couleur `--up` si PnL ≥ 0 sinon `--down`), `position` opposée au
  sens (au-dessus du high pour une sortie de long, sous le low pour un short),
  `info = "Sortie <sens> <close> (<pnl %>) — <libelles.sortie>"` ;
- **retournement (long→short, short→long)** : label de sortie + marqueur
  d'entrée du nouveau sens, sur la MÊME bougie ;
- **segment de trade** (si `lignesTrades`) : `deIdx` = bougie d'entrée,
  `aIdx` = bougie de sortie, `deValeur`/`aValeur` = close d'entrée/de sortie,
  `trait: "pointille"`, couleur par signe du PnL, `info` récapitulatif
  (« Long 67 250 → 68 900, +2,45 % en 14 bougies — <libelles.long> »).

PnL % = `(sortie − entrée) / entrée × 100 × (long ? 1 : −1)` — **hors frais**
(documenté dans le docblock et dans l'info du segment : « hors frais »).
Prix d'entrée/sortie = **close de la bougie de signal** (décision à la clôture ;
le moteur de backtest, lui, remplit à l'open de la bougie suivante — écart
assumé, documenté dans le docblock de la fabrique).

**Cap** : `MAX_TRADES_ANNOTES = 60` — seuls les 60 derniers trades clos portent
segments + labels (les marqueurs d'entrée suivent le même cap) ; patron
`MAX_RUBANS` de `premiumSpotPerp`. Le trade EN COURS est toujours annoté
(marqueur d'entrée + ligne `prixEntree`).

### 2.4 Anti-repaint

Aucun événement (marqueur/label/segment) n'est émis pour une transition
impliquant la DERNIÈRE bougie du tableau (potentiellement en formation en
live) : les transitions sont évaluées sur `i ∈ [1, n−2]`. La série
`prixEntree` couvre en revanche tout le tableau (elle peut fluctuer sur la
bougie en formation, comme toute série d'indicateur — comportement standard).

### 2.5 Dégradation

`position` renvoie `undefined` pendant le warm-up → aucune transition, aucune
annotation, série `undefined`. `undefined` au MILIEU de la série (trou de
données) : traité comme « maintien de l'état précédent » (pas de
sortie fantôme sur un trou). **Le premier état DÉFINI après le warm-up ne
génère AUCUN événement** (il matérialise silencieusement l'état : sinon chaque
stratégie « entrerait » artificiellement à la fin de son warm-up ; le premier
marqueur ne peut venir que d'une transition entre deux états définis).
Annotations omises du résultat quand vides (convention v2.1).

## 3. Catalogue — 7 stratégies (~30 lignes de spec chacune)

Toutes via `defStrategie`, cœurs existants (`ema`, `sma`, `rsiOf`, `macdOf`,
`rollingHighest`, `rollingLowest`, `stdev`) sauf mention. Ids préfixés `strat`.

| Def | Nom | Sens | Inputs (défauts) | Règle `position` |
|---|---|---|---|---|
| `stratCroisementMM` | Stratégie croisement MM | long/short | `type` select ["ema","sma"] déf. "ema", `rapide` 9 (min 1), `lente` 21 (min 2) | signe(MM rapide − MM lente) ; undefined tant qu'une MM manque |
| `stratRsiReversion` | Stratégie RSI réversion | long/flat | `length` 14, `survente` 30 (min 1, max 50), `surachat` 70 (min 50, max 99) | entrée quand RSI croise `survente` À LA HAUSSE (RSI[i−1] < s ≤ RSI[i]) ; sortie quand RSI[i] ≥ `surachat` |
| `stratMacdCross` | Stratégie croisement MACD | long/short | `fast` 12, `slow` 26, `signal` 9, `source` | signe(ligne MACD − signal) |
| `stratSupertrend` | Stratégie Supertrend | long/short | `atrLength` 10 (min 1), `mult` 3 (min 0.5) | direction du Supertrend (+1/−1) — **extraire le cœur `supertrendOf` de `trend/supertrend.ts`** (refactor pur, patron v2.1 Task 5, tests existants inchangés) |
| `stratDonchian` | Stratégie Donchian | long/short | `canal` 20 (min 2) | close > plus-haut des `canal` bougies PRÉCÉDENTES (bougie courante exclue) → 1 ; close < plus-bas → −1 ; sinon MAINTIEN de l'état précédent (stateful, warm-up undefined) |
| `stratBollingerReversion` | Stratégie Bollinger réversion | long/short | `length` 20, `mult` 2 (min 0.1) | entrée long quand close RE-franchit la bande basse à la hausse (close[i−1] < bb ≤ close[i]) ; short miroir sur bande haute ; sortie quand close atteint la SMA (croisement de la moyenne) |
| `stratDivergenceRsi` | Stratégie divergence RSI | long/short | `length` 14, `gauche` 5, `droite` 5, `maxEcart` 60, `seuilSortie` 70 (min 50, max 99) | entrée long à `idxTo + droite` d'une divergence haussière RÉGULIÈRE (la bougie de CONFIRMATION du pivot — jamais au pivot lui-même, anti-look-ahead strict) ; sortie RSI ≥ seuilSortie ; short miroir (divergence baissière, sortie RSI ≤ 100 − seuilSortie) ; réutilise `detecterDivergences` |

Précisions transverses :
- `stratDonchian` : « plus-haut des N précédentes » = `rollingHighest` décalé
  d'une bougie (la bougie courante ne participe pas à son propre canal, sinon
  le breakout est indétectable).
- `stratDivergenceRsi` : les divergences CACHÉES ne déclenchent PAS d'entrée
  (les régulières seulement — c'est une stratégie de retournement).
- Chaque `libelles()` produit des textes FR chiffrés avec les params effectifs
  (ex. « croisement EMA 9 > EMA 21 », « RSI 14 sort de survente (30) »).

## 4. Tests, gates, hors-scope

**Tests** (conventions v2.1 : dérivation à la main dans le docblock, fixtures
prouvées, gardes anti-tautologie) :
- fabrique : transitions (entrée/sortie/retournement/maintien sur undefined),
  PnL signé exact, cap 60, AUCUN événement sur la dernière bougie, série
  `prixEntree` (répétée en position, undefined à plat), dégradation warm-up ;
- 1 test par stratégie : contrat (id/pane/category/ordre inputs avec
  `lignesTrades` en dernier) + fixture construite produisant AU MOINS un
  aller-retour complet vérifié à la main (entrée, sortie, PnL, segment) ;
- `stratSupertrend` : le refactor `supertrendOf` prouvé par les tests existants
  inchangés (dont golden pandas-ta) ;
- `registry.test.ts` : 160 → 167 ; catégories : les 15 defs `strategy`
  (7 nouveaux + 8 déplacés) ;
- menu : la section « Stratégies » apparaît en premier (test existant du menu
  s'il y en a un, sinon gate visuel) ;
- gate visuel in-page : marqueurs/labels/segments lisibles sur BTCUSDT 1h,
  tooltips crosshair, thèmes, section menu en tête, palette ⌘K trouve
  « strat », édition de params (rapide 9→50 : les signaux se recalculent),
  suppression propre.

**Hors-scope (frigo)** : bouton « Backtester » pré-remplissant le builder BT
avec les règles équivalentes ; alimentation PAPER/EXPY depuis une stratégie ;
alertes sur signal de stratégie ; stops/targets/trailing dans les stratégies
chart (le PnL affiché est règle-à-règle, hors frais) ; sens long-only/short-only
configurable.
