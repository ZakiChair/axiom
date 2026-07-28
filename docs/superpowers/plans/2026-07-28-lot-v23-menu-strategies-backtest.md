# Lot v2.3 — Menu Stratégies dédié + stratégies backtestées : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Bouton Toolbar « Stratégies » avec menu dédié (foyer exclusif), 5 nouvelles stratégies (dont un champion sélectionné par une campagne de backtest réelle anti-overfit), presets BT (registre 167 → 172).

**Architecture :** `StrategyMenu` = composant dédié au patron d'`IndicatorMenu` (briques réutilisées, pas d'abstraction générique) ; stratégies via `defStrategie` sur des cœurs extraits (`ttmSqueezeOf`/`ichimokuOf`/`adxOf`/`psarOf`) ; campagne = script Bun réutilisant les fonctions PURES exportées de la fabrique (`etatsStrategie` + `construireTradesStrategie`) + `runBacktest` en contre-épreuve ; rapport chiffré commité.

**Tech stack :** TypeScript, React (apps/web), Bun (script), Vitest.

**Spec :** `docs/superpowers/specs/2026-07-28-lot-v23-menu-strategies-backtest-design.md`.

## Global Constraints

- Docblocks FR ; calculs PURS ; `noUncheckedIndexedAccess` ; chirurgie stricte.
- Extractions de cœurs = REFACTOR PUR (patron `rsiOf` — corps déplacé à l'identique, calc délègue, AUCUN test existant modifié, golden compris).
- Toute stratégie via `defStrategie` ; fixtures prouvées non tautologiques ; mutation-kill pour les non-traçables (patron v2.2).
- **Honnêteté backtest (prime sur tout)** : mesures PASSÉES jamais présentées comme promesses ; critères champion PRÉ-DÉCLARÉS (spec §3) : expectancy > 0 dans les 4 cellules (BTC/ETH × 1h/4h) ET chaque moitié temporelle, départage par expectancy médiane, UN seul jeu de params partout ; si aucun ne passe → « champion relatif, non robuste » consigné tel quel.
- Foyer exclusif : le menu Indicateurs ne montre plus JAMAIS une stratégie (catalogue ET section Actifs) ; palette ⌘K inchangée ; persistance commune inchangée.
- `pnpm check` vert par branche + post-merge ; gate visuel final.
- Branches : B1 `feat/menu-strategies-dedie` (Task 1) → merge ; B2 `feat/strategies-v23` (Tasks 2-4) → merge ; B3 `feat/campagne-backtest` (Tasks 5-8) → merge ; Task 9 = gate.

---

### Task 1 : `StrategyMenu` + foyer exclusif (B1)

**Files:**
- Create: `apps/web/src/components/StrategyMenu.tsx`
- Create: `apps/web/src/components/StrategyMenu.test.tsx` (si l'infra composant manque : tests des helpers purs seulement — voir Step 4)
- Modify: `apps/web/src/components/IndicatorMenu.tsx` (export `InstanceParamsEditor`, filtre `category !== "strategy"`)
- Modify: `apps/web/src/components/Toolbar.tsx` (~ligne 561 : `<StrategyMenu />` juste après `<IndicatorMenu />`)

**Interfaces:**
- Consumes : `INDICATORS`/`getIndicator` (@axiom/indicators), `indicatorsStore` (add/remove/duplicate/updateParams), `marketStore` (exchange/timeframe), `InstanceParamsEditor` (à exporter), `indexRoving` (./ui), `tfAtLeast` (../chart/tfOrder).
- Produces : composant `StrategyMenu` (bouton + panneau) ; helpers purs exportés `defsStrategie()` et `defsAnalyse()` (partition du registre par catégorie).

- [ ] **Step 1 : Helpers purs + test (échec attendu)**

En tête de `StrategyMenu.tsx` (exportés pour test) :

```ts
/** Defs de catégorie strategy (catalogue du menu Stratégies). PURE. */
export function defsStrategie(): IndicatorDef[] {
  return INDICATORS.filter((d) => d.category === "strategy");
}
```

Dans `IndicatorMenu.tsx`, remplacer les usages directs d'`INDICATORS` (compteur
ligne ~244/253, base du filtre ligne ~191-192) par une constante module
exportée :

```ts
/** Catalogue du menu Indicateurs : TOUT sauf les stratégies (foyer exclusif — menu Stratégies). */
export const INDICATEURS_ANALYSE = INDICATORS.filter((d) => d.category !== "strategy");
```

et filtrer la section Actifs : `active.filter((i) => getIndicator(i.defId)?.category !== "strategy")`
(constante locale `activesAnalyse` utilisée par la section Actifs ET le badge du bouton).

Test (`StrategyMenu.test.tsx`, env node, sans DOM — tester les partitions) :

```ts
import { describe, expect, it } from "vitest";
import { INDICATORS } from "@axiom/indicators";
import { defsStrategie } from "./StrategyMenu";
import { INDICATEURS_ANALYSE } from "./IndicatorMenu";

describe("partition stratégies / analyse (foyer exclusif)", () => {
  it("les deux catalogues partitionnent le registre sans recouvrement", () => {
    expect(defsStrategie().length + INDICATEURS_ANALYSE.length).toBe(INDICATORS.length);
    const ids = new Set(defsStrategie().map((d) => d.id));
    expect(INDICATEURS_ANALYSE.some((d) => ids.has(d.id))).toBe(false);
    expect(defsStrategie().every((d) => d.category === "strategy")).toBe(true);
  });
});
```

Run : `pnpm -C apps/web exec vitest run src/components/StrategyMenu.test.tsx` → FAIL (module absent).

- [ ] **Step 2 : Écrire `StrategyMenu.tsx`**

Composant complet, patron `IndicatorMenu` (state `open`/`query`/`editingId`,
zone `fixed inset-0` de fermeture, panneau `absolute left-0 top-full z-50 mt-1
w-72`, navigation clavier via `indexRoving` sur `button[data-item-strategie]`,
Échap ferme) — différences voulues : catalogue PLAT (pas de sections par
catégorie), bouton libellé « Stratégies », badge = `activesStrategie.length`
sinon `defsStrategie().length`, placeholder de recherche « Rechercher…
(croisement, squeeze, divergence…) ». Section Actives identique à celle
d'IndicatorMenu (⧉/✎/✕ + `InstanceParamsEditor` importé), filtrée
`category === "strategy"`. Grisage : `disabledSynthetic` (exchange
"synthetic" : GARDER le même comportement qu'IndicatorMenu pour le defId
"volume" non concerné ici — pour les stratégies, griser si
`def.minTimeframe && !tfAtLeast(timeframe, def.minTimeframe)` uniquement).
Docblock FR d'en-tête : « Menu dédié des stratégies (foyer exclusif — le menu
Indicateurs les exclut). Patron IndicatorMenu assumé en copie adaptée :
deux menus, deux évolutions indépendantes. »

Dans `IndicatorMenu.tsx` : `function InstanceParamsEditor` → `export function
InstanceParamsEditor` (ligne 83) ; appliquer les remplacements du Step 1
(INDICATEURS_ANALYSE + activesAnalyse) ; AUCUN autre changement.

Dans `Toolbar.tsx` : `import { StrategyMenu } from "./StrategyMenu";` +
`<StrategyMenu />` sur la ligne suivant `<IndicatorMenu />` (~562), avec le
commentaire FR : `{/* Panneau des stratégies (catégorie strategy — foyer exclusif). */}`.

- [ ] **Step 3 : Vérifier** — test Step 1 PASS + `pnpm -C apps/web exec vitest run` + `tsc --noEmit`.
- [ ] **Step 4 : Note test composant** — il n'existe PAS d'infra jsdom dans apps/web : ne PAS l'introduire. La partition est testée (Step 1) ; le rendu réel est couvert par le gate visuel (Task 9).
- [ ] **Step 5 : Commit** — `feat(web): menu Stratégies dédié dans la Toolbar (foyer exclusif)`

---

### Task 2 : Extraction des cœurs `ttmSqueezeOf` / `ichimokuOf` / `adxOf` / `psarOf` (B2)

**Files:** Modify: `packages/indicators/src/volatility/ttmSqueeze.ts`, `trend/ichimoku.ts`, `trend/adx.ts`, `trend/psar.ts`

**Interfaces — Produces (contractuel pour Tasks 4/6/7) :**
```ts
ttmSqueezeOf(candles: Candle[], hlc3: number[], length: number, multBB: number, multKC: number): { on: Array<number | undefined>; mom: Array<number | undefined> }
// NB : vérifier ce que le calc consomme réellement (ctx.hlc3 ou closeOf) et refléter la VRAIE dépendance dans la signature.
ichimokuOf(candles: Candle[], tenkan: number, kijun: number, senkouB: number, displacement: number): { tenkan; kijun; spanA; spanB; chikou }  // Array<number|undefined> chacun, MÊME alignement que les sorties du def (spanA/spanB DÉJÀ décalés comme tracés — le nuage à la bougie i est spanA[i]/spanB[i])
adxOf(candles: Candle[], length: number): { plusDI; minusDI; adx }
psarOf(candles: Candle[], step: number, max: number): { psar: Array<number | undefined> }
```

**REFACTOR PUR ×4** (patron `rsiOf`, exactement comme v2.1 Task 5 / v2.2 Task 3) :
corps du `calc` déplacé À L'IDENTIQUE dans la fonction exportée (docblock FR
« cœur exporté — réutilisé par les stratégies v2.3 »), calc délègue, AUCUN
test modifié.

- [ ] **Step 1-4 : Extraire les 4 cœurs** (un par un, en vérifiant la
  dépendance réelle de chaque calc — ichimoku : préserver le `displacement`
  exactement tel que le def aligne ses sorties).
- [ ] **Step 5 : Vérifier** — `pnpm -C packages/indicators exec vitest run src/volatility/ttmSqueeze.test.ts src/trend/ichimoku.test.ts src/trend/adx.test.ts src/trend/psar.test.ts src/golden/` PASS à l'identique + suite complète + `tsc --noEmit`.
- [ ] **Step 6 : Commit** — `refactor(indicators): cœurs ttmSqueezeOf/ichimokuOf/adxOf/psarOf exportés (patron rsiOf)`

---

### Task 3 : Fabrique — trades exportés + registre de specs (B2)

**Files:**
- Modify: `packages/indicators/src/utils-fabrique-strategie.ts`
- Modify: `packages/indicators/src/utils-fabrique-strategie.test.ts` (ajouts)
- Modify (si nécessaire): `packages/indicators/src/engine.ts` (exporter `buildCalcContext` s'il ne l'est pas — une ligne, sanctionné par le spec)

**Interfaces — Produces (contractuel pour Tasks 5/6) :**
```ts
export interface TradeStrategie { sens: 1 | -1; idxEntree: number; prixEntree: number; idxSortie?: number; prixSortie?: number; pnlPct?: number }
/** Reconstruction PURE des trades depuis une série d'états (logique EXACTE de la fabrique, extraite). */
export function construireTradesStrategie(candles: Candle[], etats: Array<EtatStrategie | undefined>): { trades: TradeStrategie[]; ouvert: TradeStrategie | null }
/** États d'une stratégie du registre : résout les params (défauts + overrides) et appelle spec.position. undefined si defId inconnu ou non-stratégie. */
export function etatsStrategie(defId: string, candles: Candle[], params?: Record<string, number | boolean | string>): Array<EtatStrategie | undefined> | undefined
```

- [ ] **Step 1 : Refactor `construireTradesStrategie`** — extraire la boucle de
  transitions + l'objet `TradeStrategie` (actuellement internes au `calc` de
  `defStrategie`) en fonction exportée ; le `calc` délègue (comportement
  identique — les 8 tests fabrique existants + 7 tests de stratégies PASSENT
  SANS MODIFICATION, c'est la preuve du refactor pur).
- [ ] **Step 2 : Registre de specs** — dans le module :

```ts
/** Specs enregistrées par defStrategie (rejeu scripté : campagne de backtest). */
const SPECS_STRATEGIES = new Map<string, SpecStrategie>();
export function specStrategie(id: string): SpecStrategie | undefined {
  return SPECS_STRATEGIES.get(id);
}
```

`defStrategie` fait `SPECS_STRATEGIES.set(spec.id, spec);` avant de retourner.
`etatsStrategie` : `getIndicator(defId)` (import depuis ./registry — ATTENTION
cycle : registry importe les stratégies qui importent la fabrique → passer par
`specStrategie(defId)` + le def via paramètre ? NON : implémenter SANS
registry : `const spec = SPECS_STRATEGIES.get(defId); if (!spec) return undefined;`
puis reconstruire le def minimal nécessaire : `resolveParams` a besoin des
inputs — les reconstruire depuis la spec : `[...spec.inputsStrategie, INPUT_LIGNES_TRADES]`.
Utiliser `resolveParams`/`buildCalcContext` importés de `./engine` (les
exporter si privés). Aucune dépendance vers registry = pas de cycle.)
- [ ] **Step 3 : Tests ajoutés** (dérivés à la main) :

```ts
  it("construireTradesStrategie : mêmes trades que la fixture principale de la fabrique", () => {
    const { trades, ouvert } = construireTradesStrategie(candles, ETATS);
    expect(trades).toEqual([
      { sens: -1, idxEntree: 7, prixEntree: 103, idxSortie: 9, prixSortie: 101, pnlPct: expect.closeTo(1.9417, 3) },
    ]);
    expect(ouvert).toEqual({ sens: 1, idxEntree: 10, prixEntree: 100 });
  });

  it("etatsStrategie : rejoue la position d'un def enregistré avec overrides", () => {
    defAvec(ETATS); // enregistre stratTest dans SPECS_STRATEGIES
    expect(etatsStrategie("stratTest", candles)).toEqual(ETATS);
    expect(etatsStrategie("defInconnu", candles)).toBeUndefined();
  });
```

- [ ] **Step 4 : Vérifier** — suite complète + tsc. **Step 5 : Commit** — `refactor(indicators): fabrique — construireTradesStrategie + etatsStrategie exportés (rejeu scripté)`

---

### Task 4 : 4 nouvelles stratégies + registre 171 (B2)

**Files:** Create ×8 dans `packages/indicators/src/strategy/` : `stratSqueezeBreakout.ts`(+test), `stratIchimokuKumo.ts`(+test), `stratMmAdx.ts`(+test), `stratPsar.ts`(+test) ; Modify : `registry.ts` (+4), `registry.test.ts` (167→171, liste 19 ids).

**Interfaces — Consumes :** `defStrategie`, cœurs Task 2, `ema`/`sma` (utils), `adxOf`.

Les 4 specs (docblocks FR complets sur le modèle v2.2, chaque def renvoyant au
rapport de campagne §Task 6 avec la formule d'honnêteté du spec §2) :

```ts
export const stratSqueezeBreakout = defStrategie({
  id: "stratSqueezeBreakout",
  name: "Stratégie squeeze breakout",
  inputsStrategie: [
    { key: "length", name: "Length", type: "number", default: 20, min: 2, max: 200 },
    { key: "multBB", name: "BB mult", type: "number", default: 2, min: 0.5, max: 5 },
    { key: "multKC", name: "KC mult", type: "number", default: 1.5, min: 0.5, max: 5 },
    { key: "dureeMin", name: "Durée min du squeeze", type: "number", default: 3, min: 1 },
  ],
  position: (candles, params, ctx) => {
    const r = ttmSqueezeOf(candles, ctx.hlc3, Number(params.length ?? 20), Number(params.multBB ?? 2), Number(params.multKC ?? 1.5));
    const dureeMin = Number(params.dureeMin ?? 3);
    const n = candles.length;
    const out: Array<EtatStrategie | undefined> = new Array(n).fill(undefined);
    let etat: EtatStrategie = 0;
    let dureeOn = 0;
    let arme = false;
    for (let i = 0; i < n; i++) {
      const on = r.on[i];
      const mom = r.mom[i];
      if (on === undefined || mom === undefined) continue;
      if (on > 0) { dureeOn++; if (dureeOn >= dureeMin) arme = true; }
      else {
        if (arme && etat === 0) etat = mom > 0 ? 1 : mom < 0 ? -1 : 0; // libération armée → sens du momentum
        arme = false;
        dureeOn = 0;
      }
      if (etat === 1 && mom < 0) etat = 0;   // sortie : momentum retourné
      else if (etat === -1 && mom > 0) etat = 0;
      out[i] = etat;
    }
    return out;
  },
  libelles: (params) => ({
    long: `libération du squeeze (≥ ${params.dureeMin} barres) momentum haussier`,
    short: `libération du squeeze (≥ ${params.dureeMin} barres) momentum baissier`,
    sortie: "retournement du momentum",
  }),
});
```

```ts
export const stratIchimokuKumo = defStrategie({
  id: "stratIchimokuKumo",
  name: "Stratégie Ichimoku kumo",
  inputsStrategie: [
    { key: "tenkan", name: "Tenkan", type: "number", default: 9, min: 1 },
    { key: "kijun", name: "Kijun", type: "number", default: 26, min: 1 },
    { key: "senkouB", name: "Senkou B", type: "number", default: 52, min: 1 },
  ],
  position: (candles, params, ctx) => {
    // displacement standard = valeur kijun (26 par défaut), comme le def ichimoku.
    const kijun = Number(params.kijun ?? 26);
    const r = ichimokuOf(candles, Number(params.tenkan ?? 9), kijun, Number(params.senkouB ?? 52), kijun);
    return ctx.source.map((c, i): EtatStrategie | undefined => {
      const a = r.spanA[i];
      const b = r.spanB[i];
      if (a === undefined || b === undefined || c === undefined) return undefined;
      const haut = Math.max(a, b);
      const bas = Math.min(a, b);
      return c > haut ? 1 : c < bas ? -1 : 0; // dans le nuage → flat
    });
  },
  libelles: (params) => ({
    long: `close au-dessus du nuage Ichimoku (${params.tenkan}/${params.kijun}/${params.senkouB})`,
    short: `close sous le nuage Ichimoku (${params.tenkan}/${params.kijun}/${params.senkouB})`,
    sortie: "retour dans/à travers le nuage",
  }),
});
```

```ts
export const stratMmAdx = defStrategie({
  id: "stratMmAdx",
  name: "Stratégie MM + filtre ADX",
  inputsStrategie: [
    { key: "type", name: "Type de MM", type: "select", default: "ema", options: ["ema", "sma"] },
    { key: "rapide", name: "MM rapide", type: "number", default: 9, min: 1 },
    { key: "lente", name: "MM lente", type: "number", default: 21, min: 2 },
    { key: "adxLength", name: "Longueur ADX", type: "number", default: 14, min: 1 },
    { key: "seuilAdx", name: "Seuil ADX", type: "number", default: 25, min: 5, max: 60 },
  ],
  position: (candles, params, ctx) => {
    const moyenne = params.type === "sma" ? sma : ema;
    const rapide = moyenne(ctx.source, Number(params.rapide ?? 9));
    const lente = moyenne(ctx.source, Number(params.lente ?? 21));
    const a = adxOf(candles, Number(params.adxLength ?? 14));
    const seuil = Number(params.seuilAdx ?? 25);
    return ctx.source.map((_v, i): EtatStrategie | undefined => {
      const f = rapide[i];
      const l = lente[i];
      const x = a.adx[i];
      if (f === undefined || l === undefined || x === undefined) return undefined;
      if (x < seuil) return 0; // filtre anti-range : flat forcé
      return f > l ? 1 : f < l ? -1 : 0;
    });
  },
  libelles: (params) => {
    const t = params.type === "sma" ? "SMA" : "EMA";
    return {
      long: `croisement ${t} ${params.rapide} > ${t} ${params.lente}, ADX ≥ ${params.seuilAdx}`,
      short: `croisement ${t} ${params.rapide} < ${t} ${params.lente}, ADX ≥ ${params.seuilAdx}`,
      sortie: `croisement inverse ou ADX < ${params.seuilAdx}`,
    };
  },
});
```

```ts
export const stratPsar = defStrategie({
  id: "stratPsar",
  name: "Stratégie PSAR",
  inputsStrategie: [
    { key: "step", name: "AF step", type: "number", default: 0.02, min: 0 },
    { key: "max", name: "AF max", type: "number", default: 0.2, min: 0 },
  ],
  position: (candles, params, ctx) => {
    const r = psarOf(candles, Number(params.step ?? 0.02), Number(params.max ?? 0.2));
    return ctx.source.map((c, i): EtatStrategie | undefined => {
      const s = r.psar[i];
      if (s === undefined || c === undefined) return undefined;
      return c > s ? 1 : -1;
    });
  },
  libelles: (params) => ({
    long: `bascule PSAR haussière (${params.step}/${params.max})`,
    short: `bascule PSAR baissière (${params.step}/${params.max})`,
    sortie: "bascule inverse",
  }),
});
```

- [ ] **Step 1-4 : TDD par def** — tests au patron v2.2 : contrat (ordre des
  inputs + `lignesTrades` dernier) + fixture PROUVÉE (≥ 1 aller-retour) +
  recomposition JS vs le cœur importé + cohérence de SENS + mutation-kill
  pour les non-traçables. Pour `stratSqueezeBreakout`, pinner en plus :
  une libération SANS armement (durée < dureeMin) ne déclenche RIEN.
  Pour `stratMmAdx` : une période où les MM se croisent AVEC ADX < seuil
  reste flat (le filtre est la raison d'être du def).
- [ ] **Step 5 : Registre** — imports + entrées dans le bloc stratégies ;
  registry.test 167 → 171, liste triée des 19 ids.
- [ ] **Step 6 : Vérifier** — suite + tsc + `pnpm check`. **Step 7 : Commit** — `feat(indicators): stratégies squeeze/ichimoku/MM+ADX/PSAR (registre 171)`

---

### Task 5 : Script de campagne — modules purs + fetch (B3)

**Files:**
- Create: `scripts/valider-strategies.ts` (entrée Bun)
- Create: `scripts/lib/statsRejeu.ts` + `scripts/lib/statsRejeu.test.ts`
- Create: `scripts/lib/candidatsChampion.ts` + `scripts/lib/candidatsChampion.test.ts`
- Modify: `.gitignore` (+ `scripts/.cache-klines/`)

**Interfaces:**
- Consumes : `etatsStrategie`/`construireTradesStrategie`/`specStrategie`/`TradeStrategie`/`EtatStrategie` (@axiom/indicators, Task 3), `runBacktest` (@axiom/backtest), cœurs Task 2 pour les candidats.
- Produces : `statsTrades(trades: TradeStrategie[]): StatsRejeu` avec `StatsRejeu = { nbTrades: number; winRate: number; expectancy: number; pnlComposePct: number; maxDrawdownPct: number; dureeMoyenne: number }` ; `CANDIDATS_CHAMPION: Array<{ id: string; nom: string; position: (candles: Candle[]) => Array<EtatStrategie | undefined> }>` (les 6 du spec §3, params par défaut FIGÉS dans le code) ; CLI `bun scripts/valider-strategies.ts [--rapport chemin.md]`.

- [ ] **Step 1 : `statsRejeu.ts` + test dérivé à la main**

```ts
/** Stats PURES d'une liste de trades clos (pnlPct signés, hors frais). */
export interface StatsRejeu {
  nbTrades: number;
  winRate: number;        // % de pnlPct >= 0
  expectancy: number;     // moyenne des pnlPct
  pnlComposePct: number;  // Π(1 + pnl/100) − 1, en %
  maxDrawdownPct: number; // pire retracement de l'equity composée, en %
  dureeMoyenne: number;   // barres, moyenne
}
export function statsTrades(trades: TradeStrategie[]): StatsRejeu { /* … */ }
/** Coupe une liste de trades en deux moitiés TEMPORELLES par idxEntree < / >= au milieu du tableau de bougies. */
export function partagerMoities(trades: TradeStrategie[], nbCandles: number): { m1: TradeStrategie[]; m2: TradeStrategie[] }
```

Test à la main : trades `[+10 %, −5 %, +2 %]` → winRate 66.67, expectancy 2.333,
composé = 1.10×0.95×1.02 − 1 = +6.59 %, maxDD depuis le pic 1.10 → creux
1.045 = −5.0 %. (Dériver précisément dans le docblock ; `closeTo` à 2 déc.)

- [ ] **Step 2 : `candidatsChampion.ts`** — les 6 candidats du spec §3, chacun
  une fonction `position` pure composée des cœurs (supertrendOf+adxOf ;
  ema+rsiOf ; rollingHighest/Lowest+rma(trueRange) pour Donchian+trailing ATR ;
  ttmSqueezeOf+ichimokuOf ; macdOf+supertrendOf ; psarOf+adxOf), params par
  défaut FIGÉS (documentés). Test léger : chaque candidat sur 60 bougies
  synthétiques en tendance → renvoie une série de la bonne longueur avec au
  moins un état non-flat ; le candidat (3) pinne en plus la sortie trailing
  (fixture courte dérivée à la main).
- [ ] **Step 3 : `valider-strategies.ts`** — orchestration (I/O non testée) :
  fetch klines Binance spot `https://api.binance.com/api/v3/klines` (BTCUSDT,
  ETHUSDT × 1h, 4h ; startTime 2024-07-01, pagination 1000, cache JSON dans
  `scripts/.cache-klines/<symbol>-<tf>.json`) ; pour chaque def strategy du
  registre : `etatsStrategie(id, candles)` → `construireTradesStrategie` →
  `statsTrades` global + par moitié ; pour les 6 EXPRIMABLES (liste en dur :
  stratCroisementMM, stratRsiReversion, stratMacdCross, stratSupertrend,
  stratBollingerReversion, stratMmAdx) : construire la `StrategieDef` BT
  équivalente (mêmes littéraux que les presets de Task 8) et `runBacktest`
  (fraisPct 0.05, slippagePct 0.02, capitalInitial 10000, tailleFixe 1000) ;
  pour les 6 candidats : rejeu + stats + évaluation des critères champion ;
  sortie : rapport markdown (tableaux par stratégie × cellule × moitié,
  méthodo, limites, verdict champion) écrit sur `--rapport` (défaut stdout).
- [ ] **Step 4 : Vérifier** — `pnpm -C scripts exec vitest run` ou vitest à la
  racine selon l'infra (les scripts n'ont pas de package.json : placer les
  tests là où vitest les ramasse — vérifier `vitest.config`/workspace ; à
  défaut, les modules purs vont dans `packages/backtest/src/rejeu/` avec leurs
  tests, et le script les importe — DÉCISION à documenter dans le report).
  `bun scripts/valider-strategies.ts --rapport /tmp/essai.md` sur le cache
  d'UNE cellule pour prouver le pipeline.
- [ ] **Step 5 : Commit** — `feat(scripts): campagne de validation des stratégies (rejeu pur + contre-épreuve BT + candidats champion)`

---

### Task 6 : EXÉCUTION de la campagne + rapport commité (B3)

**Files:** Create: `docs/superpowers/research/2026-07-28-backtest-strategies.md`

- [ ] **Step 1 : Run complet** — `bun scripts/valider-strategies.ts --rapport docs/superpowers/research/2026-07-28-backtest-strategies.md` (4 cellules ; laisser le cache se remplir ; durée réseau attendue ~1-2 min).
- [ ] **Step 2 : Relecture d'honnêteté du rapport** — vérifier : chaque tableau étiqueté « mesures passées, hors frais côté rejeu chart » ; l'écart rejeu-chart vs moteur BT (frais+open) visible par stratégie exprimable ; le verdict champion énonce les critères et les cellules qui passent/échouent ; si aucun candidat robuste → le dire en toutes lettres.
- [ ] **Step 3 : Consigner le verdict au ledger SDD** (règles du champion retenu OU « champion relatif ») — c'est l'ENTRÉE de la Task 7.
- [ ] **Step 4 : Commit** — `docs(research): campagne de backtest des stratégies v2.2/v2.3 + sélection du champion`

---

### Task 7 : `stratChampion` — le def du gagnant + registre 172 (B3)

**Files:** Create: `packages/indicators/src/strategy/stratChampion.ts` + `.test.ts` ; Modify: `registry.ts`, `registry.test.ts` (171→172, 20 ids).

- [ ] **Step 1 : Implémenter le def** — id `stratChampion`, nom
  « Stratégie champion (backtest) », règles = le CANDIDAT GAGNANT consigné en
  Task 6 (recopier la fonction `position` du candidat depuis
  `candidatsChampion.ts` en la paramétrant : ses constantes deviennent des
  inputs avec les défauts de la campagne). Docblock FR OBLIGATOIRE : la
  formule d'honnêteté du spec §2 + le verdict réel (« robuste sur les 4
  cellules » OU « champion relatif — critères non tous atteints ») + renvoi au
  rapport. Si la campagne n'a élu qu'un champion relatif, le NOM reste
  « Stratégie champion (backtest) » mais le docblock et le libellé de sortie
  `libelles()` ne sur-vendent pas.
- [ ] **Step 2 : Test** — patron v2.2 (contrat + fixture prouvée + recomposition vs les cœurs + mutation-kill). **Step 3 : Registre 172.** **Step 4 : Vérifier** (suite + pnpm check). **Step 5 : Commit** — `feat(indicators): stratChampion — le gagnant de la campagne (registre 172)`

---

### Task 8 : Presets BT + catalogue d'opérandes (B3)

**Files:** Modify: `apps/web/src/store/backtest.ts` (+ test existant du store s'il y en a un — vérifier `store/backtest.test.ts`).

- [ ] **Step 1 : Catalogue** — ajouter à `CATALOGUE_OPERANDES` :
  `indFixe("supertrend", "direction", "Supertrend (direction)", { period: 10, multiplier: 3 })`,
  `indLen("adx", "adx", "ADX", 14)`.
- [ ] **Step 2 : Presets** — ajouter à `BUILTIN_STRATEGIES` (mêmes défauts que
  les defs ; tf = la cellule la plus favorable du rapport Task 6, sinon 4h) :

```ts
  {
    id: "builtin:macd-cross", name: "Croisement MACD", tf: "4h", direction: "long",
    tailleFixe: 1000, stopPct: 5, targetPct: null,
    reglesEntree: [{ type: "croisement", a: macdLigne(), b: macdSignal(), sens: "hausse" }],
    reglesSortie: [{ type: "croisement", a: macdLigne(), b: macdSignal(), sens: "baisse" }],
    builtin: true,
  },
  {
    id: "builtin:supertrend", name: "Supertrend (direction)", tf: "4h", direction: "long",
    tailleFixe: 1000, stopPct: null, targetPct: null,
    reglesEntree: [{ type: "comparaison", gauche: supertrendDir(), comparateur: ">", droite: constante(0) }],
    reglesSortie: [{ type: "comparaison", gauche: supertrendDir(), comparateur: "<", droite: constante(0) }],
    builtin: true,
  },
  {
    id: "builtin:bollinger-reversion", name: "Bollinger réversion", tf: "4h", direction: "long",
    tailleFixe: 1000, stopPct: 5, targetPct: null,
    reglesEntree: [{ type: "croisement", a: prixClose(), b: bollLower(), sens: "hausse" }],
    reglesSortie: [{ type: "croisement", a: prixClose(), b: bollBasis(), sens: "hausse" }],
    builtin: true,
  },
  {
    id: "builtin:mm-adx", name: "Croisement EMA 9/21 + ADX ≥ 25", tf: "4h", direction: "long",
    tailleFixe: 1000, stopPct: 5, targetPct: null,
    reglesEntree: [
      { type: "croisement", a: ema(9), b: ema(21), sens: "hausse" },
      { type: "comparaison", gauche: adx14(), comparateur: ">", droite: constante(25) },
    ],
    reglesSortie: [{ type: "croisement", a: ema(9), b: ema(21), sens: "baisse" }],
    builtin: true,
  },
```

  avec les petits fabricants d'opérandes locaux à côté du `ema(len)` existant
  (`macdLigne`/`macdSignal` = `{ type: "indicateur", indicateurId: "macd", params: { fast: 12, slow: 26, signal: 9 }, output: "macd" | "signal" }` ;
  `supertrendDir` = `{ …, indicateurId: "supertrend", params: { period: 10, multiplier: 3 }, output: "direction" }` ;
  `adx14`, `bollLower`/`bollBasis` `{ length: 20, mult: 2 }` ; `prixClose` = `{ type: "prix", champ: "close" }` ;
  `constante(v)` = `{ type: "constante", valeur: v }` — VÉRIFIER les noms de
  champs exacts dans `packages/backtest/src/types.ts` avant d'écrire).
- [ ] **Step 3 : Vérifier** — la fenêtre BT liste les presets et un run tourne (test store si existant, sinon gate visuel) ; suite web + `pnpm check`. **Step 4 : Commit** — `feat(web): presets BT builtin des stratégies exprimables + opérandes supertrend/adx`

---

### Task 9 : Merges + gate visuel

- [ ] **Step 1 : Merges séquentiels** B1 → main (gate `pnpm check`), B2 → main (gate), B3 → main (gate). `git -C` explicite.
- [ ] **Step 2 : Gate visuel in-page** (BTCUSDT 1h, sondes DOM/getImageData) :
  1. Toolbar : bouton « Stratégies » à côté d'« Indicateurs » ; son panneau liste 20 stratégies ; le menu Indicateurs n'en liste AUCUNE (compteur 152) — foyer exclusif prouvé aussi côté Actifs (activer une stratégie → visible dans Stratégies uniquement, PAS dans Indicateurs).
  2. Les 5 nouvelles stratégies rendent marqueurs/labels/segments sans erreur console ; tooltips OK.
  3. `stratSqueezeBreakout` : vérifier qu'une phase de squeeze courte (< dureeMin) ne produit pas d'entrée (sonde sur données réelles ou paramètre abaissé).
  4. Fenêtre BT : les 6 presets builtin listés ; lancer `builtin:supertrend` sur BTC 4h → un résultat s'affiche (stats non vides).
  5. Édition de params, suppression, thèmes, ⌘K (« champion » trouvable).
- [ ] **Step 3 : Consigner** tout calibrage/écart au ledger.
