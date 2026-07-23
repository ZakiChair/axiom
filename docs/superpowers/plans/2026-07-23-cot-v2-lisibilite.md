# COT v2 — Lisibilité — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** COT Index (percentile 3 ans), sparklines 52 sem, barres net/OI normalisées, delta 4 sem, primitives UI — spec `2026-07-23-cot-v2-lisibilite-design.md`.

**Architecture:** Le fetch Socrata existant est approfondi (3 ans, `$limit 3000`, `$where` borné) ; la synthèse conserve la série complète par instrument ; tous les nouveaux calculs sont des fonctions pures testées dans `data/cot.ts` ; `CotWindow.tsx` recompose la ligne instrument (sparkline SVG + badge + barre normalisée) et migre vers `ErreurBloc`/`Chargement`/`NoteSource`.

**Tech Stack:** TypeScript, SVG inline (sparkline), vitest.

## Global Constraints

- Commentaires en **français**. Même dataset Socrata Legacy `6dca-aqww`, mêmes 14 instruments, mêmes 5 champs `$select` — AUCUN champ ni instrument ajouté.
- Dégradation gracieuse partout : échec réseau → repli cache ; `QuotaExceededError` localStorage → pas de cache, pas d'exception ; champ vide → NaN exclu (convention `nombreCot`).
- Badge percentile : `null` (affiché « — ») si < 26 semaines d'historique.
- Couleurs par tokens (`text-up`/`text-down`/`text-text-dim`…), primitives UI du repo.
- Branche : `feat/cot-v2-lisibilite`. TDD. Gate : `pnpm test` vert + tsc.

**Modèles à lire AVANT d'implémenter :**
- `apps/web/src/data/cot.ts` (fetch/$select :224-238, cache :215-217, synthèse 2-rapports :191-199, `nombreCot` :122-129, watchlist :85-105)
- `apps/web/src/data/cot.test.ts` (fixtures existantes)
- `apps/web/src/components/CotWindow.tsx` (Ligne :92-118, BarreNet :75-89, sections :182-196, états ad hoc :172-178, note :198-204)
- `apps/web/src/components/ui.tsx` (chercher `ErreurBloc`, `Chargement`, `NoteSource` — props réelles)
- Audit : `docs/superpowers/audits/2026-07-16-revue-ui-v2-annexe.md:189,194` (dettes à résorber ici)

---

### Task 1: Fetch profond + synthèse série complète — `data/cot.ts`

**Files:**
- Modify: `apps/web/src/data/cot.ts`
- Test: adapter `apps/web/src/data/cot.test.ts`

**Interfaces (Produces — consommées par Tasks 2-3):**
```ts
export interface PointCot { t: number; net: number; oi: number; }   // t = report_date en ms
export interface SyntheseCot { /* champs actuels conservés */ serie: PointCot[]; } // chrono croissant
// $limit 3000 ; $where report_date >= (nowMs − 3 ans) — nowMs INJECTÉ (pas de Date.now() dans la logique testée) ;
// cache clé "axiom:cot:cache:v2", TTL 12 h inchangé ; setItem enveloppé try/catch (quota → pas de cache).
```

- [ ] **Step 1: Tests rouges** — la synthèse conserve la série complète triée chrono (fixtures multi-instruments entrelacés, ordre DESC de l'API → série ASC) ; net/oi par point ; lignes à champ vide exclues ; les champs de synthèse actuels (net courant, delta 1 sem, oi) restent corrects.
- [ ] **Step 2-4: Rouge → implémentation → vert** — `pnpm --filter @axiom/web test -- cot`
- [ ] **Step 5:** Vérifier le repli quota : `setItem` en try/catch silencieux (commentaire POURQUOI).
- [ ] **Step 6: Commit** — `feat(cot): historique 3 ans conservé en série par instrument (cache v2)`

### Task 2: Calculs purs — COT Index, deltas, net/OI

**Files:**
- Modify: `apps/web/src/data/cot.ts`
- Test: compléter `apps/web/src/data/cot.test.ts`

**Interfaces (Produces — consommées par Task 3):**
```ts
export function cotIndex(serie: PointCot[], fenetreSem?: number): number | null;
// percentile-rank (0-100) du net du DERNIER point dans la fenêtre des `fenetreSem` (défaut 156) derniers points ;
// null si serie.length < 26 ; série constante → 50.
export function deltaSemaines(serie: PointCot[], n: number): number | null; // net[dernier] − net[dernier−n], null si trop court
export function netSurOi(net: number, oi: number): number | null;           // net/oi × 100, null si !(oi > 0)
```

- [ ] **Step 1: Tests rouges** — `cotIndex` : dernier = max fenêtre → 100, = min → 0, série constante → 50, < 26 points → null, fenêtre plus grande que la série → toute la série ; `deltaSemaines` (1 et 4, série courte → null) ; `netSurOi` (négatif, oi 0 → null).
- [ ] **Step 2-4: Rouge → implémentation → vert.**
- [ ] **Step 5: Commit** — `feat(cot): COT Index percentile, delta n semaines, net/OI (purs)`

### Task 3: UI — ligne recomposée + primitives

**Files:**
- Modify: `apps/web/src/components/CotWindow.tsx`

**Interfaces:** Consumes Task 1 (`serie`), Task 2 (`cotIndex`, `deltaSemaines`, `netSurOi`).

- [ ] **Step 1: Sparkline** — composant local `SparklineNet({ serie })` : SVG inline ~90×16, 52 derniers points, polyline `stroke` couleur `text-dim` (via `currentColor`), trait horizontal discret au zéro, point final marqué (cercle 1.5px teinté up/down selon signe du net). Pas d'axe, pas d'interaction.
- [ ] **Step 2: Badge COT Index** — `p{n}` arrondi ; classe `text-up` si ≥ 80, `text-down` si ≤ 20, `text-text-dim` sinon ; « — » si null. Largeur fixe pour alignement colonne.
- [ ] **Step 3: Barre normalisée** — `BarreNet` passe à l'échelle net/OI % : échelle fixe commune ±50 % (largeur = `min(|netSurOi|, 50)/50 × 50%`), graduations discrètes à ±25 % (2 traits 1px `border-border`) ; « — » (pas de barre) si netSurOi null. Le net absolu et le delta hebdo texte restent inchangés.
- [ ] **Step 4: Delta 4 sem** — `title` natif sur la ligne : `Δ4sem : {valeur formatée}` (+ net exact et OI). Pas d'infobulle custom.
- [ ] **Step 5: Primitives** — remplacer les états chargement/erreur ad hoc (:172-178) par `Chargement`/`ErreurBloc`, et la note de bas (:198-204) par `NoteSource` (texte : source CFTC + « COT Index = percentile du net spéculatif sur 3 ans »).
- [ ] **Step 6:** `pnpm --filter @axiom/web test` (non-régression) ; vérif visuelle déléguée au gate.
- [ ] **Step 7: Commit** — `feat(cot): sparklines, badge COT Index, barres net/OI normalisées, primitives UI`

### Task 4: Gate final

- [ ] **Step 1:** `pnpm --filter @axiom/web test` complet vert ; `pnpm --filter @axiom/web typecheck` propre.
- [ ] **Step 2:** `pnpm test` racine vert.
- [ ] **Step 3:** Commit final si retouches. Vérif visuelle contrôleur : 14 lignes, deux thèmes, largeur 520 px sans débordement, badges extrêmes teintés, sparklines cohérentes avec les deltas.
