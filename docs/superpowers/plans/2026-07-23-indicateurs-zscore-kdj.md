# Indicateurs priceZScore & KDJ — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deux quick wins standard : z-score de prix générique et KDJ — spec `2026-07-23-indicateurs-zscore-kdj-design.md`.

**Architecture:** Deux `IndicatorDef` purs suivant le pattern d'ajout canonique (fichier + test + entrée registry), aucun aux, aucune UI spécifique (le menu liste par catégorie automatiquement).

**Tech Stack:** TypeScript, moteur indicateurs pur, vitest.

## Global Constraints

- Commentaires en **français**. Moteur pur — aucun fetch/DOM.
- undefined tant que la fenêtre est incomplète ; jamais de NaN dans les séries de sortie.
- Branche : `feat/ind-zscore-kdj`. TDD. Gate : `pnpm test` racine vert + tsc.

**Modèles à lire AVANT d'implémenter :**
- `packages/types/src/index.ts` (IndicatorDef :256-278, IndicatorInput — types number|source)
- `packages/indicators/src/trend/sma.ts` (input `source` câblé sur `ctx.source` — modèle minimal)
- Un def momentum existant avec seed récursif (chercher `smma` ou `stochastic` pour la convention de seed/récurrence)
- `packages/indicators/src/registry.ts` (:174-330, zone par catégorie)
- Commit modèle : `31bbee4` (fichier + test + registry)

---

### Task 1: `priceZScore`

**Files:**
- Create: `packages/indicators/src/volatility/priceZScore.ts`
- Test: `packages/indicators/src/volatility/priceZScore.test.ts`

**Interfaces (Produces):**
```ts
export const priceZScore: IndicatorDef;
// id "priceZScore", category "volatility", pane "separate", precision 2
// inputs : length (défaut 100, min 10, max 500) ; source (défaut close, ctx.source)
// outputs : z (line, accent) ; hi (line pointillée, valeur constante +2, token up) ; lo (idem −2, token down)
// calc : z[i] = (src[i] − SMA(src,length)[i]) / stdev(src,length)[i]
//   stdev population sur la fenêtre ; undefined si fenêtre incomplète ou stdev == 0
```

- [ ] **Step 1: Tests rouges** — fixture linéaire simple avec valeurs attendues calculées en commentaire ; fenêtre incomplète → undefined ; série constante (stdev 0) → undefined ; source hl2 respectée ; bandes = +2/−2 constantes alignées.
- [ ] **Step 2: Rouge** — `pnpm --filter @axiom/indicators test -- priceZScore`
- [ ] **Step 3-4: Implémenter → vert.**
- [ ] **Step 5: Commit** — `feat(indicators): priceZScore — z-score de prix générique`

### Task 2: `kdj`

**Files:**
- Create: `packages/indicators/src/momentum/kdj.ts`
- Test: `packages/indicators/src/momentum/kdj.test.ts`

**Interfaces (Produces):**
```ts
export const kdj: IndicatorDef;
// id "kdj", category "momentum", pane "separate", precision 2
// inputs : length (défaut 9, min 2, max 100) ; signalK (défaut 3, min 1, max 20) ; signalD (défaut 3, min 1, max 20)
// outputs : k (line, accent), d (line, down), j (line, up)
// calc : RSV[i] = 100 × (close[i] − LL(length)[i]) / (HH(length)[i] − LL(length)[i])
//   HH==LL → RSV undefined, K et D conservent leur valeur précédente
//   K[i] = ((signalK−1)·K[i−1] + RSV[i]) / signalK   (seed K[premier] = 50)
//   D[i] = ((signalD−1)·D[i−1] + K[i]) / signalD     (seed D[premier] = 50)
//   J[i] = 3·K[i] − 2·D[i]  — NE PAS clamper J (il déborde 0-100 par nature)
```

- [ ] **Step 1: Tests rouges** — fixture courte avec K/D/J attendus calculés à la main en commentaire (défauts 9/3/3) ; seeds à 50 ; bougie plate (HH==LL) → RSV undefined et K/D reconduits ; J = 3K−2D vérifié point à point ; fenêtre incomplète → undefined.
- [ ] **Step 2: Rouge** — `pnpm --filter @axiom/indicators test -- kdj`
- [ ] **Step 3-4: Implémenter → vert.**
- [ ] **Step 5: Commit** — `feat(indicators): kdj — oscillateur K/D/J standard`

### Task 3: Enregistrement + gate

**Files:**
- Modify: `packages/indicators/src/registry.ts` (2 imports + 2 entrées, zones volatility et momentum)
- Modify: le test de compte du registre s'il asserte un nombre en dur

- [ ] **Step 1:** Imports + entrées ; compte mis à jour si asserté.
- [ ] **Step 2:** `pnpm --filter @axiom/indicators test` complet vert ; `pnpm test` racine vert ; `pnpm typecheck` propre.
- [ ] **Step 3: Commit** — `feat(indicators): enregistrement priceZScore et kdj`
- [ ] **Step 4:** Vérif visuelle contrôleur au gate : les deux panes s'affichent sur BTCUSDT, params modifiables, deux thèmes.
