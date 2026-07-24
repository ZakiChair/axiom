# Indicateurs — divergences & conformité source — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Détection auto de divergences prix ↔ oscillateur (RSI, CVD ; régulières + cachées) rendue en points sur le chart, + balayage de conformité de l'input `source`. Spec `2026-07-24-lot-v20-analyse-design.md` §C4 (périmètre RÉDUIT après audit — voir amendement de la spec).

**Architecture:** L'audit d'inventaire (étape 0 de la spec) est FAIT : AVWAP par clic, pivots sessionnés, VWAP session, throttle intra-bougie 500 ms, Volume Profile VPVR+VPFR, canal de régression ±kσ, règle de mesure et outil position sizing EXISTENT tous. Restent : (T1) test générique de conformité `source` ; (T2) helpers purs de divergence dans le package ; (T3) deux `IndicatorDef` (`rsiDivergence`, `cvdDivergence`) — rendu « points » via la machinerie existante, zéro code chart nouveau.

**Tech Stack:** TypeScript pur (package `@axiom/indicators`), vitest.

## Global Constraints

- Commentaires **français**. Branche : `feat/indicateurs-divergences`. `git -C ~/axiom` systématique. Gate : `pnpm test` racine + tsc verts + gate visuel contrôleur.
- Package PUR : aucun import app, calc synchrone full-array (patron engine).
- PAS de golden test pandas-ta pour les divergences (pas d'oracle) : fixtures construites à la main, valeurs vérifiées humainement.

**Modèles à lire AVANT d'implémenter :**
- `packages/types/src/index.ts:217-294` — `IndicatorDef/IndicatorInput/IndicatorOutput`, style `"points"`, `pane: "overlay"`.
- `packages/indicators/src/registry.ts` — import + ajout au tableau `INDICATORS` (sections par catégorie l.182-345).
- `packages/indicators/src/trend/sma.ts` — def canonique (input `source` respecté via `ctx.source`).
- `packages/indicators/src/orderflow/cvd.ts` — calcul CVD existant depuis `buyVolume/sellVolume` (réutiliser sa logique : si le cumul n'est pas exporté, l'extraire en helper `cvdOf(candles)` exporté par cvd.ts — modification chirurgicale, son def l'appelle).
- `packages/indicators/src/momentum/rsi.ts` — réutiliser le calcul RSI (même règle : extraire `rsiOf(source, length)` si nécessaire).
- `packages/indicators/src/engine.ts` — `computeIndicator` l.113 (lit `resolved.source`), `buildCalcContext` l.24.
- `apps/web/src/chart/indicators.ts:87-103` — mapping `PlotStyle` → figures (`points`→circle) : le rendu overlay des sorties « points » est automatique.

---

### Task 1: Test de conformité `source`

**Files:**
- Create: `packages/indicators/src/engine-source.test.ts`
- Modify: les defs non conformes révélés par le test (au moins vérifier ceux qui déclarent `source`)

- [ ] **Step 1: Test générique (rouge si non-conformité)** — pour CHAQUE def de `INDICATORS` déclarant un input `type: "source"` : `computeIndicator(def, fixture, { source: "hlc3" })` doit différer de `{ source: "close" }` sur au moins un point défini (fixture : 60 bougies synthétiques où high≠close). Assertion par def (test.each) avec message nommant le def fautif.
- [ ] **Step 2: Corriger les fautifs** — remplacer `closeOf(candles)` par `ctx.source` dans les calc concernés (changement chirurgical ; un def qui n'utilise PAS la source à dessein — ex. linreg, pivots OHLC — ne déclare pas l'input, donc n'est pas dans le test). Tests verts (dont goldens : les goldens utilisent la source par défaut `close`, inchangée).
- [ ] **Step 3:** `pnpm test` racine + tsc verts. **Step 4: Commit** — `test(indicators): conformité de l'input source (+ fixes des defs fautifs)`

### Task 2: Helpers purs de divergence

**Files:**
- Create: `packages/indicators/src/utils-divergence.ts` — Test: `packages/indicators/src/utils-divergence.test.ts`

**Interfaces (Produces):**
```ts
export interface Pivot { idx: number; kind: "high" | "low" }
/** Pivot fractal : extremum strict sur `gauche` barres avant et `droite` après (les `droite` dernières barres n'ont pas de pivot — pas de repaint rétroactif silencieux). */
export function detecterPivots(valeurs: ReadonlyArray<number | undefined>, gauche: number, droite: number): Pivot[];
export type TypeDivergence = "haussiere" | "baissiere" | "haussiere-cachee" | "baissiere-cachee";
export interface Divergence { idxFrom: number; idxTo: number; type: TypeDivergence }
/** Compare les 2 derniers pivots de même genre (lows pour haussières, highs pour baissières) :
 *  régulière = prix LL & osc HL (hauss.) / prix HH & osc LH (baiss.) ;
 *  cachée   = prix HL & osc LL (hauss.) / prix LH & osc HH (baiss.).
 *  Pivots appariés prix↔osc par proximité d'index (±3 barres) ; écart max `maxEcart` barres entre les 2 pivots. */
export function detecterDivergences(prix: ReadonlyArray<number>, osc: ReadonlyArray<number | undefined>, opts: { gauche: number; droite: number; maxEcart: number }): Divergence[];
```

- [ ] **Step 1: Tests rouges** — `detecterPivots` : série en dents de scie → pivots aux sommets/creux attendus (indices exacts) ; plateau (égalité) → pas de pivot (strict) ; les `droite` derniers indices jamais pivot. `detecterDivergences` : 4 fixtures construites (une par `TypeDivergence`, ~40 points chacune, commentées) → divergence détectée avec idxFrom/idxTo exacts ; fixture prix et osc corrélés → `[]` ; pivots trop écartés (> maxEcart) → `[]` ; pivots prix/osc décalés de 2 barres → appariés quand même.
- [ ] **Step 2: Implémentation.** Tests verts.
- [ ] **Step 3:** `pnpm test` racine + tsc verts. **Step 4: Commit** — `feat(indicators): détection pure de pivots et divergences prix/oscillateur`

### Task 3: Defs `rsiDivergence` + `cvdDivergence`

**Files:**
- Create: `packages/indicators/src/momentum/rsiDivergence.ts` (+ `.test.ts`), `packages/indicators/src/orderflow/cvdDivergence.ts` (+ `.test.ts`)
- Modify: `packages/indicators/src/registry.ts` (2 ajouts), `packages/indicators/src/momentum/rsi.ts` et `orderflow/cvd.ts` (export des helpers `rsiOf`/`cvdOf` si non exportés)

**Interfaces (Consumes):** Task 2 `detecterDivergences` ; `rsiOf`, `cvdOf`.

- [ ] **Step 1: Tests rouges** — sur fixture construite (prix + volumes acheteurs/vendeurs façonnés pour produire une divergence RSI haussière connue) : la série `divHauss` porte le PRIX au `idxTo` de la divergence, `undefined` ailleurs ; idem baissière ; params par défaut documentés.
- [ ] **Step 2: Defs** — communs : `pane: "overlay"`, inputs `{ gauche: 5, droite: 5, maxEcart: 60 }` (+ `length: 14` et `source` pour RSI), 4 outputs style `"points"` : `divHauss` (couleur `--up`), `divBaiss` (`--down`), `divHaussCachee`, `divBaissCachee` (mêmes teintes, points plus petits si le style le permet — sinon même rendu, décision consignée). Valeur du point = prix (high pour baissières, low pour haussières) à `idxTo`. `rsiDivergence` : osc = `rsiOf(ctx.source, length)` ; `cvdDivergence` : osc = `cvdOf(candles)` (bougies sans buy/sell → série undefined → aucun point, dégradation propre). Catégories : momentum / orderflow. Tests verts.
- [ ] **Step 3: Registre** — imports + ajout aux sections momentum et orderflow de `INDICATORS`. `pnpm test` racine + tsc verts (registry.test vérifie l'unicité des ids).
- [ ] **Step 4: Gate visuel (contrôleur)** — BTCUSDT 1h : ajouter « RSI Divergence » via le menu indicateurs → points posés sur des creux/sommets visuellement divergents (vérifier 2-3 cas au zoom) ; « CVD Divergence » sur une source AVEC buy/sell (binance) → points ; sur une source SANS (twelvedata) → aucun point, pas d'erreur console ; édition des params (gauche/droite) recalcule.
- [ ] **Step 5: Commit** — `feat(indicators): divergences RSI et CVD (régulières + cachées) en points overlay`
