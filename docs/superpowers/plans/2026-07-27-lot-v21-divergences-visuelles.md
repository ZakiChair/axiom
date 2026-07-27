# Lot v2.1 — Divergences visuelles : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Donner un canal de rendu visuel (segments pivot→pivot, labels, marqueurs, rubans, tooltips) aux détections de divergence d'AXIOM, et livrer 8 indicateurs qui l'exploitent (registre 155 → 160).

**Architecture :** `IndicatorResult` gagne un champ optionnel `annotations` calculé dans le `calc` pur (packages/indicators, testable sans navigateur). Côté chart, deux canaux de rendu sur patrons prouvés en prod : un `draw` générique dans le pont (`chart/indicators.ts`, patron orderflow.ts) pour le pane de l'indicateur, et des overlays KLineChart (`registerOverlay`, patron WHALE/ECO/fibonacci) pour les annotations cible « prix » des defs à pane séparé.

**Tech stack :** TypeScript pur (packages), KLineChart 9.8.12, Vitest, monorepo pnpm.

**Spec :** `docs/superpowers/specs/2026-07-27-lot-v21-divergences-visuelles-design.md`.

## Global Constraints

- Commentaires et identifiants métier en **français** (docblocks longs et explicatifs, convention la plus visible du repo).
- Calculs **PURS** dans `packages/indicators` : aucun fetch, aucun DOM, `noUncheckedIndexedAccess` actif (tout accès indexé gardé).
- Couleurs d'annotation = **noms de tokens CSS** (`"--up"`, `"--down"`), jamais un hex ; résolues AU RENDU via `lireTokenCanvas`/`rgbaTokenCanvas` (`apps/web/src/lib/canvasTokens.ts`), jamais au montage.
- Dégradation gracieuse : aux absent → séries `undefined`, zéro annotation, zéro throw. Un def sans `annotations` traverse tous les nouveaux chemins en no-op strict.
- Anti-repaint hérité : `detecterPivots` ne confirme un pivot qu'après `droite` barres — aucun mécanisme nouveau.
- `ECART_APPARIEMENT = 3` reste une constante non paramétrable (`utils-divergence.ts:65`).
- Caps de rendu : 150 annotations overlay par instance, 40 rubans par calc. Throttle existant (500 ms) inchangé.
- Zéro nouvelle source de données (aux `mark` et `perpDelta` existants), zéro nouvelle fenêtre, zéro nouvelle clé API.
- Tests : valeurs attendues **dérivées à la main dans le docblock** (convention du repo) ; `pnpm check` vert sur chaque branche avant merge ; gate `pnpm check` post-merge obligatoire (leçon v1.8).
- Branches : C1 `feat/canal-annotations` (base `main`, **bloquante**) ; puis C2 `feat/divergences-oscillateurs`, C3 `feat/cvd-spotperp-annotations`, C4 `feat/premium-spotperp` en parallèle (base = `main` après merge C1). Merge final : C2 → C3 → C4.

**Amendements au spec consignés** (bugs de spec attrapés au chiffrage du plan, cf. leçon v1.8) :
1. `cvdSpotPerp` v2 : lookback de divergence = **nouvel input `fenetreDiv` (défaut 14)** — la constante actuelle du module WS — et PAS l'input existant `fenetre` (100, fenêtre de normalisation z).
2. `mfiDivergence` : catégorie **`momentum`** (comme le def de base `mfi`), pas `volume`.
3. `LabelAnnotation` gagne `position?: "dessus" | "dessous"` (placement du label côté prix : sous le creux pour les haussières, au-dessus du sommet pour les baissières).
4. `Divergence` (utils-divergence.ts) gagne deux champs **requis** `oscIdxFrom`/`oscIdxTo` (index des pivots oscillateur appariés) : le segment miroir du pane doit relier les **vrais** pivots osc (à ±3 barres des pivots prix), pas les valeurs osc aux index prix.

---

### Task 1 : Types d'annotations + moteur `construireAnnotationsDivergence` (C1)

**Files:**
- Modify: `packages/types/src/index.ts` (après `IndicatorResult`, ~ligne 258)
- Modify: `packages/indicators/src/utils-divergence.ts` (interface `Divergence` + push ~ligne 127)
- Modify: `packages/indicators/src/utils-divergence.test.ts` (expectations enrichies)
- Create: `packages/indicators/src/utils-annotations.ts`
- Create: `packages/indicators/src/utils-annotations.test.ts`
- Modify: `packages/indicators/src/index.ts` (export)

**Interfaces:**
- Consumes: `detecterPivots`/`detecterDivergences` existants (`utils-divergence.ts`).
- Produces (pour les Tasks 2, 3, 4, 8, 9) :
  - Types dans `@axiom/types` : `CibleAnnotation`, `TraitAnnotation`, `SegmentAnnotation`, `MarqueurAnnotation`, `LabelAnnotation`, `RubanAnnotation`, `AnnotationsIndicateur` ; `IndicatorResult.annotations?: AnnotationsIndicateur`.
  - `Divergence` étendue : `{ idxFrom, idxTo, oscIdxFrom, oscIdxTo, type }`.
  - `construireAnnotationsDivergence(highs: ReadonlyArray<number>, lows: ReadonlyArray<number>, osc: ReadonlyArray<number | undefined>, opts: OptionsAnnotationsDivergence): AnnotationsIndicateur` avec `OptionsAnnotationsDivergence = { gauche: number; droite: number; maxEcart: number; cachees: boolean; nomOsc: string; formateur?: (v: number) => string }`.

- [ ] **Step 1 : Écrire le test qui échoue**

`packages/indicators/src/utils-annotations.test.ts` :

```ts
/**
 * @axiom/indicators — utils-annotations.test.ts
 *
 * Dérivation à la main (gauche=2, droite=2, maxEcart=60), fixtures courtes (n=10) :
 *
 * Cas 1 (régulière) :
 *   lows  = [10, 9, 8, 9, 10, 9, 7, 8, 9, 10]  → pivots low : idx 2 (8), idx 6 (7) ;
 *           pivot high parasite idx 4 (10), seul → aucune paire baissière sur cette série.
 *   highs = [12, 11, 10, 11, 12, 11, 9, 10, 11, 12] → pivot high idx 4 (12) seul →
 *           aucune paire baissière ; ses pivots low (idx 2/6) donnent une famille
 *           haussière FILTRÉE (une baissière se lit sur les sommets uniquement).
 *   osc   = [5, 4, 3, 4, 5, 4, 3.5, 4.5, 5, 5.5] → pivots low osc : idx 2 (3), idx 6 (3.5).
 *   Paire lows (2,6) : prix 7 < 8 (creux plus bas) & osc 3.5 > 3 (en hausse)
 *   → HAUSSIÈRE RÉGULIÈRE, oscIdxFrom=2, oscIdxTo=6.
 *
 * Cas 2 (cachée) :
 *   lows2 = [10, 9, 8, 9, 10, 9.5, 8.5, 9.5, 10, 10.5] → pivots low idx 2 (8), idx 6 (8.5).
 *   highs2 = lows2 + 2 (même forme, même filtrage).
 *   osc2  = [5, 4, 3, 4, 5, 4, 2.5, 3.5, 4, 4.5] → pivots low idx 2 (3), idx 6 (2.5).
 *   Paire (2,6) : prix 8.5 > 8 (creux plus haut) & osc 2.5 < 3 (en baisse)
 *   → HAUSSIÈRE CACHÉE : segments pointillés, PAS de label.
 */
import { describe, expect, it } from "vitest";
import { construireAnnotationsDivergence } from "./utils-annotations";

const lows = [10, 9, 8, 9, 10, 9, 7, 8, 9, 10];
const highs = [12, 11, 10, 11, 12, 11, 9, 10, 11, 12];
const osc = [5, 4, 3, 4, 5, 4, 3.5, 4.5, 5, 5.5];

const lows2 = [10, 9, 8, 9, 10, 9.5, 8.5, 9.5, 10, 10.5];
const highs2 = lows2.map((v) => v + 2);
const osc2 = [5, 4, 3, 4, 5, 4, 2.5, 3.5, 4, 4.5];

const OPTS = { gauche: 2, droite: 2, maxEcart: 60, cachees: true, nomOsc: "OSC" };

const INFO_REG =
  "Divergence haussière régulière — prix 8.00 → 7.00 (creux plus bas) vs OSC 3.00 → 3.50 (en hausse)";
const INFO_CACHEE =
  "Divergence haussière cachée — prix 8.00 → 8.50 (creux plus haut) vs OSC 3.00 → 2.50 (en baisse)";

describe("construireAnnotationsDivergence", () => {
  it("régulière : segment prix + segment pane (pivots osc) + label dessous, info partagée", () => {
    const a = construireAnnotationsDivergence(highs, lows, osc, OPTS);
    expect(a.segments).toEqual([
      { deIdx: 2, deValeur: 8, aIdx: 6, aValeur: 7, trait: "plein", couleur: "--up", cible: "prix", info: INFO_REG },
      { deIdx: 2, deValeur: 3, aIdx: 6, aValeur: 3.5, trait: "plein", couleur: "--up", cible: "pane", info: INFO_REG },
    ]);
    expect(a.labels).toEqual([
      { idx: 6, valeur: 7, texte: "Div ▲", couleur: "--up", cible: "prix", position: "dessous", info: INFO_REG },
    ]);
    expect(a.marqueurs).toBeUndefined();
    expect(a.rubans).toBeUndefined();
  });

  it("cachée : segments pointillés, AUCUN label (anti-encombrement)", () => {
    const a = construireAnnotationsDivergence(highs2, lows2, osc2, OPTS);
    expect(a.segments).toEqual([
      { deIdx: 2, deValeur: 8, aIdx: 6, aValeur: 8.5, trait: "pointille", couleur: "--up", cible: "prix", info: INFO_CACHEE },
      { deIdx: 2, deValeur: 3, aIdx: 6, aValeur: 2.5, trait: "pointille", couleur: "--up", cible: "pane", info: INFO_CACHEE },
    ]);
    expect(a.labels).toBeUndefined();
  });

  it("cachees=false : les divergences cachées ne produisent RIEN", () => {
    const a = construireAnnotationsDivergence(highs2, lows2, osc2, { ...OPTS, cachees: false });
    expect(a).toEqual({});
  });

  it("série plate : aucune annotation (objet vide, pas de clés)", () => {
    const plat = new Array<number>(10).fill(5);
    expect(construireAnnotationsDivergence(plat, plat, plat, OPTS)).toEqual({});
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `pnpm -C packages/indicators exec vitest run src/utils-annotations.test.ts`
Attendu : FAIL (« Cannot find module './utils-annotations' »).

- [ ] **Step 3 : Types dans `@axiom/types`**

Dans `packages/types/src/index.ts`, remplacer le bloc `IndicatorResult` (lignes 254-258) par :

```ts
// ---------- Annotations d'indicateur (canal de rendu visuel, lot v2.1) ----------
/** Cible de rendu d'une annotation : chart maître ("prix") ou pane de l'indicateur ("pane"). */
export type CibleAnnotation = "prix" | "pane";
/** Trait d'un segment : plein = divergence régulière, pointillé = cachée. */
export type TraitAnnotation = "plein" | "pointille";

/**
 * Segment pivot→pivot (ligne de divergence). Les index (`deIdx`/`aIdx`) sont des
 * index de BOUGIE dans le tableau `candles` passé au calc — l'appelant convertit
 * en timestamp/pixel au rendu. `couleur` est TOUJOURS un nom de token CSS
 * (`"--up"`, `"--down"`, `"--accent"`, `"--serie-N"`), jamais un hex : le rendu
 * résout par thème au moment du dessin. `info` = texte brut FR du tooltip.
 */
export interface SegmentAnnotation {
  deIdx: number;
  deValeur: number;
  aIdx: number;
  aValeur: number;
  trait: TraitAnnotation;
  couleur: string;
  cible: CibleAnnotation;
  info?: string;
}

/** Marqueur triangulaire posé à une bougie (mêmes conventions que SegmentAnnotation). */
export interface MarqueurAnnotation {
  idx: number;
  valeur: number;
  forme: "triangleHaut" | "triangleBas";
  couleur: string;
  cible: CibleAnnotation;
  info?: string;
}

/** Étiquette texte ancrée à une bougie. `position` : "dessous" = sous le point (haussières). */
export interface LabelAnnotation {
  idx: number;
  valeur: number;
  texte: string;
  couleur: string;
  cible: CibleAnnotation;
  position?: "dessus" | "dessous";
  info?: string;
}

/**
 * Zone remplie entre deux courbes (`hauts`/`bas` alignés depuis `deIdx`), rendue
 * sur le chart maître uniquement (prime spot/perp). `alpha` = opacité du fill.
 */
export interface RubanAnnotation {
  deIdx: number;
  hauts: number[];
  bas: number[];
  couleur: string;
  alpha: number;
  info?: string;
}

/** Annotations optionnelles d'un calc — chaque clé absente = rien à rendre. */
export interface AnnotationsIndicateur {
  segments?: SegmentAnnotation[];
  marqueurs?: MarqueurAnnotation[];
  labels?: LabelAnnotation[];
  rubans?: RubanAnnotation[];
}

/** Résultat de calcul : une série de valeurs par clé de sortie, alignée sur les bougies. */
export interface IndicatorResult {
  /** clé d'output -> valeurs (NaN/undefined pour les bougies sans valeur). */
  series: Record<string, Array<number | undefined>>;
  /** Annotations visuelles (segments de divergence, rubans…) — absentes = aucun rendu. */
  annotations?: AnnotationsIndicateur;
}
```

- [ ] **Step 4 : Étendre `Divergence` avec les index de pivots osc**

Dans `packages/indicators/src/utils-divergence.ts` :

Remplacer l'interface (lignes 58-62) par :

```ts
export interface Divergence {
  idxFrom: number;
  idxTo: number;
  /** Index des pivots OSCILLATEUR appariés (±ECART_APPARIEMENT barres des pivots
   * prix) — nécessaires pour tracer le segment miroir sur le pane de l'oscillateur
   * en reliant les VRAIS pivots osc, pas les valeurs osc aux index prix. */
  oscIdxFrom: number;
  oscIdxTo: number;
  type: TypeDivergence;
}
```

Remplacer la ligne de push (ligne 127) par :

```ts
      if (type !== undefined) out.push({ idxFrom: p1.idx, idxTo: p2.idx, oscIdxFrom: o1, oscIdxTo: o2, type });
```

Dans `packages/indicators/src/utils-divergence.test.ts`, enrichir chaque objet attendu
avec les index osc **dérivés des points de contrôle des fixtures existantes** (les
creux/sommets osc sont aux index des points de contrôle `rampe`) :

| test | attendu |
|---|---|
| haussière régulière | `{ idxFrom: 10, idxTo: 28, oscIdxFrom: 10, oscIdxTo: 28, type: "haussiere" }` |
| baissière régulière | `{ idxFrom: 10, idxTo: 28, oscIdxFrom: 10, oscIdxTo: 28, type: "baissiere" }` |
| haussière cachée | `{ idxFrom: 10, idxTo: 28, oscIdxFrom: 10, oscIdxTo: 28, type: "haussiere-cachee" }` |
| baissière cachée | `{ idxFrom: 10, idxTo: 28, oscIdxFrom: 10, oscIdxTo: 28, type: "baissiere-cachee" }` |
| maxEcart (2e expect) | `{ idxFrom: 8, idxTo: 30, oscIdxFrom: 8, oscIdxTo: 30, type: "haussiere" }` |
| décalés de 2 barres | `{ idxFrom: 10, idxTo: 28, oscIdxFrom: 12, oscIdxTo: 30, type: "haussiere" }` |
| borne ±3 (oscA3) | `{ idxFrom: 10, idxTo: 28, oscIdxFrom: 13, oscIdxTo: 31, type: "haussiere" }` |
| historique complet | `{ idxFrom: 8, idxTo: 20, oscIdxFrom: 8, oscIdxTo: 20, … }` et `{ idxFrom: 20, idxTo: 32, oscIdxFrom: 20, oscIdxTo: 32, … }` |

(Les tests attendant `[]` sont inchangés. `placerPointsDivergence` ignore les
nouveaux champs — aucun changement dans `utils-divergence-points*`.)

- [ ] **Step 5 : Implémenter le moteur**

`packages/indicators/src/utils-annotations.ts` :

```ts
/**
 * @axiom/indicators — utils-annotations.ts
 *
 * Traduction PURE des divergences détectées (utils-divergence.ts) en annotations
 * de rendu (@axiom/types AnnotationsIndicateur) : segment prix pivot→pivot,
 * segment miroir sur le pane de l'oscillateur (reliant les pivots OSC appariés),
 * label « Div ▲/▼ » au pivot d'arrivée (régulières seulement — les cachées se
 * lisent au pointillé et au tooltip, anti-encombrement), texte `info` FR partagé.
 *
 * Conventions héritées de placerPointsDivergence : la famille HAUSSIÈRE se lit
 * sur les creux (lows), la BAISSIÈRE sur les sommets (highs) ; chaque appel à
 * detecterDivergences calcule aussi l'autre famille sur la même série — on la
 * filtre. Anti-repaint hérité de detecterPivots (droite barres de confirmation).
 */

import type {
  AnnotationsIndicateur,
  LabelAnnotation,
  SegmentAnnotation,
} from "@axiom/types";
import { detecterDivergences, type TypeDivergence } from "./utils-divergence";

export interface OptionsAnnotationsDivergence {
  gauche: number;
  droite: number;
  maxEcart: number;
  /** false = les divergences cachées ne produisent aucune annotation. */
  cachees: boolean;
  /** Nom de l'oscillateur dans le texte du tooltip (ex. "RSI"). */
  nomOsc: string;
  /** Formatage des valeurs dans `info` (défaut : toFixed(2)). */
  formateur?: (v: number) => string;
}

/** Token couleur par type (haussières --up, baissières --down). */
const COULEUR: Record<TypeDivergence, string> = {
  haussiere: "--up",
  "haussiere-cachee": "--up",
  baissiere: "--down",
  "baissiere-cachee": "--down",
};

/** Qualificatif du mouvement de prix entre les deux pivots, par type. */
const MOTS_PRIX: Record<TypeDivergence, string> = {
  haussiere: "creux plus bas",
  "haussiere-cachee": "creux plus haut",
  baissiere: "sommet plus haut",
  "baissiere-cachee": "sommet plus bas",
};

export function construireAnnotationsDivergence(
  highs: ReadonlyArray<number>,
  lows: ReadonlyArray<number>,
  osc: ReadonlyArray<number | undefined>,
  opts: OptionsAnnotationsDivergence,
): AnnotationsIndicateur {
  const fmt = opts.formateur ?? ((v: number) => v.toFixed(2));
  const detOpts = { gauche: opts.gauche, droite: opts.droite, maxEcart: opts.maxEcart };
  const segments: SegmentAnnotation[] = [];
  const labels: LabelAnnotation[] = [];

  const traiter = (prix: ReadonlyArray<number>, famille: "haussiere" | "baissiere") => {
    for (const d of detecterDivergences(prix, osc, detOpts)) {
      const estHauss = d.type === "haussiere" || d.type === "haussiere-cachee";
      if ((famille === "haussiere") !== estHauss) continue; // mauvaise série pour ce sens
      const cachee = d.type === "haussiere-cachee" || d.type === "baissiere-cachee";
      if (cachee && !opts.cachees) continue;
      const p1 = prix[d.idxFrom];
      const p2 = prix[d.idxTo];
      const o1 = osc[d.oscIdxFrom];
      const o2 = osc[d.oscIdxTo];
      // Pivots garantis définis par detecterPivots ; gardes noUncheckedIndexedAccess.
      if (p1 === undefined || p2 === undefined || o1 === undefined || o2 === undefined) continue;

      const couleur = COULEUR[d.type];
      const trait = cachee ? ("pointille" as const) : ("plein" as const);
      const info =
        `Divergence ${estHauss ? "haussière" : "baissière"} ${cachee ? "cachée" : "régulière"}` +
        ` — prix ${fmt(p1)} → ${fmt(p2)} (${MOTS_PRIX[d.type]})` +
        ` vs ${opts.nomOsc} ${fmt(o1)} → ${fmt(o2)} (${o2 > o1 ? "en hausse" : "en baisse"})`;

      segments.push({ deIdx: d.idxFrom, deValeur: p1, aIdx: d.idxTo, aValeur: p2, trait, couleur, cible: "prix", info });
      segments.push({ deIdx: d.oscIdxFrom, deValeur: o1, aIdx: d.oscIdxTo, aValeur: o2, trait, couleur, cible: "pane", info });
      if (!cachee) {
        labels.push({
          idx: d.idxTo,
          valeur: p2,
          texte: estHauss ? "Div ▲" : "Div ▼",
          couleur,
          cible: "prix",
          position: estHauss ? "dessous" : "dessus",
          info,
        });
      }
    }
  };

  traiter(lows, "haussiere");
  traiter(highs, "baissiere");

  const out: AnnotationsIndicateur = {};
  if (segments.length > 0) out.segments = segments;
  if (labels.length > 0) out.labels = labels;
  return out;
}
```

Dans `packages/indicators/src/index.ts`, après la ligne `export * from "./utils-divergence-points";` :

```ts
export * from "./utils-annotations";
```

- [ ] **Step 6 : Vérifier que tout passe**

Run : `pnpm -C packages/indicators exec vitest run src/utils-annotations.test.ts src/utils-divergence.test.ts src/utils-divergence-points.test.ts`
Attendu : PASS (3 fichiers). Puis `pnpm -C packages/types exec tsc --noEmit -p .` si un script check existe, sinon la compile sera couverte par `pnpm check` en fin de branche.

- [ ] **Step 7 : Commit**

```bash
git add packages/types/src/index.ts packages/indicators/src/utils-divergence.ts \
  packages/indicators/src/utils-divergence.test.ts packages/indicators/src/utils-annotations.ts \
  packages/indicators/src/utils-annotations.test.ts packages/indicators/src/index.ts
git commit -m "feat(indicators): canal d'annotations — types + moteur construireAnnotationsDivergence"
```

---

### Task 2 : Fabrique `defDivergenceOscillateur` (C1)

**Files:**
- Create: `packages/indicators/src/utils-fabrique-divergence.ts`
- Create: `packages/indicators/src/utils-fabrique-divergence.test.ts`
- Modify: `packages/indicators/src/index.ts` (export)

**Interfaces:**
- Consumes: `construireAnnotationsDivergence` (Task 1), `highOf`/`lowOf` (`utils.ts`).
- Produces (pour les Tasks 6, 7) :
  ```ts
  interface SpecDivergenceOscillateur {
    id: string;
    name: string;
    category: IndicatorCategory;
    inputsOsc: IndicatorInput[];              // inputs propres, AVANT les communs
    serieOsc: { key: string; name: string };  // clé + libellé de la courbe oscillateur
    precision?: number;
    formateur?: (v: number) => string;        // formatage des infos (déf. toFixed(2))
    oscillateur: (
      candles: Candle[],
      params: Record<string, number | boolean | string>,
      ctx: CalcContext
    ) => Array<number | undefined>;
  }
  function defDivergenceOscillateur(spec: SpecDivergenceOscillateur): IndicatorDef
  ```
  Inputs communs ajoutés d'office (après `inputsOsc`) : `gauche` (5, min 1), `droite` (5, min 1), `maxEcart` (60, min 5, max 300), `cachees` (boolean, true).

- [ ] **Step 1 : Écrire le test qui échoue**

`packages/indicators/src/utils-fabrique-divergence.test.ts` :

```ts
/**
 * @axiom/indicators — utils-fabrique-divergence.test.ts
 *
 * La fabrique est du CÂBLAGE : oscillateur injecté → série de sortie + annotations
 * via construireAnnotationsDivergence (elle-même dérivée à la main dans
 * utils-annotations.test.ts). On teste ici le contrat du def généré et le câblage,
 * en réutilisant la fixture « haussière régulière » de utils-annotations.test.ts
 * (mêmes highs/lows/osc, mêmes attendus avec gauche=2/droite=2).
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "./engine";
import { construireAnnotationsDivergence } from "./utils-annotations";
import { defDivergenceOscillateur } from "./utils-fabrique-divergence";

const lows = [10, 9, 8, 9, 10, 9, 7, 8, 9, 10];
const highs = [12, 11, 10, 11, 12, 11, 9, 10, 11, 12];
const osc = [5, 4, 3, 4, 5, 4, 3.5, 4.5, 5, 5.5];

const candles: Candle[] = lows.map((low, i) => ({
  time: 1_700_000_000_000 + i * 60_000,
  open: low,
  high: highs[i] ?? low,
  low,
  close: (low + (highs[i] ?? low)) / 2,
  volume: 1,
}));

const def = defDivergenceOscillateur({
  id: "testDivergence",
  name: "Test Divergence",
  category: "momentum",
  inputsOsc: [{ key: "longueur", name: "Longueur", type: "number", default: 14, min: 1 }],
  serieOsc: { key: "osc", name: "OSC" },
  oscillateur: () => osc,
});

describe("defDivergenceOscillateur", () => {
  it("contrat du def : pane séparé, inputs propres + communs, une sortie ligne", () => {
    expect(def.id).toBe("testDivergence");
    expect(def.pane).toBe("separate");
    expect(def.inputs.map((i) => i.key)).toEqual(["longueur", "gauche", "droite", "maxEcart", "cachees"]);
    expect(def.outputs).toEqual([{ key: "osc", name: "OSC", style: "line" }]);
  });

  it("câblage : série = oscillateur injecté, annotations = moteur commun", () => {
    const r = computeIndicator(def, candles, { gauche: 2, droite: 2 });
    expect(r.series["osc"]).toEqual(osc);
    expect(r.annotations).toEqual(
      construireAnnotationsDivergence(highs, lows, osc, {
        gauche: 2, droite: 2, maxEcart: 60, cachees: true, nomOsc: "OSC",
      })
    );
    expect(r.annotations?.segments?.length).toBe(2); // garde-fou anti-tautologie : il Y A une divergence
  });

  it("défauts (gauche=5/droite=5 sur 10 bougies) : aucun pivot → pas d'annotations", () => {
    const r = computeIndicator(def, candles);
    expect(r.series["osc"]).toEqual(osc);
    expect(r.annotations).toBeUndefined();
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `pnpm -C packages/indicators exec vitest run src/utils-fabrique-divergence.test.ts`
Attendu : FAIL (« Cannot find module './utils-fabrique-divergence' »).

- [ ] **Step 3 : Implémenter la fabrique**

`packages/indicators/src/utils-fabrique-divergence.ts` :

```ts
/**
 * @axiom/indicators — utils-fabrique-divergence.ts
 *
 * Fabrique de defs « divergence d'oscillateur » : à partir d'une fonction
 * oscillateur pure, produit un IndicatorDef complet à pane séparé — courbe de
 * l'oscillateur + annotations (segments prix/pane, labels, tooltips) via le
 * moteur commun construireAnnotationsDivergence. Chaque def concret (RSI, MACD,
 * Stoch, OBV, MFI, CVD) tient ainsi en ~25 lignes de spec déclarative.
 */

import type {
  Candle,
  CalcContext,
  IndicatorCategory,
  IndicatorDef,
  IndicatorInput,
} from "@axiom/types";
import { highOf, lowOf } from "./utils";
import { construireAnnotationsDivergence } from "./utils-annotations";

export interface SpecDivergenceOscillateur {
  id: string;
  name: string;
  category: IndicatorCategory;
  /** Inputs propres à l'oscillateur, placés AVANT les inputs communs de pivot. */
  inputsOsc: IndicatorInput[];
  /** Clé + libellé de la série de sortie (la courbe de l'oscillateur). */
  serieOsc: { key: string; name: string };
  precision?: number;
  /** Formatage des valeurs dans les tooltips (déf. toFixed(2)). */
  formateur?: (v: number) => string;
  oscillateur: (
    candles: Candle[],
    params: Record<string, number | boolean | string>,
    ctx: CalcContext
  ) => Array<number | undefined>;
}

/** Inputs communs de détection de pivots/divergences (mêmes défauts que rsiDivergence v1). */
const INPUTS_COMMUNS: IndicatorInput[] = [
  { key: "gauche", name: "Pivot gauche", type: "number", default: 5, min: 1 },
  { key: "droite", name: "Pivot droite", type: "number", default: 5, min: 1 },
  { key: "maxEcart", name: "Écart max (barres)", type: "number", default: 60, min: 5, max: 300 },
  { key: "cachees", name: "Divergences cachées", type: "boolean", default: true },
];

export function defDivergenceOscillateur(spec: SpecDivergenceOscillateur): IndicatorDef {
  const def: IndicatorDef = {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    pane: "separate",
    inputs: [...spec.inputsOsc, ...INPUTS_COMMUNS],
    outputs: [{ key: spec.serieOsc.key, name: spec.serieOsc.name, style: "line" }],
    calc(candles, params, ctx) {
      const oscSerie = spec.oscillateur(candles, params, ctx);
      const series = { [spec.serieOsc.key]: oscSerie };
      const annotations = construireAnnotationsDivergence(highOf(candles), lowOf(candles), oscSerie, {
        gauche: Number(params.gauche ?? 5),
        droite: Number(params.droite ?? 5),
        maxEcart: Number(params.maxEcart ?? 60),
        cachees: params.cachees !== false,
        nomOsc: spec.serieOsc.name,
        ...(spec.formateur !== undefined ? { formateur: spec.formateur } : {}),
      });
      return Object.keys(annotations).length > 0 ? { series, annotations } : { series };
    },
  };
  if (spec.precision !== undefined) def.precision = spec.precision;
  return def;
}
```

Dans `packages/indicators/src/index.ts`, après l'export de `utils-annotations` :

```ts
export * from "./utils-fabrique-divergence";
```

- [ ] **Step 4 : Vérifier que tout passe**

Run : `pnpm -C packages/indicators exec vitest run src/utils-fabrique-divergence.test.ts`
Attendu : PASS.

- [ ] **Step 5 : Commit**

```bash
git add packages/indicators/src/utils-fabrique-divergence.ts \
  packages/indicators/src/utils-fabrique-divergence.test.ts packages/indicators/src/index.ts
git commit -m "feat(indicators): fabrique defDivergenceOscillateur (pane oscillateur + annotations)"
```

---

### Task 3 : Rendu pane — `annotationsPane.ts` + `draw`/tooltip dans le pont (C1)

**Files:**
- Create: `apps/web/src/chart/annotationsPane.ts`
- Create: `apps/web/src/chart/annotationsPane.test.ts`
- Modify: `apps/web/src/chart/indicators.ts` (bloc `registerIndicator` de `ensureRegistered`, ~lignes 105-131)

**Interfaces:**
- Consumes: `AnnotationsIndicateur`/`CibleAnnotation` (Task 1), `lireTokenCanvas`/`rgbaTokenCanvas` (`lib/canvasTokens.ts`).
- Produces (pour la Task 4 et le rendu runtime) :
  ```ts
  interface AxesPane { convertirX: (idx: number) => number; convertirY: (valeur: number) => number }
  function dessinerAnnotationsPane(
    ctx: CanvasRenderingContext2D,
    annotations: AnnotationsIndicateur,
    cible: CibleAnnotation,
    axes: AxesPane,
    fenetre: { de: number; a: number },   // visibleRange.from / .to (exclusif)
  ): void
  ```
- Règle de ciblage dans le pont : un def `pane: "overlay"` dessine ses annotations
  cible `"prix"` (il vit sur candle_pane) ; un def `pane: "separate"` dessine ses
  annotations cible `"pane"`. Les annotations cible `"prix"` des defs séparés
  passent par les overlays (Task 4). Les rubans ne sont rendus que sur cible `"prix"`.

- [ ] **Step 1 : Écrire le test qui échoue**

`apps/web/src/chart/annotationsPane.test.ts` :

```ts
/**
 * dessinerAnnotationsPane — testé avec un contexte canvas FACTICE qui enregistre
 * les opérations (pattern vi.mock des tests chart existants) et des axes idx*10 /
 * valeur*2. On vérifie le tri par cible, le culling par visibleRange, le pointillé
 * (setLineDash [4,4]) et le polygone fermé du ruban.
 */
import { describe, expect, it } from "vitest";
import type { AnnotationsIndicateur } from "@axiom/types";
import { dessinerAnnotationsPane } from "./annotationsPane";

function fauxCtx() {
  const ops: string[] = [];
  const ctx = {
    ops,
    beginPath: () => ops.push("beginPath"),
    moveTo: (x: number, y: number) => ops.push(`moveTo(${x},${y})`),
    lineTo: (x: number, y: number) => ops.push(`lineTo(${x},${y})`),
    closePath: () => ops.push("closePath"),
    stroke: () => ops.push("stroke"),
    fill: () => ops.push("fill"),
    fillText: (t: string, x: number, y: number) => ops.push(`fillText(${t},${x},${y})`),
    setLineDash: (d: number[]) => ops.push(`setLineDash(${d.join(",")})`),
    save: () => ops.push("save"),
    restore: () => ops.push("restore"),
    strokeStyle: "", fillStyle: "", lineWidth: 0, font: "", textAlign: "", textBaseline: "",
  };
  return ctx as unknown as CanvasRenderingContext2D & { ops: string[] };
}

const AXES = { convertirX: (i: number) => i * 10, convertirY: (v: number) => v * 2 };
const FENETRE = { de: 0, a: 100 };

describe("dessinerAnnotationsPane", () => {
  it("segment plein cible prix : tracé aux pixels convertis, sans setLineDash", () => {
    const ctx = fauxCtx();
    const a: AnnotationsIndicateur = {
      segments: [{ deIdx: 2, deValeur: 8, aIdx: 6, aValeur: 7, trait: "plein", couleur: "--up", cible: "prix" }],
    };
    dessinerAnnotationsPane(ctx, a, "prix", AXES, FENETRE);
    expect(ctx.ops).toContain("moveTo(20,16)");
    expect(ctx.ops).toContain("lineTo(60,14)");
    expect(ctx.ops).toContain("stroke");
    expect(ctx.ops.some((o) => o.startsWith("setLineDash"))).toBe(false);
  });

  it("segment pointillé : setLineDash(4,4) entre save/restore", () => {
    const ctx = fauxCtx();
    const a: AnnotationsIndicateur = {
      segments: [{ deIdx: 2, deValeur: 8, aIdx: 6, aValeur: 8.5, trait: "pointille", couleur: "--up", cible: "pane" }],
    };
    dessinerAnnotationsPane(ctx, a, "pane", AXES, FENETRE);
    expect(ctx.ops).toContain("setLineDash(4,4)");
  });

  it("cible non correspondante et hors visibleRange : rien n'est dessiné", () => {
    const ctx = fauxCtx();
    const a: AnnotationsIndicateur = {
      segments: [
        { deIdx: 2, deValeur: 8, aIdx: 6, aValeur: 7, trait: "plein", couleur: "--up", cible: "pane" }, // mauvaise cible
        { deIdx: 200, deValeur: 8, aIdx: 210, aValeur: 7, trait: "plein", couleur: "--up", cible: "prix" }, // hors fenêtre
      ],
      labels: [{ idx: 300, valeur: 5, texte: "Div ▲", couleur: "--up", cible: "prix" }], // hors fenêtre
    };
    dessinerAnnotationsPane(ctx, a, "prix", AXES, FENETRE);
    expect(ctx.ops).toEqual([]);
  });

  it("ruban : polygone fermé (aller hauts + retour bas) rempli, cible prix seulement", () => {
    const ctx = fauxCtx();
    const a: AnnotationsIndicateur = {
      rubans: [{ deIdx: 3, hauts: [10, 11], bas: [9, 9.5], couleur: "--up", alpha: 0.15 }],
    };
    dessinerAnnotationsPane(ctx, a, "prix", AXES, FENETRE);
    expect(ctx.ops).toEqual([
      "beginPath",
      "moveTo(30,20)", "lineTo(40,22)",   // hauts, aller
      "lineTo(40,19)", "lineTo(30,18)",   // bas, retour
      "closePath", "fill",
    ]);
    const ctx2 = fauxCtx();
    dessinerAnnotationsPane(ctx2, a, "pane", AXES, FENETRE);
    expect(ctx2.ops).toEqual([]); // jamais de ruban sur un pane séparé
  });

  it("marqueur et label : triangle rempli, texte décalé selon position", () => {
    const ctx = fauxCtx();
    const a: AnnotationsIndicateur = {
      marqueurs: [{ idx: 4, valeur: 5, forme: "triangleHaut", couleur: "--up", cible: "pane" }],
      labels: [{ idx: 6, valeur: 7, texte: "Div ▲", couleur: "--up", cible: "pane", position: "dessous" }],
    };
    dessinerAnnotationsPane(ctx, a, "pane", AXES, FENETRE);
    expect(ctx.ops).toContain("moveTo(40,4)");        // sommet du triangleHaut : y=10-6
    expect(ctx.ops).toContain("fillText(Div ▲,60,22)"); // label dessous : y=14+8
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `pnpm -C apps/web exec vitest run src/chart/annotationsPane.test.ts`
Attendu : FAIL (« Cannot find module './annotationsPane' »).

- [ ] **Step 3 : Implémenter `annotationsPane.ts`**

```ts
/**
 * Rendu canvas des annotations d'indicateur (@axiom/types AnnotationsIndicateur)
 * sur UN pane — appelé par le `draw` générique du pont (indicators.ts), qui passe
 * la cible locale du pane : "prix" pour un def overlay (candle_pane), "pane" pour
 * un def à pane séparé. Couleurs = tokens CSS résolus AU DESSIN (canvasTokens),
 * jamais au montage. Culling par visibleRange : on ne dessine que ce qui
 * intersecte [de, a). Ordre : rubans (fond) → segments → marqueurs → labels.
 */
import type { AnnotationsIndicateur, CibleAnnotation } from "@axiom/types";
import { lireTokenCanvas, rgbaTokenCanvas } from "../lib/canvasTokens";

/** Replis (valeurs du thème dark) pour les tokens usuels des annotations. */
const REPLIS: Record<string, string> = {
  "--up": "#10b981",
  "--down": "#ef4444",
  "--accent": "#f5c518",
};

function couleurAnnotation(token: string): string {
  return lireTokenCanvas(token, REPLIS[token] ?? "#38bdf8");
}

export interface AxesPane {
  convertirX: (idx: number) => number;
  convertirY: (valeur: number) => number;
}

/** Demi-base des triangles (même taille que les triangles CVD S/P d'orderflow.ts). */
const DEMI_TRIANGLE = 6;
/** Décalage vertical des labels par rapport au pivot (px). */
const DECALAGE_LABEL = 8;

export function dessinerAnnotationsPane(
  ctx: CanvasRenderingContext2D,
  annotations: AnnotationsIndicateur,
  cible: CibleAnnotation,
  axes: AxesPane,
  fenetre: { de: number; a: number },
): void {
  // Rubans d'abord (fond) — chart maître uniquement.
  if (cible === "prix") {
    for (const r of annotations.rubans ?? []) {
      const fin = r.deIdx + r.hauts.length - 1;
      if (fin < fenetre.de || r.deIdx >= fenetre.a) continue;
      ctx.beginPath();
      for (let k = 0; k < r.hauts.length; k++) {
        const x = axes.convertirX(r.deIdx + k);
        const y = axes.convertirY(r.hauts[k] ?? 0);
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let k = r.bas.length - 1; k >= 0; k--) {
        ctx.lineTo(axes.convertirX(r.deIdx + k), axes.convertirY(r.bas[k] ?? 0));
      }
      ctx.closePath();
      ctx.fillStyle = rgbaTokenCanvas(r.couleur, r.alpha, REPLIS[r.couleur] ?? "#38bdf8");
      ctx.fill();
    }
  }

  for (const s of annotations.segments ?? []) {
    if (s.cible !== cible) continue;
    if (s.aIdx < fenetre.de || s.deIdx >= fenetre.a) continue;
    ctx.save();
    if (s.trait === "pointille") ctx.setLineDash([4, 4]);
    ctx.strokeStyle = couleurAnnotation(s.couleur);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(axes.convertirX(s.deIdx), axes.convertirY(s.deValeur));
    ctx.lineTo(axes.convertirX(s.aIdx), axes.convertirY(s.aValeur));
    ctx.stroke();
    ctx.restore();
  }

  for (const m of annotations.marqueurs ?? []) {
    if (m.cible !== cible) continue;
    if (m.idx < fenetre.de || m.idx >= fenetre.a) continue;
    const x = axes.convertirX(m.idx);
    const y = axes.convertirY(m.valeur);
    const t = DEMI_TRIANGLE;
    ctx.beginPath();
    if (m.forme === "triangleHaut") {
      ctx.moveTo(x, y - t);
      ctx.lineTo(x - t, y + t);
      ctx.lineTo(x + t, y + t);
    } else {
      ctx.moveTo(x, y + t);
      ctx.lineTo(x - t, y - t);
      ctx.lineTo(x + t, y - t);
    }
    ctx.closePath();
    ctx.fillStyle = couleurAnnotation(m.couleur);
    ctx.fill();
  }

  for (const l of annotations.labels ?? []) {
    if (l.cible !== cible) continue;
    if (l.idx < fenetre.de || l.idx >= fenetre.a) continue;
    const x = axes.convertirX(l.idx);
    const y = axes.convertirY(l.valeur);
    const dessous = l.position === "dessous";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = dessous ? "top" : "bottom";
    ctx.fillStyle = couleurAnnotation(l.couleur);
    ctx.fillText(l.texte, x, dessous ? y + DECALAGE_LABEL : y - DECALAGE_LABEL);
  }
}
```

- [ ] **Step 4 : Vérifier que le test passe**

Run : `pnpm -C apps/web exec vitest run src/chart/annotationsPane.test.ts`
Attendu : PASS.

- [ ] **Step 5 : Brancher `draw` + `createTooltipDataSource` dans le pont**

Dans `apps/web/src/chart/indicators.ts` :

Imports (compléter les lignes 30-34) :

```ts
import { registerIndicator, IndicatorSeries } from "klinecharts";
import type { Chart, IndicatorFigure, IndicatorTooltipData, TooltipLegend } from "klinecharts";
import type { Candle, ExchangeId, IndicatorDef, IndicatorResult, Timeframe } from "@axiom/types";
import { dessinerAnnotationsPane } from "./annotationsPane";
```

Dans l'objet passé à `registerIndicator` (après la propriété `calc`, ligne 130), ajouter :

```ts
    // Rendu des annotations du calc (segments de divergence, rubans…) sur CE pane.
    // Un def overlay vit sur candle_pane → cible "prix" ; un def séparé → cible
    // "pane" (ses annotations "prix" passent par les overlays, cf. annotationsPrix).
    // `return false` : KLineChart dessine ensuite les figures séries PAR-DESSUS
    // (comportement prod des triangles CVD S/P, orderflow.ts).
    draw: ({ ctx, visibleRange, xAxis, yAxis, indicator }) => {
      const annotations = (indicator.extendData as IndicatorResult | undefined)?.annotations;
      if (annotations === undefined) return false;
      dessinerAnnotationsPane(
        ctx,
        annotations,
        def.pane === "overlay" ? "prix" : "pane",
        {
          convertirX: (idx) => xAxis.convertToPixel(idx),
          convertirY: (v) => yAxis.convertToPixel(v),
        },
        { de: visibleRange.from, a: visibleRange.to },
      );
      return false;
    },
    // Tooltip de pane : l'info de la divergence/du ruban le plus proche du
    // crosshair (≤ 3 barres du pivot d'arrivée), 3 lignes max. Objet vide sinon.
    createTooltipDataSource: ({ indicator, crosshair, kLineDataList }) => {
      const vide = {} as IndicatorTooltipData;
      const annotations = (indicator.extendData as IndicatorResult | undefined)?.annotations;
      if (annotations === undefined) return vide;
      const brut = crosshair.dataIndex ?? kLineDataList.findIndex((k) => k.timestamp === crosshair.timestamp);
      if (brut === undefined || brut < 0) return vide;
      const idx = brut;
      const values: TooltipLegend[] = [];
      const pousser = (a: number, info: string | undefined) => {
        if (info !== undefined && Math.abs(a - idx) <= 3 && values.length < 3) {
          values.push({ title: "", value: info });
        }
      };
      for (const s of annotations.segments ?? []) pousser(s.aIdx, s.info);
      for (const m of annotations.marqueurs ?? []) pousser(m.idx, m.info);
      for (const r of annotations.rubans ?? []) {
        if (r.info !== undefined && idx >= r.deIdx && idx < r.deIdx + r.hauts.length && values.length < 3) {
          values.push({ title: "", value: r.info });
        }
      }
      return values.length > 0 ? ({ values } as IndicatorTooltipData) : vide;
    },
```

Note de robustesse : si `crosshair.dataIndex` n'existe pas dans le type `Crosshair`
de la 9.8.12, garder UNIQUEMENT le repli `findIndex` par timestamp (même résultat).

- [ ] **Step 6 : Vérifier la non-régression du pont**

Run : `pnpm -C apps/web exec vitest run src/chart/indicators.symbolSwitch.test.ts src/chart/indicators.aux.test.ts src/chart/indicators.throttle.test.ts`
Attendu : PASS (les templates gagnent deux propriétés inertes ; aucun test existant ne les inspecte).

- [ ] **Step 7 : Commit**

```bash
git add apps/web/src/chart/annotationsPane.ts apps/web/src/chart/annotationsPane.test.ts \
  apps/web/src/chart/indicators.ts
git commit -m "feat(web): rendu des annotations sur pane (draw générique + tooltip crosshair)"
```

---

### Task 4 : Overlays chart maître — `annotationsPrix.ts` + intégration `ChartIndicators` (C1)

**Files:**
- Create: `apps/web/src/chart/annotationsPrix.ts`
- Create: `apps/web/src/chart/annotationsPrix.test.ts`
- Modify: `apps/web/src/chart/indicators.ts` (classe `ChartIndicators`)

**Interfaces:**
- Consumes: types Task 1 ; patrons `registerOverlay` (ecoMarkers/whaleBubbles), `totalStep: 3` (précédent fibonacci.ts pour 2 points), `lireTokenCanvas`.
- Produces :
  ```ts
  class AnnotationsPrix {
    constructor(chart: Pick<Chart, "createOverlay" | "removeOverlay">);
    appliquer(instanceId: string, def: IndicatorDef, annotations: AnnotationsIndicateur | undefined, candles: Candle[]): void;
    retirer(instanceId: string): void;
    retirerTout(): void;
  }
  ```
  `appliquer` ne pose des overlays QUE pour un def `pane: "separate"` (le pane
  overlay rend déjà ses annotations "prix" via `draw`, Task 3) ; il REJOUE
  (retire puis recrée) les annotations cible `"prix"` de l'instance, cap 150
  (les plus récentes). Tooltip au survol : div flottante singleton.

- [ ] **Step 1 : Écrire le test qui échoue**

`apps/web/src/chart/annotationsPrix.test.ts` :

```ts
/**
 * AnnotationsPrix — chart FACTICE enregistrant createOverlay/removeOverlay
 * (pattern des tests chart existants, vi.mock de klinecharts pour registerOverlay).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("klinecharts", () => ({ registerOverlay: () => {} }));

import type { Candle, IndicatorDef } from "@axiom/types";
import { AnnotationsPrix } from "./annotationsPrix";

const candles: Candle[] = Array.from({ length: 10 }, (_v, i) => ({
  time: 1_700_000_000_000 + i * 60_000,
  open: 10, high: 12, low: 9, close: 11, volume: 1,
}));

const defSepare = { pane: "separate" } as IndicatorDef;
const defOverlay = { pane: "overlay" } as IndicatorDef;

const ANNOTS = {
  segments: [
    { deIdx: 2, deValeur: 8, aIdx: 6, aValeur: 7, trait: "plein", couleur: "--up", cible: "prix", info: "i1" },
    { deIdx: 2, deValeur: 3, aIdx: 6, aValeur: 3.5, trait: "plein", couleur: "--up", cible: "pane", info: "i1" },
  ],
  labels: [{ idx: 6, valeur: 7, texte: "Div ▲", couleur: "--up", cible: "prix", position: "dessous", info: "i1" }],
} as const;

function fauxChart() {
  let seq = 0;
  const crees: Array<Record<string, unknown>> = [];
  const retires: string[] = [];
  return {
    crees,
    retires,
    createOverlay: (o: Record<string, unknown>) => { crees.push(o); return `ov-${seq++}`; },
    removeOverlay: (f: { id: string }) => { retires.push(f.id); },
  };
}

describe("AnnotationsPrix", () => {
  let chart: ReturnType<typeof fauxChart>;
  let ann: AnnotationsPrix;
  beforeEach(() => {
    chart = fauxChart();
    ann = new AnnotationsPrix(chart as never);
  });

  it("def séparé : pose les annotations cible prix (segment 2 points + label), pas celles du pane", () => {
    ann.appliquer("inst1", defSepare, ANNOTS as never, candles);
    expect(chart.crees.length).toBe(2); // 1 segment prix + 1 label (le segment pane est exclu)
    const seg = chart.crees[0] as { points: Array<{ timestamp: number; value: number }> };
    expect(seg.points).toEqual([
      { timestamp: candles[2]!.time, value: 8 },
      { timestamp: candles[6]!.time, value: 7 },
    ]);
  });

  it("rejeu : re-appliquer retire les anciens ids avant de recréer", () => {
    ann.appliquer("inst1", defSepare, ANNOTS as never, candles);
    ann.appliquer("inst1", defSepare, ANNOTS as never, candles);
    expect(chart.retires).toEqual(["ov-0", "ov-1"]);
    expect(chart.crees.length).toBe(4);
  });

  it("retirer : nettoie les ids suivis ; annotations undefined : rien de posé", () => {
    ann.appliquer("inst1", defSepare, ANNOTS as never, candles);
    ann.retirer("inst1");
    expect(chart.retires).toEqual(["ov-0", "ov-1"]);
    ann.appliquer("inst2", defSepare, undefined, candles);
    expect(chart.crees.length).toBe(2); // rien de nouveau
  });

  it("def overlay : AUCUN overlay (le draw du candle_pane s'en charge)", () => {
    ann.appliquer("inst1", defOverlay, ANNOTS as never, candles);
    expect(chart.crees.length).toBe(0);
  });

  it("cap 150 : seules les annotations les plus récentes sont posées", () => {
    const beaucoup = {
      labels: Array.from({ length: 200 }, (_v, i) => ({
        idx: i % 10, valeur: 7, texte: "Div ▲", couleur: "--up", cible: "prix" as const,
      })),
    };
    ann.appliquer("inst1", defSepare, beaucoup as never, candles);
    expect(chart.crees.length).toBe(150);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `pnpm -C apps/web exec vitest run src/chart/annotationsPrix.test.ts`
Attendu : FAIL (« Cannot find module './annotationsPrix' »).

- [ ] **Step 3 : Implémenter `annotationsPrix.ts`**

```ts
/**
 * Annotations cible « prix » des indicateurs à PANE SÉPARÉ (segments de
 * divergence, labels, marqueurs), rendues sur le chart maître via un overlay
 * custom unique « axiomAnnotation » (patron WHALE/ECO : registerOverlay
 * idempotent + un createOverlay par annotation + rejeu par ids suivis).
 * `totalStep: 1` (précédent ecoMarkers/whaleBubbles : points TOUJOURS fournis à
 * la création, jamais saisis à la souris — le seuil FINISHED devient
 * points.length >= 0, valable pour 1 ET 2 points ; totalStep: 3 laisserait les
 * overlays à 1 point en état « dessin en cours » : non enregistrés, non
 * retirables, tooltip global mort — attrapé en revue Task 4). `lock: true` :
 * pas de drag ; les figures restent SENSIBLES au survol (pas d'ignoreEvent)
 * pour le tooltip onMouseEnter/onMouseLeave (div flottante singleton, stylée
 * par variables CSS — le DOM résout var(...) nativement, contrairement aux canvas).
 *
 * Les defs pane "overlay" ne passent JAMAIS ici : leurs annotations "prix" sont
 * dessinées par le draw générique du pont sur candle_pane (annotationsPane.ts).
 */
import { registerOverlay } from "klinecharts";
import type { Chart, OverlayCreate } from "klinecharts";
import type {
  AnnotationsIndicateur,
  Candle,
  IndicatorDef,
} from "@axiom/types";
import { lireTokenCanvas } from "../lib/canvasTokens";

const ANNOTATION_OVERLAY = "axiomAnnotation";
const ANNOTATION_GROUP = "axiomAnnot";
/** Cap d'overlays par instance d'indicateur (les plus récents priment). */
const MAX_ANNOTATIONS_PAR_INSTANCE = 150;

const REPLIS: Record<string, string> = { "--up": "#10b981", "--down": "#ef4444" };

/** Données portées par chaque overlay, discriminées par genre. */
type ExtendAnnotation =
  | { genre: "segment"; trait: "plein" | "pointille"; couleur: string; info?: string }
  | { genre: "marqueur"; forme: "triangleHaut" | "triangleBas"; couleur: string; info?: string }
  | { genre: "label"; texte: string; couleur: string; dessous: boolean; info?: string };

// ── Tooltip flottant singleton (DOM, pas canvas : var(--…) résolu nativement) ──

let tooltipEl: HTMLDivElement | null = null;

function tooltip(): HTMLDivElement {
  if (tooltipEl !== null) return tooltipEl;
  const el = document.createElement("div");
  el.style.cssText =
    "position:fixed;z-index:60;display:none;max-width:320px;padding:6px 8px;" +
    "font-size:11px;line-height:1.4;pointer-events:none;border-radius:4px;" +
    "background:var(--surface);color:var(--text);border:1px solid var(--border)";
  document.body.appendChild(el);
  tooltipEl = el;
  return el;
}

export function afficherTooltipAnnotation(texte: string, pageX: number, pageY: number): void {
  const el = tooltip();
  el.textContent = texte;
  el.style.left = `${pageX + 12}px`;
  el.style.top = `${pageY + 12}px`;
  el.style.display = "block";
}

export function masquerTooltipAnnotation(): void {
  if (tooltipEl !== null) tooltipEl.style.display = "none";
}

// ── Overlay custom (idempotent, effet global klinecharts) ──

let overlayRegistered = false;

export function ensureAnnotationOverlayRegistered(): void {
  if (overlayRegistered) return;
  overlayRegistered = true;
  registerOverlay({
    name: ANNOTATION_OVERLAY,
    totalStep: 1,
    lock: true,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ overlay, coordinates }) => {
      const ext = overlay.extendData as ExtendAnnotation | undefined;
      const c0 = coordinates[0];
      if (ext === undefined || c0 === undefined) return [];
      const couleur = lireTokenCanvas(ext.couleur, REPLIS[ext.couleur] ?? "#38bdf8");
      if (ext.genre === "segment") {
        const c1 = coordinates[1];
        if (c1 === undefined) return [];
        return [
          {
            type: "line",
            attrs: { coordinates: [c0, c1] },
            styles:
              ext.trait === "pointille"
                ? { style: "dashed", dashedValue: [4, 4], size: 1.5, color: couleur }
                : { style: "solid", size: 1.5, color: couleur },
          },
        ];
      }
      if (ext.genre === "marqueur") {
        const t = 6;
        const pts =
          ext.forme === "triangleHaut"
            ? [{ x: c0.x, y: c0.y - t }, { x: c0.x - t, y: c0.y + t }, { x: c0.x + t, y: c0.y + t }]
            : [{ x: c0.x, y: c0.y + t }, { x: c0.x - t, y: c0.y - t }, { x: c0.x + t, y: c0.y - t }];
        return [{ type: "polygon", attrs: { coordinates: pts }, styles: { style: "fill", color: couleur } }];
      }
      return [
        {
          type: "text",
          attrs: {
            x: c0.x,
            y: ext.dessous ? c0.y + 8 : c0.y - 8,
            text: ext.texte,
            align: "center",
            baseline: ext.dessous ? "top" : "bottom",
          },
          styles: { color: couleur, size: 10 },
        },
      ];
    },
    onMouseEnter: (event) => {
      const ext = event.overlay.extendData as ExtendAnnotation | undefined;
      if (ext?.info !== undefined) afficherTooltipAnnotation(ext.info, event.pageX ?? 0, event.pageY ?? 0);
      return false;
    },
    onMouseLeave: () => {
      masquerTooltipAnnotation();
      return false;
    },
  });
}

// ── Contrôleur par instance de chart ──

type ChartOverlays = Pick<Chart, "createOverlay" | "removeOverlay">;

export class AnnotationsPrix {
  private readonly chart: ChartOverlays;
  /** instanceId d'indicateur -> ids d'overlays posés (rejeu ciblé, cf. whaleBubbles). */
  private readonly suivis = new Map<string, string[]>();

  constructor(chart: ChartOverlays) {
    ensureAnnotationOverlayRegistered();
    this.chart = chart;
  }

  /**
   * Rejoue les annotations cible "prix" d'une instance : retire les anciennes
   * puis pose les nouvelles (cap MAX_ANNOTATIONS_PAR_INSTANCE, les plus récentes).
   * No-op créatif pour un def overlay (rendu par le draw de candle_pane) ou sans
   * annotations — mais on retire toujours l'existant (params édités, def changé).
   */
  appliquer(
    instanceId: string,
    def: IndicatorDef,
    annotations: AnnotationsIndicateur | undefined,
    candles: Candle[],
  ): void {
    this.retirer(instanceId);
    if (def.pane !== "separate" || annotations === undefined) return;
    const t = (idx: number): number | undefined => candles[idx]?.time;

    const creations: OverlayCreate[] = [];
    for (const s of (annotations.segments ?? []).filter((x) => x.cible === "prix")) {
      const t0 = t(s.deIdx);
      const t1 = t(s.aIdx);
      if (t0 === undefined || t1 === undefined) continue;
      creations.push({
        name: ANNOTATION_OVERLAY,
        groupId: ANNOTATION_GROUP,
        lock: true,
        points: [
          { timestamp: t0, value: s.deValeur },
          { timestamp: t1, value: s.aValeur },
        ],
        extendData: { genre: "segment", trait: s.trait, couleur: s.couleur, info: s.info } satisfies ExtendAnnotation,
      });
    }
    for (const m of (annotations.marqueurs ?? []).filter((x) => x.cible === "prix")) {
      const t0 = t(m.idx);
      if (t0 === undefined) continue;
      creations.push({
        name: ANNOTATION_OVERLAY,
        groupId: ANNOTATION_GROUP,
        lock: true,
        points: [{ timestamp: t0, value: m.valeur }],
        extendData: { genre: "marqueur", forme: m.forme, couleur: m.couleur, info: m.info } satisfies ExtendAnnotation,
      });
    }
    for (const l of (annotations.labels ?? []).filter((x) => x.cible === "prix")) {
      const t0 = t(l.idx);
      if (t0 === undefined) continue;
      creations.push({
        name: ANNOTATION_OVERLAY,
        groupId: ANNOTATION_GROUP,
        lock: true,
        points: [{ timestamp: t0, value: l.valeur }],
        extendData: {
          genre: "label",
          texte: l.texte,
          couleur: l.couleur,
          dessous: l.position === "dessous",
          info: l.info,
        } satisfies ExtendAnnotation,
      });
    }

    const ids: string[] = [];
    for (const o of creations.slice(-MAX_ANNOTATIONS_PAR_INSTANCE)) {
      const id = this.chart.createOverlay(o);
      if (typeof id === "string") ids.push(id);
    }
    if (ids.length > 0) this.suivis.set(instanceId, ids);
  }

  /** Retire les overlays d'une instance (try/catch : chart peut être détruit, cf. whaleBubbles). */
  retirer(instanceId: string): void {
    const ids = this.suivis.get(instanceId);
    if (ids === undefined) return;
    for (const id of ids) {
      try {
        this.chart.removeOverlay({ id });
      } catch {
        break;
      }
    }
    this.suivis.delete(instanceId);
  }

  retirerTout(): void {
    for (const instanceId of [...this.suivis.keys()]) this.retirer(instanceId);
  }
}
```

- [ ] **Step 4 : Vérifier que le test passe**

Run : `pnpm -C apps/web exec vitest run src/chart/annotationsPrix.test.ts`
Attendu : PASS.

- [ ] **Step 5 : Intégrer dans `ChartIndicators`**

Dans `apps/web/src/chart/indicators.ts` :

1. Import : `import { AnnotationsPrix } from "./annotationsPrix";`
2. Champ + constructeur (lignes 181-183) :

```ts
  /** Overlays d'annotations cible "prix" des defs à pane séparé (rejeu par instance). */
  private readonly annotationsPrix: AnnotationsPrix;

  constructor(chart: Chart) {
    this.chart = chart;
    this.annotationsPrix = new AnnotationsPrix(chart);
  }
```

3. `sync` — retrait des instances désactivées (après `this.active.delete(instanceId)`, ligne 301) :

```ts
        this.annotationsPrix.retirer(instanceId);
```

4. `sync` — boucle de ré-ordonnancement des panes (après `this.active.delete(instanceId)`, ligne 326) : même ligne `this.annotationsPrix.retirer(instanceId);`.

5. `sync` — branche « édition des params » (après `existing.key = key;`, ligne 347) :

```ts
        this.annotationsPrix.appliquer(inst.instanceId, def, result.annotations, candles);
```

6. `sync` — branche « nouvelle instance » (après `if (created) this.active.set(...)`, ligne 360) :

```ts
      if (created) this.annotationsPrix.appliquer(inst.instanceId, def, result.annotations, candles);
```

7. `recompute` — après `this.chart.overrideIndicator(override, info.paneId);` (ligne 390) :

```ts
      this.annotationsPrix.appliquer(inst.instanceId, def, result.annotations, candles);
```

8. `onAuxReady` — après le `overrideIndicator` (ligne 261) :

```ts
    this.annotationsPrix.appliquer(inst.instanceId, def, result.annotations, candles);
```

- [ ] **Step 6 : Non-régression du pont + gate de branche**

Run : `pnpm -C apps/web exec vitest run src/chart/` puis `pnpm check`
Attendu : PASS partout. NB pour les tests existants du pont : le constructeur appelle
désormais `ensureAnnotationOverlayRegistered()` — leurs `vi.mock("klinecharts")`
doivent exposer `registerOverlay` (ajouter `registerOverlay: () => {}` au mock si absent).

- [ ] **Step 7 : Commit (fin de C1)**

```bash
git add apps/web/src/chart/annotationsPrix.ts apps/web/src/chart/annotationsPrix.test.ts \
  apps/web/src/chart/indicators.ts
git commit -m "feat(web): overlays d'annotations sur le chart maître + tooltip au survol"
```

Merge de `feat/canal-annotations` dans `main` après `pnpm check` vert (gate post-merge : re-run `pnpm check` sur main).

---

### Task 5 : Extraction des cœurs d'oscillateur (C2)

**Files:**
- Modify: `packages/indicators/src/trend/macd.ts`
- Modify: `packages/indicators/src/momentum/stochastic.ts`
- Modify: `packages/indicators/src/volume/obv.ts`
- Modify: `packages/indicators/src/momentum/mfi.ts`

**Interfaces:**
- Produces (pour la Task 7) — patron `rsiOf` (`momentum/rsi.ts:35`), cœur exporté, def délègue :
  - `macdOf(source: number[], fast: number, slow: number, signal: number): { macd: Array<number | undefined>; signal: Array<number | undefined>; hist: Array<number | undefined> }`
  - `stochKOf(candles: Candle[], kLength: number): Array<number | undefined>` (le %K brut)
  - `smaOfDefined(values: Array<number | undefined>, length: number): Array<number | undefined>` (déjà écrite dans stochastic.ts — ajouter `export`)
  - `obvOf(candles: Candle[]): Array<number | undefined>`
  - `mfiOf(candles: Candle[], tp: number[], length: number): Array<number | undefined>` (`tp` = `ctx.hlc3`)

**Refactor PUR** : déplacer le corps de chaque `calc` dans la fonction exportée, le
`calc` délègue (ex. macd : `const r = macdOf(ctx.source, fast, slow, signal); return { series: { macd: r.macd, signal: r.signal, hist: r.hist } };`).
Comportement identique ⇒ AUCUN test existant modifié.

- [ ] **Step 1 : Extraire `macdOf`** — déplacer les lignes 48-89 de `macd.ts` dans
  `export function macdOf(source: number[], fast: number, slow: number, signal: number)`
  qui retourne `{ macd: macdLine, signal: signalLine, hist }` ; le `calc` lit les
  params puis délègue.
- [ ] **Step 2 : Extraire `stochKOf` + exporter `smaOfDefined`** — le %K (lignes
  67-84 de `stochastic.ts`) devient `export function stochKOf(candles, kLength)` ;
  `smaOfDefined` gagne `export` ; le `calc` délègue (`const k = stochKOf(candles, kLength); const d = smaOfDefined(k, dLength);`).
- [ ] **Step 3 : Extraire `obvOf`** — corps du `calc` d'`obv.ts` → `export function obvOf(candles)` ; `calc` délègue.
- [ ] **Step 4 : Extraire `mfiOf`** — corps du `calc` de `mfi.ts` → `export function mfiOf(candles, tp, length)` ; `calc(candles, params, ctx)` délègue avec `ctx.hlc3`.
- [ ] **Step 5 : Vérifier la non-régression**

Run : `pnpm -C packages/indicators exec vitest run src/trend/macd.test.ts src/momentum/stochastic.test.ts src/volume/obv.test.ts src/momentum/mfi.test.ts src/golden/`
Attendu : PASS à l'identique (y compris les golden pandas-ta).

- [ ] **Step 6 : Commit**

```bash
git add packages/indicators/src/trend/macd.ts packages/indicators/src/momentum/stochastic.ts \
  packages/indicators/src/volume/obv.ts packages/indicators/src/momentum/mfi.ts
git commit -m "refactor(indicators): cœurs macdOf/stochKOf/obvOf/mfiOf exportés (patron rsiOf)"
```

---

### Task 6 : `rsiDivergence` v2 + `cvdDivergence` v2 (C2)

**Files:**
- Modify: `packages/indicators/src/momentum/rsiDivergence.ts` (réécriture via fabrique)
- Modify: `packages/indicators/src/momentum/rsiDivergence.test.ts` (réécriture)
- Modify: `packages/indicators/src/orderflow/cvdDivergence.ts` (réécriture via fabrique)
- Modify: `packages/indicators/src/orderflow/cvdDivergence.test.ts` (réécriture)
- Modify: `packages/indicators/src/engine-source.test.ts` (lignes 90 et 160)

**Interfaces:**
- Consumes: `defDivergenceOscillateur` (Task 2), `rsiOf` (`momentum/rsi.ts`), `cvdOf` (`orderflow/cvd.ts`).
- Produces: mêmes ids `rsiDivergence`/`cvdDivergence` — pane passe d'`overlay` à
  `separate`, les 4 sorties « points » sont REMPLACÉES par 1 sortie courbe
  (`rsi` / `cvd`) + annotations. Le pane n'est PAS persisté (seuls defId/params/
  instanceId le sont, cf. `store/indicators.ts`) : les instances persistées
  migrent d'elles-mêmes au prochain chargement ; l'input `cachees` manquant est
  complété par `resolveParams`.

- [ ] **Step 1 : Réécrire `rsiDivergence.ts`**

```ts
/**
 * @axiom/indicators — momentum/rsiDivergence.ts
 *
 * Divergences RSI ↔ prix, v2 (lot v2.1) : pane SÉPARÉ portant la courbe RSI,
 * segments pivot→pivot sur le RSI (cible "pane") ET sur le prix (cible "prix",
 * rendus en overlays par l'app), labels « Div ▲/▼ » (régulières), pointillés
 * pour les cachées, tooltips. Détection inchangée (detecterDivergences via le
 * moteur commun) ; l'oscillateur reste le RSI de Wilder (rsiOf) sur la source
 * configurée. Remplace le rendu « 4 sorties points » de la v1 (limite consignée :
 * pas de rayon, cachées indistinguables — levée par le canal d'annotations).
 */

import { defDivergenceOscillateur } from "../utils-fabrique-divergence";
import { rsiOf } from "./rsi";

export const rsiDivergence = defDivergenceOscillateur({
  id: "rsiDivergence",
  name: "RSI Divergence",
  category: "momentum",
  precision: 2,
  serieOsc: { key: "rsi", name: "RSI" },
  inputsOsc: [
    { key: "length", name: "Longueur RSI", type: "number", default: 14, min: 1 },
    {
      key: "source",
      name: "Source",
      type: "source",
      default: "close",
      options: ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"],
    },
  ],
  oscillateur: (_candles, params, ctx) => rsiOf(ctx.source, Number(params.length ?? 14)),
});
```

- [ ] **Step 2 : Réécrire `rsiDivergence.test.ts`**

```ts
/**
 * rsiDivergence v2 — tests de CONTRAT + CÂBLAGE. La géométrie des annotations est
 * dérivée à la main dans utils-annotations.test.ts et le RSI dans rsi.test.ts :
 * ici on vérifie que le def assemble bien ces briques hand-testées (comparaison
 * aux fonctions pures composées), plus un garde-fou anti-tautologie : sur une
 * V de prix avec RSI en désaccord, il Y A des annotations.
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { construireAnnotationsDivergence } from "../utils-annotations";
import { highOf, lowOf } from "../utils";
import { rsiOf } from "./rsi";
import { rsiDivergence } from "./rsiDivergence";

/** Bougies « plates » (open=high=low=close) depuis une série de clôtures. */
function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((c, i) => ({
    time: 1_700_000_000_000 + i * 60_000,
    open: c, high: c, low: c, close: c, volume: 1,
  }));
}

describe("rsiDivergence v2", () => {
  it("contrat : pane séparé, sortie unique rsi, inputs osc + communs", () => {
    expect(rsiDivergence.pane).toBe("separate");
    expect(rsiDivergence.outputs).toEqual([{ key: "rsi", name: "RSI", style: "line" }]);
    expect(rsiDivergence.inputs.map((i) => i.key)).toEqual([
      "length", "source", "gauche", "droite", "maxEcart", "cachees",
    ]);
  });

  it("câblage : série = rsiOf(source, length), annotations = moteur commun sur le RSI", () => {
    // Double V prix : creux à idx10 puis idx28 — le RSI (length 3, réactif) suit.
    const closes: number[] = [];
    for (let i = 0; i < 40; i++) {
      if (i <= 10) closes.push(70 - i * 2);          // descente vers 50
      else if (i <= 19) closes.push(50 + (i - 10) * 1.5);
      else if (i <= 28) closes.push(63.5 - (i - 19) * 2.2); // descente plus BASSE
      else closes.push(43.7 + (i - 28) * 1.5);
    }
    const candles = candlesFromCloses(closes);
    const params = { length: 3, gauche: 2, droite: 2 };
    const r = computeIndicator(rsiDivergence, candles, params);
    const rsiAttendu = rsiOf(closes, 3);
    expect(r.series["rsi"]).toEqual(rsiAttendu);
    // `?? {}` : la fabrique omet la clé `annotations` quand le moteur renvoie {}
    // — l'égalité doit tenir dans les deux cas (divergence présente ou non).
    const attendu = construireAnnotationsDivergence(highOf(candles), lowOf(candles), rsiAttendu, {
      gauche: 2, droite: 2, maxEcart: 60, cachees: true, nomOsc: "RSI",
    });
    expect(r.annotations ?? {}).toEqual(attendu);
  });
});
```

- [ ] **Step 3 : Réécrire `cvdDivergence.ts`** (même patron ; conserver le docblock
  de dégradation « source sans taker → CVD plat → aucun pivot → aucune annotation ») :

```ts
import { defDivergenceOscillateur } from "../utils-fabrique-divergence";
import { cvdOf } from "./cvd";

export const cvdDivergence = defDivergenceOscillateur({
  id: "cvdDivergence",
  name: "CVD Divergence",
  category: "orderflow",
  precision: 0,
  serieOsc: { key: "cvd", name: "CVD" },
  inputsOsc: [],
  formateur: (v) => v.toFixed(0), // volumes cumulés : pas de décimales dans les tooltips
  oscillateur: (candles) => cvdOf(candles),
});
```

(Ajouter le docblock FR complet au-dessus, sur le modèle de la v1.)

- [ ] **Step 4 : Réécrire `cvdDivergence.test.ts`** — contrat (pane/outputs/inputs
  `["gauche","droite","maxEcart","cachees"]`) + câblage vs `cvdOf` +
  `construireAnnotationsDivergence(..., { nomOsc: "CVD", formateur })` (même
  structure que le test rsiDivergence, avec des bougies portant `buyVolume`/`sellVolume`
  pour un CVD non plat) + dégradation : bougies SANS taker → `r.annotations` undefined.

- [ ] **Step 5 : Mettre à jour `engine-source.test.ts`**

Ligne 90 : `const POINT_VALUE_INVARIANTS = new Set<string>([]);`
Ligne 160 : `expect([...POINT_VALUE_INVARIANTS].sort()).toEqual([]);`
(rsiDivergence v2 sort une courbe RSI qui dépend de la source → il réintègre le
test générique « consomme réellement ctx.source », qui doit passer tel quel.)

- [ ] **Step 6 : Vérifier**

Run : `pnpm -C packages/indicators exec vitest run`
Attendu : PASS complet (registry.test toujours à 155 — aucun def ajouté ici).

- [ ] **Step 7 : Commit**

```bash
git add packages/indicators/src/momentum/rsiDivergence.ts packages/indicators/src/momentum/rsiDivergence.test.ts \
  packages/indicators/src/orderflow/cvdDivergence.ts packages/indicators/src/orderflow/cvdDivergence.test.ts \
  packages/indicators/src/engine-source.test.ts
git commit -m "feat(indicators): rsiDivergence/cvdDivergence v2 — pane oscillateur + segments/labels/tooltips"
```

---

### Task 7 : 4 nouveaux defs divergence + registre (C2)

**Files:**
- Create: `packages/indicators/src/momentum/macdDivergence.ts` + `.test.ts`
- Create: `packages/indicators/src/momentum/stochDivergence.ts` + `.test.ts`
- Create: `packages/indicators/src/volume/obvDivergence.ts` + `.test.ts`
- Create: `packages/indicators/src/momentum/mfiDivergence.ts` + `.test.ts`
- Modify: `packages/indicators/src/registry.ts` (4 imports + 4 entrées)
- Modify: `packages/indicators/src/registry.test.ts` (ligne 20 : 155 → 159)

**Interfaces:**
- Consumes: `defDivergenceOscillateur` (Task 2), cœurs Task 5.
- Produces: ids `macdDivergence`, `stochDivergence`, `obvDivergence`, `mfiDivergence`.

- [ ] **Step 1 : `macdDivergence.ts`**

```ts
/**
 * @axiom/indicators — momentum/macdDivergence.ts
 *
 * Divergences MACD ↔ prix (lot v2.1, via la fabrique commune). L'oscillateur est
 * au choix la LIGNE MACD (défaut — la lecture canonique en divergence) ou
 * l'HISTOGRAMME (macd − signal), sur la source configurée. Rendu : courbe en pane
 * séparé + segments/labels/tooltips du canal d'annotations.
 */

import { defDivergenceOscillateur } from "../utils-fabrique-divergence";
import { macdOf } from "../trend/macd";

export const macdDivergence = defDivergenceOscillateur({
  id: "macdDivergence",
  name: "MACD Divergence",
  category: "momentum",
  precision: 4,
  serieOsc: { key: "osc", name: "MACD" },
  inputsOsc: [
    { key: "fast", name: "Fast", type: "number", default: 12, min: 1 },
    { key: "slow", name: "Slow", type: "number", default: 26, min: 1 },
    { key: "signal", name: "Signal", type: "number", default: 9, min: 1 },
    {
      key: "source", name: "Source", type: "source", default: "close",
      options: ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"],
    },
    { key: "oscSource", name: "Oscillateur", type: "select", default: "ligne", options: ["ligne", "histogramme"] },
  ],
  oscillateur: (_candles, params, ctx) => {
    const r = macdOf(ctx.source, Number(params.fast ?? 12), Number(params.slow ?? 26), Number(params.signal ?? 9));
    return params.oscSource === "histogramme" ? r.hist : r.macd;
  },
});
```

- [ ] **Step 2 : `stochDivergence.ts`**

```ts
import { defDivergenceOscillateur } from "../utils-fabrique-divergence";
import { smaOfDefined, stochKOf } from "./stochastic";

export const stochDivergence = defDivergenceOscillateur({
  id: "stochDivergence",
  name: "Stochastic Divergence",
  category: "momentum",
  precision: 2,
  serieOsc: { key: "k", name: "Stoch %K" },
  inputsOsc: [
    { key: "longueurK", name: "%K", type: "number", default: 14, min: 1 },
    { key: "lissageK", name: "Lissage %K", type: "number", default: 3, min: 1 },
  ],
  oscillateur: (candles, params) =>
    smaOfDefined(stochKOf(candles, Number(params.longueurK ?? 14)), Number(params.lissageK ?? 3)),
});
```

(Docblock FR : %K lissé = stochastique « slow », le standard des divergences stoch.)

- [ ] **Step 3 : `obvDivergence.ts`**

```ts
import { defDivergenceOscillateur } from "../utils-fabrique-divergence";
import { obvOf } from "./obv";

export const obvDivergence = defDivergenceOscillateur({
  id: "obvDivergence",
  name: "OBV Divergence",
  category: "volume",
  precision: 0,
  serieOsc: { key: "obv", name: "OBV" },
  inputsOsc: [],
  formateur: (v) => v.toFixed(0),
  oscillateur: (candles) => obvOf(candles),
});
```

- [ ] **Step 4 : `mfiDivergence.ts`** (catégorie `momentum` — amendement n°2 du spec,
  alignée sur le def de base `mfi`)

```ts
import { defDivergenceOscillateur } from "../utils-fabrique-divergence";
import { mfiOf } from "./mfi";

export const mfiDivergence = defDivergenceOscillateur({
  id: "mfiDivergence",
  name: "MFI Divergence",
  category: "momentum",
  precision: 2,
  serieOsc: { key: "mfi", name: "MFI" },
  inputsOsc: [{ key: "length", name: "Longueur", type: "number", default: 14, min: 1 }],
  oscillateur: (candles, params, ctx) => mfiOf(candles, ctx.hlc3, Number(params.length ?? 14)),
});
```

- [ ] **Step 5 : Tests** — un `.test.ts` par def, même structure que
  `rsiDivergence.test.ts` (Task 6) : contrat (id/pane/outputs/ordre des inputs) +
  câblage (série égale au cœur composé, annotations égales au moteur commun avec
  le bon `nomOsc`). Pour obv/mfi/stoch, bougies avec high/low/volume variés
  (pas de bougies plates : stoch exige high≠low).

- [ ] **Step 6 : Registre**

Dans `registry.ts` : imports groupés près des defs frères
(`import { macdDivergence } from "./momentum/macdDivergence";` etc.) et entrées
dans `INDICATORS` : `macdDivergence`, `stochDivergence`, `mfiDivergence` après
`rsiDivergence` (~ligne 251) ; `obvDivergence` près d'`obv` dans le bloc volume.
Dans `registry.test.ts` ligne 20 : `expect(INDICATORS.length).toBe(159);`

- [ ] **Step 7 : Vérifier + commit**

Run : `pnpm -C packages/indicators exec vitest run` → PASS (159), puis `pnpm check`.

```bash
git add packages/indicators/src/momentum/macdDivergence.ts packages/indicators/src/momentum/macdDivergence.test.ts \
  packages/indicators/src/momentum/stochDivergence.ts packages/indicators/src/momentum/stochDivergence.test.ts \
  packages/indicators/src/volume/obvDivergence.ts packages/indicators/src/volume/obvDivergence.test.ts \
  packages/indicators/src/momentum/mfiDivergence.ts packages/indicators/src/momentum/mfiDivergence.test.ts \
  packages/indicators/src/registry.ts packages/indicators/src/registry.test.ts
git commit -m "feat(indicators): macd/stoch/obv/mfi Divergence via la fabrique (registre 155→159)"
```

---

### Task 8 : `detecterDivergencesSpotPerp` + `cvdSpotPerp` v2 (C3)

**Files:**
- Create: `packages/indicators/src/orderflow/divergenceSpotPerp.ts`
- Create: `packages/indicators/src/orderflow/divergenceSpotPerp.test.ts`
- Modify: `packages/indicators/src/orderflow/cvdSpotPerp.ts`
- Modify: `packages/indicators/src/orderflow/cvdSpotPerp.test.ts` (ajouts)
- Modify: `packages/indicators/src/index.ts` (export)

**Interfaces:**
- Consumes: algorithme de `apps/web/src/chart/cvdSpotPerp.ts:55-91`
  (`detectCvdDivergences` : mismatch de signe sur Δ lookback, filtre médiane
  anti-bruit par série, garde symétrique zéro-delta) — PORTÉ en pur index-based,
  le module app-side WS n'est PAS touché (les deux coexistent : REST/def ici,
  WS/toggle orderflow là).
- Produces :
  ```ts
  interface DivergenceSpotPerp { idx: number; sens: "spotHaussier" | "spotBaissier"; dSpot: number; dPerp: number }
  function detecterDivergencesSpotPerp(
    spot: ReadonlyArray<number | undefined>,
    perp: ReadonlyArray<number | undefined>,
    lookback: number,
  ): DivergenceSpotPerp[]
  ```
  `cvdSpotPerp` v2 : + input `fenetreDiv` (défaut 14, min 2, max 100 — amendement
  n°1 du spec : PAS `fenetre`=100 qui est la fenêtre de normalisation) ; séries
  inchangées ; + `annotations.marqueurs` cible `"pane"`.

- [ ] **Step 1 : Écrire le test du détecteur (échec attendu)**

`packages/indicators/src/orderflow/divergenceSpotPerp.test.ts` :

```ts
/**
 * Dérivation à la main, lookback=2 :
 *  - spot = [0,1,2,3,4,5,6,7] → dSpot(i)=2 pour i≥2 ; perp opposé → dPerp=−2.
 *    Mismatch de signe partout, médianes |d|=2, 2≥2 → divergence à CHAQUE i∈[2,7],
 *    sens spotHaussier (dSpot>0).
 *  - perp plat [1,1,…] → dPerp=0 → garde symétrique zéro-delta → [].
 *  - perp = spot → même signe → [].
 *  - trou : spot[3]=undefined → i=3 (spot[i] indéfini) et i=5 (spot[i−2] indéfini)
 *    sont sautés (et exclus des fenêtres de médiane) → divergences à i=2,4,6,7.
 */
import { describe, expect, it } from "vitest";
import { detecterDivergencesSpotPerp } from "./divergenceSpotPerp";

const montant = [0, 1, 2, 3, 4, 5, 6, 7];
const tombant = montant.map((v) => -v);

describe("detecterDivergencesSpotPerp", () => {
  it("sens opposés soutenus : une divergence par indice, deltas exposés", () => {
    expect(detecterDivergencesSpotPerp(montant, tombant, 2)).toEqual(
      [2, 3, 4, 5, 6, 7].map((idx) => ({ idx, sens: "spotHaussier", dSpot: 2, dPerp: -2 }))
    );
  });

  it("un côté plat : jamais de divergence (garde symétrique zéro-delta)", () => {
    expect(detecterDivergencesSpotPerp(montant, new Array(8).fill(1), 2)).toEqual([]);
  });

  it("même direction : aucune divergence", () => {
    expect(detecterDivergencesSpotPerp(montant, montant, 2)).toEqual([]);
  });

  it("trous : les indices dont une borne est indéfinie sont sautés", () => {
    const troue: Array<number | undefined> = [0, 1, 2, undefined, 4, 5, 6, 7];
    expect(detecterDivergencesSpotPerp(troue, tombant, 2).map((d) => d.idx)).toEqual([2, 4, 6, 7]);
  });

  it("sens inverse : spot qui baisse face à un perp qui monte → spotBaissier", () => {
    expect(detecterDivergencesSpotPerp(tombant, montant, 2)[0]).toEqual({
      idx: 2, sens: "spotBaissier", dSpot: -2, dPerp: 2,
    });
  });
});
```

- [ ] **Step 2 : Vérifier l'échec** — `pnpm -C packages/indicators exec vitest run src/orderflow/divergenceSpotPerp.test.ts` → FAIL (module absent).

- [ ] **Step 3 : Implémenter le détecteur**

`packages/indicators/src/orderflow/divergenceSpotPerp.ts` :

```ts
/**
 * @axiom/indicators — orderflow/divergenceSpotPerp.ts
 *
 * Détecteur PUR de divergences de flux spot/perp — port index-based de
 * `detectCvdDivergences` (apps/web/src/chart/cvdSpotPerp.ts, module WS conservé
 * tel quel) pour le def REST `cvdSpotPerp`. Définition à l'indice i (i ≥ lookback) :
 *   dSpot = spot[i] − spot[i−lookback] ; dPerp idem ;
 *   divergence ssi sign(dSpot) ≠ sign(dPerp), AUCUN des deux n'est nul (garde
 *   symétrique zéro-delta : un côté plat ne prouve jamais une divergence), ET
 *   |dSpot| ≥ médiane(|dSpot| fenêtre glissante) ET idem |dPerp| (anti-bruit,
 *   indépendant par série). Fenêtre glissante : indices j VALIDES (bornes
 *   définies) de i−lookback+1 à i inclus. Les indices dont une borne est
 *   `undefined` sont sautés et exclus des médianes.
 */

export interface DivergenceSpotPerp {
  idx: number;
  sens: "spotHaussier" | "spotBaissier";
  /** Δ des jambes sur `lookback` bougies (unités de la série d'entrée — σ de flux
   * quand on lui passe les CVD normalisés du def). Exposés pour les tooltips. */
  dSpot: number;
  dPerp: number;
}

/** Médiane (moyenne des deux centrales si pair) — copie du module WS. PURE. */
function mediane(valeurs: number[]): number {
  const tri = [...valeurs].sort((a, b) => a - b);
  const mid = Math.floor(tri.length / 2);
  if (tri.length % 2 === 0) return ((tri[mid - 1] ?? 0) + (tri[mid] ?? 0)) / 2;
  return tri[mid] ?? 0;
}

export function detecterDivergencesSpotPerp(
  spot: ReadonlyArray<number | undefined>,
  perp: ReadonlyArray<number | undefined>,
  lookback: number,
): DivergenceSpotPerp[] {
  const n = spot.length;
  const dSpot: Array<number | undefined> = new Array(n).fill(undefined);
  const dPerp: Array<number | undefined> = new Array(n).fill(undefined);
  for (let i = lookback; i < n; i++) {
    const s1 = spot[i - lookback];
    const s2 = spot[i];
    const p1 = perp[i - lookback];
    const p2 = perp[i];
    if (s1 === undefined || s2 === undefined || p1 === undefined || p2 === undefined) continue;
    dSpot[i] = s2 - s1;
    dPerp[i] = p2 - p1;
  }

  const out: DivergenceSpotPerp[] = [];
  for (let i = lookback; i < n; i++) {
    const ds = dSpot[i];
    const dp = dPerp[i];
    if (ds === undefined || dp === undefined) continue;
    if (ds === 0 || dp === 0) continue; // garde symétrique : un côté plat, jamais de divergence
    if (Math.sign(ds) === Math.sign(dp)) continue;

    const fenSpot: number[] = [];
    const fenPerp: number[] = [];
    for (let j = Math.max(lookback, i - lookback + 1); j <= i; j++) {
      const a = dSpot[j];
      const b = dPerp[j];
      if (a !== undefined) fenSpot.push(Math.abs(a));
      if (b !== undefined) fenPerp.push(Math.abs(b));
    }
    if (Math.abs(ds) < mediane(fenSpot)) continue;
    if (Math.abs(dp) < mediane(fenPerp)) continue;

    out.push({ idx: i, sens: ds > 0 ? "spotHaussier" : "spotBaissier", dSpot: ds, dPerp: dp });
  }
  return out;
}
```

Dans `packages/indicators/src/index.ts` : `export * from "./orderflow/divergenceSpotPerp";`

- [ ] **Step 4 : Vérifier** — même commande → PASS.

- [ ] **Step 5 : Brancher dans le def `cvdSpotPerp`**

Dans `packages/indicators/src/orderflow/cvdSpotPerp.ts` :

1. Import : `import { detecterDivergencesSpotPerp } from "./divergenceSpotPerp";`
   et compléter l'import types : `import type { AnnotationsIndicateur, IndicatorDef, MarqueurAnnotation } from "@axiom/types";`
2. Input supplémentaire (après `lissage`, ligne 136) :

```ts
    { key: "fenetreDiv", name: "Fenêtre divergence", type: "number", default: 14, min: 2, max: 100 },
```

3. Dans `calc`, avant le `return` final (ligne 208), remplacer le `return` par :

```ts
    // Marqueurs de divergence spot/perp (v2.1) : mismatch de signe soutenu des
    // jambes NORMALISÉES sur `fenetreDiv` bougies (défaut 14 = constante du
    // module WS historique — PAS `fenetre`, qui est la fenêtre de normalisation).
    const fenetreDiv = clampInt(params.fenetreDiv, 14, 2, 100);
    const fmtSigne = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
    const marqueurs: MarqueurAnnotation[] = detecterDivergencesSpotPerp(cvdSpot, cvdPerp, fenetreDiv).map((d) => ({
      idx: d.idx,
      valeur: cvdSpot[d.idx] ?? 0, // ancré sur la jambe spot (définie par construction du Δ)
      forme: d.sens === "spotHaussier" ? "triangleHaut" : "triangleBas",
      couleur: d.sens === "spotHaussier" ? "--up" : "--down",
      cible: "pane",
      info:
        `Divergence spot/perp (${fenetreDiv} bougies) — ` +
        `Δspot ${fmtSigne(d.dSpot)} σ / Δperp ${fmtSigne(d.dPerp)} σ`,
    }));
    const annotations: AnnotationsIndicateur | undefined =
      marqueurs.length > 0 ? { marqueurs } : undefined;

    return annotations !== undefined
      ? { series: { cvdSpot, cvdPerp, divergence }, annotations }
      : { series: { cvdSpot, cvdPerp, divergence } };
```

4. Mettre à jour le docblock d'en-tête (mention des marqueurs v2.1 + fenetreDiv).

- [ ] **Step 6 : Compléter `cvdSpotPerp.test.ts`**

Ajouter (sans toucher aux tests existants) :

```ts
  it("v2.1 : sens opposés soutenus → marqueurs pane --up ancrés sur la jambe spot", () => {
    // 60 bougies, deltas spot alternés +1/+2 (stdev > 0), perp opposé −1/−2 :
    // les deux jambes normalisées montent/descendent continûment → après le
    // warm-up (MIN_POINTS_STDEV=20), le détecteur signale un mismatch soutenu.
    const n = 60;
    const candles = Array.from({ length: n }, (_v, i) => ({
      time: 1_700_000_000_000 + i * 60_000,
      open: 100, high: 101, low: 99, close: 100, volume: 3,
      buyVolume: i % 2 === 0 ? 2 : 2.5,
      sellVolume: i % 2 === 0 ? 1 : 0.5,   // delta spot : +1 / +2
    }));
    const perpDelta = Array.from({ length: n }, (_v, i) => (i % 2 === 0 ? -1 : -2));
    const r = computeIndicator(cvdSpotPerp, candles, { fenetreDiv: 5 }, { perpDelta });
    const marqueurs = r.annotations?.marqueurs ?? [];
    expect(marqueurs.length).toBeGreaterThan(0);
    for (const m of marqueurs) {
      expect(m.forme).toBe("triangleHaut");
      expect(m.couleur).toBe("--up");
      expect(m.cible).toBe("pane");
      expect(m.valeur).toBe(r.series["cvdSpot"]?.[m.idx]);
      expect(m.info).toMatch(/^Divergence spot\/perp \(5 bougies\)/);
    }
  });

  it("v2.1 : perp absent → aucune annotation", () => {
    const candles = Array.from({ length: 30 }, (_v, i) => ({
      time: 1_700_000_000_000 + i * 60_000,
      open: 100, high: 101, low: 99, close: 100, volume: 3,
      buyVolume: 2, sellVolume: 1,
    }));
    const r = computeIndicator(cvdSpotPerp, candles, {});
    expect(r.annotations).toBeUndefined();
  });
```

(Adapter le builder de bougies à celui déjà présent dans le fichier de test.)

- [ ] **Step 7 : Vérifier + commit**

Run : `pnpm -C packages/indicators exec vitest run src/orderflow/` puis `pnpm check`.

```bash
git add packages/indicators/src/orderflow/divergenceSpotPerp.ts \
  packages/indicators/src/orderflow/divergenceSpotPerp.test.ts \
  packages/indicators/src/orderflow/cvdSpotPerp.ts packages/indicators/src/orderflow/cvdSpotPerp.test.ts \
  packages/indicators/src/index.ts
git commit -m "feat(indicators): cvdSpotPerp v2 — marqueurs de divergence spot/perp (détecteur pur porté du WS)"
```

---

### Task 9 : `premiumSpotPerp` — ruban de prime sur le chart maître (C4)

**Files:**
- Create: `packages/indicators/src/derivatives/premiumSpotPerp.ts`
- Create: `packages/indicators/src/derivatives/premiumSpotPerp.test.ts`
- Modify: `packages/indicators/src/registry.ts` (import + entrée près de `basisPct`, ~ligne 330)
- Modify: `packages/indicators/src/registry.test.ts` (ligne 20 : 155 → 156 **sur cette branche** ; la résolution post-merge donnera 160, cf. Task 10)

**Interfaces:**
- Consumes: aux `mark` (chemin `basisPct` : mark price 1 h LOCF, Binance USDT-M), `RubanAnnotation` (Task 1), `closeOf` (`utils.ts`).
- Produces: def `premiumSpotPerp` — catégorie `derivatives`, `pane: "overlay"`,
  `minTimeframe: "15m"` (même aux que `basisPct`), sortie `mark` (ligne mark price
  sur l'échelle prix) + rubans. Ses annotations sont rendues par le `draw` du
  candle_pane (Task 3) — AUCUN overlay (les rubans ne passent jamais par
  `AnnotationsPrix`, qui ignore les defs pane overlay) ; tooltip du ruban via le
  `createTooltipDataSource` du pont.

- [ ] **Step 1 : Écrire le test (échec attendu)**

`packages/indicators/src/derivatives/premiumSpotPerp.test.ts` :

```ts
/**
 * Dérivation à la main (seuil 0,05 %, closes constants à 100) :
 * mark = [100, 100, 100, 100.1, 100.1, 100.1, 100.1, 99.9, 99.9, 99.9]
 * prime% = [0, 0, 0, +0.1, +0.1, +0.1, +0.1, −0.1, −0.1, −0.1]
 * → run 1 : idx 3..6 (4 bougies, signe +, |0.1| ≥ 0.05) → ruban --up,
 *   hauts = mark (100.1), bas = close (100), moyenne +0.10, extrême +0.10 ;
 * → bascule de signe à idx 7 → run 2 : idx 7..9 (3 bougies) → ruban --down,
 *   hauts = close (100), bas = mark (99.9), moyenne −0.10.
 * Un run de longueur 1 est ignoré (polygone dégénéré invisible).
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { premiumSpotPerp } from "./premiumSpotPerp";

function candles100(n: number): Candle[] {
  return Array.from({ length: n }, (_v, i) => ({
    time: 1_700_000_000_000 + i * 3_600_000,
    open: 100, high: 100, low: 100, close: 100, volume: 1,
  }));
}

const mark = [100, 100, 100, 100.1, 100.1, 100.1, 100.1, 99.9, 99.9, 99.9];

describe("premiumSpotPerp", () => {
  it("contrat : overlay derivatives, aux mark, sortie ligne mark, input seuilPct", () => {
    expect(premiumSpotPerp.pane).toBe("overlay");
    expect(premiumSpotPerp.category).toBe("derivatives");
    expect(premiumSpotPerp.aux).toEqual(["mark"]);
    expect(premiumSpotPerp.minTimeframe).toBe("15m");
    expect(premiumSpotPerp.outputs).toEqual([{ key: "mark", name: "Mark perp", style: "line" }]);
    expect(premiumSpotPerp.inputs).toEqual([
      { key: "seuilPct", name: "Seuil prime (%)", type: "number", default: 0.05, min: 0, max: 5 },
    ]);
  });

  it("deux runs signés : rubans --up puis --down, bornes et infos exactes", () => {
    const r = computeIndicator(premiumSpotPerp, candles100(10), {}, { mark });
    expect(r.series["mark"]).toEqual(mark);
    expect(r.annotations?.rubans).toEqual([
      {
        deIdx: 3, hauts: [100.1, 100.1, 100.1, 100.1], bas: [100, 100, 100, 100],
        couleur: "--up", alpha: 0.15,
        info: "Prime perp moyenne +0.10 % sur 4 bougies (extrême +0.10 %)",
      },
      {
        deIdx: 7, hauts: [100, 100, 100], bas: [99.9, 99.9, 99.9],
        couleur: "--down", alpha: 0.15,
        info: "Prime perp moyenne -0.10 % sur 3 bougies (extrême -0.10 %)",
      },
    ]);
  });

  it("sous le seuil / run de longueur 1 : aucun ruban", () => {
    const sousSeuil = new Array<number>(10).fill(100.02); // prime +0.02 < 0.05
    expect(computeIndicator(premiumSpotPerp, candles100(10), {}, { mark: sousSeuil }).annotations).toBeUndefined();
    const runDe1 = [100, 100, 100, 100.1, 100, 100, 100, 100, 100, 100];
    expect(computeIndicator(premiumSpotPerp, candles100(10), {}, { mark: runDe1 }).annotations).toBeUndefined();
  });

  it("aux absent : série mark toute undefined, aucune annotation, aucun throw", () => {
    const r = computeIndicator(premiumSpotPerp, candles100(10), {});
    expect(r.series["mark"]).toEqual(new Array(10).fill(undefined));
    expect(r.annotations).toBeUndefined();
  });
});
```

- [ ] **Step 2 : Vérifier l'échec** — `pnpm -C packages/indicators exec vitest run src/derivatives/premiumSpotPerp.test.ts` → FAIL.

- [ ] **Step 3 : Implémenter le def**

`packages/indicators/src/derivatives/premiumSpotPerp.ts` :

```ts
/**
 * @axiom/indicators — derivatives/premiumSpotPerp.ts
 *
 * Prime spot/perp EN VISUEL sur le chart maître (lot v2.1) : trace la ligne mark
 * price du perp (aux `mark`, chemin basisPct — 1 h LOCF Binance USDT-M, d'où le
 * rendu en marches d'escalier sous H1, assumé) et remplit un RUBAN entre le close
 * spot et le mark sur chaque run contigu où |prime| ≥ seuil, avec
 * prime% = 100 × (mark − close) / close. Ruban --up quand le perp est AU-DESSUS
 * (contango), --down en dessous (discount). Un run se coupe sur : trou de donnée,
 * |prime| < seuil, ou bascule de signe ; longueur minimale 2 (un polygone d'une
 * bougie est invisible). Cap 40 runs, les plus récents. Le seuil par défaut
 * (0,05 %) est une hypothèse à CALIBRER au gate visuel (règle SQZ : consigner).
 * Tooltip (info) : prime moyenne + extrême du run, via le crosshair du pont.
 */

import type { IndicatorDef, RubanAnnotation } from "@axiom/types";
import { closeOf } from "../utils";

/** Cap de rubans par calc (les plus récents priment). */
const MAX_RUBANS = 40;

function fmtSigne(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
}

export const premiumSpotPerp: IndicatorDef = {
  id: "premiumSpotPerp",
  name: "Prime spot-perp",
  category: "derivatives",
  pane: "overlay",
  aux: ["mark"],
  minTimeframe: "15m",
  inputs: [
    { key: "seuilPct", name: "Seuil prime (%)", type: "number", default: 0.05, min: 0, max: 5 },
  ],
  outputs: [{ key: "mark", name: "Mark perp", style: "line" }],
  calc(candles, params, ctx) {
    const n = candles.length;
    const mark: Array<number | undefined> = new Array(n).fill(undefined);
    const markAux = ctx.aux?.mark;
    if (!markAux) return { series: { mark } };

    const close = closeOf(candles);
    const seuil = Number(params.seuilPct ?? 0.05);
    const primes: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const m = markAux[i];
      const c = close[i];
      if (m === undefined || c === undefined || !Number.isFinite(m) || !Number.isFinite(c) || c === 0) continue;
      mark[i] = m;
      primes[i] = (100 * (m - c)) / c;
    }

    // Runs contigus : même signe, |prime| ≥ seuil, longueur ≥ 2.
    const rubans: RubanAnnotation[] = [];
    let debut = -1;
    let signe = 0;
    const cloreRun = (fin: number) => {
      if (debut < 0) return;
      const longueur = fin - debut + 1;
      if (longueur >= 2) {
        const hauts: number[] = [];
        const bas: number[] = [];
        let somme = 0;
        let extreme = 0;
        for (let j = debut; j <= fin; j++) {
          const m = mark[j] ?? 0;
          const c = close[j] ?? 0;
          hauts.push(Math.max(m, c));
          bas.push(Math.min(m, c));
          const p = primes[j] ?? 0;
          somme += p;
          if (Math.abs(p) > Math.abs(extreme)) extreme = p;
        }
        rubans.push({
          deIdx: debut,
          hauts,
          bas,
          couleur: signe > 0 ? "--up" : "--down",
          alpha: 0.15,
          info:
            `Prime perp moyenne ${fmtSigne(somme / longueur)} % sur ${longueur} bougies ` +
            `(extrême ${fmtSigne(extreme)} %)`,
        });
      }
      debut = -1;
      signe = 0;
    };

    for (let i = 0; i < n; i++) {
      const p = primes[i];
      const s = p === undefined ? 0 : Math.sign(p);
      const dansRun = p !== undefined && Math.abs(p) >= seuil && s !== 0;
      if (!dansRun || (debut >= 0 && s !== signe)) cloreRun(i - 1);
      if (dansRun && debut < 0) {
        debut = i;
        signe = s;
      }
    }
    cloreRun(n - 1);

    const recents = rubans.slice(-MAX_RUBANS);
    return recents.length > 0
      ? { series: { mark }, annotations: { rubans: recents } }
      : { series: { mark } };
  },
};
```

- [ ] **Step 4 : Registre** — dans `registry.ts`, import
  `import { premiumSpotPerp } from "./derivatives/premiumSpotPerp";` et entrée
  `premiumSpotPerp,` juste après `basisPct,` (~ligne 330). Dans `registry.test.ts`
  ligne 20 : `toBe(156)` (base de branche = 155 ; résolu à 160 au merge final).

- [ ] **Step 5 : Vérifier + commit**

Run : `pnpm -C packages/indicators exec vitest run src/derivatives/premiumSpotPerp.test.ts src/registry.test.ts` puis `pnpm check`.

```bash
git add packages/indicators/src/derivatives/premiumSpotPerp.ts \
  packages/indicators/src/derivatives/premiumSpotPerp.test.ts \
  packages/indicators/src/registry.ts packages/indicators/src/registry.test.ts
git commit -m "feat(indicators): premiumSpotPerp — ruban de prime spot/perp sur le chart maître"
```

---

### Task 10 : Intégration — merges, registre 160, gate visuel

**Files:**
- Modify: `packages/indicators/src/registry.test.ts` (résolution finale : 160)
- (résolutions de merge dans `registry.ts` / `index.ts`)

- [ ] **Step 1 : Merges séquentiels dans `main`** — ordre C2 → C3 → C4, avec
  `git -C ~/axiom …` EXPLICITE (leçon worktrees). Conflits attendus : imports/
  entrées de `registry.ts` et exports d'`index.ts` (keep-both, À LA MAIN — jamais
  par regex : leçon v1.8, un keep-both automatique a déjà fusionné deux objets en
  un littéral TS1117) ; `registry.test.ts` ligne 20 → **160**.
- [ ] **Step 2 : Gate post-merge** — `pnpm check` sur `main`. Attendu : vert
  (~2 900+ tests). JAMAIS sauté (leçon v1.8).
- [ ] **Step 3 : Gate visuel in-page** (sondes DOM/`getImageData`, PAS de
  screenshot MCP — leçon v1.4 ; état vérifié via le DOM, pas via un store importé
  à nu). Checklist à dérouler sur BTCUSDT (Binance), TF 1h :
  1. Activer `rsiDivergence` : pane RSI présent avec courbe + segments ; segments
     et labels « Div ▲/▼ » sur le chart maître ; pointillés sur au moins une
     cachée (sinon en forcer une via `maxEcart` large).
  2. Survol d'un segment prix → la div tooltip apparaît (sonde :
     `document.body.textContent.includes("Divergence")` après dispatch d'un
     mousemove sur les coordonnées du segment) ; elle disparaît au leave.
  3. Activer `premiumSpotPerp` : ligne mark visible + au moins un ruban sur les
     500 dernières bougies. **Si 0 ruban en marché calme, calibrer `seuilPct`
     (0.05 → 0.03/0.02) et CONSIGNER le calibrage** (règle SQZ). Crosshair sur le
     ruban → l'info « Prime perp moyenne… » apparaît dans la légende du pane.
  4. Activer `cvdSpotPerp` : triangles ▲/▼ dans le pane + tooltip crosshair.
  5. Activer `macdDivergence`/`stochDivergence`/`obvDivergence`/`mfiDivergence` :
     pane + segments sans erreur console.
  6. Changer de thème (dark → bloomberg → clair) : les couleurs d'annotations
     suivent SANS recharger (tokens lus au rendu).
  7. Zoom/scroll avec ~150 annotations : pas de jank perceptible ; changement de
     symbole : les overlays d'annotations sont rejoués (pas d'orphelins du
     symbole précédent).
  8. Éditer les params d'une instance (droite ↑) puis la supprimer : les
     segments prix disparaissent avec elle.
- [ ] **Step 4 : Commit final de calibrage éventuel + push.**
