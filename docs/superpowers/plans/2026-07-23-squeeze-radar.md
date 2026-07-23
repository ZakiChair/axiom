# Radar de squeeze (SQZ) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nouvelle fenêtre scatter quadrants — X = funding %, Y = ΔOI 24h %, taille ∝ volume 24h, couleur par quadrant — sur l'échantillon Signaux (top liquides à perp ∪ watchlist) ; survol → tooltip, clic → charge le symbole sur le chart.

**Architecture:** Données réutilisées des modules EQS/Signaux (ticker 24h, premiumIndex, `fetchOpenInterestHist`+`oiChangePctFromHist` via cache `histOiUsd`). Logique pure dans `data/squeeze.ts` (points, quadrants, hit-testing), rendu canvas impératif façon `CorrWindow`, navigation via `navigateTo`.

**Tech Stack:** TypeScript, canvas 2D, Zustand vanilla, vitest.

## Global Constraints

- Commentaires en **français**.
- Fenêtre : id `squeeze`, mnémonique `SQZ`, `nouveau: true` — `commands/registry.test.ts` doit passer.
- Pas de polling continu : 1 run à l'ouverture + bouton Rafraîchir.
- Note de couverture affichée (échantillon top-N, pas d'OI batch gratuit) — même honnêteté qu'EQS.
- Couleurs par tokens (`lireTokenCanvas`, `--up`/`--down`/`--accent`), DPR, `ResizeObserver`.
- Branche : `feat/squeeze-radar`. TDD. Gate : `pnpm test` vert.

**Modèles à lire AVANT d'implémenter :**
- `apps/web/src/data/signaux.ts` (selectionEchantillon :348-368, signalQuadrantOiPrix :72-111, seuils :53-55)
- `apps/web/src/data/screener.ts` (parseTicker24h :96, parsePremiumIndex :140, oiChangePctFromHist :167, pool `enrichPositionSample` :174-198)
- `apps/web/src/data/referentiels.ts` (histOiUsd :116, cache TTL 1h)
- `apps/web/src/components/CorrWindow.tsx` (canvas DPR :209-285, hit-testing clic :352-393, tooltip :373-377)
- `apps/web/src/lib/navigation.ts` (navigateTo :246-271)
- `apps/web/src/store/windowManager.ts` (WINDOW_REGISTRY :46-71) + `apps/web/src/App.tsx` (WINDOW_COMPONENTS :135-190)
- `apps/web/src/commands/windowPanels.ts` (commande toggle fenêtre)

---

### Task 1: Logique pure — `data/squeeze.ts`

**Files:**
- Create: `apps/web/src/data/squeeze.ts`
- Test: `apps/web/src/data/squeeze.test.ts`

**Interfaces (Produces):**
```ts
export type QuadrantSqueeze = "carburant-squeeze" | "longs-crowded" | "shorts-crowded" | "deleveraging" | "neutre";
export const SEUIL_FUNDING_PCT = 0.01;  // |funding| < seuil → axe neutre (0.01%/8h ≈ neutre)
export const SEUIL_DOI_PCT = 3;         // même seuil que signaux.ts SEUIL_OI_PCT
export function quadrantFundingOi(fundingPct: number, dOiPct: number): QuadrantSqueeze;
  // funding<0 & OI↑ = carburant-squeeze (shorts payent et s'accumulent)
  // funding>0 & OI↑ = longs-crowded ; funding>0 & OI↓ = deleveraging (longs sortent)
  // funding<0 & OI↓ = shorts-crowded (couverture de shorts) ; sous les deux seuils = neutre (couverture)
export interface PointRadar { symbol: string; fundingPct: number; dOiPct: number;
  volumeUsd24h: number; quadrant: QuadrantSqueeze; }
export function construirePoints(rows: { symbol: string; fundingPct?: number;
  dOiPct?: number; volumeUsd24h: number }[]): PointRadar[];
  // exclut les lignes sans funding OU sans dOi ; calcule le quadrant
export function rayonPoint(volumeUsd24h: number, volumeMax: number): number; // ∝ sqrt, borné [3, 16] px
export function plusProchePoint(points: { x: number; y: number }[], px: number, py: number,
  capture: number): number; // index du plus proche dans le rayon de capture, -1 sinon
```

- [ ] **Step 1: Tests rouges** :
```ts
it("quadrantFundingOi classe les 4 quadrants et la zone neutre", () => {
  expect(quadrantFundingOi(-0.05, 8)).toBe("carburant-squeeze");
  expect(quadrantFundingOi(0.05, 8)).toBe("longs-crowded");
  expect(quadrantFundingOi(0.05, -8)).toBe("deleveraging");
  expect(quadrantFundingOi(-0.05, -8)).toBe("shorts-crowded");
  expect(quadrantFundingOi(0.001, 1)).toBe("neutre");     // sous les deux seuils
});
it("construirePoints exclut les lignes incomplètes", () => { /* sans funding / sans dOi */ });
it("rayonPoint est monotone et borné", () => { /* min 3, max 16, ×4 volume → ×2 rayon */ });
it("plusProchePoint respecte le rayon de capture", () => { /* match, hors capture → -1, liste vide → -1 */ });
```
- [ ] **Step 2-4: Rouge → implémentation → vert** — `pnpm --filter @axiom/web test -- squeeze`
- [ ] **Step 5: Commit** — `feat(squeeze): quadrants funding×ΔOI et projection des points`

### Task 2: Store + run de collecte

**Files:**
- Create: `apps/web/src/store/squeeze.ts`
- Test: `apps/web/src/store/squeeze.test.ts` (logique de fusion pure extraite)

**Interfaces (Produces):**
```ts
export const squeezeStore: StoreApi<{ open: boolean; enCours: boolean; points: PointRadar[];
  couverture: string; erreur: string | null; run(): Promise<void>; }>;
export function fusionnerSources(tickers, fundingMap, oiParSymbole): entrées pour construirePoints; // PURE, testée
```

- [ ] **Step 1: Test rouge** de `fusionnerSources` (fusion symbole spot/perp comme `applyFunding`, volumes du ticker, ΔOI de la map ; symbole absent d'une source → exclu par construirePoints).
- [ ] **Step 2-3: Implémenter le run** : `selectionEchantillon` (réutiliser l'export de `data/signaux.ts` ; s'il n'est pas exporté, extraire la sélection en fonction partagée plutôt que dupliquer) → fetch ticker 24h + premiumIndex (2 requêtes) → pool de concurrence 4-6 sur `histOiUsd(sym)` + `oiChangePctFromHist` → `fusionnerSources` → `construirePoints`. `couverture` = « ΔOI sur N symboles (top liquides ∪ watchlist) ». Erreurs réseau → `erreur` affichable, jamais de throw non capté.
- [ ] **Step 4: Vert + commit** — `feat(squeeze): store et collecte funding/ΔOI sur l'échantillon`

### Task 3: Fenêtre `SqueezeWindow` — scatter canvas

**Files:**
- Create: `apps/web/src/components/SqueezeWindow.tsx`
- Create: `apps/web/src/components/squeezeWindow.util.ts` + Test: `apps/web/src/components/squeezeWindow.util.test.ts` (projection données→pixels, domaines d'axes)

**Interfaces:**
- Consumes: `squeezeStore`, `quadrantFundingOi`/`rayonPoint`/`plusProchePoint`, `lireTokenCanvas`/`rgbaTokenCanvas`, `navigateTo`.
- Produces: composant `SqueezeWindow` (export nommé), utilitaires purs `domaineAxes(points)` (bornes symétriques autour de 0, padding) et `projeterEnPixels(points, domaine, w, h, pad)`.

- [ ] **Step 1: Tests rouges** des utilitaires (domaine symétrique incluant tous les points, 0 toujours visible ; projection aller-retour cohérente).
- [ ] **Step 2: Implémenter le composant** façon CorrWindow : canvas DPR + ResizeObserver ; axes centrés sur 0 avec lignes de quadrant en pointillé + étiquettes discrètes de quadrant ; points = cercles semi-transparents (`rgbaTokenCanvas`) colorés par quadrant (carburant-squeeze = `--up`, longs-crowded = `--down`, autres = série/gris), rayon `rayonPoint` ; label symbole sur les 8 plus gros volumes ; survol (`onMouseMove` + `plusProchePoint`, capture 12 px) → tooltip état React (symbole, funding, ΔOI, volume, quadrant) ; clic → `navigateTo({ symbol, exchange:"binance", timeframe: marketStore.getState().timeframe, source:"eqs" })`.
- [ ] **Step 3:** En-tête `<EnTeteFenetre mnemo="SQZ">`, bouton Rafraîchir (`run()`, désactivé si `enCours`), `<NoteSource>` couverture + fraîcheur ; run auto au premier `open`.
- [ ] **Step 4: Vérif visuelle** `pnpm run up`.
- [ ] **Step 5: Commit** — `feat(squeeze): fenêtre scatter quadrants cliquable`

### Task 4: Enregistrement + gate

**Files:**
- Modify: `apps/web/src/store/windowManager.ts` (WINDOW_REGISTRY : `{ id:"squeeze", title:"Radar squeeze", mnemonic:"SQZ", nouveau:true, … }`)
- Modify: `apps/web/src/App.tsx` (lazy dans WINDOW_COMPONENTS)
- Modify: `apps/web/src/commands/windowPanels.ts` (commande toggle) — vérifier si `SOURCES_GREFFEES` du registry.test couvre déjà windowPanels (oui a priori, sinon l'ajouter)

- [ ] **Step 1:** Les 3 greffes (le type `WindowId` force l'exhaustivité — la compile casse tant que le lazy manque).
- [ ] **Step 2:** `pnpm --filter @axiom/web test -- registry` vert (unicité SQZ) puis `pnpm test` complet vert.
- [ ] **Step 3: Commit** — `feat(squeeze): enregistrement fenêtre SQZ + commande palette`
