# Lot v2.2 — Menu « Stratégies » + entrées/sorties : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Nouvelle catégorie « Stratégies » en tête du menu (8 defs v2.1 déplacés) + fabrique `defStrategie` + 7 stratégies affichant entrées/sorties/PnL sur le chart maître via le canal d'annotations v2.1 (registre 160 → 167).

**Architecture :** Une stratégie = un `IndicatorDef` `pane: "overlay"` généré par une fabrique : la spec fournit une fonction d'état pure `position() → Array<1|0|−1|undefined>` ; la fabrique dérive les trades aux transitions, émet marqueurs/labels/segments cible « prix » (rendus par le `draw` candle_pane existant — zéro code nouveau côté apps/web hors menu) et une série `prixEntree` à l'échelle prix.

**Tech stack :** TypeScript pur (packages/indicators), Vitest, monorepo pnpm.

**Spec :** `docs/superpowers/specs/2026-07-28-lot-v22-strategies-design.md`.

## Global Constraints

- Docblocks/identifiants FRANÇAIS ; calculs PURS ; `noUncheckedIndexedAccess` (tout accès indexé gardé) ; couleurs = tokens (`"--up"`/`"--down"`), jamais un hex.
- **JAMAIS de série −1/0/+1 en sortie d'un def overlay** (l'auto-scale du pane prix inclut les figures — piège documenté du pont). Seule sortie : `prixEntree` (échelle prix).
- Anti-repaint : transitions évaluées sur `i ∈ [1, n−2]` (aucun événement sur la dernière bougie) ; **le premier état défini après warm-up ne génère AUCUN événement** (matérialisation silencieuse — et aucun trade n'est ouvert : la ligne `prixEntree` et le PnL démarrent à la première VRAIE transition).
- `undefined` au milieu de `position` = maintien de l'état précédent (pas de sortie fantôme).
- Prix d'entrée/sortie = close de la bougie de signal ; PnL % = `(sortie−entrée)/entrée×100×sens`, **hors frais** (mention « (hors frais) » dans l'info des segments ; écart avec le fill à l'open du moteur backtest documenté dans le docblock de la fabrique).
- Cap `MAX_TRADES_ANNOTES = 60` (les plus récents ; le trade en cours toujours annoté).
- Annotations omises du résultat quand vides ; fixtures de test PROUVÉES non tautologiques (jamais de rampe plate) ; valeurs attendues dérivées à la main dans le docblock ; `pnpm check` vert par branche + post-merge.
- Branches : C1 `feat/categorie-strategies` (Task 1, base main) → merge ; C2 `feat/strategies-entrees-sorties` (Tasks 2-6, base main post-C1) → merge ; Task 7 = gate visuel.

---

### Task 1 : Catégorie « Stratégies » + déplacement des 8 defs v2.1 (C1)

**Files:**
- Modify: `packages/types/src/index.ts` (union `IndicatorCategory`, ~ligne 228)
- Modify: `packages/indicators/src/registry.test.ts` (lignes 5-16 + nouveau test)
- Modify: `apps/web/src/components/IndicatorMenu.tsx:28-56`
- Modify (1 ligne chacun — champ `category`) : `packages/indicators/src/momentum/rsiDivergence.ts`, `momentum/macdDivergence.ts`, `momentum/stochDivergence.ts`, `momentum/mfiDivergence.ts`, `orderflow/cvdDivergence.ts`, `volume/obvDivergence.ts`, `orderflow/cvdSpotPerp.ts`, `derivatives/premiumSpotPerp.ts`
- Modify : les tests de contrat de ces 8 defs qui assertent `category` (grep `category` dans leurs `.test.ts` ; remplacer l'attendu par `"strategy"`)

**Interfaces:**
- Produces : la valeur de catégorie `"strategy"` (consommée par les Tasks 2-6) ; section « Stratégies » en tête du menu.

- [ ] **Step 1 : Type** — dans `packages/types/src/index.ts`, juste avant `| "custom";` :

```ts
  // Stratégies : setups de trade et signaux d'entrée/sortie (divergences, croisements, breakouts).
  | "strategy"
```

- [ ] **Step 2 : Test registre (échec attendu)** — dans `registry.test.ts` : ajouter `"strategy",` à `VALID_CATEGORIES` (après `"derivatives",`) et ajouter le test :

```ts
  it("catégorie strategy : les 8 defs v2.1 déplacés", () => {
    const strategie = INDICATORS.filter((def) => def.category === "strategy").map((d) => d.id);
    expect(strategie.sort()).toEqual([
      "cvdDivergence", "cvdSpotPerp", "macdDivergence", "mfiDivergence",
      "obvDivergence", "premiumSpotPerp", "rsiDivergence", "stochDivergence",
    ]);
  });
```

Run : `pnpm -C packages/indicators exec vitest run src/registry.test.ts` → FAIL (0 def strategy).

- [ ] **Step 3 : Déplacer les 8 defs** — dans chacun des 8 fichiers, `category: "momentum" | "orderflow" | "volume" | "derivatives"` → `category: "strategy"`. Mettre à jour les assertions `category` de leurs tests de contrat (`premiumSpotPerp.test.ts` asserte `toBe("derivatives")` ; vérifier les autres par grep). NB honnêteté : `obvDivergence` perd la série d'axe « volume » de son pane (`seriesFor` mappe catégorie volume → IndicatorSeries.Volume) — formatage d'axe cosmétique, assumé.

- [ ] **Step 4 : Menu** — dans `IndicatorMenu.tsx` : ajouter `strategy: "Stratégies",` en PREMIÈRE entrée de `CATEGORY_LABELS` (ligne 29) et `"strategy",` en PREMIÈRE entrée de `CATEGORY_ORDER` (ligne 46). Rien d'autre (un id absent de `CATEGORY_ORDER` rendrait la catégorie invisible — les deux constantes sont obligatoires).

- [ ] **Step 5 : Vérifier** — `pnpm -C packages/indicators exec vitest run` (160 inchangé, catégories valides, 8 strategy) puis `pnpm check`.

- [ ] **Step 6 : Commit**

```bash
git add -A && git commit -m "feat(indicators,web): catégorie Stratégies en tête de menu — 8 defs v2.1 déplacés"
```

---

### Task 2 : Fabrique `defStrategie` (C2)

**Files:**
- Create: `packages/indicators/src/utils-fabrique-strategie.ts`
- Create: `packages/indicators/src/utils-fabrique-strategie.test.ts`
- Modify: `packages/indicators/src/index.ts` (export)

**Interfaces:**
- Consumes : types d'annotations v2.1 (`MarqueurAnnotation`, `LabelAnnotation`, `SegmentAnnotation`, `AnnotationsIndicateur`).
- Produces (pour Tasks 4-6) :
  ```ts
  type EtatStrategie = 1 | 0 | -1;
  interface SpecStrategie {
    id: string; name: string;
    inputsStrategie: IndicatorInput[];
    precision?: number; minTimeframe?: Timeframe;
    position: (candles: Candle[], params: Record<string, number | boolean | string>, ctx: CalcContext) => Array<EtatStrategie | undefined>;
    libelles: (params: Record<string, number | boolean | string>) => { long: string; short: string; sortie: string };
  }
  function defStrategie(spec: SpecStrategie): IndicatorDef  // category "strategy", pane "overlay"
  const MAX_TRADES_ANNOTES = 60;
  ```
  Input commun ajouté APRÈS `inputsStrategie` : `{ key: "lignesTrades", name: "Lignes de trades", type: "boolean", default: true }`. Sortie unique `{ key: "prixEntree", name: "Prix d'entrée", style: "line" }`.

- [ ] **Step 1 : Écrire le test qui échoue**

`packages/indicators/src/utils-fabrique-strategie.test.ts` :

```ts
/**
 * @axiom/indicators — utils-fabrique-strategie.test.ts
 *
 * Fabrique testée avec une `position` INJECTÉE (tableau littéral) — la géométrie
 * des événements est ainsi dérivable à la main, indépendamment de tout oscillateur.
 *
 * Fixture principale (n=12, closes 100..99, highs=closes+1, lows=closes−1) :
 *   etats = [u, u, 1, 1, 1, 0, 0, -1, -1, 0, 1, 1]
 *   - i=2 : premier état défini (long) → MATÉRIALISATION SILENCIEUSE : aucun
 *     événement, aucun trade ouvert (pas de prix d'entrée connu).
 *   - i=5 : 1→0 : sortie SANS trade ouvert → ignorée (silencieuse).
 *   - i=7 : 0→−1 : ENTRÉE SHORT @ close[7]=103.
 *   - i=9 : −1→0 : SORTIE SHORT @ close[9]=101 → PnL = (101−103)/103×100×(−1)
 *     = +1.9417… → « +1.94 % » (gagnant, --up).
 *   - i=10 : 0→1 : ENTRÉE LONG @ close[10]=100 (i=10 = n−2, dernière transition
 *     admissible) → trade EN COURS.
 *   prixEntree attendu : [u,u,u,u,u,u,u, 103,103,103, 100,100].
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "./engine";
import { defStrategie, MAX_TRADES_ANNOTES, type EtatStrategie } from "./utils-fabrique-strategie";

const closes = [100, 101, 102, 103, 104, 105, 104, 103, 102, 101, 100, 99];
const candles: Candle[] = closes.map((c, i) => ({
  time: 1_700_000_000_000 + i * 60_000,
  open: c, high: c + 1, low: c - 1, close: c, volume: 1,
}));

const ETATS: Array<EtatStrategie | undefined> = [undefined, undefined, 1, 1, 1, 0, 0, -1, -1, 0, 1, 1];

function defAvec(etats: Array<EtatStrategie | undefined>) {
  return defStrategie({
    id: "stratTest",
    name: "Stratégie test",
    inputsStrategie: [],
    position: () => etats,
    libelles: () => ({ long: "règle long", short: "règle short", sortie: "règle sortie" }),
  });
}

describe("defStrategie", () => {
  it("contrat : category strategy, pane overlay, sortie prixEntree, input lignesTrades en dernier", () => {
    const def = defAvec(ETATS);
    expect(def.category).toBe("strategy");
    expect(def.pane).toBe("overlay");
    expect(def.outputs).toEqual([{ key: "prixEntree", name: "Prix d'entrée", style: "line" }]);
    expect(def.inputs.map((i) => i.key)).toEqual(["lignesTrades"]);
  });

  it("événements aux transitions : entrée short, sortie avec PnL, entrée long en cours", () => {
    const r = computeIndicator(defAvec(ETATS), candles);
    expect(r.annotations?.marqueurs).toEqual([
      { idx: 7, valeur: 104, forme: "triangleBas", couleur: "--down", cible: "prix",
        info: "Entrée short 103.00 — règle short" },
      { idx: 10, valeur: 99, forme: "triangleHaut", couleur: "--up", cible: "prix",
        info: "Entrée long 100.00 — règle long" },
    ]);
    expect(r.annotations?.labels).toEqual([
      { idx: 9, valeur: 100, texte: "+1.94 %", couleur: "--up", cible: "prix", position: "dessous",
        info: "Sortie short 101.00 (+1.94 %) — règle sortie" },
    ]);
    expect(r.annotations?.segments).toEqual([
      { deIdx: 7, deValeur: 103, aIdx: 9, aValeur: 101, trait: "pointille", couleur: "--up", cible: "prix",
        info: "Short 103.00 → 101.00, +1.94 % en 2 bougies (hors frais) — règle short" },
    ]);
    expect(r.series["prixEntree"]).toEqual(
      [undefined, undefined, undefined, undefined, undefined, undefined, undefined, 103, 103, 103, 100, 100]
    );
  });

  it("lignesTrades=false : pas de segments, marqueurs/labels conservés", () => {
    const r = computeIndicator(defAvec(ETATS), candles, { lignesTrades: false });
    expect(r.annotations?.segments).toBeUndefined();
    expect(r.annotations?.marqueurs?.length).toBe(2);
  });

  it("aucun événement sur la dernière bougie (transition à n−1 ignorée)", () => {
    const etats: Array<EtatStrategie | undefined> = new Array(12).fill(1);
    etats[11] = 0; // bascule sur la bougie potentiellement en formation
    const r = computeIndicator(defAvec(etats), candles);
    expect(r.annotations).toBeUndefined(); // matérialisation silencieuse + transition finale exclue
    expect(r.series["prixEntree"]).toEqual(new Array(12).fill(undefined)); // aucun trade réel ouvert
  });

  it("undefined au milieu = maintien (pas de sortie fantôme)", () => {
    const etats: Array<EtatStrategie | undefined> = [0, 1, 1, undefined, 1, 1, 0, 0, 0, 0, 0, 0];
    const r = computeIndicator(defAvec(etats), candles);
    expect(r.annotations?.marqueurs?.length).toBe(1); // une seule entrée (i=1)
    expect(r.annotations?.labels?.length).toBe(1);    // une seule sortie (i=6)
  });

  it("cap MAX_TRADES_ANNOTES : seuls les 60 derniers trades portent des annotations", () => {
    // 140 bougies, alternance 1/0 → un trade complet toutes les 2 bougies (~69 trades clos).
    const n = 140;
    const grands: Candle[] = Array.from({ length: n }, (_v, i) => ({
      time: 1_700_000_000_000 + i * 60_000, open: 100, high: 101, low: 99, close: 100, volume: 1,
    }));
    const etats: Array<EtatStrategie | undefined> = Array.from({ length: n }, (_v, i) => (i % 2 === 0 ? 1 : 0));
    const r = computeIndicator(defAvec(etats), grands);
    expect(r.annotations?.segments?.length).toBe(MAX_TRADES_ANNOTES);
    expect(r.annotations?.labels?.length).toBe(MAX_TRADES_ANNOTES);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec** — `pnpm -C packages/indicators exec vitest run src/utils-fabrique-strategie.test.ts` → FAIL (module absent).

- [ ] **Step 3 : Implémenter la fabrique**

`packages/indicators/src/utils-fabrique-strategie.ts` :

```ts
/**
 * @axiom/indicators — utils-fabrique-strategie.ts
 *
 * Fabrique de defs « stratégie » (catégorie strategy, pane overlay) : à partir
 * d'une fonction d'état PURE `position` (1 long / 0 flat / −1 short, décidée à
 * la clôture de chaque bougie), produit les TRADES aux transitions et les rend
 * via le canal d'annotations v2.1 : ▲/▼ d'entrée (marqueur au low/high), label
 * de sortie « ±x.xx % » (couleur par signe du PnL), segment pointillé
 * entrée→sortie (désactivable par l'input commun `lignesTrades`), plus une
 * série `prixEntree` à l'échelle prix (breakeven visuel — JAMAIS de série
 * −1/0/+1 en overlay : l'auto-scale du pane prix inclut les figures).
 *
 * Honnêteté (conventions figées) :
 *  - prix d'entrée/sortie = CLOSE de la bougie de signal (le moteur de backtest
 *    de la fenêtre BT, lui, remplit à l'open de la bougie SUIVANTE — écart
 *    assumé : les marqueurs montrent le signal, le backtest mesure l'exécution) ;
 *  - PnL affiché HORS FRAIS (mention dans l'info des segments) ;
 *  - anti-repaint : transitions évaluées sur i ∈ [1, n−2] (jamais la dernière
 *    bougie, potentiellement en formation) ;
 *  - le PREMIER état défini après warm-up est matérialisé en silence : aucun
 *    événement ET aucun trade ouvert (pas de prix d'entrée connu) — le premier
 *    marqueur ne peut venir que d'une transition entre deux états définis ;
 *  - `undefined` au MILIEU de la série = maintien de l'état précédent.
 *  - cap MAX_TRADES_ANNOTES trades clos annotés (les plus récents) ; le trade
 *    en cours est toujours annoté.
 */

import type {
  AnnotationsIndicateur,
  CalcContext,
  Candle,
  IndicatorDef,
  IndicatorInput,
  LabelAnnotation,
  MarqueurAnnotation,
  SegmentAnnotation,
  Timeframe,
} from "@axiom/types";

export type EtatStrategie = 1 | 0 | -1;

export interface SpecStrategie {
  id: string;
  name: string;
  /** Inputs propres à la stratégie, placés AVANT l'input commun `lignesTrades`. */
  inputsStrategie: IndicatorInput[];
  precision?: number;
  minTimeframe?: Timeframe;
  /** État de position DÉSIRÉ par bougie (décidé à la clôture). PURE. */
  position: (
    candles: Candle[],
    params: Record<string, number | boolean | string>,
    ctx: CalcContext
  ) => Array<EtatStrategie | undefined>;
  /** Textes FR des tooltips, résolus avec les params effectifs. */
  libelles: (params: Record<string, number | boolean | string>) => {
    long: string;
    short: string;
    sortie: string;
  };
}

/** Cap de trades clos annotés (les plus récents) — borne le coût du rendu. */
export const MAX_TRADES_ANNOTES = 60;

const INPUT_LIGNES_TRADES: IndicatorInput = {
  key: "lignesTrades",
  name: "Lignes de trades",
  type: "boolean",
  default: true,
};

function fmtSigne(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
}

function fmtPrix(v: number): string {
  return v.toFixed(2);
}

/** Trade reconstruit depuis les transitions d'état. */
interface TradeStrategie {
  sens: 1 | -1;
  idxEntree: number;
  prixEntree: number;
  idxSortie?: number;
  prixSortie?: number;
  pnlPct?: number;
}

export function defStrategie(spec: SpecStrategie): IndicatorDef {
  const def: IndicatorDef = {
    id: spec.id,
    name: spec.name,
    category: "strategy",
    pane: "overlay",
    inputs: [...spec.inputsStrategie, INPUT_LIGNES_TRADES],
    outputs: [{ key: "prixEntree", name: "Prix d'entrée", style: "line" }],
    calc(candles, params, ctx) {
      const n = candles.length;
      const etats = spec.position(candles, params, ctx);
      const lib = spec.libelles(params);
      const lignesTrades = params.lignesTrades !== false;

      // État EFFECTIF : un trou (undefined) au milieu maintient l'état précédent.
      const effectif: Array<EtatStrategie | undefined> = new Array(n).fill(undefined);
      let courant: EtatStrategie | undefined = undefined;
      for (let i = 0; i < n; i++) {
        const e = etats[i];
        if (e !== undefined) courant = e;
        effectif[i] = courant;
      }

      // Trades aux transitions (bougies clôturées : i ∈ [1, n−2]). Le premier
      // état défini a un `prev` undefined → jamais d'événement (silencieux).
      const trades: TradeStrategie[] = [];
      let ouvert: TradeStrategie | null = null;
      for (let i = 1; i <= n - 2; i++) {
        const prev = effectif[i - 1];
        const cur = effectif[i];
        if (prev === undefined || cur === undefined || prev === cur) continue;
        const close = candles[i]?.close;
        if (close === undefined || !Number.isFinite(close)) continue;
        if (prev !== 0 && ouvert !== null) {
          ouvert.idxSortie = i;
          ouvert.prixSortie = close;
          ouvert.pnlPct = ((close - ouvert.prixEntree) / ouvert.prixEntree) * 100 * ouvert.sens;
          trades.push(ouvert);
          ouvert = null;
        }
        if (cur !== 0) ouvert = { sens: cur, idxEntree: i, prixEntree: close };
      }

      // Série prixEntree : le prix d'entrée répété tant que la position vit.
      const prixEntree: Array<number | undefined> = new Array(n).fill(undefined);
      const remplir = (t: TradeStrategie, fin: number) => {
        for (let j = t.idxEntree; j <= fin; j++) prixEntree[j] = t.prixEntree;
      };
      for (const t of trades) remplir(t, t.idxSortie ?? n - 1);
      if (ouvert !== null) remplir(ouvert, n - 1);

      // Annotations (cap : les MAX_TRADES_ANNOTES trades clos les plus récents
      // + le trade en cours, toujours annoté).
      const marqueurs: MarqueurAnnotation[] = [];
      const labels: LabelAnnotation[] = [];
      const segments: SegmentAnnotation[] = [];
      const annoter = (t: TradeStrategie) => {
        const bEntree = candles[t.idxEntree];
        if (bEntree === undefined) return;
        const libEntree = t.sens === 1 ? lib.long : lib.short;
        const sens = t.sens === 1 ? "long" : "short";
        marqueurs.push({
          idx: t.idxEntree,
          valeur: t.sens === 1 ? bEntree.low : bEntree.high,
          forme: t.sens === 1 ? "triangleHaut" : "triangleBas",
          couleur: t.sens === 1 ? "--up" : "--down",
          cible: "prix",
          info: `Entrée ${sens} ${fmtPrix(t.prixEntree)} — ${libEntree}`,
        });
        if (t.idxSortie === undefined || t.prixSortie === undefined || t.pnlPct === undefined) return;
        const bSortie = candles[t.idxSortie];
        if (bSortie === undefined) return;
        const gagnant = t.pnlPct >= 0;
        labels.push({
          idx: t.idxSortie,
          valeur: t.sens === 1 ? bSortie.high : bSortie.low,
          texte: `${fmtSigne(t.pnlPct)} %`,
          couleur: gagnant ? "--up" : "--down",
          cible: "prix",
          position: t.sens === 1 ? "dessus" : "dessous",
          info: `Sortie ${sens} ${fmtPrix(t.prixSortie)} (${fmtSigne(t.pnlPct)} %) — ${lib.sortie}`,
        });
        if (lignesTrades) {
          segments.push({
            deIdx: t.idxEntree,
            deValeur: t.prixEntree,
            aIdx: t.idxSortie,
            aValeur: t.prixSortie,
            trait: "pointille",
            couleur: gagnant ? "--up" : "--down",
            cible: "prix",
            info:
              `${t.sens === 1 ? "Long" : "Short"} ${fmtPrix(t.prixEntree)} → ${fmtPrix(t.prixSortie)}, ` +
              `${fmtSigne(t.pnlPct)} % en ${t.idxSortie - t.idxEntree} bougies (hors frais) — ${libEntree}`,
          });
        }
      };
      for (const t of trades.slice(-MAX_TRADES_ANNOTES)) annoter(t);
      if (ouvert !== null) annoter(ouvert);

      const annotations: AnnotationsIndicateur = {};
      if (segments.length > 0) annotations.segments = segments;
      if (marqueurs.length > 0) annotations.marqueurs = marqueurs;
      if (labels.length > 0) annotations.labels = labels;
      return Object.keys(annotations).length > 0
        ? { series: { prixEntree }, annotations }
        : { series: { prixEntree } };
    },
  };
  if (spec.precision !== undefined) def.precision = spec.precision;
  if (spec.minTimeframe !== undefined) def.minTimeframe = spec.minTimeframe;
  return def;
}
```

Dans `packages/indicators/src/index.ts`, après l'export de `utils-fabrique-divergence` :

```ts
export * from "./utils-fabrique-strategie";
```

- [ ] **Step 4 : Vérifier** — même commande → PASS (6 tests). Dérivation du PnL vérifiée : (101−103)/103×100×(−1) = +1.9417 → « +1.94 % ».

- [ ] **Step 5 : Commit**

```bash
git add packages/indicators/src/utils-fabrique-strategie.ts \
  packages/indicators/src/utils-fabrique-strategie.test.ts packages/indicators/src/index.ts
git commit -m "feat(indicators): fabrique defStrategie — trades aux transitions, marqueurs/labels/segments PnL"
```

---

### Task 3 : Extraction du cœur `supertrendOf` (C2)

**Files:**
- Modify: `packages/indicators/src/trend/supertrend.ts`

**Interfaces:**
- Produces : `supertrendOf(candles: Candle[], period: number, mult: number): { line: Array<number | undefined>; direction: Array<number | undefined> }` — `direction` vaut +1/−1 (undefined pendant le warm-up ATR).

**Refactor PUR** (patron `rsiOf`/v2.1 Task 5) : déplacer le corps du `calc`
(lignes 44-116) dans la fonction exportée `supertrendOf` (docblock FR : « cœur
exporté — réutilisé par stratSupertrend ») ; le `calc` délègue :
`const r = supertrendOf(candles, period, mult); return { series: { line: r.line, direction: r.direction } };`
Comportement identique ⇒ AUCUN test modifié.

- [ ] **Step 1 : Extraire** (comme ci-dessus).
- [ ] **Step 2 : Vérifier** — `pnpm -C packages/indicators exec vitest run src/trend/supertrend.test.ts src/golden/` → PASS à l'identique.
- [ ] **Step 3 : Commit** — `git add packages/indicators/src/trend/supertrend.ts && git commit -m "refactor(indicators): cœur supertrendOf exporté (patron rsiOf)"`

---

### Task 4 : Stratégies « signe » — croisement MM, MACD, Supertrend (C2)

**Files:**
- Create: `packages/indicators/src/strategy/stratCroisementMM.ts` + `.test.ts`
- Create: `packages/indicators/src/strategy/stratMacdCross.ts` + `.test.ts`
- Create: `packages/indicators/src/strategy/stratSupertrend.ts` + `.test.ts`

**Interfaces:**
- Consumes : `defStrategie` (Task 2), `ema`/`sma` (`../utils`), `macdOf` (`../trend/macd`), `supertrendOf` (Task 3).
- Produces : ids `stratCroisementMM`, `stratMacdCross`, `stratSupertrend` (enregistrés en Task 6).

- [ ] **Step 1 : Test `stratCroisementMM` (échec attendu)**

`packages/indicators/src/strategy/stratCroisementMM.test.ts` :

```ts
/**
 * Dérivation à la main (type SMA, rapide=2, lente=3 — traçable de tête) :
 * closes = [10, 12, 14, 16, 14, 12, 10, 8, 9, 12, 15, 16, 16]   (n=13)
 * sma2   = [ u, 11, 13, 15, 15, 13, 11, 9, 8.5, 10.5, 13.5, 15.5, 16]
 * sma3   = [ u,  u, 12, 14, 14.67, 14, 12, 10, 9, 9.67, 12, 14.33, 15.67]
 * position (signe sma2−sma3) : [u,u,1,1,1,−1,−1,−1,−1,1,1,1,1]
 *  - i=2 : premier état défini → silencieux (pas de trade long).
 *  - i=5 : 1→−1 : ENTRÉE SHORT @ close[5]=12 (sortie ignorée : rien d'ouvert).
 *  - i=9 : −1→1 : SORTIE SHORT @ close[9]=12… NON : closes[9]=12 donne PnL 0 ;
 *    la fixture utilise closes[9]=13 → vérifier ci-dessous.
 * REMARQUE : la fixture EXACTE ci-dessous a closes[8]=9 et closes[9]=13 :
 * sma2[9]=(9+13)/2=11 ; sma3[9]=(8+9+13)/3=10 → position[9]=1.
 *  - i=9 : SORTIE SHORT @ 13 → PnL = (13−12)/12×100×(−1) = −8.3333 → « -8.33 % »
 *    (perdant, --down) ; ENTRÉE LONG @ 13 (retournement, même bougie).
 *  - i∈[10,11] : long maintenu ; i=12 = n−1 : hors transitions.
 * prixEntree : [u×5, 12,12,12,12, 13,13,13,13].
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { stratCroisementMM } from "./stratCroisementMM";

const closes = [10, 12, 14, 16, 14, 12, 10, 8, 9, 13, 15, 16, 16];
const candles: Candle[] = closes.map((c, i) => ({
  time: 1_700_000_000_000 + i * 3_600_000,
  open: c, high: c + 1, low: c - 1, close: c, volume: 1,
}));
const PARAMS = { type: "sma", rapide: 2, lente: 3 };

describe("stratCroisementMM", () => {
  it("contrat : strategy/overlay, inputs propres + lignesTrades en dernier", () => {
    expect(stratCroisementMM.category).toBe("strategy");
    expect(stratCroisementMM.pane).toBe("overlay");
    expect(stratCroisementMM.inputs.map((i) => i.key)).toEqual(["type", "rapide", "lente", "lignesTrades"]);
  });

  it("aller-retour dérivé à la main : short 12→13 (−8.33 %) puis long en cours", () => {
    const r = computeIndicator(stratCroisementMM, candles, PARAMS);
    expect(r.annotations?.marqueurs).toEqual([
      { idx: 5, valeur: 13, forme: "triangleBas", couleur: "--down", cible: "prix",
        info: "Entrée short 12.00 — croisement SMA 2 < SMA 3" },
      { idx: 9, valeur: 12, forme: "triangleHaut", couleur: "--up", cible: "prix",
        info: "Entrée long 13.00 — croisement SMA 2 > SMA 3" },
    ]);
    expect(r.annotations?.labels).toEqual([
      // Sortie de SHORT → label SOUS le low (position "dessous"), valeur = low[9] = 12.
      { idx: 9, valeur: 12, texte: "-8.33 %", couleur: "--down", cible: "prix", position: "dessous",
        info: "Sortie short 13.00 (-8.33 %) — croisement inverse" },
    ]);
    expect(r.annotations?.segments).toEqual([
      { deIdx: 5, deValeur: 12, aIdx: 9, aValeur: 13, trait: "pointille", couleur: "--down", cible: "prix",
        info: "Short 12.00 → 13.00, -8.33 % en 4 bougies (hors frais) — croisement SMA 2 < SMA 3" },
    ]);
    expect(r.series["prixEntree"]).toEqual(
      [undefined, undefined, undefined, undefined, undefined, 12, 12, 12, 12, 13, 13, 13, 13]
    );
  });
});
```

NB : re-dériver la fixture à la main avant de figer (les valeurs ci-dessus ont été dérivées deux fois — sma2/sma3 de tête, événements via les règles de la fabrique — mais la convention du repo exige que l'implémenteur refasse le calcul, pas qu'il recopie).

- [ ] **Step 2 : Vérifier l'échec** — module absent.

- [ ] **Step 3 : Implémenter `stratCroisementMM`**

```ts
/**
 * @axiom/indicators — strategy/stratCroisementMM.ts
 *
 * Stratégie croisement de moyennes mobiles (long/short symétrique) : long quand
 * la MM rapide est au-dessus de la lente, short en dessous, égalité = flat.
 * Type (EMA/SMA) et longueurs configurables — remplace les variantes figées
 * (le défaut EMA 9/21 est le classique intraday). Rendu par defStrategie.
 */

import { defStrategie, type EtatStrategie } from "../utils-fabrique-strategie";
import { ema, sma } from "../utils";

export const stratCroisementMM = defStrategie({
  id: "stratCroisementMM",
  name: "Stratégie croisement MM",
  inputsStrategie: [
    { key: "type", name: "Type de MM", type: "select", default: "ema", options: ["ema", "sma"] },
    { key: "rapide", name: "MM rapide", type: "number", default: 9, min: 1 },
    { key: "lente", name: "MM lente", type: "number", default: 21, min: 2 },
  ],
  position: (_candles, params, ctx) => {
    const moyenne = params.type === "sma" ? sma : ema;
    const rapide = moyenne(ctx.source, Number(params.rapide ?? 9));
    const lente = moyenne(ctx.source, Number(params.lente ?? 21));
    return ctx.source.map((_v, i): EtatStrategie | undefined => {
      const a = rapide[i];
      const b = lente[i];
      if (a === undefined || b === undefined) return undefined;
      return a > b ? 1 : a < b ? -1 : 0;
    });
  },
  libelles: (params) => {
    const t = params.type === "sma" ? "SMA" : "EMA";
    return {
      long: `croisement ${t} ${params.rapide} > ${t} ${params.lente}`,
      short: `croisement ${t} ${params.rapide} < ${t} ${params.lente}`,
      sortie: "croisement inverse",
    };
  },
});
```

- [ ] **Step 4 : `stratMacdCross`** — même structure exactement, avec :

```ts
import { defStrategie, type EtatStrategie } from "../utils-fabrique-strategie";
import { macdOf } from "../trend/macd";

export const stratMacdCross = defStrategie({
  id: "stratMacdCross",
  name: "Stratégie croisement MACD",
  inputsStrategie: [
    { key: "fast", name: "Fast", type: "number", default: 12, min: 1 },
    { key: "slow", name: "Slow", type: "number", default: 26, min: 1 },
    { key: "signal", name: "Signal", type: "number", default: 9, min: 1 },
    {
      key: "source", name: "Source", type: "source", default: "close",
      options: ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"],
    },
  ],
  position: (_candles, params, ctx) => {
    const r = macdOf(ctx.source, Number(params.fast ?? 12), Number(params.slow ?? 26), Number(params.signal ?? 9));
    return ctx.source.map((_v, i): EtatStrategie | undefined => {
      const m = r.macd[i];
      const s = r.signal[i];
      if (m === undefined || s === undefined) return undefined;
      return m > s ? 1 : m < s ? -1 : 0;
    });
  },
  libelles: (params) => ({
    long: `MACD (${params.fast}/${params.slow}) croise au-dessus du signal ${params.signal}`,
    short: `MACD (${params.fast}/${params.slow}) croise sous le signal ${params.signal}`,
    sortie: "croisement inverse",
  }),
});
```

Test `stratMacdCross.test.ts` : contrat (inputs `["fast","slow","signal","source","lignesTrades"]`)
+ fixture en double V (~40 bougies, params réduits `{fast: 2, slow: 4, signal: 2}`)
PROUVÉE : au moins un marqueur d'entrée ET un label de sortie ; cohérence
vérifiée par recomposition (`position` attendue = signe de
`macdOf(...).macd − .signal` sur la même fixture, transitions re-dérivées en
JS DANS le test — pas à la main, la cascade d'EMA n'est pas traçable de tête —
avec garde anti-tautologie `marqueurs.length > 0` et vérification que chaque
marqueur tombe sur un VRAI changement de signe).

- [ ] **Step 5 : `stratSupertrend`**

```ts
import { defStrategie, type EtatStrategie } from "../utils-fabrique-strategie";
import { supertrendOf } from "../trend/supertrend";

export const stratSupertrend = defStrategie({
  id: "stratSupertrend",
  name: "Stratégie Supertrend",
  inputsStrategie: [
    { key: "atrLength", name: "Période ATR", type: "number", default: 10, min: 1 },
    { key: "mult", name: "Multiplicateur", type: "number", default: 3, min: 0.5 },
  ],
  position: (candles, params) => {
    const r = supertrendOf(candles, Number(params.atrLength ?? 10), Number(params.mult ?? 3));
    return r.direction.map((d): EtatStrategie | undefined =>
      d === undefined ? undefined : d > 0 ? 1 : -1
    );
  },
  libelles: (params) => ({
    long: `bascule Supertrend haussière (ATR ${params.atrLength} × ${params.mult})`,
    short: `bascule Supertrend baissière (ATR ${params.atrLength} × ${params.mult})`,
    sortie: "bascule inverse",
  }),
});
```

Test : contrat + fixture V agitée (~30 bougies, `{atrLength: 2, mult: 0.5}`)
prouvée (≥ 1 entrée + 1 sortie), cohérence par recomposition vs
`supertrendOf(...).direction` (même patron que stratMacdCross).

- [ ] **Step 6 : Vérifier** — `pnpm -C packages/indicators exec vitest run src/strategy/` → PASS.

- [ ] **Step 7 : Commit**

```bash
git add packages/indicators/src/strategy/
git commit -m "feat(indicators): stratégies croisement MM / MACD / Supertrend (fabrique defStrategie)"
```

---

### Task 5 : Stratégies à état — RSI réversion, Bollinger réversion, Donchian (C2)

**Files:**
- Create: `packages/indicators/src/strategy/stratRsiReversion.ts` + `.test.ts`
- Create: `packages/indicators/src/strategy/stratBollingerReversion.ts` + `.test.ts`
- Create: `packages/indicators/src/strategy/stratDonchian.ts` + `.test.ts`

**Interfaces:**
- Consumes : `defStrategie`, `rsiOf` (`../momentum/rsi`), `sma`/`stdev`/`rollingHighest`/`rollingLowest`/`highOf`/`lowOf`/`closeOf` (`../utils`).
- Produces : ids `stratRsiReversion`, `stratBollingerReversion`, `stratDonchian`.

- [ ] **Step 1 : Test `stratDonchian` (échec attendu) — dérivé à la main**

```ts
/**
 * Dérivation à la main (canal=3) — canal des 3 bougies PRÉCÉDENTES (la bougie
 * courante est EXCLUE de son propre canal, sinon le breakout est indétectable) :
 * highs = [10,11,12,11,10,11,12,15,16,15,14,13,10,11]  (n=14)
 * lows  = highs − 2 ; closes = highs − 1
 * hh3   = [ u, u,12,12,12,11,12,15,16,16,16,15,14,13]
 * ll3   = [ u, u, 8, 9, 8, 8, 8, 9,10,13,12,11, 8, 8]
 * position[i] compare close[i] à hh3[i−1] / ll3[i−1] (définis dès i=3) :
 *  i=3 : close 10 ∈ ]8,12[ → premier état = 0 (silencieux)
 *  i∈[4,6] : dans le canal → 0
 *  i=7 : close 14 > hh3[6]=12 → 1 → ENTRÉE LONG @ 14
 *  i∈[8,11] : maintien 1 (jamais < ll3 précédent)
 *  i=12 : close 9 < ll3[11]=11 → −1 → SORTIE LONG @ 9
 *         (PnL = (9−14)/14×100 = −35.7142… → « -35.71 % ») + ENTRÉE SHORT @ 9
 *  i=13 = n−1 : hors transitions. Trade short EN COURS.
 * prixEntree : [u×7, 14,14,14,14,14, 9, 9].
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { stratDonchian } from "./stratDonchian";

const highs = [10, 11, 12, 11, 10, 11, 12, 15, 16, 15, 14, 13, 10, 11];
const candles: Candle[] = highs.map((h, i) => ({
  time: 1_700_000_000_000 + i * 3_600_000,
  open: h - 1, high: h, low: h - 2, close: h - 1, volume: 1,
}));

describe("stratDonchian", () => {
  it("contrat", () => {
    expect(stratDonchian.category).toBe("strategy");
    expect(stratDonchian.inputs.map((i) => i.key)).toEqual(["canal", "lignesTrades"]);
  });

  it("breakout haut → long, cassure basse → retournement short (dérivé à la main)", () => {
    const r = computeIndicator(stratDonchian, candles, { canal: 3 });
    expect(r.annotations?.marqueurs).toEqual([
      { idx: 7, valeur: 13, forme: "triangleHaut", couleur: "--up", cible: "prix",
        info: "Entrée long 14.00 — cassure du plus-haut 3 bougies" },
      { idx: 12, valeur: 10, forme: "triangleBas", couleur: "--down", cible: "prix",
        info: "Entrée short 9.00 — cassure du plus-bas 3 bougies" },
    ]);
    expect(r.annotations?.labels).toEqual([
      { idx: 12, valeur: 10, texte: "-35.71 %", couleur: "--down", cible: "prix", position: "dessus",
        info: "Sortie long 9.00 (-35.71 %) — cassure du canal opposé" },
    ]);
    expect(r.series["prixEntree"]).toEqual(
      [undefined, undefined, undefined, undefined, undefined, undefined, undefined, 14, 14, 14, 14, 14, 9, 9]
    );
  });
});
```

- [ ] **Step 2 : Implémenter `stratDonchian`**

```ts
/**
 * @axiom/indicators — strategy/stratDonchian.ts
 *
 * Stratégie breakout de canal Donchian (long/short) : long à la cassure du
 * plus-haut des `canal` bougies PRÉCÉDENTES (courante exclue), short à la
 * cassure du plus-bas ; entre les deux, la position est CONSERVÉE (stateful).
 * Premier état = flat une fois le canal défini. Rendu par defStrategie.
 */

import { defStrategie, type EtatStrategie } from "../utils-fabrique-strategie";
import { closeOf, highOf, lowOf, rollingHighest, rollingLowest } from "../utils";

export const stratDonchian = defStrategie({
  id: "stratDonchian",
  name: "Stratégie Donchian",
  inputsStrategie: [{ key: "canal", name: "Canal (bougies)", type: "number", default: 20, min: 2 }],
  position: (candles, params) => {
    const canal = Number(params.canal ?? 20);
    const hh = rollingHighest(highOf(candles), canal);
    const ll = rollingLowest(lowOf(candles), canal);
    const closes = closeOf(candles);
    const n = candles.length;
    const out: Array<EtatStrategie | undefined> = new Array(n).fill(undefined);
    let etat: EtatStrategie | undefined = undefined;
    for (let i = 1; i < n; i++) {
      const h = hh[i - 1]; // canal des `canal` bougies PRÉCÉDENTES
      const l = ll[i - 1];
      const c = closes[i];
      if (h === undefined || l === undefined || c === undefined) {
        out[i] = etat;
        continue;
      }
      if (c > h) etat = 1;
      else if (c < l) etat = -1;
      else etat = etat ?? 0; // canal défini, pas de cassure : flat au départ, maintien ensuite
      out[i] = etat;
    }
    return out;
  },
  libelles: (params) => ({
    long: `cassure du plus-haut ${params.canal} bougies`,
    short: `cassure du plus-bas ${params.canal} bougies`,
    sortie: "cassure du canal opposé",
  }),
});
```

- [ ] **Step 3 : `stratRsiReversion` (long/flat, machine à états)**

```ts
/**
 * @axiom/indicators — strategy/stratRsiReversion.ts
 *
 * Stratégie retour de survente (long/flat) : entrée quand le RSI RECROISE son
 * seuil de survente à la hausse (RSI[i−1] < survente ≤ RSI[i] — le rebond
 * confirmé, pas la chute) ; sortie quand le RSI atteint le seuil de surachat.
 * Pas de jambe short : la réversion crypto est asymétrique (les défauts 30/70
 * suivent le preset backtest « RSI survente/surachat »). Rendu par defStrategie.
 */

import { defStrategie, type EtatStrategie } from "../utils-fabrique-strategie";
import { rsiOf } from "../momentum/rsi";

export const stratRsiReversion = defStrategie({
  id: "stratRsiReversion",
  name: "Stratégie RSI réversion",
  inputsStrategie: [
    { key: "length", name: "Longueur RSI", type: "number", default: 14, min: 1 },
    { key: "survente", name: "Survente", type: "number", default: 30, min: 1, max: 50 },
    { key: "surachat", name: "Surachat", type: "number", default: 70, min: 50, max: 99 },
  ],
  position: (_candles, params, ctx) => {
    const r = rsiOf(ctx.source, Number(params.length ?? 14));
    const survente = Number(params.survente ?? 30);
    const surachat = Number(params.surachat ?? 70);
    const n = ctx.source.length;
    const out: Array<EtatStrategie | undefined> = new Array(n).fill(undefined);
    let etat: EtatStrategie = 0;
    for (let i = 0; i < n; i++) {
      const cur = r[i];
      if (cur === undefined) continue; // warm-up : out[i] reste undefined
      const prev = r[i - 1];
      if (etat === 1 && cur >= surachat) etat = 0;
      else if (etat === 0 && prev !== undefined && prev < survente && cur >= survente) etat = 1;
      out[i] = etat;
    }
    return out;
  },
  libelles: (params) => ({
    long: `RSI ${params.length} sort de survente (${params.survente})`,
    short: "", // jamais émis (long/flat)
    sortie: `RSI ${params.length} atteint le surachat (${params.surachat})`,
  }),
});
```

Test : contrat + dérivation à la main avec `length: 2` sur une séquence
descente→rebond→montée construite pour traverser 30 puis 70 (calculer le RSI(2)
de Wilder à la main dans le docblock, patron `rsi.test.ts` qui le fait déjà en
length 3 — OU réutiliser `rsiOf` importé pour dériver la position attendue en
JS dans le test, avec garde `marqueurs.length === 1` et sortie présente).

- [ ] **Step 4 : `stratBollingerReversion` (long/short, machine à états)**

```ts
/**
 * @axiom/indicators — strategy/stratBollingerReversion.ts
 *
 * Stratégie mean-reversion Bollinger (long/short) : entrée long quand le close
 * RE-franchit la bande basse à la hausse (close[i−1] < bandeBasse[i−1] ET
 * close[i] ≥ bandeBasse[i] — le retour DANS les bandes, pas l'excursion) ;
 * short miroir sur la bande haute ; sortie au retour sur la moyenne (SMA) :
 * long sort quand close ≥ SMA, short sort quand close ≤ SMA. En position, la
 * sortie est évaluée AVANT toute nouvelle entrée. Rendu par defStrategie.
 */

import { defStrategie, type EtatStrategie } from "../utils-fabrique-strategie";
import { sma, stdev } from "../utils";

export const stratBollingerReversion = defStrategie({
  id: "stratBollingerReversion",
  name: "Stratégie Bollinger réversion",
  inputsStrategie: [
    { key: "length", name: "Longueur", type: "number", default: 20, min: 2 },
    { key: "mult", name: "Multiplicateur σ", type: "number", default: 2, min: 0.1 },
  ],
  position: (_candles, params, ctx) => {
    const length = Number(params.length ?? 20);
    const mult = Number(params.mult ?? 2);
    const src = ctx.source;
    const m = sma(src, length);
    const sd = stdev(src, length);
    const n = src.length;
    const out: Array<EtatStrategie | undefined> = new Array(n).fill(undefined);
    let etat: EtatStrategie = 0;
    for (let i = 0; i < n; i++) {
      const moy = m[i];
      const s = sd[i];
      const c = src[i];
      if (moy === undefined || s === undefined || c === undefined) continue;
      const bas = moy - mult * s;
      const haut = moy + mult * s;
      const cPrev = src[i - 1];
      const mPrev = m[i - 1];
      const sPrev = sd[i - 1];
      if (etat === 1 && c >= moy) etat = 0;
      else if (etat === -1 && c <= moy) etat = 0;
      else if (etat === 0 && cPrev !== undefined && mPrev !== undefined && sPrev !== undefined) {
        if (cPrev < mPrev - mult * sPrev && c >= bas) etat = 1;
        else if (cPrev > mPrev + mult * sPrev && c <= haut) etat = -1;
      }
      out[i] = etat;
    }
    return out;
  },
  libelles: (params) => ({
    long: `retour au-dessus de la bande basse (${params.length}, ${params.mult}σ)`,
    short: `retour sous la bande haute (${params.length}, ${params.mult}σ)`,
    sortie: "retour à la moyenne",
  }),
});
```

Test : contrat + fixture en V profond (`{length: 3, mult: 1}`) PROUVÉE : le
close casse la bande basse puis rebondit → 1 entrée long + 1 sortie à la
moyenne ; position attendue re-dérivée en JS dans le test (sma/stdev importés),
garde `marqueurs.length >= 1` + chaque entrée coïncide avec un re-franchissement.

- [ ] **Step 5 : Vérifier** — `pnpm -C packages/indicators exec vitest run src/strategy/` → PASS.

- [ ] **Step 6 : Commit**

```bash
git add packages/indicators/src/strategy/
git commit -m "feat(indicators): stratégies RSI réversion / Bollinger réversion / Donchian"
```

---

### Task 6 : `stratDivergenceRsi` + registre 167 (C2)

**Files:**
- Create: `packages/indicators/src/strategy/stratDivergenceRsi.ts` + `.test.ts`
- Modify: `packages/indicators/src/registry.ts` (7 imports + bloc « stratégies »)
- Modify: `packages/indicators/src/registry.test.ts` (160 → 167 ; test catégorie strategy : 8 → 15 ids)

**Interfaces:**
- Consumes : `defStrategie`, `rsiOf`, `detecterDivergences` (+ `highOf`/`lowOf`).

- [ ] **Step 1 : Implémenter `stratDivergenceRsi`**

```ts
/**
 * @axiom/indicators — strategy/stratDivergenceRsi.ts
 *
 * Stratégie divergence RSI (long/short) : entrée à la CONFIRMATION d'une
 * divergence RÉGULIÈRE (les cachées ne déclenchent rien — stratégie de
 * retournement). Anti-look-ahead STRICT : detecterDivergences date une
 * divergence à son pivot (idxTo), mais ce pivot n'est CONNU que `droite`
 * bougies plus tard — l'entrée est donc posée à idxTo + droite, jamais au
 * pivot. Sortie : RSI extrême opposé (long sort à ≥ seuilSortie, short à
 * ≤ 100 − seuilSortie). Une divergence confirmée pendant une position du même
 * sens est ignorée ; pendant une position opposée, elle attend le flat (pas de
 * retournement direct : la sortie est pilotée par le RSI). Rendu par defStrategie.
 */

import { defStrategie, type EtatStrategie } from "../utils-fabrique-strategie";
import { detecterDivergences } from "../utils-divergence";
import { highOf, lowOf } from "../utils";
import { rsiOf } from "../momentum/rsi";

export const stratDivergenceRsi = defStrategie({
  id: "stratDivergenceRsi",
  name: "Stratégie divergence RSI",
  inputsStrategie: [
    { key: "length", name: "Longueur RSI", type: "number", default: 14, min: 1 },
    { key: "gauche", name: "Pivot gauche", type: "number", default: 5, min: 1 },
    { key: "droite", name: "Pivot droite", type: "number", default: 5, min: 1 },
    { key: "maxEcart", name: "Écart max (barres)", type: "number", default: 60, min: 5, max: 300 },
    { key: "seuilSortie", name: "Seuil de sortie (RSI)", type: "number", default: 70, min: 50, max: 99 },
  ],
  position: (candles, params, ctx) => {
    const length = Number(params.length ?? 14);
    const gauche = Number(params.gauche ?? 5);
    const droite = Number(params.droite ?? 5);
    const maxEcart = Number(params.maxEcart ?? 60);
    const seuilSortie = Number(params.seuilSortie ?? 70);
    const r = rsiOf(ctx.source, length);
    const n = candles.length;
    const opts = { gauche, droite, maxEcart };

    // Index de CONFIRMATION (idxTo + droite) des divergences régulières.
    const confirmLong = new Set<number>();
    for (const d of detecterDivergences(lowOf(candles), r, opts)) {
      if (d.type === "haussiere" && d.idxTo + droite < n) confirmLong.add(d.idxTo + droite);
    }
    const confirmShort = new Set<number>();
    for (const d of detecterDivergences(highOf(candles), r, opts)) {
      if (d.type === "baissiere" && d.idxTo + droite < n) confirmShort.add(d.idxTo + droite);
    }

    const out: Array<EtatStrategie | undefined> = new Array(n).fill(undefined);
    let etat: EtatStrategie = 0;
    for (let i = 0; i < n; i++) {
      const cur = r[i];
      if (cur === undefined) continue; // warm-up RSI
      if (etat === 1 && cur >= seuilSortie) etat = 0;
      else if (etat === -1 && cur <= 100 - seuilSortie) etat = 0;
      if (etat === 0) {
        if (confirmLong.has(i)) etat = 1;
        else if (confirmShort.has(i)) etat = -1;
      }
      out[i] = etat;
    }
    return out;
  },
  libelles: (params) => ({
    long: `divergence RSI haussière confirmée (${params.gauche}/${params.droite})`,
    short: `divergence RSI baissière confirmée (${params.gauche}/${params.droite})`,
    sortie: `RSI ${params.length} extrême (seuil ${params.seuilSortie})`,
  }),
});
```

- [ ] **Step 2 : Test** — contrat (ordre des inputs + `lignesTrades` dernier) +
  câblage sur la fixture PROUVÉE de `momentum/rsiDivergence.test.ts` (double V,
  divergence haussière connue avec `{length: 3, gauche: 2, droite: 2}`) :
  vérifier qu'un marqueur `triangleHaut` existe EXACTEMENT à `idxTo + droite`
  de la divergence détectée (re-dériver `idxTo` en appelant `detecterDivergences`
  dans le test), qu'AUCUN marqueur ne tombe à `idxTo` (anti-look-ahead pinné
  par assertion négative), et garde anti-tautologie `marqueurs.length >= 1`.
  Ajouter un cas `seuilSortie` bas (55) pour prouver une sortie.

- [ ] **Step 3 : Registre** — dans `registry.ts` : bloc d'imports
  `import { stratCroisementMM } from "./strategy/stratCroisementMM";` (×7) et
  entrées groupées en fin de tableau sous un commentaire `// — stratégies (v2.2)` :
  `stratCroisementMM, stratRsiReversion, stratMacdCross, stratSupertrend,
  stratDonchian, stratBollingerReversion, stratDivergenceRsi,`.
  Dans `registry.test.ts` : compte `toBe(167)` ; test catégorie strategy →
  liste triée des 15 ids (8 déplacés + 7 `strat*`).

- [ ] **Step 4 : Vérifier** — `pnpm -C packages/indicators exec vitest run` (167) + `pnpm check`.
  Vigilance `engine-source.test.ts` : `stratMacdCross` déclare un input `source`
  → il entre dans le test générique « consomme réellement ctx.source ». Si la
  fixture générique de ce test ne produit AUCUN trade (aucun point défini à
  comparer), le test distingue déjà ce cas (`comparedDefined`) ; si au contraire
  il ÉCHOUE (séries identiques définies), ne PAS l'ajouter à
  `POINT_VALUE_INVARIANTS` sans consigner — remonter au contrôleur (c'est un
  signe que `prixEntree` ne dépend pas de la source sur cette fixture, à
  arbitrer explicitement).

- [ ] **Step 5 : Commit**

```bash
git add packages/indicators/src/strategy/ packages/indicators/src/registry.ts packages/indicators/src/registry.test.ts
git commit -m "feat(indicators): stratDivergenceRsi + registre 167 (15 defs Stratégies)"
```

---

### Task 7 : Intégration — merge + gate visuel

- [ ] **Step 1 : Merges** — C1 → main (gate `pnpm check`), C2 → main (gate `pnpm check`). `git -C ~/axiom …` explicite.
- [ ] **Step 2 : Gate visuel in-page** (BTCUSDT Binance 1h, sondes DOM/getImageData, conventions v1.4/v2.1) :
  1. Le menu Indicateurs ouvre avec « Stratégies » EN PREMIÈRE section, 15 entrées.
  2. Activer `Stratégie croisement MM` : ▲/▼ aux croisements, labels « ±x.xx % » colorés par signe, segments pointillés entrée→sortie, ligne `prixEntree` visible pendant les positions ; crosshair sur un marqueur → info « Entrée long … — croisement EMA 9 > EMA 21 ».
  3. Éditer les params (rapide 9 → 50) : les signaux se recalculent ; `lignesTrades` OFF : les segments disparaissent, marqueurs/labels restent.
  4. Activer `Stratégie Supertrend` + `Stratégie Donchian` en parallèle : lisible, pas de collision bloquante ; zéro erreur console.
  5. `Stratégie divergence RSI` : le marqueur d'entrée est APRÈS le pivot (jamais dessus) — comparer visuellement avec `RSI Divergence` activé en même temps (le segment de divergence pointe le pivot, le ▲ de la stratégie est `droite` bougies plus tard).
  6. Dernière bougie : aucun marqueur ne clignote sur la bougie en formation (observer ~30 s en live).
  7. Thèmes (dark → bloomberg) : couleurs suivent.
  8. Palette ⌘K : « strat » liste les 7 stratégies ; activation/désactivation OK.
  9. Suppression d'une instance : ses marqueurs/segments disparaissent.
- [ ] **Step 3 : Calibrages consignés au ledger si nécessaire** (aucun défaut n'est pressenti — les stratégies n'ont pas de seuil de déclenchement à calibrer, leurs signaux sont structurels).
