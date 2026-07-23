# Heatmap de liquidité du carnet (BOOK) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overlay heatmap temps × prix du carnet d'ordres (style Bookmap) superposé au chart maître, intensité log = taille des ordres limites, activable via la palette (mnémonique `BOOK`).

**Architecture:** Échantillonnage ~1 s du carnet Binance spot (`data/depth.ts`) dans un buffer FIFO borné (modèle `liqEventsStore`), rendu par un `DepthHeatController` calqué sur `LiquidationHeatController` (canvas empilé, rAF + dirty, `convertToPixel`). Ref-counting ajouté à `souscrireDepth` pour respecter le budget « une connexion depth ».

**Tech Stack:** TypeScript, KLineChart (projection uniquement), canvas 2D, Zustand vanilla, vitest.

## Global Constraints

- Commentaires et docstrings en **français** (style POURQUOI/MODÈLE de `tradeMarkers.ts`).
- Aucune donnée tick dans un store Zustand : accumulation hors React, redraw rAF (invariant `store/orderflow.ts:6-8`).
- Couleurs lues **au moment du dessin** via `lib/canvasTokens` ; redraw sur `themeStore`.
- Logique pure exportée + testée ; couplage KLineChart/DOM non testé (convention repo).
- Mnémonique `BOOK` unique — le test `apps/web/src/commands/registry.test.ts` doit passer.
- Branche : `feat/depth-heatmap`. TDD : test rouge → implémentation → vert → commit.
- Vérification finale : `pnpm test` (vitest web) vert.

**Modèles à lire AVANT d'implémenter** (le code du plan est indicatif, la vérité est dans ces fichiers) :
- `apps/web/src/data/depth.ts` (souscrireDepth:263, agregerNiveaux:158, pasArrondi:137, OrderBook:46)
- `apps/web/src/chart/liquidationHeat.ts` (LiquidationHeatController:534, intensiteLog:125, rampePourTheme:318, boucle rAF:773-848, subscribeActions:759)
- `apps/web/src/chart/liquidationMarkers.ts` (liqEventsStore:263-279, bornerEvenements:173)
- `apps/web/src/chart/ChartInstance.tsx` (montage canvas overlay :290, :566-578, :869)
- `apps/web/src/store/dom-ui.ts` (commandes palette :66-85)

---

### Task 1: Ref-counting de `souscrireDepth`

**Files:**
- Modify: `apps/web/src/data/depth.ts`
- Test: `apps/web/src/data/depth.test.ts` (compléter le fichier existant ; s'il n'existe pas, le créer avec les mocks WS du repo — chercher comment `wsLoop` est mocké ailleurs)

**Interfaces:**
- Produces: `souscrireDepth(symbol, onLivre): Unsubscribe` — signature INCHANGÉE ; N abonnés au même symbole partagent une connexion, fermée quand le dernier se désabonne. Fonction pure extraite pour testabilité : `export function creerMultiplexeurDepth(...)` ou équivalent — la logique de comptage (ajouter/retirer un abonné, décider ouvrir/fermer) doit être pure et testée sans WS.

- [ ] **Step 1: Écrire les tests rouges** — comptage pur : 1er abonné → « ouvrir » ; 2e abonné même symbole → pas de nouvelle ouverture ; désabonnement partiel → connexion vivante ; dernier désabonnement → « fermer » ; chaque abonné reçoit les mises à jour ; un abonné désabonné ne reçoit plus rien.
- [ ] **Step 2: Vérifier l'échec** — `pnpm --filter @axiom/web test -- depth`
- [ ] **Step 3: Implémenter** — extraire la logique de multiplexage (Map symbole → {abonnés:Set, unsub}) autour du `connectWsLoop` existant, sans changer le protocole snapshot+diffs.
- [ ] **Step 4: Vert** — même commande.
- [ ] **Step 5: Vérifier que le DOM fonctionne toujours** — `rg "souscrireDepth" apps/web/src` : aucun appelant à modifier (signature inchangée).
- [ ] **Step 6: Commit** — `feat(depth): mutualiser la connexion depth par ref-counting`

### Task 2: Module pur d'accumulation et de grille — `chart/depthHeat.ts`

**Files:**
- Create: `apps/web/src/chart/depthHeat.ts`
- Test: `apps/web/src/chart/depthHeat.test.ts`

**Interfaces (Produces — utilisées par Tasks 3-4):**
```ts
export interface ColonneDepth { t: number; pas: number; bids: NiveauAgrege[]; asks: NiveauAgrege[]; }
export const MAX_COLONNES = 1800;            // ≈ 30 min à 1 col/s
export const INTERVALLE_COLONNE_MS = 1000;
export function echantillonnerColonne(livre: OrderBook, nowMs: number): ColonneDepth;
  // agregerNiveaux(…, pasArrondi(midPrice), "bid"|"ask", LIMITE_NIVEAUX) des deux côtés
export function ajouterColonne(colonnes: ColonneDepth[], c: ColonneDepth, max?: number): ColonneDepth[];
  // FIFO borné (modèle bornerEvenements)
export function grilleDepuisColonnes(colonnes: ColonneDepth[], deMs: number, aMs: number,
  prixMin: number, prixMax: number, nLignes: number): { cellules: Float32Array; nCols: number; qtyMax: number };
  // grille temps × prix sur la plage visible, valeurs = qty par cellule
export function intensiteLogDepth(qty: number, qtyMax: number): number; // [0,1], log, 0 si qtyMax<=0
```

- [ ] **Step 1: Tests rouges** — échantillonnage (colonne contient bids/asks agrégés, pas cohérent avec le mid) ; FIFO (éviction au-delà de max, ordre chrono conservé) ; grille (colonne hors plage exclue, cumul dans la bonne cellule, qtyMax correct, grille vide → qtyMax 0) ; intensité (0→0, qtyMax→1, monotone, log — mêmes propriétés que `intensiteLog` de liquidationHeat).
- [ ] **Step 2: Rouge** → **Step 3: Implémenter** (réutiliser `agregerNiveaux`/`pasArrondi` importés de `../data/depth`) → **Step 4: Vert**.
- [ ] **Step 5: Commit** — `feat(depth-heat): accumulation FIFO et grille temps×prix pures`

### Task 3: Store d'accumulation + bascule

**Files:**
- Create: `apps/web/src/store/depth-heat.ts` (ou co-localisé dans `chart/depthHeat.ts` si < ~80 lignes, au choix du goût local — suivre `liquidationMarkers.ts` qui co-localise)
- Test: compléter `apps/web/src/chart/depthHeat.test.ts`

**Interfaces (Produces):**
```ts
export const depthHeatStore: StoreApi<{ actif: boolean; rev: number; basculer(): void }>;
export function lireColonnes(): ColonneDepth[];   // accès au buffer module (hors store)
export function demarrerDepthHeat(): void;        // idempotent : s'abonne à marketStore (symbole)
  // actif=true → souscrireDepth(symbole) ; échantillonne 1 col/INTERVALLE_COLONNE_MS ; bump rev
  // actif=false ou changement de symbole → désabonne + reset buffer
```

- [ ] **Step 1: Tests rouges** (logique pure extraite : décision réabonnement sur changement symbole/actif, reset du buffer — tester via fonctions pures, mocker `souscrireDepth`).
- [ ] **Step 2-4: Rouge → implémentation → vert.** Le buffer vit en variable module (JAMAIS dans le store) ; le store ne porte que `actif` + `rev` (bump ≤ 1/s).
- [ ] **Step 5: Commit** — `feat(depth-heat): store de bascule et accumulation échantillonnée`

### Task 4: `DepthHeatController` + montage dans ChartInstance

**Files:**
- Modify: `apps/web/src/chart/depthHeat.ts` (classe contrôleur, non testée — couplage)
- Modify: `apps/web/src/chart/ChartInstance.tsx` (canvas empilé + instanciation slot maître)

**Interfaces:**
- Consumes: `grilleDepuisColonnes`, `intensiteLogDepth`, `depthHeatStore`, `lireColonnes` (Task 2-3).
- Produces: `class DepthHeatController { constructor(chart, container, canvas); setEnabled(b): void; dispose(): void }` — même contrat que `LiquidationHeatController`.

- [ ] **Step 1: Implémenter le contrôleur** calqué ligne à ligne sur `LiquidationHeatController` : rAF + dirty, DPR, `convertToPixel`/`getVisibleRange`/`getSize("candle_pane")`, `subscribeAction` (scroll/zoom/visibleRange), clip pane, rampe theme-aware (réutiliser `rampePourTheme`/`intensiteLog` si exportés, sinon recopier le calcul), chemin offscreen upscalé sous `SEUIL_LISSAGE_PX`. Abonnements : `depthHeatStore` (rev + actif), `themeStore`, `ResizeObserver`.
- [ ] **Step 2: Monter dans ChartInstance** — nouveau `depthHeatCanvasRef`, `<canvas className="pointer-events-none absolute inset-0" style={{display:"none"}}/>` à côté des canvases existants (:868-871), instanciation `if (isMaster)` + `setEnabled` câblé sur le store + `dispose()` au teardown (modèle exact :566-578).
- [ ] **Step 3: Vérification visuelle** — `pnpm run up`, activer BOOK (après Task 5) ou temporairement `setEnabled(true)`, vérifier la peinture, le pan/zoom, le changement de thème.
- [ ] **Step 4: Commit** — `feat(depth-heat): contrôleur canvas overlay sur le chart maître`

### Task 5: Commande palette + gate final

**Files:**
- Modify: `apps/web/src/chart/depthHeat.ts` (export `commandes: Commande[]`, modèle `liquidationHeat.ts:1711-1721`)
- Modify: `apps/web/src/App.tsx` (ajouter la source dans `enregistrerCommandes`)
- Modify: `apps/web/src/commands/registry.test.ts` (ajouter la source à `SOURCES_GREFFEES`)

- [ ] **Step 1:** Commande `{ id:"action:depth-heat", mnemonique:"BOOK", categorie:"action", action: basculer }` + greffe App.tsx + miroir registry.test.
- [ ] **Step 2:** `pnpm --filter @axiom/web test -- registry` vert (unicité BOOK).
- [ ] **Step 3:** Suite complète `pnpm test` verte.
- [ ] **Step 4: Commit** — `feat(depth-heat): commande palette BOOK`
