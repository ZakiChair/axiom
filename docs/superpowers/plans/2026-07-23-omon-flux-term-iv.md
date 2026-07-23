# OMON — Flux du jour, Term IV, Gamma flip — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bascule Volume dans la heatmap OI (+ ratio V/OI, notionnel $), 4ᵉ vue « Term IV » (IV ATM + RR25 par échéance), gamma flip et net GEX/DEX toutes échéances — zéro nouvelle source (spec `2026-07-23-omon-flux-term-iv-design.md`).

**Architecture:** Deux champs Deribit déjà présents dans le payload sont mappés dans `OptionPoint` ; toutes les nouvelles agrégations sont des fonctions pures testées (`oiHeatmap.ts`, nouveau `data/termIv.ts`, `gexDex.ts`) ; l'UI n'est que du câblage OptionsWindow (Segmente 4 vues, bascule métrique 3 options, métriques d'en-tête).

**Tech Stack:** TypeScript, canvas 2D, Black-Scholes existant, vitest.

## Global Constraints

- Commentaires en **français**. `nowMs` injecté dans toute fonction pure (jamais `Date.now()` dans la logique testée).
- Zéro nouveau fetch : uniquement le payload `get_book_summary_by_currency` déjà pollé 60 s + `fetchDvol` existant.
- Champs absents/illiquides → `NaN`, exclus des agrégations via `Number.isFinite` (convention repo).
- Canvas montés en permanence, masqués CSS quand la vue est inactive (convention OMON documentée).
- Couleurs par tokens au dessin (`lireTokenCanvas`/`rgbaTokenCanvas`), tooltips via `<InfobulleGraphe>`.
- Pas de nouvelle fenêtre ni mnémonique — registry.test inchangé.
- Branche : `feat/omon-flux-term-iv`. TDD strict. Gate : `pnpm test` vert + tsc.

**Modèles à lire AVANT d'implémenter :**
- `apps/web/src/data/deribit.ts` (DeribitOptionSummary :245-252, OptionPoint :230-243, parse :258-287, computeMaxPain :123)
- `apps/web/src/data/oiHeatmap.ts` (construireGrilleOi :53, CelluleOi/GrilleOi, intensiteCellule :139)
- `apps/web/src/data/gexDex.ts` (computeCryptoGexDex :96-113, aggregateGexDex :49 — convention à déléguer, ne pas recopier)
- `apps/web/src/data/skew.ts` (calculerSkew25d :67 — réutilisé par échéance)
- `apps/web/src/components/OptionsWindow.tsx` (Segmente vues :880, dessinerHeatmapOi :407, HEATMAP_PAD_*, métriques Smile :1043-1063, net GEX/DEX mono-échéance :744-745, canvases masqués, redraw effects)

---

### Task 1: Champs `volume24h` / `markPrice` — `data/deribit.ts`

**Files:**
- Modify: `apps/web/src/data/deribit.ts`
- Test: compléter `apps/web/src/data/deribit.test.ts` (s'il n'existe pas, le créer sur le modèle des tests data existants)

**Interfaces (Produces):** `OptionPoint` gagne `volume24h: number` et `markPrice: number` (NaN si champ absent/non fini). `DeribitOptionSummary` mappe `volume` et `mark_price`.

- [ ] **Step 1: Tests rouges** — le parseur de chaîne produit `volume24h`/`markPrice` depuis un summary fixture ; champ manquant ou non-numérique → NaN ; les champs existants (markIv, openInterest…) inchangés.
- [ ] **Step 2: Rouge** — `pnpm --filter @axiom/web test -- deribit`
- [ ] **Step 3-4: Implémenter → vert** (deux lignes de mapping + interface ; ne rien changer d'autre au fetch).
- [ ] **Step 5: Commit** — `feat(omon): mapper volume 24h et mark price du payload Deribit`

### Task 2: Volume dans la grille — `data/oiHeatmap.ts`

**Files:**
- Modify: `apps/web/src/data/oiHeatmap.ts`
- Test: compléter `apps/web/src/data/oiHeatmap.test.ts`

**Interfaces (Produces):** `CelluleOi` gagne `volume24h: number` (fusion call+put, NaN traités comme 0 à la somme) ; `GrilleOi` gagne `volumeMax: number` ; `construireGrilleOi` les remplit. Signature inchangée.

- [ ] **Step 1: Tests rouges** — fusion volume call+put par (échéance, strike) ; `volumeMax` correct ; points sans volume (NaN) → 0 ; tests existants inchangés.
- [ ] **Step 2-4: Rouge → implémentation → vert** — `pnpm --filter @axiom/web test -- oiHeatmap`
- [ ] **Step 5: Commit** — `feat(omon): volume 24h agrégé dans la grille strike×échéance`

### Task 3: Term structure IV — `data/termIv.ts` (nouveau, pur)

**Files:**
- Create: `apps/web/src/data/termIv.ts`
- Test: `apps/web/src/data/termIv.test.ts`

**Interfaces (Produces — consommées par Task 6):**
```ts
export interface PointTermIv { expiryMs: number; ivAtm: number; rr25: number | null; nbStrikes: number; }
export function termStructureIv(chain: OptionPoint[], spot: number, nowMs: number): PointTermIv[];
// échéances triées croissantes, expirées exclues (expiryMs <= nowMs) ;
// ivAtm = IV du strike le plus proche du spot (moyenne call/put si les deux existent, sinon celle dispo) ;
// rr25 via calculerSkew25d appliqué aux points de l'échéance (null si non calculable) ;
// point omis si aucune IV finie à l'ATM.
```

- [ ] **Step 1: Tests rouges** — fixtures multi-échéances (fabrique `pt(over)`) : tri, exclusion expirée, ATM le plus proche (au-dessus/au-dessous du spot), moyenne call/put vs un seul côté, rr25 délégué (comparaison directe avec `calculerSkew25d`), point omis si IV NaN partout, spot NaN → tableau vide.
- [ ] **Step 2-4: Rouge → implémentation → vert** — `pnpm --filter @axiom/web test -- termIv`
- [ ] **Step 5: Commit** — `feat(omon): term structure IV ATM et RR25 par échéance (pur)`

### Task 4: GEX toutes échéances + gamma flip — `data/gexDex.ts`

**Files:**
- Modify: `apps/web/src/data/gexDex.ts`
- Test: compléter `apps/web/src/data/gexDex.test.ts`

**Interfaces (Produces — consommées par Task 7):**
```ts
export function gexParStrikeToutesEcheances(chain: OptionPoint[], spot: number, nowMs: number): { strike: number; gex: number; dex: number }[];
// délègue à computeCryptoGexDex échéance par échéance puis fusionne par strike (somme) — même convention, pas de recopie ;
// strikes triés croissants.
export function gammaFlip(gexParStrike: { strike: number; gex: number }[]): number | null;
// cumul du gex en parcourant les strikes croissants ; renvoie le strike où le cumul change de signe
// (interpolation linéaire entre les deux strikes encadrants) ; null si aucun changement de signe.
```

- [ ] **Step 1: Tests rouges** — fusion multi-échéances = somme des `computeCryptoGexDex` par échéance (comparaison directe) ; `gammaFlip` : flip simple entre deux strikes (valeur interpolée vérifiée), aucun flip → null, plusieurs passages → premier, tableau vide → null.
- [ ] **Step 2-4: Rouge → implémentation → vert** — `pnpm --filter @axiom/web test -- gexDex`
- [ ] **Step 5: Commit** — `feat(omon): GEX/DEX toutes échéances et niveau de gamma flip (pur)`

### Task 5: UI — bascule Volume + métriques flux

**Files:**
- Modify: `apps/web/src/components/OptionsWindow.tsx`

**Interfaces:** Consumes Task 2 (`volume24h`/`volumeMax`), Task 1 (`markPrice`).

- [ ] **Step 1:** Sous-bascule métrique heatmap : `Segmente` 2 → 3 options (`OI | |GEX| | Volume`) ; métrique `volume` = rampe accent, `intensiteCellule(volume24h, volumeMax)`.
- [ ] **Step 2:** Tooltip heatmap enrichi (toutes métriques) : lignes `Vol 24h` et `V/OI` (ratio, « — » si OI 0) ; en métrique Volume, la valeur de prime de la cellule `OI × markPrice × spot` formatée `$` (« — » si markPrice NaN).
- [ ] **Step 3:** Métriques d'en-tête vue Smile : ajouter `P/C (Vol)` (ratio put/call sur volume 24 h — calcul inline sur `chain`, même patron que `putCallRatioOi`) et `Notionnel OI` = Σ(OI×spot) formaté compact `$`.
- [ ] **Step 4:** `pnpm --filter @axiom/web test` (non-régression) ; vérif visuelle déléguée au gate.
- [ ] **Step 5: Commit** — `feat(omon): métrique Volume dans la heatmap + P/C volume et notionnel OI`

### Task 6: UI — 4ᵉ vue « Term IV »

**Files:**
- Modify: `apps/web/src/components/OptionsWindow.tsx`

**Interfaces:** Consumes Task 3 (`termStructureIv`), `fetchDvol` existant (state DVOL déjà présent pour le repère).

- [ ] **Step 1:** `Segmente` de vue 3 → 4 (`Term IV`), state `vue` étendu ; canvas dédié monté en permanence masqué (convention exacte des canvases OMON existants).
- [ ] **Step 2:** `dessinerTermIv(canvas, points, dvol, survol)` : X ordinal = échéances (étiquettes courtes existantes), ligne IV ATM (accent) + ligne RR25 (up si ≥0, down sinon) sur échelle propre à droite ; ligne horizontale pointillée DVOL (libellée) ; annotation pente `contango IV` / `backwardation IV` (premier vs dernier point). DPR, tokens au dessin, constantes de padding partagées dessin/survol (leçon HEATMAP_PAD).
- [ ] **Step 3:** Survol → `<InfobulleGraphe>` : échéance, IV ATM, RR25, nb strikes. Redraw effect même patron que les autres vues (données/vue/thème).
- [ ] **Step 4:** `pnpm --filter @axiom/web test` ; vérif visuelle déléguée au gate.
- [ ] **Step 5: Commit** — `feat(omon): vue Term IV — courbe IV ATM et RR25 par échéance`

### Task 7: UI — gamma flip + net toutes échéances (vue GEX/DEX)

**Files:**
- Modify: `apps/web/src/components/OptionsWindow.tsx`

**Interfaces:** Consumes Task 4 (`gexParStrikeToutesEcheances`, `gammaFlip`).

- [ ] **Step 1:** Métriques d'en-tête GEX/DEX : `GEX net`/`DEX net` calculés sur TOUTES les échéances (libellé « (toutes éch.) ») via Task 4 ; l'histogramme reste piloté par la bascule d'échéance (inchangé). Nouvelle métrique `Gamma flip` (« — » si null).
- [ ] **Step 2:** Ligne verticale pointillée accent au niveau du flip sur l'histogramme quand il tombe dans la plage de strikes affichée (dessin dans `dessinerBarres` ou surcouche, au choix du goût local — même logique de projection que les barres).
- [ ] **Step 3:** `pnpm --filter @axiom/web test` ; vérif visuelle déléguée au gate.
- [ ] **Step 4: Commit** — `feat(omon): gamma flip et net GEX/DEX toutes échéances`

### Task 8: Gate final

- [ ] **Step 1:** `pnpm --filter @axiom/web test` complet vert (aucune régression OMON) ; `pnpm --filter @axiom/web typecheck` propre.
- [ ] **Step 2:** `pnpm test` racine vert.
- [ ] **Step 3:** Commit final si retouches, sinon rien. Vérif visuelle globale par le contrôleur (4 vues, BTC/ETH, 2 thèmes).
