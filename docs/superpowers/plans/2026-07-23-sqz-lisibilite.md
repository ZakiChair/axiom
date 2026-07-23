# SQZ lisibilité — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refonte lisibilité complète du radar SQZ (zone neutre, axes gradués, 5 couleurs, échelle robuste, panneau Top candidats par score, pont vers EQS) — spec `2026-07-23-lot-v15-lisibilite-presets-design.md` §1.

**Architecture:** Toute la géométrie/statistique nouvelle est PURE dans `squeezeWindow.util.ts` (T1), le canvas la consomme (T2), le panneau latéral et le pont EQS sont du React fin (T3).

**Tech Stack:** TypeScript, canvas 2D, vitest.

## Global Constraints

- Commentaires **français**. Tokens au dessin : carburant-squeeze `--up`, longs-crowded `--down`, shorts-crowded `--accent`, deleveraging `--serie-3`, neutre `--text-dim` alpha fill ~0.25 (replis hex comme l'existant). `git -C` systématique.
- Le hit-testing (survol/clic) et le dessin partagent la MÊME projection (projRef existant) — toute nouvelle géométrie doit préserver cet invariant.
- Pont EQS : `loadPreset("builtin:long-potentiel"/"builtin:short-potentiel")` + `openScreener()` + `run()` du screenerStore ; preset ABSENT du registre → ouvrir sans charger (garde silencieuse, branche presets peut ne pas être mergée).
- Branche : `feat/sqz-lisibilite`. TDD sur T1. Gate : `pnpm test` racine + tsc verts + gate visuel (contrôleur).

**Modèles à lire AVANT d'implémenter :**
- `apps/web/src/components/SqueezeWindow.tsx` (302 l. — structure actuelle complète) et `squeezeWindow.util.ts` (`domaineAxes`, `projeterEnPixels`, `placerLabels`)
- `apps/web/src/data/squeeze.ts` (seuils SEUIL_FUNDING_PCT/SEUIL_DOI_PCT, `PointRadar`, `rayonPoint`)
- `apps/web/src/store/screener.ts` (`loadPreset`/`openScreener`/`run`) pour le pont

---

### Task 1: Logique pure — domaine robuste, score, ticks

**Files:**
- Modify: `apps/web/src/components/squeezeWindow.util.ts`
- Test: `apps/web/src/components/squeezeWindow.util.test.ts` (extension)

**Interfaces (Produces — consommé par T2/T3):**
```ts
export function quantile(valeurs: readonly number[], q: number): number | undefined;
// interpolation linéaire, valeurs non finies exclues, [] → undefined
export function domaineAxesRobuste(points: readonly CoordRadar[]): DomaineAxes;
// par axe : borne = max(|q2%|, |q98%|) symétrisée autour de 0, plancher 2× le seuil
// de neutralité de l'axe (SEUIL_FUNDING_PCT / SEUIL_DOI_PCT importés de data/squeeze) ;
// remplace domaineAxes pour le rendu (l'ancienne reste si utilisée ailleurs, sinon remplacée).
export function scoreSqueeze(p: { fundingPct: number; dOiPct: number; quadrant: QuadrantSqueeze }, d: DomaineAxes): number;
// 0 si quadrant "neutre" ; sinon √((f/bF)² + (oi/bOi)²) avec f/oi CLAMPÉS aux bornes → max √2.
export function genTicks(min: number, max: number, n: number): number[];
// 4-6 valeurs « rondes » (pas 1/2/5×10^k) couvrant [min, max], 0 inclus si dans l'intervalle.
export function estEcrete(p: CoordRadar, d: DomaineAxes): boolean; // hors domaine sur au moins un axe
```

- [ ] **Step 1: Tests rouges** — quantile (interpolation exacte sur fixture, exclusion NaN) ; domaine robuste (outlier ×100 n'étire pas la borne au-delà de q98, plancher 2× seuils sur nuage calme) ; score (neutre → 0, coin → √2, clamp hors domaine) ; ticks (pas ronds, 0 inclus, bornes couvertes) ; estEcrete.
- [ ] **Step 2-4: Rouge → implémentation → vert** — `pnpm --filter @axiom/web test -- squeezeWindow`
- [ ] **Step 5: Commit** — `feat(sqz): domaine winsorisé, score d'intensité et ticks (purs)`

### Task 2: Canvas — zone neutre, axes, couleurs, écrêtage, labels top-score

**Files:**
- Modify: `apps/web/src/components/SqueezeWindow.tsx`

- [ ] **Step 1:** Zone neutre : rect `[−SEUIL_FUNDING, +SEUIL_FUNDING]×[−SEUIL_DOI, +SEUIL_DOI]` projeté via `projeterEnPixels` (mêmes coins que les bulles), fill token dim alpha 0.06, libellé « neutre » centré 9px dim.
- [ ] **Step 2:** Axes : ticks `genTicks` sur chaque axe (valeurs formatées formatPct, 9px dim, X sous le cadre / Y à gauche), libellés « funding %/8 h » et « ΔOI % » aux extrémités. Domaine = `domaineAxesRobuste`.
- [ ] **Step 3:** Couleurs : mapping 5 quadrants des Global Constraints ; points écrêtés (`estEcrete`) plaqués au bord par le clamp de projection + anneau (2ᵉ cercle r+2.5, mêmes token/alpha trait) ; légende sous le canvas (5 pastilles+libellés, composant React fin, 10px).
- [ ] **Step 4:** Étiquettes canvas : top 8 par `scoreSqueeze` (au lieu du volume), anti-collision `placerLabels` conservé.
- [ ] **Step 5:** Suite web + tsc verts. **Step 6: Commit** — `feat(sqz): canvas lisible — zone neutre, axes gradués, 5 couleurs, écrêtage`

### Task 3: Panneau Top candidats + pont EQS + gate

**Files:**
- Modify: `apps/web/src/components/SqueezeWindow.tsx`

- [ ] **Step 1:** Panneau droit ~190 px (flex, masqué si largeur conteneur < 520 px via ResizeObserver existant ou mesure du conteneur) : groupes « Carburant squeeze » (top 5 score>0), « Longs crowded » (top 5), « Autres » (top 3 restants, si non vides). Ligne : symbole (font-medium) + funding/ΔOI teintés (formatPct) + barre de score (div, largeur ∝ score/√2, token du quadrant). Clic ligne → `navigateTo` (même payload que le clic bulle).
- [ ] **Step 2:** Pont EQS : les étiquettes de coin « Carburant squeeze » et « Longs crowded » du CANVAS deviennent des zones cliquables (hit-test rectangle du texte mesuré, curseur pointer au survol, `title` via attribut du canvas impossible → infobulle native non requise, souligner le libellé au survol) → `loadPreset` + `openScreener` + `run` avec garde preset-absent. Les libellés cliquables passent en token du quadrant (au lieu de dim) pour signaler l'affordance.
- [ ] **Step 3:** `pnpm test` racine + tsc verts. **Step 4: Commit** — `feat(sqz): panneau top candidats par score + pont vers le screener`

Gate visuel (contrôleur) : zone neutre + ticks visibles, 5 couleurs distinctes + légende, outlier plaqué avec anneau (vraie valeur dans l'infobulle), panneau classé cohérent avec le nuage, clic ligne → chart, clic coin → EQS ouvert avec preset chargé et run lancé, repli du panneau < 520 px.
