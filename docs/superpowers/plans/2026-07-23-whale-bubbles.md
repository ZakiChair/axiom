# Bulles de prints baleines (WHALE) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher les trades agressifs ≥ seuil notionnel en bulles proportionnelles (√notionnel) sur les bougies du chart maître, vert/rouge selon le côté agresseur, seuil réglable, bascule palette `WHALE`.

**Architecture:** Contrôleur singleton (modèle `tradeMarkers.ts`) qui consomme `subscribeTrades` spot + `subscribePerpAggTrades` (modèle `OrderflowController.ensureTrades`), accumule un FIFO ~500 prints hors React, et pose des overlays KLineChart `circle` (+ `text` pour les très gros). Seuil dans `store/orderflow.ts`, réglage dans `FootprintSettingsPanel`.

**Tech Stack:** TypeScript, KLineChart `registerOverlay`, Zustand vanilla, vitest.

## Global Constraints

- Commentaires en **français** (docstring POURQUOI/MODÈLE comme `tradeMarkers.ts`).
- Aucune donnée tick dans un store Zustand ; buffer en variable module, redraw throttlé (~2 Hz suffit — les overlays KLineChart sont plus coûteux qu'un canvas).
- Couleurs au dessin : `rgbaTokenCanvas("--up"/"--down", 0.35, repli)` (`lib/canvasTokens.ts:61`).
- Convention de côté : `Trade.side` = agresseur, tel que produit par `aggTradeToTrade` (`data/binance.ts:127-134`) — **ne pas inverser**.
- Notionnel = `price * qty` (absent du type `Trade`, à calculer).
- Mnémonique `WHALE` unique — `commands/registry.test.ts` doit passer.
- Branche : `feat/whale-bubbles`. TDD. Gate final : `pnpm test` vert.

**Modèles à lire AVANT d'implémenter :**
- `apps/web/src/chart/tradeMarkers.ts` (pattern complet : registerOverlay :282-303, redraw :314-366, retirerMarqueursSuivis :191-202, démarrage :376-437, commandes :442-452)
- `apps/web/src/chart/orderflow.ts` (ensureTrades :506-518, onTrade :560-598)
- `apps/web/src/store/orderflow.ts` (seuils numériques :23-26, :48-51)
- `apps/web/src/components/FootprintSettingsPanel.tsx` (pattern draft :45-50)
- `apps/web/src/chart/tradeMarkers.test.ts` (mocks vitest :12-18)

---

### Task 1: Fonctions pures — `chart/whaleBubbles.ts`

**Files:**
- Create: `apps/web/src/chart/whaleBubbles.ts`
- Test: `apps/web/src/chart/whaleBubbles.test.ts`

**Interfaces (Produces):**
```ts
export interface WhalePrint { time: number; price: number; notionnel: number; side: "buy" | "sell"; }
export const WHALE_MAX_PRINTS = 500;
export function versWhalePrint(t: Trade, seuil: number): WhalePrint | null; // null sous le seuil
export function ajouterPrint(buffer: WhalePrint[], p: WhalePrint, max?: number): WhalePrint[]; // FIFO borné
export function rayonBulle(notionnel: number, seuil: number): number;
  // ∝ sqrt(notionnel/seuil), borné [R_MIN=4, R_MAX=18] px
export function labelPourPrint(p: WhalePrint, seuil: number): string | null;
  // formatUsd si notionnel >= 5*seuil, sinon null
export function retirerBullesSuivies(suivis: Map<CibleOverlays, string[]>): void;
  // identique à retirerMarqueursSuivis (interface minimale {removeOverlay({id})}, try/catch)
```

- [ ] **Step 1: Tests rouges** (mocks vitest identiques à `tradeMarkers.test.ts:12-18` : klinecharts, ./drawing, ../store/theme) :
```ts
it("versWhalePrint filtre sous le seuil et calcule le notionnel", () => {
  const t = { time: 1, price: 50_000, qty: 3, side: "buy" as const };
  expect(versWhalePrint(t, 100_000)?.notionnel).toBe(150_000);
  expect(versWhalePrint({ ...t, qty: 1 }, 100_000)).toBeNull();
});
it("ajouterPrint évince FIFO au-delà du max", () => { /* 3 prints, max 2 → garde les 2 derniers */ });
it("rayonBulle est monotone et borné", () => {
  expect(rayonBulle(100_000, 100_000)).toBe(4);
  expect(rayonBulle(400_000, 100_000)).toBe(8);        // ×4 notionnel → ×2 rayon
  expect(rayonBulle(1e9, 100_000)).toBe(18);           // plafonné
});
it("labelPourPrint n'étiquette que ≥ 5× le seuil", () => { /* 499k→null, 500k→"…" */ });
it("retirerBullesSuivies tolère une instance disposée", () => { /* removeOverlay qui throw */ });
```
- [ ] **Step 2: Rouge** — `pnpm --filter @axiom/web test -- whaleBubbles`
- [ ] **Step 3-4: Implémenter → vert.**
- [ ] **Step 5: Commit** — `feat(whale): fonctions pures de projection des bulles baleines`

### Task 2: Seuil réglable — store + panneau

**Files:**
- Modify: `apps/web/src/store/orderflow.ts`
- Modify: `apps/web/src/components/FootprintSettingsPanel.tsx`

**Interfaces (Produces):** `whaleNotionalMin: number` (défaut `100_000`) + `setWhaleNotionalMin(v: number)` dans `orderflowStore` — même forme que `imbalanceMinVol`/`setImbalanceMinVol` (:23-26, :48-51).

- [ ] **Step 1:** Ajouter le champ + setter au store (session-only, non persisté — cohérent avec les autres seuils).
- [ ] **Step 2:** Champ numérique dans le panneau, pattern draft (useState(String(v)) + resync + commit blur/enter), libellé « Seuil baleine ($) ».
- [ ] **Step 3:** `pnpm --filter @axiom/web test` (aucune régression) puis vérif visuelle du panneau.
- [ ] **Step 4: Commit** — `feat(whale): seuil notionnel réglable dans le panneau orderflow`

### Task 3: Contrôleur singleton + overlay

**Files:**
- Modify: `apps/web/src/chart/whaleBubbles.ts`

**Interfaces:**
- Consumes: Task 1 (fonctions pures), Task 2 (`whaleNotionalMin`), `getAdapter`/`subscribeTrades`, `subscribePerpAggTrades` (`data/binanceFutures.ts:281`), `getActiveChart` (`chart/drawing.ts:280`).
- Produces: `demarrerWhaleBubbles(): void` (idempotent, auto-appelé à l'import) ; `whaleBubblesStore { actif, basculer }` (vanilla, éphémère).

- [ ] **Step 1:** `ensureOverlayRegistered()` : `registerOverlay({ name:"whaleBubble", totalStep:1, lock:true, needDefault*:false, createPointFigures })` → figures `[{type:"circle", attrs:{x,y,r}, styles:{style:"fill", color}}, …text conditionnel]` ; `r` et `color` portés par `extendData` (résolus au redraw via `rayonBulle` + `rgbaTokenCanvas`).
- [ ] **Step 2:** Abonnement trades façon `ensureTrades` (spot + perp du symbole courant), chaque trade → `versWhalePrint` → `ajouterPrint` (variable module) → redraw throttlé (setTimeout ~500 ms, pas de rAF nécessaire).
- [ ] **Step 3:** `redraw()` : cycle `retirerBullesSuivies` → si `actif` et chart prêt, ne poser que les prints dans la plage temporelle des bougies chargées, `points:[{timestamp, value: price}]`, cap ~200 overlays (les plus récents).
- [ ] **Step 4:** Abonnements filtrés `prev*` : marketStore (symbol/exchange/chart) → reset buffer + réabonnement ; themeStore → redraw ; whaleBubblesStore → redraw ; orderflowStore.whaleNotionalMin → redraw (re-filtrage a posteriori non requis : le seuil s'applique aux nouveaux prints, documenter ce choix).
- [ ] **Step 5:** Vérif visuelle `pnpm run up` (BTCUSDT, bulles visibles sur gros prints).
- [ ] **Step 6: Commit** — `feat(whale): contrôleur singleton et overlay bulles sur le chart`

### Task 4: Commande palette + gate

**Files:**
- Modify: `apps/web/src/chart/whaleBubbles.ts` (export `commandes`), `apps/web/src/App.tsx`, `apps/web/src/commands/registry.test.ts`

- [ ] **Step 1:** Commande `{ id:"action:whale-bubbles", mnemonique:"WHALE", categorie:"action" }` + greffe `enregistrerCommandes` + miroir `SOURCES_GREFFEES`.
- [ ] **Step 2:** `pnpm --filter @axiom/web test -- registry` vert, puis `pnpm test` complet vert.
- [ ] **Step 3: Commit** — `feat(whale): commande palette WHALE`
