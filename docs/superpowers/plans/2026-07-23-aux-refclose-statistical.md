# refClose + indicateurs statistical — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Série aux `refClose` (close d'un symbole de référence aligné sur le chart) + 3 indicateurs cross-asset `rollingCorrelation`/`betaRef`/`spreadZScore` — spec `2026-07-23-aux-refclose-multisymbole-design.md`.

**Architecture:** Réutilisation du mécanisme perpDelta d'auxProvider (fetch à l'interval du chart, clé de cache dédiée) mais alignement LOCF (refClose est un NIVEAU, pas un flux) ; moteur indicateurs pur (rendements log) ; nouvelle catégorie d'enum `statistical`.

**Tech Stack:** TypeScript, vitest, Zustand vanilla.

## Global Constraints

- Commentaires **français**. Moteur `@axiom/indicators` pur et synchrone (zéro réseau). `git -C` systématique.
- Rendements **log** obligatoires pour les 3 indicateurs (corréler les prix bruts est interdit par la spec).
- refClose = NIVEAU → LOCF d'`alignAux` correct, MAIS fetch à l'interval du chart (leçon v1.2 : un close 1h forward-fillé sur du 1m écrase la corrélation).
- Dégradation : refSymbol invalide / fetch échoué / tf non supporté → série vide → outputs undefined, jamais de throw.
- Registre : 150 → 153. Double mise à jour OBLIGATOIRE : assertion de `registry.test.ts` ET en-tête `registry.ts:8` (« 150 indicateurs câblés » → 153).
- Branche : `feat/aux-refclose`. TDD. Gate : `pnpm test` racine + tsc verts + gate visuel (contrôleur).

**Modèles à lire AVANT d'implémenter :**
- `apps/web/src/chart/auxProvider.ts` (cas `perpDelta` :262-266 — fetch à l'interval, clé `id:symbol:tf` :371-374, TTL :83, `sanitize`+`alignAux`)
- `apps/web/src/data/binance.ts` (fetch klines spot existant — RÉUTILISER l'URL/parseur, zéro nouvelle URL) et `timeframeToFapiInterval` de `data/binanceFutures.ts` (spot accepte les mêmes intervals — le vérifier)
- `packages/types/src/index.ts:186-214` (`AuxSeriesId`, `IndicatorCategory`) ; `packages/indicators/src/volatility/priceZScore.ts` (convention stdev population) ; `orderflow/cvdSpotPerp.ts` (patron indicateur à série aux, gardes undefined)
- `apps/web/src/store/persist.ts:385,417,538` (patron persistance d'un réglage simple — orderflow.enabled) et le panneau Réglages (composant lisant `settingsUiStore`)

---

### Task 1: Types + réglage refSymbol persisté

**Files:**
- Modify: `packages/types/src/index.ts` (AuxSeriesId += `"refClose"` avec commentaire ; IndicatorCategory += `"statistical"`)
- Create: `apps/web/src/store/refSymbol.ts` (store vanilla : `refSymbol` défaut `"BTCUSDT"`, `setRefSymbol` — normalise en MAJUSCULES/trim)
- Modify: `apps/web/src/store/persist.ts` (persister refSymbol — patron exact orderflow.enabled : snapshot, restauration, subscribe)
- Modify: panneau Réglages (champ texte « Symbole de référence (indicateurs croisés) », patron input watchlist)
- Test: store (défaut, set, normalisation) + persist si le patron existant est testé

**Interfaces (Produces):** `refSymbolStore.getState().refSymbol: string` — consommé par Task 2.

- [ ] **Step 1:** Types (exhaustivité TS : suivre les erreurs de compilation sur IndicatorCategory — libellé menu traité en Task 5).
- [ ] **Step 2:** Store + persistance + champ Réglages. Tests verts, tsc vert.
- [ ] **Step 3: Commit** — `feat(aux): type refClose + catégorie statistical + réglage refSymbol persisté`

### Task 2: auxProvider — cas `refClose`

**Files:**
- Modify: `apps/web/src/chart/auxProvider.ts`

**Interfaces (Produces):** série aux `refClose` alignée LOCF sur les bougies du chart, disponible via `aux` pour tout indicateur déclarant `aux: ["refClose"]`.

- [ ] **Step 1:** Cas `refClose` dans le switch de fetch : klines SPOT Binance du `refSymbolStore` à l'interval du chart (mapping interval réutilisé ; tf non supporté → série vide documentée), pagination arrière si nécessaire (suivre le volume du patron perpDelta), points `{time: openTime, value: close}`.
- [ ] **Step 2:** Clé de cache `refClose:${refSymbol}:${tf}` (le symbole du CHART n'y figure pas — la série n'en dépend pas) + TTL 60 s (patron perpDelta) + invalidation quand refSymbol change (clé différente = suffisant, le vérifier).
- [ ] **Step 3:** L'alignement reste le LOCF standard d'`alignAux` (niveau). Commentaire d'en-tête expliquant la dualité flux/niveau (perpDelta vs refClose).
- [ ] **Step 4:** Suite web verte. **Step 5: Commit** — `feat(aux): série refClose (close du symbole de référence, fetch à l'interval du chart)`

### Task 3: `rollingCorrelation` (pur, TDD)

**Files:**
- Create: `packages/indicators/src/statistical/rollingCorrelation.ts`
- Test: `packages/indicators/src/statistical/rollingCorrelation.test.ts`

**Interfaces (Produces):** `IndicatorDef` id `rollingCorrelation`, catégorie `statistical`, `aux: ["refClose"]`, inputs `length` (défaut 50, 10-500) + `source` (close), outputs `corr` (ligne) + repères constants `+1`/`0`/`-1`, precision 2, pane separate.

- [ ] **Step 1: Tests rouges** — corr=1 sur rendements identiques ; −1 sur opposés ; ~0 sur orthogonaux (fixtures construites, valeurs commentées) ; undefined si fenêtre incomplète, stdev nulle d'un côté, refClose absent ; premier point sans rendement ; trou refClose (bougie undefined) → rendement du trou exclu de la fenêtre (pas de 0 fantôme).
- [ ] **Step 2-4: Rouge → implémentation (Pearson sur rendements log) → vert** — `pnpm --filter @axiom/indicators test -- rollingCorrelation`
- [ ] **Step 5: Commit** — `feat(indicators): rollingCorrelation — corrélation roulante des rendements log vs référence`

### Task 4: `betaRef` + `spreadZScore` (purs, TDD)

**Files:**
- Create: `packages/indicators/src/statistical/betaRef.ts` + test ; `packages/indicators/src/statistical/spreadZScore.ts` + test

**Interfaces (Produces):**
- `betaRef` : mêmes inputs que rollingCorrelation ; output `beta` (cov(r,rRef)/var(rRef) sur `length` rendements log) + repère `1` ; var(rRef)=0 → undefined.
- `spreadZScore` : input `length` (défaut 100) ; spread = log(P) − log(PRef) ; output `z` (z-score roulant, stdev POPULATION — convention priceZScore) + bandes `+2`/`−2`.

- [ ] **Step 1: Tests rouges** — beta=2 quand r = 2·rRef (fixture exacte) ; beta undefined si var(rRef)=0 ; spread z borné sur fixture oscillante, undefined si stdev 0 ou fenêtre incomplète ; refClose absent → tout undefined.
- [ ] **Step 2-4: Rouge → implémentation → vert.** **Step 5: Commit** — `feat(indicators): betaRef et spreadZScore (spread log vs référence)`

### Task 5: Enregistrement + menu + gate

**Files:**
- Modify: `packages/indicators/src/registry.ts` (3 imports zone statistical + 3 entrées + en-tête :8 « 153 indicateurs câblés »), `packages/indicators/src/registry.test.ts` (150 → 153), `IndicatorMenu` (libellé « Statistiques », ordre : après Volatilité)

- [ ] **Step 1:** Greffes ; `pnpm --filter @axiom/indicators test` vert.
- [ ] **Step 2:** `pnpm test` racine + `pnpm typecheck` verts.
- [ ] **Step 3: Commit** — `feat(indicators): catégorie Statistiques enregistrée (150 → 153)`

Gate visuel (contrôleur) : ETHUSDT 1h + réf BTCUSDT → corr ~0.7-0.9 plausible, beta ~1, spread z oscillant ; changement de refSymbol dans Réglages → recalcul ; chart BTCUSDT sur réf BTCUSDT → corr=1/beta=1.
