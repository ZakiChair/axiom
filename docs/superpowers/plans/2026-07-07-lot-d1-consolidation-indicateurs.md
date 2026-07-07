# Lot D1 — Consolidation chart + indicateurs « terminal » : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Résorber les 3 vigilances chart (flash TF, VPVR log/%, sous-panes en grille) et livrer les 4 familles d'extensions indicateurs (dettes moteur, séries auxiliaires, Tier 1 edge, golden tests) définies dans la spec `docs/superpowers/specs/2026-07-07-lot-d1-consolidation-indicateurs-design.md`.

**Architecture:** Volet chart d'abord (le refactor de cycle de vie de `ChartInstance` précède tout ce qui s'y intègre), puis moteur indicateurs (validation, source, intra-bougie, sessions), puis contrat aux + nouveaux indicateurs, puis CVD spot/perp, golden tests, vérification finale.

**Tech Stack:** TypeScript strict, React 18, KLineChart 9.8.12, Zustand vanilla, vitest ; Python + pandas-ta-classic (génération de fixtures test-only, hors build).

## Global Constraints

- Moteur `@axiom/indicators` **pur et synchrone** : aucun fetch, aucun accès réseau/DOM.
- KLineChart 9.8.12 : vérifier toute API contre `apps/web/node_modules/klinecharts/dist/index.d.ts`, PAS contre la doc en ligne/context7 (leçon consignée).
- Budget 0 $/mois : aucune nouvelle source payante/à clé. WS de marché en direct (jamais proxifiés daemon).
- Commentaires et messages de commit en **français**. Couleurs canvas via `readToken("--…")` avec fallback littéral.
- Tests : `pnpm --filter @axiom/indicators test`, `pnpm --filter @axiom/web test` ; jamais commiter avec des tests rouges (leçon C1).
- Baseline : `main@5b41579`, 1046 tests verts. Les tests de comptage éventuels (registry) devront être mis à jour par la tâche qui ajoute des indicateurs.
- Déjà fait, NE PAS refaire : ticker watchlist multi-source (P0, `data/ticker.ts` gère kraken/coinbase/mexc en polling 30 s).

---

## Task 1: Refactor ChartInstance — réutilisation d'instance (fix flash TF)

**Files:**
- Modify: `apps/web/src/chart/ChartInstance.tsx` (l'unique `useEffect` lignes 248-578 → deux effets)
- Modify: `apps/web/src/chart/drawing.ts` (si nécessaire : rebinder la méta sans re-`bindChart` — voir Step 2)

**Interfaces:**
- Consumes: tout l'existant (`bindChart/unbindChart/restoreDrawings` `drawing.ts:126/171/303`, contrôleurs, `lastViewport` ligne 120).
- Produces: `ChartInstance` au comportement identique, mais l'instance KLineChart (et son DOM) survit aux changements `exchange/symbol/timeframe/replayGen`. Les tâches 3, 6, 14, 17 modifient ce fichier ensuite — cette structure est leur socle.

- [ ] **Step 1: Effet MONTAGE** (deps `[slot]`) — y déplacer : `init(chartDom)`, `applyChartTheme` + abonnement thème, construction `ChartIndicators` + `PaneHeaders` + abonnement `unsubscribePaneHeaders`, tout le bloc crosshair synchronisé (canvas, throttle, `subscribeAction` ×4, `unsubscribeXhairStore`), `updateThrottle`. Cleanup : symétrique de l'actuel pour ces éléments + capture `lastViewport` + `unbindChart` + `dispose(chart)`. L'instance est partagée avec l'effet données via un `useRef<KLineChartInstance | null>`.
- [ ] **Step 2: Effet DONNÉES** (deps `[exchange, symbol, timeframe, replayGen, isMaster]`) — y garder : liaison dessin (`bindChart(chart, { exchange, symbol }, slot)` — vérifier dans `drawing.ts` que re-`bindChart` sur un chart déjà lié REMPLACE proprement l'entrée du registre ; sinon ajouter `export function updateChartMeta(chart, meta): void`), abonnement `indicatorsStore` (capture `exchange`), bloc orderflow (`ensureOrderflow` + 2 abonnements), bloc contrôleurs maîtres (compare/vp/revenue/macro/derivativesChart + abonnements), abonnement `priceScaleStore` (référence `orderflow`), backfill → `applyNewData` → restauration viewport/dessins/indicateurs → `setLoadDataCallback` → `subscribeKline`. Garde anti-course : `let cancelled = false` reste dans CET effet.
- [ ] **Step 3: Cleanup de l'effet données** — tout désabonner/disposer SAUF le chart : `cancelled = true`, unsubscribe WS, dispose des contrôleurs, `chart.removeOverlay()` sans argument (purge les dessins de l'ANCIEN symbole sur CETTE instance — les panes d'indicateurs ne sont pas des overlays, ils survivent), capture `lastViewport` (le « même source seulement » existant reste valable), `chart.setLoadDataCallback(() => {})` inutile (écrasé au prochain run).
- [ ] **Step 4: Suite existante verte** — `pnpm --filter @axiom/web test` et `pnpm --filter @axiom/web typecheck`. Attendu : 701 tests verts (aucun test n'instancie ChartInstance directement, mais market.factory/paneOrder peuvent référencer des exports — corriger le cas échéant).
- [ ] **Step 5: Vérification runtime** (`pnpm --filter @axiom/web dev`) — BTCUSDT : changer 1m→5m→1h→1d : PAS de flash (fond/canvas stables, seule la série se recharge) ; changer de symbole (ETHUSDT) : dessins du nouveau symbole restaurés, ceux de l'ancien absents ; échelle log conservée après changement de TF ; grille 2×2 : TF d'un slot secondaire sans flash, crosshair sync OK ; REPLAY start/stop OK (le `replayGen` passe par l'effet données) ; retour mono-chart OK.
- [ ] **Step 6: Commit** — `git commit -m "refactor(chart): instance KLineChart réutilisée au changement de TF/symbole (fix flash)"`

---

## Task 2: VPVR aligné en échelle log/%

**Files:**
- Modify: `apps/web/src/chart/volumeProfile.ts` (fonction `render()`, mapping `yOf` lignes ~305-310)

**Interfaces:**
- Consumes: `this.toPx({ value })` (wrapper `convertToPixel`, ligne ~260) ; `computeVolumeProfile` inchangé.
- Produces: rendu VPVR correct quelle que soit l'échelle (`normal`/`log`/`percentage`).

- [ ] **Step 1: Remplacer l'interpolation linéaire** — supprimer `yOf` (interpolation `yMin`/`yMax`) ; pour chaque bin, calculer `yLow = this.toPx({ value: bin.priceLow }).y` et `yHigh = this.toPx({ value: bin.priceHigh }).y` (≈2×BIN_COUNT conversions par frame, négligeable — le VPFR fait pareil). Idem pour la ligne POC (`toPx({ value: pocPrice })`) et les bornes VA. Garder les gardes `undefined`/`Number.isFinite`.
- [ ] **Step 2: Typecheck + suite** — `pnpm --filter @axiom/web typecheck && pnpm --filter @axiom/web test` (le test existant `volumeProfile.test.ts` couvre `computeVolumeProfile`, pas le rendu — il doit rester vert).
- [ ] **Step 3: Vérification runtime** — BTCUSDT 1h, VPVR activé : en échelle log, poser un VPFR sur la plage visible → les deux POC coïncident visuellement ; en échelle %, les barres suivent les bougies ; en normal, rendu identique à avant.
- [ ] **Step 4: Commit** — `git commit -m "fix(vp): VPVR suit l'échelle de prix active (log/%) via convertToPixel par bin"`

---

## Task 3: OI/FUND sur tous les slots + badge orderflow + mnémonique MAP

**Files:**
- Modify: `apps/web/src/chart/ChartInstance.tsx` (bloc contrôleurs de l'effet données)
- Modify: `apps/web/src/chart/derivatives.ts` (si dédoublonnage nécessaire — voir Step 1)
- Modify: `apps/web/src/store/windowManager.ts:41` (mnemonic `IMAP` → `MAP`)
- Modify: `apps/web/src/commands/registry.ts` (alias `IMAP` conservé dans la palette)
- Test: mettre à jour tout test de comptage/mnémonique (`grep -rn "IMAP" apps/web/src --include="*.test.ts"`)

**Interfaces:**
- Consumes: `DerivativesChartController(chart, symbol)` (autonome, s'abonne lui-même — `chart/derivatives.ts`) ; structure 2-effets de la Task 1.
- Produces: sous-panes OI/FUND disponibles sur slots secondaires ; badge « Orderflow · slot focus » ; mnémonique `MAP` (+ alias `IMAP`).

- [ ] **Step 1: Sortir `derivativesChart` du bloc `isMaster`** — créer `new DerivativesChartController(chart, symbol)` pour TOUS les slots dans l'effet données. Lire `chart/derivatives.ts` d'abord : si le contrôleur poll Coinalyze par instance, vérifier qu'un cache par symbole existe (2 slots BTCUSDT = 1 seul fetch) ; sinon ajouter une mémo module-scope `Map<symbol, Promise>` TTL 60 s dans `derivatives.ts` (protège le quota 40 req/min, visible HealthPanel).
- [ ] **Step 2: Badge orderflow** — dans le JSX de `ChartInstance`, sous la bannière replay : `{orderflowEnabled && !isFocus && (<div className="pointer-events-none absolute right-1 top-1 z-20 rounded border border-border bg-surface/80 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-dim">Orderflow · slot focus</div>)}` avec `const orderflowEnabled = useStore(orderflowStore, (s) => s.enabled)`. Visible seulement en grille (masquer si layout mono : lire `chartLayoutStore` layout).
- [ ] **Step 3: Mnémonique** — `windowManager.ts:41` : `mnemonic: "MAP"`. Dans `commands/registry.ts`, repérer comment les mnémoniques deviennent des commandes ; ajouter une entrée alias `IMAP` → même action que `MAP` (recherche palette ⌘K : les deux matchent).
- [ ] **Step 4: Tests + typecheck** — mettre à jour les tests qui référencent `IMAP` ; suite web verte.
- [ ] **Step 5: Vérification runtime** — grille 2×2 : activer OI et FUND sur un slot secondaire (sous-panes visibles, données Coinalyze) ; badge visible sur les slots non-focus quand Orderflow est ON, absent en mono-chart ; ⌘K « MAP » et « IMAP » ouvrent la treemap.
- [ ] **Step 6: Commit** — `git commit -m "feat(grid): OI/FUND sur tous les slots, badge orderflow explicite, mnémonique MAP (+alias IMAP)"`

---

## Task 4: Engine — validation min/max des paramètres

**Files:**
- Modify: `packages/indicators/src/engine.ts` (`resolveParams`, lignes ~39-54)
- Test: `packages/indicators/src/engine.test.ts` (créer)

**Interfaces:**
- Consumes: `IndicatorInput.min/max` (`packages/types/src/index.ts:196-197`, déjà déclarés).
- Produces: `resolveParams` exporté (pour testabilité) : valeurs numériques non finies → défaut ; clamp `[min, max]` quand déclarés.

- [ ] **Step 1: Test failing**

```ts
import { describe, expect, it } from "vitest";
import { resolveParams } from "./engine";
const def = {
  id: "t", name: "t", category: "trend", pane: "overlay", outputs: [],
  inputs: [{ key: "period", name: "P", type: "number", default: 14, min: 1, max: 500 }],
  calc: () => ({ series: {} }),
} as never;
it("clamp et assainit les paramètres numériques", () => {
  expect(resolveParams(def, { period: 0 })).toEqual({ period: 1 });      // < min → min
  expect(resolveParams(def, { period: 10_000 })).toEqual({ period: 500 }); // > max → max
  expect(resolveParams(def, { period: Number.NaN })).toEqual({ period: 14 }); // NaN → défaut
  expect(resolveParams(def, { period: 21 })).toEqual({ period: 21 });    // valide → inchangé
});
```

- [ ] **Step 2: FAIL** — `pnpm --filter @axiom/indicators test -- engine` (resolveParams non exporté).
- [ ] **Step 3: Implémenter** — exporter `resolveParams` ; pour chaque `input.type === "number"` : si `typeof v !== "number" || !Number.isFinite(v)` → défaut ; sinon clamp `Math.min(input.max ?? v, Math.max(input.min ?? v, v))`.
- [ ] **Step 4: PASS + suite complète du package** (226 tests + nouveaux).
- [ ] **Step 5: Commit** — `git commit -m "feat(indicators): validation min/max + assainissement des paramètres (resolveParams)"`

---

## Task 5: Engine — input `source` câblé (RSI/SMA/EMA/WMA/MACD/Bollinger)

**Files:**
- Modify: `packages/types/src/index.ts` (`CalcContext` : + `source: number[]`)
- Modify: `packages/indicators/src/engine.ts` (`buildCalcContext` prend la source résolue)
- Modify: `packages/indicators/src/trend/{sma,ema,wma}.ts`, `momentum/{rsi,macd}.ts`, `volatility/bollinger*.ts` (noms exacts : `ls packages/indicators/src/{trend,momentum,volatility}`) — ajout input `{ key: "source", name: "Source", type: "source", default: "close", options: ["open","high","low","close","hl2","hlc3","ohlc4"] }` + `calc` lit `ctx.source` au lieu de `close`
- Test: étendre les tests des 6 defs

**Interfaces:**
- Consumes: `CalcContext.hl2/hlc3/ohlc4` existants.
- Produces: `CalcContext.source: number[]` — série résolue selon `params.source` (défaut `close`). Tout futur def mono-série peut déclarer l'input et lire `ctx.source`.

- [ ] **Step 1: Test failing** (exemple RSI ; même schéma pour les 6)

```ts
it("RSI sur hlc3 diffère de RSI sur close", () => {
  const a = computeIndicator(rsi, FIXTURE_CANDLES, { period: 14 });                    // close (défaut)
  const b = computeIndicator(rsi, FIXTURE_CANDLES, { period: 14, source: "hlc3" });
  expect(a.series.rsi).not.toEqual(b.series.rsi);
  // et b égale un RSI calculé à la main sur la série hlc3 de la fixture
});
```

- [ ] **Step 2: FAIL, puis implémenter** — `buildCalcContext(candles, sourceKey)` construit aussi `source` (switch sur `"open"|"high"|"low"|"close"|"hl2"|"hlc3"|"ohlc4"`) ; `computeIndicator` lit `resolved.source` (string, défaut `"close"`) AVANT d'appeler `buildCalcContext`. Les 6 defs remplacent leur lecture de `close` par `ctx.source`.
- [ ] **Step 3: PASS + suite complète** — attention aux tests existants des 6 defs : ils passent `close` implicite, résultats inchangés par défaut.
- [ ] **Step 4: Vérifier le SettingsPanel des indicateurs** — l'UI des inputs (`IndicatorMenu`/réglages) doit rendre le type `"source"` en `<select>` (chercher comment `"select"` est rendu ; si `"source"` n'est pas géré, le mapper sur le même rendu).
- [ ] **Step 5: Commit** — `git commit -m "feat(indicators): input source câblé (close/hl2/hlc3/… ) sur SMA/EMA/WMA/RSI/MACD/Bollinger"`

---

## Task 6: Bridge — recalcul intra-bougie throttlé (500 ms)

**Files:**
- Modify: `apps/web/src/chart/indicators.ts` (`ChartIndicators` : + `recomputeThrottled`)
- Modify: `apps/web/src/chart/ChartInstance.tsx` (`onKline`, branche non-close)
- Test: `apps/web/src/chart/indicators.throttle.test.ts` (créer — fake timers)

**Interfaces:**
- Consumes: `ChartIndicators.recompute(instances, candles, exchange)` existant (`indicators.ts:256`).
- Produces: `recomputeThrottled(instances, candles, exchange): void` — leading + trailing, période 500 ms ; `disposeThrottle(): void` appelé dans le cleanup.

- [ ] **Step 1: Test failing** (vitest `vi.useFakeTimers()`) — un spy sur `recompute` : 5 appels `recomputeThrottled` en 100 ms → `recompute` appelé 1× immédiatement, puis 1× (trailing) à t=500 ms ; un appel isolé → exécution immédiate ; `disposeThrottle` annule le trailing en attente.
- [ ] **Step 2: FAIL, puis implémenter** — champ privé `lastRun = 0`, `pending: ReturnType<typeof setTimeout> | null`. Si `now - lastRun >= 500` → exécuter tout de suite ; sinon programmer un trailing unique à `lastRun + 500` avec les DERNIERS arguments reçus.
- [ ] **Step 3: Câbler dans `onKline`** — branche `else` (bougie non close) : après `updateThrottle.trigger()`, appeler `indicators.recomputeThrottled(indicatorsStore.getState().indicators, store.getState().candles, exchange)`. La branche close garde `recompute` direct (flush exact). Cleanup effet données : `indicators.disposeThrottle()`.
- [ ] **Step 4: Suite + runtime** — RSI 1m affiché : la valeur bouge en cours de bougie (~2 mises à jour/s max), plus de « retard d'une bougie ».
- [ ] **Step 5: Commit** — `git commit -m "feat(indicators): recalcul intra-bougie throttlé 500 ms (RSI à la bougie près)"`

---

## Task 7: Pivots sessionnés — helper session + pivotStandard

**Files:**
- Create: `packages/indicators/src/utils-session.ts` + test
- Modify: `packages/indicators/src/support_resistance/pivotStandard.ts` + test

**Interfaces:**
- Produces: `utcDayOf(timeMs: number): number` (index de jour UTC = `Math.floor(timeMs / 86_400_000)`) ; `sessionExtents(candles: Candle[]): { dayIdx: number; high: number; low: number; close: number; from: number; to: number }[]` (agrégats H/L/C par jour UTC, ordre chronologique). `pivotStandard` : pour chaque bougie du jour J, niveaux calculés depuis les extents du jour J-1 (undefined pour le premier jour du buffer).

- [ ] **Step 1: Tests failing** — `utcDayOf(0) === 0`, `utcDayOf(86_400_000 - 1) === 0`, `utcDayOf(86_400_000) === 1` ; `sessionExtents` sur 2 jours de bougies 1h synthétiques → 2 entrées avec H/L/C corrects ; `pivotStandard` sur cette fixture : jour 1 → `undefined`, jour 2 → `P=(H1+L1+C1)/3`, `R1=2P-L1`, `S1=2P-H1` (vérifier valeurs à la main dans le test).
- [ ] **Step 2: FAIL, puis implémenter.** Le calc actuel (fenêtre globale) est remplacé ; les inputs existants du def sont conservés s'ils restent pertinents, sinon retirés (period global n'a plus de sens).
- [ ] **Step 3: PASS + suite du package.**
- [ ] **Step 4: Commit** — `git commit -m "feat(indicators): pivots standard sessionnés (session UTC, niveaux du jour précédent)"`

---

## Task 8: Pivots sessionnés — Camarilla, Woodie, Fibonacci, Demark

**Files:**
- Modify: `packages/indicators/src/support_resistance/{pivotCamarilla,pivotWoodie,pivotFibonacci,pivotDemark}.ts` + leurs tests

**Interfaces:**
- Consumes: `sessionExtents`/`utcDayOf` (Task 7). Formules par def INCHANGÉES (seule la fenêtre devient la session J-1) — Demark utilise aussi l'open du jour J-1 : étendre `sessionExtents` avec `open` si nécessaire.

- [ ] **Step 1: Pour chaque def** : test failing sur la fixture 2-jours de la Task 7 (valeurs attendues calculées à la main depuis les formules existantes du fichier), puis bascule du calc sur `sessionExtents`, PASS.
- [ ] **Step 2: Suite complète du package.**
- [ ] **Step 3: Commit** — `git commit -m "feat(indicators): pivots Camarilla/Woodie/Fibonacci/Demark sessionnés"`

---

## Task 9: VWAP à reset de session (vwap + vwapBands)

**Files:**
- Modify: `packages/indicators/src/volume/vwap.ts`, `volume/vwapBands.ts` + tests

**Interfaces:**
- Consumes: `utcDayOf` (Task 7).
- Produces: VWAP cumulé DEPUIS minuit UTC (reset à chaque changement de `utcDayOf`), au lieu de « depuis le début du buffer ». vwapBands suit (bandes σ sur la même session).

- [ ] **Step 1: Test failing** — fixture 2 jours : à la première bougie du jour 2, VWAP = typicalPrice de cette bougie (cumul repart) ; dernière bougie du jour 1 ≠ première du jour 2.
- [ ] **Step 2: FAIL, puis implémenter** (reset des accumulateurs quand `utcDayOf` change). Adapter les tests existants (qui supposent le cumul global).
- [ ] **Step 3: PASS + suite. Commit** — `git commit -m "feat(indicators): VWAP et VWAP bands à reset de session UTC"`

---

## Task 10: AVWAP — ancrage par timestamp + outil d'ancrage au clic

**Files:**
- Modify: `packages/indicators/src/volume/anchored-vwap.ts` + test (`anchorIndex` → `anchorTime`)
- Modify: `apps/web/src/chart/drawing.ts` (union `DrawingToolId` + `"avwapAnchor"`)
- Modify: `apps/web/src/components/DrawingToolbar.tsx` (entrée outil + icône ⚓ SVG inline)
- Modify: `apps/web/src/store/indicators.ts` (lecture seule — vérifier la forme `ActiveIndicator` pour l'ajout d'instance)

**Interfaces:**
- Produces: def `anchoredVwap` avec input `{ key: "anchorTime", type: "number", default: 0 }` (timestamp ms ; 0 = depuis le début, comportement legacy). Le calc trouve le premier index `candles[i].time >= anchorTime`. Compat : si un paramètre persisté `anchorIndex` existe encore, l'ignorer (défaut). Outil `avwapAnchor` : au clic (overlay 1 point, `totalStep: 2`), ajoute une instance AVWAP avec `anchorTime` = timestamp de la bougie cliquée puis supprime l'overlay (l'outil est un « picker », pas un dessin persistant).

- [ ] **Step 1: Test failing** — `anchorTime` égal au timestamp de la 3e bougie → mêmes valeurs que l'ancien `anchorIndex: 2` (reprendre la fixture du test existant lignes 12-26) ; `anchorTime` entre deux bougies → ancre sur la suivante ; `anchorTime: 0` → cumul complet.
- [ ] **Step 2: FAIL, puis implémenter le def. PASS.**
- [ ] **Step 3: Outil picker** — suivre le flux `selectTool`/`registerOverlay` de `fibonacci.ts` : `onDrawEnd` (1 point posé) → `indicatorsStore.getState()` ajout d'instance `anchoredVwap` avec `params: { anchorTime }` (relire la mécanique multi-instances P1 dans `store/indicators.ts`), puis `chart.removeOverlay({ id })`.
- [ ] **Step 4: Runtime** — clic ⚓ sur une bougie → courbe AVWAP démarre là ; scroll gauche (backfill) → la courbe ne se décale PAS (l'ancrage timestamp tient) ; reload → instance persistée correcte.
- [ ] **Step 5: Suite + commit** — `git commit -m "feat(indicators): AVWAP ancrée par timestamp + outil d'ancrage au clic"`

---

## Task 11: Contrat séries auxiliaires (types + engine + alignAux)

**Files:**
- Modify: `packages/types/src/index.ts` (`AuxSeriesId`, `IndicatorDef.aux?`, `IndicatorDef.minTimeframe?`, `CalcContext.aux?`)
- Modify: `packages/indicators/src/engine.ts` (`computeIndicator(def, candles, params?, aux?)`)
- Create: `packages/indicators/src/utils-aux.ts` + test (`alignAux`)

**Interfaces:**
- Produces (types) :

```ts
export type AuxSeriesId = "oi" | "funding" | "stablecoins" | "nvt" | "mvrv";
export type AuxSeries = Partial<Record<AuxSeriesId, Array<number | undefined>>>;
// IndicatorDef : + aux?: AuxSeriesId[]; + minTimeframe?: Timeframe;
// CalcContext  : + aux?: AuxSeries;
```

- Produces (moteur) : `computeIndicator(def, candles, params?, aux?: AuxSeries)` — place `aux` dans le ctx ; moteur toujours pur (l'appelant fournit des séries DÉJÀ alignées sur `candles`).
- Produces (helper) : `alignAux(candleTimes: number[], points: { time: number; value: number }[]): Array<number | undefined>` — dernière valeur connue ≤ t (two-pointer, points supposés triés), `undefined` avant le premier point.

- [ ] **Step 1: Test failing alignAux** — `alignAux([10,20,30,40], [{time:15,value:1},{time:30,value:2}])` = `[undefined, 1, 2, 2]` ; points vides → tout `undefined` ; point exactement à t inclus.
- [ ] **Step 2: FAIL, implémenter, PASS.**
- [ ] **Step 3: Étendre types + signature `computeIndicator`** (paramètre optionnel — 0 rupture d'appelants existants). Typecheck des 6 packages.
- [ ] **Step 4: Commit** — `git commit -m "feat(indicators): contrat séries auxiliaires (aux/minTimeframe, alignAux) — moteur toujours pur"`

---

## Task 12: AuxProvider — fetch, alignement, cache, notification

**Files:**
- Create: `apps/web/src/chart/auxProvider.ts` + `auxProvider.test.ts`

**Interfaces:**
- Consumes: `coinalyzeProvider.fetchOpenInterestHistory / fetchFundingRateHistory` (`data/coinalyze.ts`, `IDerivedDataProvider`) ; supply stablecoins (`data/macro/stablecoins.ts` — lire ses exports) ; `fetchCoinMetrics` (`data/onchain/coinmetrics.ts:133` — métriques Community `NVTAdj`, `CapMVRVCur`) ; `alignAux` (Task 11).
- Produces:

```ts
export type AuxStatus =
  | { status: "ready"; aux: AuxSeries }
  | { status: "pending" }
  | { status: "error"; message: string };
export class AuxProvider {
  /** Retourne l'état courant ; déclenche les fetchs manquants et rappelle onReady quand ils aboutissent. */
  getAligned(req: {
    exchange: ExchangeId; symbol: string; timeframe: Timeframe;
    ids: AuxSeriesId[]; candleTimes: number[];
  }, onReady: () => void): AuxStatus;
}
export const auxProvider = new AuxProvider(); // singleton module (cache partagé entre slots)
```

- Cache brut par `(id, symbol)` avec TTL : 60 s pour `oi`/`funding`, 1 h pour `stablecoins`/`nvt`/`mvrv` (séries quotidiennes). L'alignement (`alignAux`) est recalculé à chaque `getAligned` (dépend de `candleTimes`), le FETCH est mémoïsé. Un fetch en échec mémorise `error` 30 s (pas de retry-tempête).

- [ ] **Step 1: Tests failing** (mock des fetchs, pattern `extapi.test.ts`) — 1er appel → `pending` + fetch déclenché ; après résolution → `onReady` appelé, 2e appel → `ready` avec séries alignées ; échec fetch → `error` puis pas de re-fetch avant 30 s ; deux `getAligned` simultanés même clé → UN fetch.
- [ ] **Step 2: FAIL, implémenter, PASS.** Mapping des fetchs : `oi`→`fetchOpenInterestHistory(symbol, "1hour", now-90j)` ; `funding`→`fetchFundingRateHistory(symbol, "1hour", now-90j)` (vérifier les intervalles `COINALYZE_INTERVALS` acceptés, `coinalyze.ts:46`) ; `nvt`/`mvrv`→`fetchCoinMetrics` avec l'asset dérivé du symbole (BTCUSDT→btc — réutiliser le mapping existant du OnchainWindow) ; `stablecoins`→ série totale DefiLlama existante.
- [ ] **Step 3: Commit** — `git commit -m "feat(chart): AuxProvider — fetch/alignement/cache des séries auxiliaires (OI, funding, stablecoins, NVT, MVRV)"`

---

## Task 13: Defs `derivatives` purs — OI, Funding, Stablecoins, NVT, MVRV, Funding z-score

**Files:**
- Create: `packages/indicators/src/derivatives/{openInterest,fundingRate,stablecoinSupply,nvt,mvrv,fundingZScore}.ts` + 6 tests
- Modify: `packages/indicators/src/registry.ts` (+6 ; mettre à jour tout test de comptage)

**Interfaces:**
- Consumes: `ctx.aux` (Task 11) ; `stdev` (`utils.ts`) pour le z-score.
- Produces: 6 `IndicatorDef` catégorie `"derivatives"`, pane `"separate"` :
  - `openInterest` — aux `["oi"]`, minTimeframe `"1h"`, output line (recopie `ctx.aux.oi`).
  - `fundingRate` — aux `["funding"]`, minTimeframe `"1h"`, output histogram.
  - `stablecoinSupply` — aux `["stablecoins"]`, minTimeframe `"1d"`, output line.
  - `nvt` / `mvrv` — aux `["nvt"]`/`["mvrv"]`, minTimeframe `"1d"`, output line.
  - `fundingZScore` — aux `["funding"]`, minTimeframe `"1h"`, input `{ key: "window", default: 30, min: 5, max: 500 }`, output line : `(f[i] − mean(fenêtre)) / stdev(fenêtre)` sur les `window` derniers points définis, `undefined` tant que < `window` points.

- [ ] **Step 1: Tests failing** — chaque def : aux absent (`ctx.aux` undefined) → série tout `undefined` (JAMAIS de throw) ; aux fourni → valeurs recopiées/calculées. fundingZScore : fixture 35 points constants → z=0 à partir du 30e ; un pic → z élevé (valeur vérifiée à la main).
- [ ] **Step 2: FAIL, implémenter, PASS.** Registre +6 (`getIndicator("fundingZScore")` etc.), tests de comptage ajustés.
- [ ] **Step 3: Suite complète du package. Commit** — `git commit -m "feat(indicators): catégorie derivatives peuplée — OI, funding, stablecoins, NVT, MVRV, funding z-score"`

---

## Task 14: Bridge aux-aware + menu grisé + état « Indisponible »

**Files:**
- Modify: `apps/web/src/chart/indicators.ts` (`ChartIndicators.sync/recompute` : injection aux)
- Modify: `apps/web/src/components/IndicatorMenu.tsx` (grisage par `minTimeframe` ; libellé « (1h+) » / « (1d) »)
- Test: étendre un test existant du bridge s'il y en a un ; sinon test pur du helper de comparaison TF (créer `apps/web/src/chart/tfOrder.test.ts`)

**Interfaces:**
- Consumes: `auxProvider.getAligned` (Task 12) ; `def.aux`/`def.minTimeframe` (Task 11/13).
- Produces: helper pur `tfAtLeast(tf: Timeframe, min: Timeframe): boolean` (ordre des TF — réutiliser/adapter `TF_MS` de `data/replayFeed.ts:31` plutôt qu'une 3e table si exportable proprement) ; bridge : pour un def avec `aux`, appel `auxProvider.getAligned(..., onReady = re-sync de cet indicateur)` — `pending` → série vide + le pane affiche le nom avec suffixe « … » ; `error` → suffixe « (indisponible) » ; `ready` → `computeIndicator(def, candles, params, aux)`.

- [ ] **Step 1: Test `tfAtLeast`** — `tfAtLeast("4h","1h")=true`, `tfAtLeast("15m","1h")=false`, `tfAtLeast("1d","1d")=true`. FAIL → implémenter → PASS.
- [ ] **Step 2: Bridge** — dans le chemin `sync`/`recompute`, brancher l'injection aux (le `onReady` doit re-déclencher UNIQUEMENT le recalcul, pas une re-création de pane). Le suffixe d'état passe par le titre du pane (relire comment `paneHeaders`/`createIndicator` nomme les panes — utiliser le même canal).
- [ ] **Step 3: Menu** — entrée grisée + tooltip si `minTimeframe` non satisfait par le TF du chart maître (`disabled` + `title="Nécessite ≥ 1h"`).
- [ ] **Step 4: Runtime** — BTCUSDT 1h : activer Open Interest + Funding z-score → séries affichées après un court « … » ; passer en 15m → menu grise OI/funding ; NVT grisé partout sauf 1d+ ; couper le réseau (DevTools offline) → « (indisponible) », pas de pane vide silencieux.
- [ ] **Step 5: Suite + commit** — `git commit -m "feat(chart): indicateurs auxiliaires branchés — injection AuxProvider, menu grisé par TF, état indisponible"`

---

## Task 15: ATR régime (percentile roulant)

**Files:**
- Create: `packages/indicators/src/volatility/atrRegime.ts` + test
- Modify: `packages/indicators/src/registry.ts` (+1, comptages)

**Interfaces:**
- Consumes: le calcul ATR existant (`volatility/atr.ts` — réutiliser sa fonction interne si exportée, sinon dupliquer la RMA-Wilder via `utils.ts`).
- Produces: def `atrRegime`, pane separate, inputs `{ period: 14 (min 2, max 100), lookback: 100 (min 20, max 1000) }`, output line `pct` ∈ [0, 100] : rang percentile de `ATR[i]` parmi `ATR[i-lookback+1 … i]` (`100 × (nb valeurs ≤ courante − 1) / (lookback − 1)`), `undefined` tant que < lookback valeurs d'ATR.

- [ ] **Step 1: Test failing** — fixture où l'ATR croît strictement → pct final = 100 ; ATR constant → pct = 100 (toutes ≤) — documenter ce choix dans le test ; premières bougies → `undefined`.
- [ ] **Step 2: FAIL, implémenter, PASS. Registre + comptages. Commit** — `git commit -m "feat(indicators): ATR régime — percentile roulant de volatilité (0-100)"`

---

## Task 16: CVD spot vs perp — flux perp + détecteur pur

**Files:**
- Modify: `apps/web/src/data/binanceFutures.ts` (+ WS aggTrade perp)
- Create: `apps/web/src/chart/cvdSpotPerp.ts` + test (détecteur pur + agrégation par bougie)

**Interfaces:**
- Produces (data) : `subscribePerpAggTrades(symbol: string, cb: (t: Trade) => void): Unsubscribe` — WS `wss://fstream.binance.com/ws/{symbol.toLowerCase()}@aggTrade`, mapping `m ? "sell" : "buy"` (même convention que le spot, `chart/orderflow.ts`), reconnexion : copier le pattern du WS spot existant (`data/binance.ts`).
- Produces (pur) :

```ts
export interface CvdBucket { time: number; spot: number; perp: number } // CVD cumulés à la clôture du bucket
export interface CvdDivergence { time: number; kind: "spotUp_perpDown" | "spotDown_perpUp" }
export function detectCvdDivergences(buckets: CvdBucket[], lookback: number): CvdDivergence[];
```

- L'ACCUMULATION (trades → `CvdBucket[]` par bougie) vit dans le contrôleur (Task 17), comme le CVD existant ; seule la DÉTECTION est exportée pure ici.

- Définition EXACTE de la divergence (à coder telle quelle) : pour chaque i ≥ lookback, `dSpot = spot[i] − spot[i−lookback]`, `dPerp = perp[i] − perp[i−lookback]` ; marquer si `sign(dSpot) ≠ sign(dPerp)` ET `|dSpot| ≥ médiane(|dSpot| sur les lookback dernières fenêtres)` ET idem pour `|dPerp|` (filtre anti-bruit). `lookback` défaut 14.

- [ ] **Step 1: Test failing du détecteur** — fixture 40 buckets : spot monotone croissant, perp croissant puis décroissant sur les 15 derniers → divergences `spotUp_perpDown` détectées uniquement dans la zone divergente ; séries parallèles → aucune ; amplitudes minuscules sous la médiane → aucune.
- [ ] **Step 2: FAIL, implémenter, PASS.**
- [ ] **Step 3: WS perp** — implémentation + test de mapping du message (fixture JSON aggTrade fstream → `Trade`), pattern `tradeMapping.test.ts` existant.
- [ ] **Step 4: Commit** — `git commit -m "feat(orderflow): flux aggTrade perp Binance + détecteur pur de divergences CVD spot/perp"`

---

## Task 17: CVD spot vs perp — sous-pane + réglages

**Files:**
- Modify: `apps/web/src/chart/orderflow.ts` OU create `apps/web/src/chart/cvdSpotPerpController.ts` (suivre l'architecture du CVD existant — lire `orderflow.ts` d'abord : si le CVD actuel est un pane KLineChart custom, répliquer ; le contrôleur est chart-bound, PAS de singleton module — leçon C1/VPFR)
- Modify: `apps/web/src/store/orderflow.ts` (+ `cvdSpotPerp: boolean` persisté, défaut false)
- Modify: le panneau de réglages orderflow (`FootprintSettingsPanel.tsx` ou section existante — suivre l'emplacement des toggles actuels)

**Interfaces:**
- Consumes: `subscribePerpAggTrades`, `detectCvdDivergences` (Task 16) ; flux spot aggTrade existant du contrôleur orderflow.
- Produces: sous-pane « CVD S/P » (slot FOCUS uniquement, comme le reste de l'orderflow) : 2 courbes (spot = token `--up` fallback `#10b981`, perp = token `--accent` fallback `#f5c518`), triangles de divergence au-dessus du pane (même style que les divergences delta du footprint C1).

- [ ] **Step 1: Store** — champ + setter + persistance (suivre les champs orderflow existants). Test store si `orderflow.test.ts` existe (défaut false + setter).
- [ ] **Step 2: Contrôleur** — activer/désactiver selon `cvdSpotPerp && focus` ; cumul par bougie du buffer du slot ; rendu ; dispose propre (unsubscribe WS perp).
- [ ] **Step 3: Réglages** — toggle « CVD spot vs perp » à côté des réglages footprint ; grisé si source ≠ binance (le flux est Binance-only, comme le footprint).
- [ ] **Step 4: Runtime** — BTCUSDT 1m orderflow ON + toggle ON : deux CVD divergent/convergent plausiblement, triangles rares (pas à chaque bougie), OFF nettoie le pane, changement de TF (Task 1 !) sans fuite (une seule connexion fstream — vérifier onglet Réseau).
- [ ] **Step 5: Suite + commit** — `git commit -m "feat(orderflow): sous-pane CVD spot vs perp avec marqueurs de divergence"`

---

## Task 18: Golden tests — ADX, SuperTrend, Ichimoku, PSAR vs pandas-ta-classic

**Files:**
- Create: `scripts/golden/generate.py` (+ `scripts/golden/README.md` : `pip install pandas-ta-classic`, usage)
- Create: `packages/indicators/src/golden/fixture-ohlcv.json` (300 bougies BTCUSDT 1h réelles, exportées UNE fois — n'importe quel extrait figé convient, committé)
- Create: `packages/indicators/src/golden/{adx,supertrend,ichimoku,psar}.golden.json` (générés par le script, committés)
- Create: `packages/indicators/src/golden/golden.test.ts`

**Interfaces:**
- Consumes: defs existants via `getIndicator("adx" | "supertrend" | "ichimoku" | "psar")` (vérifier les ids exacts dans `registry.ts`).
- Produces: garde de non-régression numérique. Le test vitest NE lance PAS Python : il compare nos sorties aux JSON committés. Le script Python ne sert qu'à (re)générer les golden.

- [ ] **Step 1: Script** — `generate.py` lit `fixture-ohlcv.json`, calcule via pandas-ta-classic (`adx(14)`, `supertrend(10,3)`, `ichimoku(9,26,52)`, `psar(0.02,0.2)`), écrit un JSON `{ params, series: { colonne: number|null[] } }` par indicateur. Lancer, committer les golden.
- [ ] **Step 2: Test failing** — pour chaque indicateur : aligner nos séries de sortie sur les colonnes pandas-ta (mapper les noms), comparer point à point avec `toBeCloseTo(v, 6)` À PARTIR du premier index où LES DEUX sont définis. Si une divergence de convention d'amorçage apparaît (probable sur SuperTrend/PSAR) : NE PAS élargir la tolérance — exclure explicitement les N premiers points avec un commentaire chiffré (`// pandas-ta amorce PSAR sur la bougie 1, nous sur la 2 : premiers 5 points exclus, écart max observé ensuite 1e-9`).
- [ ] **Step 3: Itérer jusqu'à PASS** — si un écart RÉEL apparaît (pas une convention d'amorçage), c'est un bug d'un des deux côtés : investiguer avant de choisir (documenter la conclusion dans le test).
- [ ] **Step 4: Suite + commit** — `git commit -m "test(indicators): golden tests ADX/SuperTrend/Ichimoku/PSAR vs pandas-ta-classic (fixtures committées)"`

---

## Task 19: Fin de lot — vérification complète

**Files:** aucun nouveau (corrections éventuelles uniquement).

- [ ] **Step 1: Suites complètes** — `pnpm -r typecheck && pnpm -r test && pnpm --filter @axiom/web build` → tout vert (≥ 1046 + nouveaux).
- [ ] **Step 2: Checklist runtime (mode prod daemon `pnpm prod`)** — dérouler la spec §Vérification :
  1. TF 1m→1h→1d sans flash, mono ET 2×2 ; 2. VPVR log = POC du VPFR ; 3. OI/FUND slot secondaire + badge orderflow ; 4. RSI intra-bougie + RSI(hlc3) ≠ RSI(close) ; 5. VWAP session (rupture à minuit UTC visible en 1h) ; 6. AVWAP clic + survie au backfill ; 7. OI/funding z-score affichés, NVT grisé sous 1d, mode offline → « indisponible » ; 8. CVD S/P + divergences ; 9. ⌘K MAP/IMAP ; 10. REPLAY start/stop.
- [ ] **Step 3: Captures** — `~/axiom-d1-noflash.png` (avant/après TF), `~/axiom-d1-derivatives.png` (OI+funding z-score), `~/axiom-d1-cvdsp.png`, `~/axiom-d1-vpvr-log.png`.
- [ ] **Step 4: Commit final** — corrections éventuelles, message `chore(d1): vérification de fin de lot + captures`.
