# ÷BTC en un clic — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bouton toggle « ÷BTC » dans le SymbolBanner : bascule le symbole courant vers le ratio synthétique X/BTC (et retour), spec `2026-07-24-lot-v20-analyse-design.md` §C1.

**Architecture:** Helpers PURS de mapping (nouveau `data/ratioBtc.ts`, TDD) + bouton dans SymbolBanner + presets. Le moteur SYN existant fait tout le reste (live, AT). Détoggle SANS ÉTAT : quitter un ratio = revenir à sa jambe A — aucune mémoire du symbole précédent à gérer.

**Tech Stack:** TypeScript, vitest, Zustand vanilla.

## Global Constraints

- Commentaires **français**. Branche : `feat/ratio-un-clic`. `git -C ~/axiom` systématique.
- Gate : `pnpm test` racine + tsc verts + gate visuel contrôleur.
- Bascule de marché : TOUJOURS `setMarket({...})` (setter ATOMIQUE, une seule invalidation du buffer) — jamais `setExchange` puis `setSymbol` (double invalidation, défaut connu du builder PairSearch qu'on ne reproduit pas).
- Convention volume=0 des SYN inchangée. Aucune modification de `data/synthetic.ts`.

**Modèles à lire AVANT d'implémenter :**
- `apps/web/src/data/symbol.ts:31` — `splitSymbol(symbol, exchangeLabel): { base, quote }`, **throws** si quote inconnue (envelopper try/catch → null).
- `apps/web/src/data/synthetic.ts` — `encodeSyntheticSymbol` / `parseSyntheticSymbol` / `SyntheticSpec` (`{ exA, legA, exB, legB, op }`), jambes autorisées : binance, kraken, coinbase, twelvedata, mexc.
- `apps/web/src/store/market.ts:177-200` — `setMarket(identity)` atomique ; `MarketIdentity = { exchange, symbol, timeframe }`.
- `apps/web/src/components/SymbolBanner.tsx:188-212` — conteneur racine `pointer-events-none` (⚠️ le bouton doit rétablir `pointer-events-auto`), spans lus par refs (aucun re-render sur tick : le bouton ne lit QUE exchange/symbol/timeframe, déjà sélectionnés lignes 99-101).
- `apps/web/src/components/PairSearch.tsx:227-242` — style du toggle « SYN » à réutiliser : base `rounded border px-2 py-1 text-xs`, actif `border-emerald-500 bg-emerald-500 text-accent-ink`, inactif `border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500`.
- `apps/web/src/store/synthetics.ts:4-8` — `SYNTHETIC_PRESETS` (ETH/BTC existe DÉJÀ) ; `addRecent(symbol)`.

---

### Task 1: Helpers purs + bouton + presets

**Files:**
- Create: `apps/web/src/data/ratioBtc.ts` — Test: `apps/web/src/data/ratioBtc.test.ts`
- Modify: `apps/web/src/components/SymbolBanner.tsx` (bouton), `apps/web/src/store/synthetics.ts` (presets SOL/BTC, BNB/BTC)

**Interfaces (Produces):**
```ts
// data/ratioBtc.ts — tout pur, zéro import React/store.
/** Ticker BTC de référence par source jambe (catalogues normalisés format Binance). */
export const BTC_REF: Partial<Record<ExchangeId, string>> = {
  binance: "BTCUSDT", mexc: "BTCUSDT", kraken: "BTCUSD", coinbase: "BTCUSD",
};
/**
 * Symbole SYN du ratio X/BTC pour le marché courant, ou null si non basculable :
 * source sans réf BTC (twelvedata, synthetic, non-jambe), base déjà BTC,
 * quote déjà BTC (ex. ETHBTC), ou symbole non découpable (splitSymbol throw).
 */
export function symboleRatioBtc(symbol: string, exchange: ExchangeId): string | null;
/**
 * Spec SYN si le marché courant EST un ratio ÷BTC posé par le toggle
 * (exchange="synthetic", op="/", exB===exA, legB===BTC_REF[exA]), sinon null.
 */
export function estRatioBtc(symbol: string, exchange: ExchangeId): SyntheticSpec | null;
```

- [ ] **Step 1: Tests rouges** (`ratioBtc.test.ts`) — `symboleRatioBtc` : `("ETHUSDT","binance")` → `"binance:ETHUSDT|/|binance:BTCUSDT"` ; `("SOLUSD","kraken")` → `"kraken:SOLUSD|/|kraken:BTCUSD"` ; idem mexc/coinbase ; `("BTCUSDT","binance")` → null (base BTC) ; `("ETHBTC","binance")` → null (déjà coté BTC) ; `("SPY","twelvedata")` → null ; `(encodé SYN,"synthetic")` → null ; symbole exotique indécoupable → null (pas de throw). `estRatioBtc` : round-trip sur la sortie de `symboleRatioBtc` → spec avec `legA==="ETHUSDT"` ; refus si op `-`, si exB≠exA, si legB≠réf, si exchange≠"synthetic".
- [ ] **Step 2: Implémentation** — `symboleRatioBtc` : garde `BTC_REF[exchange]` ; `splitSymbol` en try/catch ; base/quote ≠ "BTC" ; `encodeSyntheticSymbol`. `estRatioBtc` : `parseSyntheticSymbol` + les 3 gardes. Tests verts.
- [ ] **Step 3: Bouton SymbolBanner** — après le span timeframe (ligne ~194) : bouton `÷BTC`, `pointer-events-auto`, style toggle PairSearch. Trois états : ACTIF (`estRatioBtc` non null) → clic = `setMarket({ exchange: spec.exA, symbol: spec.legA, timeframe })` (retour jambe A) ; BASCULABLE (`symboleRatioBtc` non null) → clic = `addRecent(cible)` puis `setMarket({ exchange: "synthetic", symbol: cible, timeframe })` ; sinon caché (pas de bouton grisé permanent sur tradfi — sobriété du banner). `title` explicite dans les deux états visibles (« Ratio vs BTC » / « Revenir à {legA} »).
- [ ] **Step 4: Presets** — ajouter à `SYNTHETIC_PRESETS` : `{ label: "SOL / BTC", symbol: "binance:SOLUSDT|/|binance:BTCUSDT" }`, `{ label: "BNB / BTC", symbol: "binance:BNBUSDT|/|binance:BTCUSDT" }` (ETH/BTC existe déjà — ne pas dupliquer).
- [ ] **Step 5:** `pnpm test` racine + tsc verts.
- [ ] **Step 6: Gate visuel (contrôleur)** — sur ETHUSDT binance : clic ÷BTC → chart passe en `ETHUSDT / BTCUSDT` live, indicateurs/dessins posables ; re-clic → retour ETHUSDT ; sur BTCUSDT le bouton est absent ; sur un preset SYN chargé à la main le bouton « retour » apparaît si c'est un ratio BTC.
- [ ] **Step 7: Commit** — `feat(ratio): bouton ÷BTC du SymbolBanner (bascule ratio SYN X/BTC un clic)`
