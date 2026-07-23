# Lisibilité NETLIQ + CBPREM — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Habillage lisibilité des fenêtres NETLIQ (overlay BTC, grille, étiquettes) et CBPREM (bandes ±2σ, moyenne 7 j, étiquettes, z au survol) — spec `2026-07-23-lot-v15-lisibilite-presets-design.md` §4.

**Architecture:** Deux tâches indépendantes, une par fenêtre. Aucune nouvelle source (overlay BTC = fetch klines Binance existant). Helpers d'axes/dates dupliqués localement si aucun module commun n'existe (PAS de nouveau module partagé pour 2 fenêtres).

**Tech Stack:** TypeScript, canvas 2D, vitest.

## Global Constraints

- Commentaires **français**. Tokens au dessin ; paddings partagés dessin/survol (invariant existant des deux fenêtres — le préserver). `git -C` systématique.
- Dégradation : échec du fetch BTC → overlay absent SILENCIEUSEMENT (le cœur NETLIQ n'en dépend pas) ; série CBPREM trop courte pour σ (< 30 points) → bandes non dessinées.
- Branche : `chore/lisibilite-netliq-cbprem`. TDD sur toute logique pure extraite (ticks Md$, normalisation overlay, z du point). Gate : `pnpm test` racine + tsc verts + gate visuel (contrôleur).

**Modèles à lire AVANT d'implémenter :**
- `apps/web/src/components/NetliqWindow.tsx` + `CbpremWindow.tsx` (structure canvas/paddings/tooltip actuelles — les modifications s'y greffent)
- `apps/web/src/data/binance.ts` (`binanceAdapter.fetchKlines(sym, "1d", { limit })` — 730 points en 1 appel, cf. store cbprem)
- `apps/web/src/data/cbprem.ts` (`statsPremium` — moyenne/z existants) et `data/netliq.ts` (`PointNetliq`)

---

### Task 1: NETLIQ — overlay BTC + grille + étiquettes + tooltip

**Files:**
- Modify: `apps/web/src/components/NetliqWindow.tsx`
- Create (si logique non triviale): `apps/web/src/components/netliqWindow.util.ts` + test (normalisation overlay, ticks Md$)

**Interfaces (Produces):**
```ts
// util (pur, testé) :
export function normaliserSerieOverlay(closes: readonly { t: number; close: number }[]): { t: number; y01: number }[];
// y01 = (close − min)/(max − min) sur la fenêtre ; série < 2 points ou max==min → [].
export function ticksMd(min: number, max: number, n: number): number[]; // valeurs rondes en Md$ (pas 100/250/500/1000)
```

- [ ] **Step 1:** Bouton en-tête « ₿ BTC » (état local, défaut ON, style Segmente/bouton existant) → fetch `binanceAdapter.fetchKlines("BTCUSDT", "1d", { limit: 730 })` au premier affichage de l'overlay (une fois, pas de re-fetch au toggle ; StrictMode-safe), catch → overlay absent.
- [ ] **Step 2:** Dessin : courbe BTC normalisée (`normaliserSerieOverlay`, mappée sur la hauteur utile du cadre), ligne `--serie-1` 1 px, alignée sur l'axe X temporel de netliq (les jours sans point BTC — week-ends absents du netliq ou l'inverse — simplement omis, ligne continue entre points existants). Mention NoteSource : « BTC superposé (échelle propre) ».
- [ ] **Step 3:** Grille horizontale : 3-4 lignes aux `ticksMd` (token grid/border, 1 px), étiquettes Y compactes à gauche (« 6 000 »), étiquettes X : 5-6 dates abrégées fr (« août 25 ») sous le cadre. Remplissage dégradé sous la courbe netliq (gradient vertical token accent alpha 0.10 → 0).
- [ ] **Step 4:** Tooltip enrichi : date, netliq Md$, BTC $ (si overlay et point disponible), Δ vs point précédent (teinté). Paddings partagés préservés.
- [ ] **Step 5:** Tests util + suite web + tsc verts. **Step 6: Commit** — `feat(netliq): overlay BTC, grille, étiquettes et tooltip enrichi`

### Task 2: CBPREM — bandes ±2σ + moyenne 7 j + étiquettes + z au survol

**Files:**
- Modify: `apps/web/src/components/CbpremWindow.tsx`
- Modify (si besoin d'exposer moyenne/σ): `apps/web/src/data/cbprem.ts` + test

**Interfaces (Produces):**
```ts
// data/cbprem.ts (pur, testé — si non déjà exposé par statsPremium) :
export function bandesPremium(serie: readonly PointPremium[]): { moyenne: number; sigma: number } | null;
// stdev POPULATION sur toute la série ; null si < 30 points ou σ == 0.
export function zPoint(p: number, bandes: { moyenne: number; sigma: number }): number;
```

- [ ] **Step 1: Tests rouges puis verts** — bandesPremium (fixture main-calculée, < 30 → null, σ 0 → null) ; zPoint exact.
- [ ] **Step 2:** Dessin : lignes pointillées discrètes à moyenne ± 2σ (token dim) + remplissage très faible entre elles (alpha ~0.04) ; ligne « moyenne 7 j » pointillée (token accent, valeur du stats existant) ; le zéro plein existant reste la référence principale.
- [ ] **Step 3:** Étiquettes : Y en % (3-4 ticks, réutiliser la génération de ticks locale de la fenêtre si existante, sinon dupliquer `genTicks`-like localement) ; X : dates abrégées fr comme NETLIQ (helper local dupliqué — pas de module commun).
- [ ] **Step 4:** Tooltip enrichi : date, premium %, z du point (`zPoint`, teinté |z| ≥ 2 → down). Paddings partagés préservés.
- [ ] **Step 5:** Suite web + tsc verts. **Step 6: Commit** — `feat(cbprem): bandes ±2σ, moyenne 7 j, étiquettes et z au survol`

Gate visuel (contrôleur) : NETLIQ — overlay BTC visible et corrélé de forme, toggle OFF/ON sans re-fetch (Réseau), grille/étiquettes lisibles, tooltip complet ; CBPREM — bandes et moyenne 7 j plausibles, z du survol cohérent avec le badge Z 30j au dernier point, aucun débordement des étiquettes.
