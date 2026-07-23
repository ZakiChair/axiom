# Heatmap OI strike × échéance + max pain (OMON) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 3e vue « Heatmap OI » dans OMON : grille échéances (X) × strikes (Y), couleur = OI ou |GEX| (bascule), ligne max pain par échéance, ligne du spot, tooltip par cellule. Zéro fetch supplémentaire.

**Architecture:** Généralisation multi-échéances des agrégations existantes (`agregerParStrike`, `computeMaxPain`, `computeCryptoGexDex`) dans un module pur `data/oiHeatmap.ts`, rendu canvas impératif calqué sur `dessinerBarres` d'OptionsWindow, intégré comme 3e option du `Segmente` de vue.

**Tech Stack:** TypeScript, canvas 2D, Black-Scholes existant (`data/blackScholes.ts`), vitest.

## Global Constraints

- Commentaires en **français**.
- Zéro nouveau fetch : réutiliser le state `chain` (`OptionPoint[]`) déjà chargé/pollé 60 s par OMON.
- Canvas monté en permanence, masqué en CSS quand la vue n'est pas active (contrainte `useDomaineZoom` documentée `OptionsWindow.tsx:721-726`) — même si la heatmap n'utilise pas le zoom, suivre la convention de montage.
- Couleurs par tokens au moment du dessin (`lireTokenCanvas`), tooltip via `<InfobulleGraphe>`.
- `nowMs` injecté dans toute fonction pure qui en a besoin (convention `skew.ts`) — jamais `Date.now()` dans la logique testée.
- Pas de nouvelle fenêtre ni de nouveau mnémonique (vue interne d'OMON) — registry.test inchangé.
- Branche : `feat/omon-heatmap-oi`. TDD. Gate : `pnpm test` vert.

**Modèles à lire AVANT d'implémenter :**
- `apps/web/src/components/OptionsWindow.tsx` (Segmente de vue :631-638, dessinerBarres :283-381, agregerParStrike :87-96, echeancesDispo :74-84, redraw effect :589-600, survol/tooltip :602-622, canvases masqués :721-726)
- `apps/web/src/data/deribit.ts` (OptionPoint :230-243, computeMaxPain :123, StrikeOi)
- `apps/web/src/data/gexDex.ts` (computeCryptoGexDex :96-113, aggregateGexDex :49)
- `apps/web/src/lib/canvasTokens.ts`, `apps/web/src/lib/domaineAxe.ts`

---

### Task 1: Agrégations pures multi-échéances — `data/oiHeatmap.ts`

**Files:**
- Create: `apps/web/src/data/oiHeatmap.ts`
- Test: `apps/web/src/data/oiHeatmap.test.ts`

**Interfaces (Produces — consommées par Task 2):**
```ts
export interface CelluleOi { expiryMs: number; strike: number; callOi: number; putOi: number;
  oiTotal: number; gex: number; }
export interface GrilleOi { echeances: number[]; strikes: number[]; cellules: CelluleOi[];
  maxPainParEcheance: Map<number, number>; oiMax: number; gexAbsMax: number; }
export function construireGrilleOi(chain: OptionPoint[], spot: number, nowMs: number): GrilleOi;
  // groupe par expiryMs (echeancesDispo) puis par strike ; OI fusion calls/puts ;
  // gex par cellule via bsGreeks (mêmes conventions que computeCryptoGexDex) ;
  // maxPain par échéance via computeMaxPain(agregerParStrike(pointsEcheance))
export function bandeStrikes(strikes: number[], spot: number, maxLignes?: number): number[];
  // strikes affichés : ceux à OI non nul dans ±40 % du spot, plafonné à maxLignes (defaut 40)
  // centré sur le spot ; si tout est hors bande, replier sur les plus proches du spot
export function intensiteCellule(v: number, vMax: number): number; // [0,1] log, 0 si vMax<=0
```

- [ ] **Step 1: Tests rouges** avec fixtures multi-échéances (fabrique `pt(over: Partial<OptionPoint>)`) :
  - `construireGrilleOi` : fusion call+put par (échéance, strike) ; strikes sans OI exclus des cellules ; échéances triées ; `oiMax`/`gexAbsMax` corrects ; `maxPainParEcheance` cohérent avec `computeMaxPain` appliqué échéance par échéance (comparer directement).
  - `bandeStrikes` : filtre ±40 %, plafond maxLignes (garde les plus proches du spot), repli si bande vide.
  - `intensiteCellule` : 0→0, vMax→1, monotone, vMax<=0→0.
- [ ] **Step 2: Rouge** — `pnpm --filter @axiom/web test -- oiHeatmap`
- [ ] **Step 3-4: Implémenter → vert** (réutiliser `parseOptionInstrument` non nécessaire — `chain` est déjà parsée ; importer `computeMaxPain`, `bsGreeks`, et reprendre la convention GEX de `gexDex.ts:96-113`).
- [ ] **Step 5: Commit** — `feat(omon): agrégation OI/GEX strike×échéance et max pain multi-échéances`

### Task 2: Vue heatmap dans OptionsWindow

**Files:**
- Modify: `apps/web/src/components/OptionsWindow.tsx`

**Interfaces:**
- Consumes: `construireGrilleOi`, `bandeStrikes`, `intensiteCellule` (Task 1) ; state `chain`, `spot`, `echeancesDispo` existants.

- [ ] **Step 1: Ajouter la vue** — `Segmente` de vue : 3e option `{ id: "heatmap", label: "Heatmap OI" }` (state `vue` étendu) ; sous-bascule métrique locale `oi` ↔ `gex` (`Segmente` 2 options, state dédié).
- [ ] **Step 2: `dessinerHeatmapOi(canvas, grille, bande, metrique, spot, survol)`** calqué sur `dessinerBarres` : DPR, `clearRect`, padding, X ordinal = échéances (étiquettes format court existant), Y = `bandeStrikes` (ordonné décroissant, spot au milieu) ; cellule = `fillRect` teinté par `intensiteCellule` (métrique `oi` : rampe neutre→`--accent` via `rgbaTokenCanvas` ; métrique `gex` : signe → `--up`/`--down`, intensité = |gex|) ; marqueur ◆ max pain par colonne (couleur `--accent`) ; ligne horizontale du spot en pointillé.
- [ ] **Step 3: Survol** — `onMouseMove` inverse la géométrie (colonne/ligne depuis les pixels), état survol → `<InfobulleGraphe>` : échéance, strike, OI calls / OI puts, GEX, max pain de l'échéance. Canvas ajouté au JSX **monté en permanence, masqué si `vue !== "heatmap"`** (même patron que les canvases existants :721-726).
- [ ] **Step 4: Redraw effect** — même `useEffect` piloté par données/vue/thème/métrique que :589-600.
- [ ] **Step 5: Vérif visuelle** `pnpm run up` → OMON → Heatmap OI (BTC puis ETH, bascule OI/GEX, tooltip, thème clair/sombre).
- [ ] **Step 6: Commit** — `feat(omon): vue Heatmap OI strike×échéance avec max pain et spot`

### Task 3: Gate final

- [ ] **Step 1:** `pnpm --filter @axiom/web test` complet vert (dont les tests OMON existants — la vue smile/gexdex ne doit pas régresser).
- [ ] **Step 2:** `pnpm test` racine vert.
- [ ] **Step 3: Commit final** si retouches, sinon rien.
