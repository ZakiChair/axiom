# Lot C1 « Analytics chart » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer les 5 features de la spec `docs/superpowers/specs/2026-07-06-lot-c1-analytics-chart-design.md` : séries synthétiques cross-source (SYN), saisonnalité (SEAG), analytics de volatilité (VOL + indicateur RV), footprint pro (imbalances/POC/VA/divergences), volume profile à plage fixe (VPFR).

**Architecture:** SYN = adapter virtuel `createSyntheticAdapter(resolve)` enregistré dans `ADAPTERS` — le reste de l'app le voit comme une source normale ; SEAG et VOL = fenêtres flottantes canvas au pattern `MacroRatesWindow` (UiStore + `mirrorOpenState` + export `commandes`) avec moteurs purs dans `lib/` ; footprint pro = module pur `footprintAnalytics.ts` + rendu dans `OrderflowController` (la value area par bougie existe déjà dans `buildFootprintBar` — travail = rendu + imbalances + divergences) ; VPFR = overlay custom KLineChart au pattern `fibonacci.ts` réutilisant `computeVolumeProfile(candles, from, to, binCount)` existant.

**Tech Stack:** React 18 + TypeScript strict + Zustand vanilla + KLineChart 9.8.12 + vitest. **Aucune nouvelle dépendance.**

## Global Constraints

- Commentaires et documentation en FRANÇAIS.
- TypeScript strict, `noUncheckedIndexedAccess` actif (toujours garder les accès indexés sous garde `undefined`).
- AUCUNE nouvelle dépendance npm ; ne pas modifier les `package.json`.
- Pas de re-render React sur tick — données haute fréquence dans les stores Zustand vanilla, rendu impératif canvas.
- Conventions de test : vitest, `X.test.ts` à côté de `X.ts`, valeurs attendues **calculées à la main en commentaire**. Les fichiers intégrant directement une instance KLineChart (`chart/indicators.ts`, contrôleurs, fenêtres React) ne sont PAS unit-testés — vérification manuelle Chrome DevTools MCP.
- KLineChart : vérifier toute API contre `node_modules/.pnpm/klinecharts@9.8.12/.../dist/index.d.ts` (PAS context7 — divergences connues).
- `@axiom/types` : seule modification autorisée par ce lot = ajout `"synthetic"` à `ExchangeId` (Task 2).
- Couleurs de rendu : JAMAIS en dur — `readToken("--x") || fallback`.
- Commit après chaque tâche complétée et vérifiée (`git add` ciblé, pas `git add -A`).
- Types partagés existants : `Candle { time, open, high, low, close, volume, quoteVolume?, buyVolume?, sellVolume? }` ; `IExchangeAdapter { id, fetchKlines(symbol, tf, opts?), subscribeKline(symbol, tf, cb), subscribeTrades(symbol, cb) }` ; `Timeframe` inclut `"3M"|"6M"|"12M"` agrégés client.

**Dépendances entre tâches (parallélisation SDD)** : T1→T2→{T3,T4} · T5→T6 · T7 · T8→T9 · T10→T11 · T12 · T13 (fin de lot, après tout). Les chaînes {T1…}, {T5…}, {T7}, {T8…}, {T10…}, {T12} sont indépendantes entre elles.

---

## Task 1: `data/synthetic.ts` — parse + composition (moteur pur)

**Files:**
- Create: `apps/web/src/data/synthetic.ts`
- Test: `apps/web/src/data/synthetic.test.ts`

**Interfaces:**
- Produces: `SyntheticOp = "/" | "-"` ; `SyntheticSpec { exA: ExchangeId; legA: string; exB: ExchangeId; legB: string; op: SyntheticOp }` ; `parseSyntheticSymbol(symbol: string): SyntheticSpec | null` ; `encodeSyntheticSymbol(spec: SyntheticSpec): string` ; `formatSyntheticLabel(spec: SyntheticSpec): string` ; `combineKlines(a: Candle[], b: Candle[], op: SyntheticOp): Candle[]`.
- Encodage : `exA:LEGA|op|exB:LEGB` (le `|` n'apparaît dans aucun catalogue de tickers ; les tickers Twelve Data peuvent contenir `/` et `:` est le premier séparateur de jambe uniquement → `indexOf(":")`).

- [ ] **Step 1: Écrire les tests**

```ts
// apps/web/src/data/synthetic.test.ts
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import {
  parseSyntheticSymbol,
  encodeSyntheticSymbol,
  formatSyntheticLabel,
  combineKlines,
} from "./synthetic";

/** Bougie compacte pour les tests. */
function c(time: number, o: number, h: number, l: number, cl: number): Candle {
  return { time, open: o, high: h, low: l, close: cl, volume: 100 };
}

describe("parseSyntheticSymbol", () => {
  it("parse un ratio same-source", () => {
    expect(parseSyntheticSymbol("binance:ETHUSDT|/|binance:BTCUSDT")).toEqual({
      exA: "binance", legA: "ETHUSDT", exB: "binance", legB: "BTCUSDT", op: "/",
    });
  });

  it("parse un spread cross-source avec ticker à slash (EUR/USD)", () => {
    expect(parseSyntheticSymbol("binance:BTCUSDT|-|twelvedata:EUR/USD")).toEqual({
      exA: "binance", legA: "BTCUSDT", exB: "twelvedata", legB: "EUR/USD", op: "-",
    });
  });

  it("rejette : op inconnu, segments manquants, jambe synthetic, jambe vide", () => {
    expect(parseSyntheticSymbol("binance:A|*|binance:B")).toBeNull();
    expect(parseSyntheticSymbol("binance:A|/|")).toBeNull();
    expect(parseSyntheticSymbol("BTCUSDT")).toBeNull();
    expect(parseSyntheticSymbol("synthetic:X|/|binance:B")).toBeNull();
    expect(parseSyntheticSymbol("binance:|/|binance:B")).toBeNull();
  });

  it("encode/parse aller-retour", () => {
    const spec = { exA: "binance", legA: "ETHUSDT", exB: "twelvedata", legB: "GLD", op: "/" } as const;
    expect(parseSyntheticSymbol(encodeSyntheticSymbol(spec))).toEqual(spec);
  });

  it("formatSyntheticLabel produit le libellé court", () => {
    expect(
      formatSyntheticLabel({ exA: "binance", legA: "ETHUSDT", exB: "binance", legB: "BTCUSDT", op: "/" })
    ).toBe("ETHUSDT / BTCUSDT");
  });
});

describe("combineKlines", () => {
  it("ratio aligné bucket par bucket (golden main-calc)", () => {
    // a: O=30 H=40 L=20 C=36 ; b: O=10 H=10 L=10 C=12
    // ratio: O=3 H=4 L=2 C=3 → H re-clamp max(3,4,2,3)=4, L=min(...)=2
    const out = combineKlines([c(1000, 30, 40, 20, 36)], [c(1000, 10, 10, 10, 12)], "/");
    expect(out).toEqual([
      { time: 1000, open: 3, high: 4, low: 2, close: 3, volume: 0 },
    ]);
  });

  it("re-clampe H/L quand la division inverse l'ordre", () => {
    // a: O=9 H=10 L=9 C=10 ; b: O=2 H=5 L=2 C=5
    // brut: O=4.5 H=2 L=4.5 C=2 → H=max=4.5, L=min=2
    const out = combineKlines([c(1000, 9, 10, 9, 10)], [c(1000, 2, 5, 2, 5)], "/");
    expect(out[0]).toEqual({ time: 1000, open: 4.5, high: 4.5, low: 2, close: 2, volume: 0 });
  });

  it("spread A-B", () => {
    // O=30-10=20 H=40-10=30 L=20-10=10 C=36-12=24
    const out = combineKlines([c(1000, 30, 40, 20, 36)], [c(1000, 10, 10, 10, 12)], "-");
    expect(out[0]).toEqual({ time: 1000, open: 20, high: 30, low: 10, close: 24, volume: 0 });
  });

  it("forward-fill du close de B quand B n'a pas de bougie dans le bucket (marché fermé)", () => {
    // B n'existe qu'à t=1000 (close 10) ; à t=2000 et t=3000, B plat à 10.
    // a(t=2000): O=20 H=30 L=20 C=30 → /10 = O=2 H=3 L=2 C=3
    const a = [c(1000, 10, 10, 10, 10), c(2000, 20, 30, 20, 30), c(3000, 40, 40, 40, 40)];
    const b = [c(1000, 5, 5, 5, 10)];
    const out = combineKlines(a, b, "/");
    expect(out).toHaveLength(3);
    expect(out[1]).toEqual({ time: 2000, open: 2, high: 3, low: 2, close: 3, volume: 0 });
    expect(out[2]).toEqual({ time: 3000, open: 4, high: 4, low: 4, close: 4, volume: 0 });
  });

  it("saute les bougies de A antérieures à la première bougie de B (pas de ffill possible)", () => {
    const a = [c(1000, 1, 1, 1, 1), c(2000, 2, 2, 2, 2)];
    const b = [c(2000, 4, 4, 4, 4)];
    const out = combineKlines(a, b, "/");
    expect(out).toEqual([{ time: 2000, open: 0.5, high: 0.5, low: 0.5, close: 0.5, volume: 0 }]);
  });

  it("ignore le bucket si un composant du diviseur est 0 (ratio uniquement)", () => {
    const out = combineKlines([c(1000, 1, 1, 1, 1)], [c(1000, 0, 1, 1, 1)], "/");
    expect(out).toEqual([]);
    // le spread, lui, accepte le 0
    const spread = combineKlines([c(1000, 1, 1, 1, 1)], [c(1000, 0, 1, 0, 1)], "-");
    expect(spread).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Vérifier l'échec** — `pnpm --filter @axiom/web test -- synthetic` → FAIL (module inexistant).

- [ ] **Step 3: Implémenter**

```ts
// apps/web/src/data/synthetic.ts
/**
 * Séries synthétiques (SYN) — parse du symbole encodé et composition de bougies.
 *
 * Encodage : `exA:LEGA|op|exB:LEGB` (ex. `binance:ETHUSDT|/|binance:BTCUSDT`).
 * Le séparateur `|` n'apparaît dans aucun ticker ; `:` sépare source/jambe au
 * PREMIER `:` seulement (les tickers Twelve Data contiennent des `/`, ex. EUR/USD).
 *
 * Composition OHLC jambe-à-jambe (Oa∘Ob, Ha∘Hb, La∘Lb, Ca∘Cb) puis re-clamp
 * H=max(O,H,L,C), L=min(O,H,L,C) — approximation standard (idem TradingView),
 * le max d'un ratio n'étant pas le ratio des max. volume=0 par convention.
 * Jambe B absente d'un bucket → forward-fill de son dernier close (marché fermé).
 */
import type { Candle, ExchangeId } from "@axiom/types";

export type SyntheticOp = "/" | "-";

export interface SyntheticSpec {
  exA: ExchangeId;
  legA: string;
  exB: ExchangeId;
  legB: string;
  op: SyntheticOp;
}

/** Sources autorisées comme jambe (toute source câblée non synthétique). */
const LEG_EXCHANGES: ReadonlySet<string> = new Set([
  "binance", "kraken", "coinbase", "twelvedata", "mexc",
]);

function splitLeg(leg: string): { ex: ExchangeId; sym: string } | null {
  const i = leg.indexOf(":");
  if (i <= 0 || i >= leg.length - 1) return null;
  const ex = leg.slice(0, i);
  const sym = leg.slice(i + 1);
  if (!LEG_EXCHANGES.has(ex)) return null;
  return { ex: ex as ExchangeId, sym };
}

export function parseSyntheticSymbol(symbol: string): SyntheticSpec | null {
  const parts = symbol.split("|");
  if (parts.length !== 3) return null;
  const [rawA, op, rawB] = parts;
  if (op !== "/" && op !== "-") return null;
  if (rawA === undefined || rawB === undefined) return null;
  const a = splitLeg(rawA);
  const b = splitLeg(rawB);
  if (a === null || b === null) return null;
  return { exA: a.ex, legA: a.sym, exB: b.ex, legB: b.sym, op };
}

export function encodeSyntheticSymbol(spec: SyntheticSpec): string {
  return `${spec.exA}:${spec.legA}|${spec.op}|${spec.exB}:${spec.legB}`;
}

export function formatSyntheticLabel(spec: SyntheticSpec): string {
  return `${spec.legA} ${spec.op} ${spec.legB}`;
}

function apply(op: SyntheticOp, x: number, y: number): number {
  return op === "/" ? x / y : x - y;
}

export function combineKlines(a: Candle[], b: Candle[], op: SyntheticOp): Candle[] {
  const out: Candle[] = [];
  let bi = 0;            // curseur dans b (les deux séries sont triées par time croissant)
  let lastB: Candle | null = null;

  for (const ca of a) {
    while (bi < b.length) {
      const cb = b[bi];
      if (cb === undefined || cb.time > ca.time) break;
      lastB = cb;
      bi += 1;
    }
    if (lastB === null) continue; // avant la 1ère bougie de B : pas de ffill possible

    // Bucket exact → OHLC de B ; sinon forward-fill plat au dernier close.
    const exact = lastB.time === ca.time;
    const bo = exact ? lastB.open : lastB.close;
    const bh = exact ? lastB.high : lastB.close;
    const bl = exact ? lastB.low : lastB.close;
    const bc = lastB.close;

    if (op === "/" && (bo === 0 || bh === 0 || bl === 0 || bc === 0)) continue;

    const o = apply(op, ca.open, bo);
    const h = apply(op, ca.high, bh);
    const l = apply(op, ca.low, bl);
    const cl = apply(op, ca.close, bc);
    out.push({
      time: ca.time,
      open: o,
      high: Math.max(o, h, l, cl),
      low: Math.min(o, h, l, cl),
      close: cl,
      volume: 0,
    });
  }
  return out;
}
```

- [ ] **Step 4: Vérifier** — `pnpm --filter @axiom/web test -- synthetic` → PASS.
- [ ] **Step 5: Commit** — `git add apps/web/src/data/synthetic.ts apps/web/src/data/synthetic.test.ts && git commit -m "feat(syn): parse + composition des séries synthétiques (moteur pur)"`

---

## Task 2: adapter virtuel + type `"synthetic"` + timeframes par intersection

**Files:**
- Modify: `packages/types/src/index.ts` (union `ExchangeId`, ~ligne 20)
- Modify: `apps/web/src/data/synthetic.ts` (ajout `createSyntheticAdapter`)
- Modify: `apps/web/src/data/adapters.ts` (registre + `syntheticTimeframes`)
- Test: `apps/web/src/data/synthetic.test.ts` (étendre), `apps/web/src/data/adapters.test.ts` (créer si absent)

**Interfaces:**
- Consumes: `parseSyntheticSymbol`, `combineKlines` (Task 1).
- Produces: `ExchangeId` inclut `"synthetic"` ; `createSyntheticAdapter(resolve: (ex: ExchangeId) => IExchangeAdapter): IExchangeAdapter` ; dans `adapters.ts` : entrée `synthetic` de `ADAPTERS` + `export function syntheticTimeframes(exA: ExchangeId, exB: ExchangeId): Timeframe[]` (intersection ordonnée selon la liste Binance) + `export function supportedTimeframesFor(exchange: ExchangeId, symbol: string): Timeframe[]` (helper unique pour la Toolbar : table statique, ou intersection si synthetic).

- [ ] **Step 1: Type** — ajouter à `ExchangeId` :

```ts
  // Source VIRTUELLE : séries synthétiques ratio/spread à 2 jambes composées
  // client-side (data/synthetic.ts). Jamais une jambe elle-même.
  | "synthetic";
```

- [ ] **Step 2: Tests de l'adaptateur (fake adapters injectés)**

```ts
// à ajouter dans synthetic.test.ts
import type { IExchangeAdapter } from "@axiom/types";
import { createSyntheticAdapter } from "./synthetic";

function fakeAdapter(id: string, candles: Candle[]): IExchangeAdapter & { unsubs: number } {
  const fake = {
    id: id as IExchangeAdapter["id"],
    unsubs: 0,
    async fetchKlines() { return candles; },
    subscribeKline(_s: string, _tf: string, cb: (c: Candle) => void) {
      // émet immédiatement sa dernière bougie, comme un WS qui push l'état courant
      const last = candles[candles.length - 1];
      if (last) cb(last);
      return () => { fake.unsubs += 1; };
    },
    subscribeTrades() { return () => {}; },
  };
  return fake as IExchangeAdapter & { unsubs: number };
}

describe("createSyntheticAdapter", () => {
  const legA = fakeAdapter("binance", [c(1000, 30, 40, 20, 36)]);
  const legB = fakeAdapter("kraken", [c(1000, 10, 10, 10, 12)]);
  const resolve = (ex: string) => (ex === "binance" ? legA : legB);
  const syn = createSyntheticAdapter(resolve as never);

  it("fetchKlines compose les deux jambes", async () => {
    const out = await syn.fetchKlines("binance:ETHUSDT|/|kraken:XBTUSD", "1h", {});
    expect(out).toEqual([{ time: 1000, open: 3, high: 4, low: 2, close: 3, volume: 0 }]);
  });

  it("fetchKlines rejette un symbole invalide", async () => {
    await expect(syn.fetchKlines("nimporte", "1h", {})).rejects.toThrow(/invalide/);
  });

  it("subscribeKline émet dès que les 2 jambes ont un état, et l'unsubscribe ferme les 2", () => {
    const got: Candle[] = [];
    const off = syn.subscribeKline("binance:ETHUSDT|/|kraken:XBTUSD", "1h", (cd) => got.push(cd));
    expect(got.length).toBeGreaterThanOrEqual(1); // les 2 fakes émettent immédiatement
    expect(got[got.length - 1]?.close).toBe(3);   // 36/12
    off();
    expect(legA.unsubs).toBe(1);
    expect(legB.unsubs).toBe(1);
  });

  it("subscribeTrades est un no-op", () => {
    const off = syn.subscribeTrades("x", () => { throw new Error("ne doit jamais émettre"); });
    expect(typeof off).toBe("function");
    off();
  });
});
```

- [ ] **Step 3: Implémenter `createSyntheticAdapter`** (dans `synthetic.ts`)

```ts
/**
 * Adapter virtuel : compose 2 jambes via les adaptateurs réels, injectés pour
 * éviter l'import circulaire avec adapters.ts (qui nous enregistre).
 * subscribeTrades est un no-op → orderflow/footprint/CVD/DOM inertes sur SYN.
 */
export function createSyntheticAdapter(
  resolve: (ex: ExchangeId) => IExchangeAdapter
): IExchangeAdapter {
  return {
    id: "synthetic",

    async fetchKlines(symbol, tf, opts) {
      const spec = parseSyntheticSymbol(symbol);
      if (spec === null) throw new Error(`Symbole synthétique invalide : ${symbol}`);
      const [a, b] = await Promise.all([
        resolve(spec.exA).fetchKlines(spec.legA, tf, opts),
        resolve(spec.exB).fetchKlines(spec.legB, tf, opts),
      ]);
      return combineKlines(a, b, spec.op);
    },

    subscribeKline(symbol, tf, cb) {
      const spec = parseSyntheticSymbol(symbol);
      if (spec === null) return () => {};
      let lastA: Candle | null = null;
      let lastB: Candle | null = null;
      const emit = (): void => {
        if (lastA === null || lastB === null) return;
        // NB : si B a déjà basculé dans un bucket plus récent que A, on attend le
        // tick suivant de A (combineKlines saute A antérieur à B) — bénin en live.
        const merged = combineKlines([lastA], [lastB], spec.op);
        const cd = merged[0];
        if (cd !== undefined) cb(cd);
      };
      const offA = resolve(spec.exA).subscribeKline(spec.legA, tf, (cd) => { lastA = cd; emit(); });
      const offB = resolve(spec.exB).subscribeKline(spec.legB, tf, (cd) => { lastB = cd; emit(); });
      return () => { offA(); offB(); };
    },

    subscribeTrades() {
      return () => {};
    },
  };
}
```

- [ ] **Step 4: Câbler `adapters.ts`**

```ts
import { createSyntheticAdapter, parseSyntheticSymbol } from "./synthetic";

const ADAPTERS: Partial<Record<ExchangeId, IExchangeAdapter>> = {
  binance: binanceAdapter,
  kraken: krakenAdapter,
  coinbase: coinbaseAdapter,
  twelvedata: twelveDataAdapter,
  mexc: mexcAdapter,
  synthetic: createSyntheticAdapter((ex) => getAdapter(ex)),
};

/** TF d'un synthétique = intersection des 2 jambes, dans l'ordre de la liste Binance. */
export function syntheticTimeframes(exA: ExchangeId, exB: ExchangeId): Timeframe[] {
  const a = SUPPORTED_TIMEFRAMES[exA] ?? [];
  const b = new Set(SUPPORTED_TIMEFRAMES[exB] ?? []);
  return a.filter((tf) => b.has(tf));
}

/** Point d'entrée unique du grisage TF (Toolbar) : table statique, ou intersection si SYN. */
export function supportedTimeframesFor(exchange: ExchangeId, symbol: string): Timeframe[] {
  if (exchange !== "synthetic") return SUPPORTED_TIMEFRAMES[exchange] ?? [];
  const spec = parseSyntheticSymbol(symbol);
  if (spec === null) return [];
  return syntheticTimeframes(spec.exA, spec.exB);
}
```

Tests (`adapters.test.ts`) : `syntheticTimeframes("binance","twelvedata")` = `["1m","5m","15m","1h","4h","1d","1w","1M"]` (main-calc depuis les 2 tables) ; `supportedTimeframesFor("synthetic", "binance:A|/|kraken:B")` = intersection binance×kraken ; `supportedTimeframesFor("binance", "BTCUSDT")` = table binance inchangée.

- [ ] **Step 5: Vérifier** — `pnpm --filter @axiom/types build && pnpm --filter @axiom/web test -- synthetic adapters && pnpm -r typecheck` → PASS. Le typecheck global révélera tout `Record<ExchangeId, …>` exhaustif à compléter (suivre les erreurs, ajouter l'entrée `synthetic` pertinente — ex. libellés de source dans la Toolbar).
- [ ] **Step 6: Commit** — `git commit -m "feat(syn): adapter virtuel synthetic + timeframes par intersection"`

---

## Task 3: intégration chart — grisage TF/orderflow/VP, volume masqué, badge tradfi

**Files:**
- Modify: `apps/web/src/components/Toolbar.tsx` (lignes ~389 et ~413 : `SUPPORTED_TIMEFRAMES[exchange]` → `supportedTimeframesFor(exchange, symbol)` ; ligne ~395 : condition `noTradeStream` étendue à `exchange === "synthetic"` ; ligne ~554 : `disabled={isTradfi || exchange === "synthetic"}` pour Profil Vol)
- Modify: `apps/web/src/chart/indicators.ts` (filtrer l'instance `volume` quand `exchange === "synthetic"`)
- Modify: `apps/web/src/components/IndicatorMenu.tsx` (case Volume désactivée + tooltip « Volume non défini sur une série synthétique »)
- Modify: `apps/web/src/components/SymbolBanner.tsx` (badge marché fermé sur jambe tradfi)

**Interfaces:**
- Consumes: `supportedTimeframesFor` (Task 2), `parseSyntheticSymbol`, `formatSyntheticLabel` (Task 1), `isMarketOpen(kind, date)` (`data/ticker.ts:94`).

- [ ] **Step 1: Toolbar** — remplacer les deux lectures `SUPPORTED_TIMEFRAMES[...] ?? []` par `supportedTimeframesFor(exchange, symbol)` ; étendre la condition « sources sans flux tick » (commentaire ligne ~395) et le `disabled` du bouton Profil Vol comme indiqué ci-dessus. Le sélecteur de source ne liste PAS `synthetic` (on n'y « bascule » pas : on y entre par la recherche de paires, Task 4).
- [ ] **Step 2: Volume masqué** — dans `chart/indicators.ts`, au point où les instances actives sont appliquées au chart, filtrer : `const effectives = exchange === "synthetic" ? instances.filter((i) => i.defId !== "volume") : instances;`. Dans `IndicatorMenu.tsx`, désactiver la case `volume` (checkbox `disabled` + `title`) quand `exchange === "synthetic"`.
- [ ] **Step 3: SymbolBanner** — quand `exchange === "synthetic"` : afficher `formatSyntheticLabel(spec)` comme titre ; si une jambe est `twelvedata`, réutiliser la résolution de `kind` que le bandeau/ticker applique déjà aux paires twelvedata simples (chercher les usages de `isMarketOpen` dans `SymbolBanner.tsx`/`data/ticker.ts` ; si la jambe n'est pas résoluble, `"stocks"` par défaut, documenté) et si `!isMarketOpen(kind, new Date())` afficher le badge : `« jambe tradfi : dernier close (marché fermé) »` (span `text-text-dim`, à côté du titre).
- [ ] **Step 4: Vérification manuelle (Chrome DevTools MCP)** — charger `binance:ETHUSDT|/|binance:BTCUSDT` (via l'état persisté ou un `setSymbol` console en attendant Task 4) : chart live, RSI posable, TF grisés = intersection, boutons orderflow/VP grisés, pane Volume absent. `pnpm -r typecheck` vert.
- [ ] **Step 5: Commit** — `git commit -m "feat(syn): grisage TF/orderflow/VP, volume masqué, badge tradfi fermé"`

---

## Task 4: PairSearch mode constructeur + presets + récents persistés

**Files:**
- Create: `apps/web/src/store/synthetics.ts` (+ test)
- Modify: `apps/web/src/components/PairSearch.tsx`
- Modify: `apps/web/src/data/pairs.ts` (ajouter `UUP` au catalogue tradfi si absent — proxy ETF dollar/DXY, cohérent avec la ligne 99-102 « commodités via ETF »)
- Modify: `apps/web/src/store/persist.ts` (persistance des récents)

**Interfaces:**
- Consumes: `encodeSyntheticSymbol`, `parseSyntheticSymbol`, `formatSyntheticLabel` (Task 1).
- Produces: `syntheticsStore { recents: string[] (max 8, symboles encodés), addRecent(sym), setRecents(syms) }` ; `SYNTHETIC_PRESETS: { label: string; symbol: string }[]` =
  `[{ label: "ETH / BTC", symbol: "binance:ETHUSDT|/|binance:BTCUSDT" }, { label: "BTC / DXY (proxy UUP)", symbol: "binance:BTCUSDT|/|twelvedata:UUP" }, { label: "BTC / OR (proxy GLD)", symbol: "binance:BTCUSDT|/|twelvedata:GLD" }]`.

- [ ] **Step 1: Store + test** — `synthetics.ts` : store Zustand vanilla, `addRecent` dédoublonne (le plus récent en tête) et tronque à 8. Test : ajout, dédoublonnage, troncature (golden).
- [ ] **Step 2: Persistance** — suivre le pattern des fonctions `saveWatchlist`/`hydrateStores` de `persist.ts` : clé `axiom.synthetic.recents`, save sur subscribe du store, hydrate au boot (valider chaque entrée par `parseSyntheticSymbol` — jeter les invalides).
- [ ] **Step 3: PairSearch** — si la saisie contient `/` ou `-` (hors résultat exact du catalogue) OU clic sur un nouvel onglet/section « Synthétique » : afficher la section constructeur — presets + récents (libellés via `formatSyntheticLabel`), puis 2 champs jambe (chacun réutilisant la même liste filtrée que la recherche normale + un `<select>` source par jambe, défauts : source courante / `twelvedata` si le ticker vient du catalogue tradfi) + boutons op `/` `-`. Valider → `onSelect` avec `{ exchange: "synthetic", symbol: encodeSyntheticSymbol(spec) }` (même chemin que la sélection d'une paire normale) + `addRecent`. Si un flux « ajouter à la watchlist » est atteignable avec le symbole courant (bouton watchlist), le désactiver quand `exchange === "synthetic"` (limitation v1 de la spec).
- [ ] **Step 4: Vérification manuelle** — construire ETH/BTC, charger ; preset BTC/GLD, charger ; reload → récents présents, chart restauré (persistance `ChartState` existante). `pnpm --filter @axiom/web test -- synthetics` vert.
- [ ] **Step 5: Commit** — `git commit -m "feat(syn): constructeur PairSearch, presets, récents persistés"`

---

## Task 5: `lib/seasonality.ts` — moteur de saisonnalité (pur)

**Files:**
- Create: `apps/web/src/lib/seasonality.ts`
- Test: `apps/web/src/lib/seasonality.test.ts`

**Interfaces:**
- Produces: `SeasonMode = "monthly" | "weekday" | "hourly"` ; `SeasonCell { bucket: number; mean: number; median: number; winRate: number; n: number }` ; `bucketReturns(candles: Candle[], mode: SeasonMode): SeasonCell[]` (bucket = mois 0-11 / jour 0-6 lundi=0 / heure 0-23, **UTC**) ; `MonthCell { year: number; month: number; ret: number }` ; `monthlyMatrix(candles: Candle[]): MonthCell[]` (rendement du mois civil = dernier close du mois vs dernier close du mois précédent). Rendements simples `close/prev - 1`, en fraction (0.05 = +5 %).

- [ ] **Step 1: Tests** — bougies daily construites sur des dates UTC connues (ex. `Date.UTC(2024, 0, 1)` = lundi) : `bucketReturns(mode="weekday")` place les rendements dans les bons buckets (main-calc mean/median/winRate/n sur 2-3 valeurs par bucket) ; `monthlyMatrix` sur 3 mois de daily golden (closes 100→110→99 : janv +10 %, févr −10 %) ; buckets vides absents du résultat ; `mode="hourly"` avec des bougies 1h. Cas limites : série vide → `[]` ; 1 seule bougie → `[]` (pas de rendement).
- [ ] **Step 2: FAIL** — `pnpm --filter @axiom/web test -- seasonality`.
- [ ] **Step 3: Implémenter** — regrouper `close[i]/close[i-1] - 1` par `new Date(time).getUTCMonth()/getUTCDay() (converti lundi=0 : (d+6)%7)/getUTCHours()` ; médiane = tri + milieu (moyenne des 2 centraux si pair) ; winRate = part des rendements > 0. `monthlyMatrix` : dernier close par (année, mois) puis rendement vs mois précédent chronologique.
- [ ] **Step 4: PASS** puis **Step 5: Commit** — `git commit -m "feat(seag): moteur de saisonnalité pur (mensuel/hebdo/horaire)"`

---

## Task 6: fenêtre SEAG (heatmap canvas)

**Files:**
- Create: `apps/web/src/components/SeasonalityWindow.tsx`
- Modify: `apps/web/src/store/windowManager.ts` (entrée `WINDOW_REGISTRY` : `{ id: "seasonality", title: "Saisonnalité", mnemonic: "SEAG", defaultWidth: 760, defaultHeight: 560 }`) + màj du test de comptage `windowManager.test.ts`
- Modify: `apps/web/src/App.tsx` (rendu de la fenêtre + greffe des `commandes`)
- Modify: `apps/web/src/components/Toolbar.tsx` (entrée menu « Fonctions », pattern du commit `03c8171` RATE/COT)

**Interfaces:**
- Consumes: `bucketReturns`, `monthlyMatrix` (Task 5) ; `getAdapter` + pagination `fetchKlines({ endTime })` ; `windowManagerStore`, `mirrorOpenState`, `FloatingWindow` ; tokens thème via CSS-vars.
- Pattern à copier : **`MacroRatesWindow.tsx`** (UiStore vanilla `seasonalityUiStore` + `mirrorOpenState("seasonality", …)` + export `commandes: Commande[]` avec `{ id: "panneau:seasonality", mnemonique: "SEAG", libelle: "Saisonnalité", categorie: "panneau", motsCles: ["saisonnalité", "seasonality", "heatmap", "mensuel"] }`).

- [ ] **Step 1: Registre + fenêtre vide** — entrée `WINDOW_REGISTRY`, UiStore, `FloatingWindow` avec 3 onglets (Mensuel / Jour de semaine / Heure), App.tsx + menu Fonctions. Vérif : `SEAG` dans ⌘K ouvre la fenêtre.
- [ ] **Step 2: Données** — suit le symbole du groupe-couleur (même mécanique que `MacroRatesWindow`/Dérivés). Chargement paresseux par onglet : daily complet paginé (boucle `fetchKlines(symbol, "1d", { limit: 1000, endTime })` jusqu'à réponse < 1000, cap 10 000 bougies) ; 1h × 90 jours (`limit: 1000`, 3 pages max). États : chargement / indisponible / données (dégradation gracieuse, pattern MacroRatesWindow).
- [ ] **Step 3: Rendu canvas** — heatmap : X = mois (ou jour/heure), Y = années (vue mensuelle) ou barre unique (autres vues) ; couleur = interpolation 2 tokens (`--candle-down` ↔ `--candle-up`, alpha ∝ |ret| clampé au P90) ; texte % dans la cellule si largeur suffisante ; ligne de synthèse (moyenne par bucket) + winRate en pied. Survol : `mousemove` → cellule sous le curseur affichée dans l'en-tête (mean/median/winRate/n) — pas de tooltip flottant.
- [ ] **Step 4: Vérification manuelle** — BTCUSDT : vue mensuelle ≥ 5 ans cohérente (recouper 2-3 cellules avec TradingView) ; changement de symbole du groupe → recharge ; thèmes Dark et Bloomberg lisibles.
- [ ] **Step 5: Commit** — `git commit -m "feat(seag): fenêtre Saisonnalité (heatmap mensuelle/hebdo/horaire)"`

---

## Task 7: indicateur `RV` (`@axiom/indicators`)

**Files:**
- Create: `packages/indicators/src/volatility/rv.ts`
- Test: `packages/indicators/src/volatility/rv.test.ts`
- Modify: `packages/indicators/src/registry.ts` (import + enregistrement, section volatility ~ligne 65 ; màj du test de comptage du registre s'il existe)

**Interfaces:**
- Produces: `IndicatorDef` id `"rv"`, catégorie `"volatility"`, pane `"separate"`, inputs `length` (défaut 30, min 2) et `periodesParAn` (défaut 365, min 1 — 365 pour du daily crypto 24/7, 8760 pour du 1h ; `CalcContext` n'expose pas le timeframe, donc paramètre explicite documenté), output `rv` (ligne, en **%**).
- Formule : `rv[i] = stdev_population(logReturns[i-length+1..i]) × √periodesParAn × 100`, `logReturns[j] = ln(close[j]/close[j-1])` ; `undefined` tant que la fenêtre n'est pas pleine (alignement convention package, cf. en-tête `atr.ts`).

- [ ] **Step 1: Test golden** — série de closes main-calc (ex. `[100, 110, 104.5, 115]`, length 3 : lr = [ln1.1, ln0.95, ln1.1004…], stdev pop calculée à la main en commentaire, ×√365×100) ; premières positions `undefined` ; `periodesParAn` différent change l'échelle en √.
- [ ] **Step 2: FAIL** — `pnpm --filter @axiom/indicators test -- rv`.
- [ ] **Step 3: Implémenter** — même squelette que `atr.ts` (en-tête doc français, `calc(candles, params, _ctx)`), réutiliser `stdev` de `../utils` si sa signature s'applique à une fenêtre glissante, sinon boucle locale (population, documenté).
- [ ] **Step 4: PASS** (`pnpm --filter @axiom/indicators test`) puis **Step 5: Commit** — `git commit -m "feat(vol): indicateur RV (vol réalisée annualisée) dans @axiom/indicators"`

---

## Task 8: `lib/volCone.ts` + historique DVOL Deribit

**Files:**
- Create: `apps/web/src/lib/volCone.ts` (+ test)
- Modify: `apps/web/src/data/deribit.ts` (ajout `fetchDvolHistory`, sous `fetchDvol` ligne ~296) + `deribit.test.ts` (suivre le pattern de mock existant du fichier)

**Interfaces:**
- Produces: `realizedVolSeries(closes: number[], window: number, periodsPerYear: number): (number | null)[]` (en %, null fenêtre incomplète) ; `percentile(sortedAsc: number[], p: number): number` (interpolation linéaire) ; `VolConeRow { horizon: number; p5: number; p25: number; p50: number; p75: number; p95: number; current: number | null }` ; `volCone(closes: number[], horizons: number[], periodsPerYear?: number): VolConeRow[]` (défauts horizons `[7, 14, 30, 60, 90]`, ppa 365) ; `zScore(values: number[], current: number): number | null` (null si stdev 0 ou n < 2) ; `fetchDvolHistory(currency: "BTC" | "ETH", days: number): Promise<{ time: number; value: number }[]>` (`get_volatility_index_data`, résolution `"86400"`, lignes `[ts, o, h, l, c]` → `{ time: ts, value: c }`, même client `appelDeribit` que `fetchDvol` ligne 300).

- [ ] **Step 1: Tests golden** — `percentile([1,2,3,4], 50)` = 2.5 (main-calc interpolation) ; `realizedVolSeries` recoupé avec le golden RV de Task 7 (mêmes closes → même dernière valeur) ; `volCone` sur série construite (200 closes) : chaque row a p5 ≤ p25 ≤ p50 ≤ p75 ≤ p95 et `current` = dernière RV de l'horizon ; `zScore([10,10,10], 12)` = null (stdev 0), `zScore([8,12], 12)` main-calc ; `fetchDvolHistory` : mock fetch → mapping ts/close et paramètres d'appel corrects.
- [ ] **Step 2: FAIL**, **Step 3: Implémenter** (RV identique Task 7 en version série ; cône = pour chaque horizon, série RV(window=horizon) sur tout l'historique → tri → percentiles), **Step 4: PASS**.
- [ ] **Step 5: Commit** — `git commit -m "feat(vol): moteur cône de volatilité + historique DVOL Deribit"`

---

## Task 9: fenêtre VOL (cône + RV vs IV + VRP)

**Files:**
- Create: `apps/web/src/components/VolWindow.tsx`
- Modify: `apps/web/src/store/windowManager.ts` (`{ id: "vol", title: "Volatilité (cône RV, VRP)", mnemonic: "VOL", defaultWidth: 760, defaultHeight: 560 }`) + test de comptage
- Modify: `apps/web/src/App.tsx`, `apps/web/src/components/Toolbar.tsx` (menu Fonctions)

**Interfaces:**
- Consumes: `volCone`, `realizedVolSeries`, `zScore`, `fetchDvolHistory` (Task 8) ; pattern fenêtre `MacroRatesWindow` ; mnémonique `VOL`, id commande `panneau:vol`.

- [ ] **Step 1: Fenêtre + registre + menu** (comme Task 6 Step 1).
- [ ] **Step 2: Données** — daily 730 bougies du symbole du groupe (1 `fetchKlines`) ; devise IV : si le symbole commence par `BTC` → `"BTC"`, `ETH` → `"ETH"`, sinon pas d'IV. Si IV : `fetchDvolHistory(devise, 365)` en parallèle.
- [ ] **Step 3: Rendu canvas** — cône : X = horizons, bandes p5-p95 (alpha faible) et p25-p75 (alpha moyen), ligne p50, points `current` (token accent) ; panneau droit : RV30 vs DVOL superposés sur 1 an (2 lignes) + en-tête `RV30 x.x % · DVOL y.y % · VRP (IV−RV) z.z pts · z-score RV n.n`. Sans IV : cône seul + message « IV indisponible — Deribit ne cote que BTC/ETH ».
- [ ] **Step 4: Vérification manuelle** — BTC (cône + DVOL + VRP plausibles vs Deribit), SOLUSDT (message IV, cône OK), thèmes lisibles.
- [ ] **Step 5: Commit** — `git commit -m "feat(vol): fenêtre VOL — cône RV, RV vs DVOL, VRP, z-score"`

---

## Task 10: `chart/footprintAnalytics.ts` — imbalances + divergences (pur)

**Files:**
- Create: `apps/web/src/chart/footprintAnalytics.ts`
- Test: `apps/web/src/chart/footprintAnalytics.test.ts`

**Interfaces:**
- Consumes: types `FootprintRow { price, buyVol, sellVol }` et `FootprintBar { time, rows, poc, vah, val, delta }` exportés par `chart/orderflow.ts` (les exporter si internes).
- Produces: `ImbalanceFlags { askImb: boolean[]; bidImb: boolean[]; stackedAsk: boolean[]; stackedBid: boolean[] }` (index alignés sur `rows`, triées prix croissant) ; `detectImbalances(rows: FootprintRow[], ratioPct: number, minVol: number): ImbalanceFlags` ; `DivergenceFlag = "bull" | "bear" | null` ; `detectDeltaDivergences(candles: Candle[], bars: FootprintBar[]): DivergenceFlag[]` (aligné sur `bars` par `time`).
- Conventions (footprint standard) : **ask imbalance** au niveau i = `buyVol[i] ≥ (ratioPct/100) × sellVol[i-1]` (diagonale : agression acheteuse au niveau i vs passif vendeur un tick en dessous), avec `buyVol[i] ≥ minVol` ; si `sellVol[i-1] === 0`, imbalance ssi `buyVol[i] ≥ minVol && buyVol[i] > 0`. **bid imbalance** symétrique : `sellVol[i] ≥ (ratioPct/100) × buyVol[i+1]`. `stacked*` = membre d'une suite d'au moins 3 imbalances consécutives du même côté. Divergence : `bear` si `high > high précédent && delta < 0` ; `bull` si `low < low précédent && delta > 0` ; `null` sinon (et pour la première bougie).

- [ ] **Step 1: Tests golden** — rows construites à la main : cas ratio exactement au seuil (300 % : 30 vs 10 → imbalance), sous le seuil (29 vs 10 → non), `minVol` filtrant, diviseur 0, bord de tableau (i=0 pas d'ask imb, dernier niveau pas de bid imb) ; stacked : 3 consécutives marquées, 2 non ; divergences : séquence de 3 bougies main-calc (HH avec delta<0 → bear).
- [ ] **Step 2: FAIL**, **Step 3: Implémenter** (2 passes : flags puis runs consécutifs), **Step 4: PASS** (`pnpm --filter @axiom/web test -- footprintAnalytics`).
- [ ] **Step 5: Commit** — `git commit -m "feat(footprint): détection imbalances/stacked + divergences delta (pur)"`

---

## Task 11: rendu footprint pro + réglages

**Files:**
- Modify: `apps/web/src/store/orderflow.ts` (nouveaux champs + setters : `showImbalances: true`, `imbalanceRatioPct: 300`, `imbalanceMinVol: 0`, `showBarPoc: true`, `showBarVa: false`, `showDivergences: true`)
- Modify: `apps/web/src/chart/orderflow.ts` (`OrderflowController` : appel `detectImbalances`/`detectDeltaDivergences` au rendu, dessin des marqueurs)
- Modify: le panneau où vivent les réglages orderflow actuels (`SettingsPanel.tsx` ou la section orderflow existante — suivre l'emplacement du toggle footprint actuel) : 4 cases + champ numérique seuil %
- Test: étendre `apps/web/src/store/orderflow.test.ts` si existant (défauts + setters), sinon vérification manuelle (fichier chart-bound)

**Interfaces:**
- Consumes: `detectImbalances`, `detectDeltaDivergences` (Task 10) ; `bar.poc/vah/val` déjà calculés par `buildFootprintBar` (`orderflow.ts:103`) ; `readToken` (`orderflow.ts:65`).

- [ ] **Step 1: Store** — champs + setters, persistés avec les réglages orderflow existants s'ils le sont (suivre l'existant, ne pas inventer une persistance nouvelle).
- [ ] **Step 2: Rendu** — dans la boucle de rendu footprint du contrôleur : contour de cellule sur imbalance (`readToken("--of-imb-buy") || readToken("--candle-up")` / symétrique sell), liseré épaissi si stacked ; rectangle contour sur la cellule POC (`showBarPoc`) ; bande translucide val→vah (`showBarVa`) ; triangle 6 px au-dessus de la bougie si divergence (`showDivergences`, couleur up/down). Recalcul par bougie **au rendu seulement** (pas de cache store — cohérent BUILD-CONTRACT, les données restent hors store).
- [ ] **Step 3: Tokens** — balayer la zone `orderflow.ts:555-600` : tout littéral couleur restant hors position `|| fallback` passe par `readToken`.
- [ ] **Step 4: Vérification manuelle** — BTCUSDT 1m footprint : imbalances plausibles (recouper 2 cellules à la main depuis les volumes affichés), POC marqué = cellule au volume max visible, seuil 500 % réduit le nombre d'imbalances, toggles OFF nettoient le rendu, thème Bloomberg OK.
- [ ] **Step 5: Commit** — `git commit -m "feat(footprint): rendu imbalances/POC/VA/divergences + réglages"`

---

## Task 12: VPFR — volume profile à plage fixe (outil de dessin)

**Files:**
- Modify: `apps/web/src/chart/drawing.ts` (union `DrawingToolId` + `"volumeRange"` ; câblage `selectTool`/`createTrackedOverlay` — l'outil suit le flux standard des overlays à 2 points)
- Create: `apps/web/src/chart/volumeRangeOverlay.ts` (registerOverlay KLineChart, pattern `fibonacci.ts`) + test du helper pur
- Modify: `apps/web/src/components/DrawingToolbar.tsx` (`TOOLS` : `{ id: "volumeRange", label: "Profil de volume (plage)", Icon: VolumeRangeIcon }` + icône SVG inline simple (3 barres horizontales), grisé si `exchange === "synthetic"`)

**Interfaces:**
- Consumes: `computeVolumeProfile(candles, from, to, binCount): VolumeProfile | null` (`chart/volumeProfile.ts:59`, `VolumeProfile { bins, priceMin, priceMax, maxVol, pocIndex, vaLow, vaHigh }`) ; pattern overlay custom + `createPointFigures` de `fibonacci.ts` ; `createTrackedOverlay` (`drawing.ts:232`) pour la persistance 2 points.
- Produces: helper pur exporté `rangeIndices(times: number[], t1: number, t2: number): { from: number; to: number } | null` (bornes d'index inclusives triées, null si plage hors données).

- [ ] **Step 1: Test du helper** — `rangeIndices([10,20,30,40], 35, 15)` = `{ from: 1, to: 3 }` (bornes réordonnées, temps arrondi au bucket contenant) ; plage entièrement hors données → null ; timestamps exacts inclus.
- [ ] **Step 2: FAIL puis implémenter le helper.**
- [ ] **Step 3: Overlay** — `registerOverlay({ name: "volumeRange", totalStep: 3, … })` : dans `createPointFigures`, récupérer les bougies du chart (même accès aux données que `fibonacci.ts`/le contrôleur — `getDataList()` de l'instance), `rangeIndices` sur les 2 points, `computeVolumeProfile(candles, from, to + 1, 24)`, figures : cadre discret de la plage, barres horizontales (longueur ∝ volume, largeur max 30 % de la plage, ancrées au bord droit), ligne POC (token accent), bornes VA (2 lignes pointillées). Couleurs via tokens.
- [ ] **Step 4: Câblage** — `DrawingToolId`, entrée `TOOLS`, flux `selectTool("volumeRange")` → `createTrackedOverlay` (2 points capturés → persistance/restauration existantes marchent sans code neuf : vérifier `restoreDrawings` restaure bien un `volumeRange` posé).
- [ ] **Step 5: Vérification manuelle** — poser 3 VPFR sur BTCUSDT (dont un sur la même plage que le VPVR visible : POC identique), reload → restaurés, suppression clic-droit/flux existant OK, outil grisé sur un synthétique. Note connue (spec) : désalignement en échelle log/% hérité du moteur — ne pas le « corriger » ici.
- [ ] **Step 6: Commit** — `git commit -m "feat(vpfr): outil profil de volume à plage fixe (overlay persisté)"`

---

## Task 13: fin de lot — vérification complète

**Files:** aucun nouveau (corrections éventuelles uniquement).

- [ ] **Step 1: Suites complètes** — `pnpm -r typecheck && pnpm -r test && pnpm --filter @axiom/web build` → tout vert (y compris tests de comptage windowManager/registry mis à jour par T6/T7/T9).
- [ ] **Step 2: Vérification runtime (mode prod daemon : `pnpm prod`)** — dérouler la checklist de la spec §6 :
  1. ETH/BTC live + RSI + fib, reload OK ; 2. BTC/GLD daily (badge marché fermé si hors séance US, sinon forcer `isMarketOpen` à false en console pour constater le badge) ; 3. SEAG BTCUSDT 3 vues ; 4. VOL BTC puis SOL ; 5. footprint 1m imbalances/POC ; 6. VPFR posé/reload/supprimé.
- [ ] **Step 3: Captures** — `~/axiom-c1-syn.png` (ETH/BTC + indicateurs), `~/axiom-c1-seag.png`, `~/axiom-c1-vol.png`, `~/axiom-c1-footprint.png`.
- [ ] **Step 4: Commit final** — corrections de vérification éventuelles, message `chore(c1): vérification de fin de lot + captures`.
