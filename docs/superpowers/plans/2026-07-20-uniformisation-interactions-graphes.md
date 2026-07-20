# Uniformisation des interactions graphes canvas — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kit d'interaction unique (zoom molette, pan, double-clic reset, boutons de période, curseur/infobulle, labels d'axe X) appliqué à 7 fenêtres canvas : STBL, CHAIN, VOL, BT (temporel) + OMON, TERM, RATE (zoom d'axe).

**Architecture:** Maths pures de domaine dans `lib/domaineAxe.ts` (testées vitest, sans DOM), hook `useDomaineZoom` qui branche les gestes sur le canvas, composants partagés `BarrePeriodes`/`InfobulleGraphe` dans `ui.tsx`. Chaque fenêtre garde sa fonction de dessin custom et reçoit le domaine visible.

**Tech Stack:** React 18, TypeScript strict, Canvas 2D natif, vitest. Spec : `docs/superpowers/specs/2026-07-20-uniformisation-interactions-graphes-design.md`.

## Global Constraints

- Commentaires et identifiants en **français** (convention repo : `dessinerImpression`, `lireTokenCanvas`…).
- **Aucune couleur en dur** dans les rendus : tokens via `lireTokenCanvas(nom, repli)` (`lib/canvasTokens.ts:33`). Le repli hex est autorisé comme 2e argument.
- **Jamais** `var(--x)` littéral dans `ctx.font` (le canvas l'ignore silencieusement) : résoudre la police via `lireTokenCanvas("--font-display", ...)` ou utiliser `"10px system-ui, sans-serif"` comme les fenêtres existantes.
- Formatters partagés de `lib/format.ts` uniquement (`formatDateCourte`, `formatDateComplete`, `formatUsd`, `formatPct`, `VALEUR_ABSENTE`…).
- Listener `wheel` TOUJOURS natif avec `{ passive: false }` + `preventDefault()` (pattern GlobeWindow.tsx:361-373) — un handler React `onWheel` ne peut pas bloquer le scroll.
- Après chaque tâche : `cd /Users/zakichair/axiom/apps/web && npx tsc --noEmit` (doit sortir 0) + les tests vitest indiqués. Commit par tâche.
- Le canvas travaille en **pixels CSS** (`clientWidth`) après `ctx.setTransform(dpr, ...)` — toutes les conversions pixel↔valeur utilisent `rect.width` CSS, jamais `canvas.width` physique.

---

### Task 1: Maths pures de domaine — `lib/domaineAxe.ts`

**Files:**
- Create: `apps/web/src/lib/domaineAxe.ts`
- Test: `apps/web/src/lib/domaineAxe.test.ts`

**Interfaces:**
- Consumes: rien (module pur).
- Produces (utilisées par toutes les tâches suivantes) :
  - `interface Domaine { min: number; max: number }`
  - `LARGEUR_MIN_FRACTION = 0.01`
  - `clampDomaine(d: Domaine, bornes: Domaine): Domaine`
  - `zoomerDomaine(d: Domaine, facteur: number, pivot: number, bornes: Domaine): Domaine`
  - `deplacerDomaine(d: Domaine, delta: number, bornes: Domaine): Domaine`
  - `pixelVersValeur(d: Domaine, xPix: number, largeurPix: number): number`
  - `valeurVersPixel(d: Domaine, valeur: number, largeurPix: number): number`
  - `indicesVisibles<T>(points: readonly T[], valeurDe: (p: T) => number, d: Domaine): { debut: number; fin: number }`
  - `domainePourPreset(bornes: Domaine, jours: number | null): Domaine`

- [ ] **Step 1: Écrire les tests (échouent — module absent)**

```ts
// apps/web/src/lib/domaineAxe.test.ts
/** Tests des maths pures de domaine d'axe (zoom, pan, clamp, conversions). */
import { describe, expect, it } from "vitest";
import {
  clampDomaine,
  deplacerDomaine,
  domainePourPreset,
  indicesVisibles,
  pixelVersValeur,
  valeurVersPixel,
  zoomerDomaine,
  type Domaine,
} from "./domaineAxe";

const JOUR_MS = 86_400_000;
const bornes: Domaine = { min: 0, max: 1000 };

describe("clampDomaine", () => {
  it("recadre un domaine qui déborde sans changer sa largeur", () => {
    expect(clampDomaine({ min: -100, max: 200 }, bornes)).toEqual({ min: 0, max: 300 });
    expect(clampDomaine({ min: 900, max: 1200 }, bornes)).toEqual({ min: 700, max: 1000 });
  });
  it("un domaine plus large que les bornes → les bornes", () => {
    expect(clampDomaine({ min: -500, max: 2000 }, bornes)).toEqual(bornes);
  });
});

describe("zoomerDomaine", () => {
  it("le pivot garde sa position relative après zoom", () => {
    const d: Domaine = { min: 0, max: 1000 };
    const z = zoomerDomaine(d, 2, 250, bornes); // zoom ×2 autour de 250 (à 25 %)
    expect(z.max - z.min).toBeCloseTo(500);
    expect((250 - z.min) / (z.max - z.min)).toBeCloseTo(0.25);
  });
  it("respecte la largeur minimale (1 % des bornes)", () => {
    const z = zoomerDomaine({ min: 400, max: 420 }, 1e9, 410, bornes);
    expect(z.max - z.min).toBeCloseTo(10); // 1 % de 1000
  });
  it("zoom arrière clampé aux bornes", () => {
    expect(zoomerDomaine({ min: 100, max: 900 }, 0.1, 500, bornes)).toEqual(bornes);
  });
});

describe("deplacerDomaine", () => {
  it("translate sans changer la largeur", () => {
    expect(deplacerDomaine({ min: 100, max: 300 }, 50, bornes)).toEqual({ min: 150, max: 350 });
  });
  it("s'arrête aux bornes", () => {
    expect(deplacerDomaine({ min: 100, max: 300 }, -500, bornes)).toEqual({ min: 0, max: 200 });
    expect(deplacerDomaine({ min: 700, max: 900 }, 500, bornes)).toEqual({ min: 800, max: 1000 });
  });
});

describe("conversions pixel↔valeur", () => {
  const d: Domaine = { min: 100, max: 300 };
  it("aller-retour stable", () => {
    const v = pixelVersValeur(d, 250, 500);
    expect(v).toBeCloseTo(200);
    expect(valeurVersPixel(d, v, 500)).toBeCloseTo(250);
  });
});

describe("indicesVisibles", () => {
  const pts = [0, 100, 200, 300, 400, 500].map((t) => ({ t }));
  it("inclut un point au-delà de chaque bord (continuité des lignes)", () => {
    expect(indicesVisibles(pts, (p) => p.t, { min: 150, max: 350 })).toEqual({ debut: 1, fin: 4 });
  });
  it("domaine couvrant tout → toute la série", () => {
    expect(indicesVisibles(pts, (p) => p.t, { min: -10, max: 600 })).toEqual({ debut: 0, fin: 5 });
  });
  it("série vide → {0, -1}", () => {
    expect(indicesVisibles([], (p: { t: number }) => p.t, { min: 0, max: 1 })).toEqual({ debut: 0, fin: -1 });
  });
});

describe("domainePourPreset", () => {
  const b: Domaine = { min: 0, max: 400 * JOUR_MS };
  it("N jours = fenêtre ancrée sur max", () => {
    expect(domainePourPreset(b, 30)).toEqual({ min: 400 * JOUR_MS - 30 * JOUR_MS, max: 400 * JOUR_MS });
  });
  it("null = tout", () => {
    expect(domainePourPreset(b, null)).toEqual(b);
  });
  it("préréglage plus large que les données → les bornes", () => {
    expect(domainePourPreset({ min: 0, max: 10 * JOUR_MS }, 30)).toEqual({ min: 0, max: 10 * JOUR_MS });
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd /Users/zakichair/axiom/apps/web && npx vitest run src/lib/domaineAxe.test.ts`
Expected: FAIL (« Cannot find module './domaineAxe' » ou équivalent).

- [ ] **Step 3: Implémenter le module**

```ts
// apps/web/src/lib/domaineAxe.ts
/**
 * Maths PURES de domaine d'axe pour les graphes canvas — zoom centré sur le curseur,
 * pan clampé, conversions pixel↔valeur, fenêtres de préréglage temporel.
 *
 * Un domaine est un intervalle numérique {min, max} : ms epoch pour les séries
 * temporelles (STBL, CHAIN, VOL, BT), strike (OMON), échéance ms (TERM) ou
 * maturité en années (RATE). Aucune dépendance DOM — testé dans domaineAxe.test.ts.
 * Le branchement gestuel (molette/drag/double-clic) vit dans hooks/useDomaineZoom.ts.
 */

export interface Domaine {
  min: number;
  max: number;
}

/** Largeur minimale d'un domaine zoomé : 1 % de la plage totale (anti zoom infini). */
export const LARGEUR_MIN_FRACTION = 0.01;

const JOUR_MS = 86_400_000;

/** Recadre `d` dans `bornes` en conservant sa largeur (tronquée si plus large). */
export function clampDomaine(d: Domaine, bornes: Domaine): Domaine {
  const largeurBornes = bornes.max - bornes.min;
  const largeur = Math.min(d.max - d.min, largeurBornes);
  let min = d.min;
  if (min < bornes.min) min = bornes.min;
  if (min + largeur > bornes.max) min = bornes.max - largeur;
  return { min, max: min + largeur };
}

/**
 * Zoom autour de `pivot` (valeur d'axe sous le curseur) : facteur > 1 = zoom avant.
 * Le pivot conserve sa position relative dans le domaine ; largeur clampée entre
 * LARGEUR_MIN_FRACTION × bornes et la largeur des bornes.
 */
export function zoomerDomaine(d: Domaine, facteur: number, pivot: number, bornes: Domaine): Domaine {
  const largeurBornes = bornes.max - bornes.min;
  const largeurMin = largeurBornes * LARGEUR_MIN_FRACTION;
  const largeur = Math.min(Math.max((d.max - d.min) / facteur, largeurMin), largeurBornes);
  const part = (pivot - d.min) / Math.max(1e-12, d.max - d.min);
  return clampDomaine({ min: pivot - part * largeur, max: pivot + (1 - part) * largeur }, bornes);
}

/** Translation de `delta` (en valeur d'axe), clampée aux bornes, largeur conservée. */
export function deplacerDomaine(d: Domaine, delta: number, bornes: Domaine): Domaine {
  return clampDomaine({ min: d.min + delta, max: d.max + delta }, bornes);
}

/** Valeur d'axe à la position `xPix` (pixels CSS) pour un tracé de `largeurPix`. */
export function pixelVersValeur(d: Domaine, xPix: number, largeurPix: number): number {
  return d.min + (xPix / Math.max(1, largeurPix)) * (d.max - d.min);
}

/** Position pixel (CSS) d'une valeur d'axe dans un tracé de `largeurPix`. */
export function valeurVersPixel(d: Domaine, valeur: number, largeurPix: number): number {
  return ((valeur - d.min) / Math.max(1e-12, d.max - d.min)) * largeurPix;
}

/**
 * Indices [debut, fin] (inclus) des points à dessiner pour couvrir `d`, avec UN point
 * au-delà de chaque bord pour que les lignes traversent le cadre sans trou.
 * `points` doit être trié croissant selon `valeurDe`. Série vide → {0, -1}.
 */
export function indicesVisibles<T>(
  points: readonly T[],
  valeurDe: (p: T) => number,
  d: Domaine,
): { debut: number; fin: number } {
  if (points.length === 0) return { debut: 0, fin: -1 };
  let debut = 0;
  while (debut < points.length && valeurDe(points[debut]!) < d.min) debut++;
  let fin = points.length - 1;
  while (fin >= 0 && valeurDe(points[fin]!) > d.max) fin--;
  return { debut: Math.max(0, debut - 1), fin: Math.min(points.length - 1, fin + 1) };
}

/** Domaine d'un préréglage « N derniers jours » ancré sur bornes.max ; null = tout. */
export function domainePourPreset(bornes: Domaine, jours: number | null): Domaine {
  if (jours === null) return { ...bornes };
  return clampDomaine({ min: bornes.max - jours * JOUR_MS, max: bornes.max }, bornes);
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `npx vitest run src/lib/domaineAxe.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
cd /Users/zakichair/axiom
git add apps/web/src/lib/domaineAxe.ts apps/web/src/lib/domaineAxe.test.ts
git commit -m "feat(graphes): maths pures de domaine d'axe (zoom, pan, presets)"
```

---

### Task 2: Hook gestuel — `hooks/useDomaineZoom.ts`

**Files:**
- Create: `apps/web/src/hooks/useDomaineZoom.ts` (nouveau dossier `hooks/`)

**Interfaces:**
- Consumes: `Domaine`, `zoomerDomaine`, `deplacerDomaine`, `pixelVersValeur` (Task 1).
- Produces: `useDomaineZoom(bornes: Domaine | null, onGeste?: () => void)` → `{ refCanvas: React.RefObject<HTMLCanvasElement | null>; domaine: Domaine | null; setDomaine: (d: Domaine) => void }`.
- Pas de test unitaire : la logique pure est déjà testée en Task 1 ; le branchement DOM est vérifié visuellement (Task 10), convention repo (« calculs purs testés sans DOM »).

- [ ] **Step 1: Implémenter le hook**

```ts
// apps/web/src/hooks/useDomaineZoom.ts
/**
 * Branche les gestes de navigation d'axe sur un <canvas> :
 *   molette  = zoom centré sur le curseur (listener NATIF { passive: false },
 *              seul moyen de preventDefault le scroll — pattern GlobeWindow) ;
 *   drag     = pan horizontal (pointer capture) ;
 *   dbl-clic = retour aux bornes complètes.
 *
 * `bornes` = domaine total des données (null tant qu'elles ne sont pas chargées).
 * Le domaine visible se réinitialise quand les bornes changent (nouvelle série).
 * `onGeste` est appelé à chaque interaction manuelle — les fenêtres s'en servent
 * pour désactiver le bouton de période actif (« plage personnalisée »).
 */
import { useEffect, useRef, useState } from "react";
import {
  deplacerDomaine,
  pixelVersValeur,
  zoomerDomaine,
  type Domaine,
} from "../lib/domaineAxe";

export function useDomaineZoom(
  bornes: Domaine | null,
  onGeste?: () => void,
): {
  refCanvas: React.RefObject<HTMLCanvasElement | null>;
  domaine: Domaine | null;
  setDomaine: (d: Domaine) => void;
} {
  const refCanvas = useRef<HTMLCanvasElement | null>(null);
  const [domaine, setDomaine] = useState<Domaine | null>(bornes);

  // Miroirs en refs : les listeners natifs (attachés une fois) lisent l'état courant.
  const domaineRef = useRef(domaine);
  domaineRef.current = domaine;
  const bornesRef = useRef(bornes);
  bornesRef.current = bornes;
  const onGesteRef = useRef(onGeste);
  onGesteRef.current = onGeste;

  // Nouvelle série (bornes changent) → plage personnalisée obsolète, on repart du tout.
  useEffect(() => {
    setDomaine(bornes);
  }, [bornes?.min, bornes?.max]);

  // Attache les listeners quand le canvas existe (il apparaît avec les données).
  const actif = bornes !== null;
  useEffect(() => {
    const cvs = refCanvas.current;
    if (cvs === null || !actif) return;

    const surMolette = (e: WheelEvent): void => {
      const d = domaineRef.current;
      const b = bornesRef.current;
      if (d === null || b === null) return;
      e.preventDefault();
      const rect = cvs.getBoundingClientRect();
      const pivot = pixelVersValeur(d, e.clientX - rect.left, rect.width);
      const facteur = Math.exp(-e.deltaY * 0.002); // deltaY < 0 (haut) = zoom avant
      setDomaine(zoomerDomaine(d, facteur, pivot, b));
      onGesteRef.current?.();
    };

    let panDepuisX: number | null = null;
    const surPointerDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      panDepuisX = e.clientX;
      cvs.setPointerCapture(e.pointerId);
    };
    const surPointerMove = (e: PointerEvent): void => {
      const d = domaineRef.current;
      const b = bornesRef.current;
      if (panDepuisX === null || d === null || b === null) return;
      const rect = cvs.getBoundingClientRect();
      const dx = e.clientX - panDepuisX;
      if (dx === 0) return;
      panDepuisX = e.clientX;
      setDomaine(deplacerDomaine(d, (-dx / Math.max(1, rect.width)) * (d.max - d.min), b));
      onGesteRef.current?.();
    };
    const surPointerFin = (e: PointerEvent): void => {
      panDepuisX = null;
      if (cvs.hasPointerCapture(e.pointerId)) cvs.releasePointerCapture(e.pointerId);
    };
    const surDoubleClic = (): void => {
      const b = bornesRef.current;
      if (b === null) return;
      setDomaine({ ...b });
      onGesteRef.current?.();
    };

    cvs.addEventListener("wheel", surMolette, { passive: false });
    cvs.addEventListener("pointerdown", surPointerDown);
    cvs.addEventListener("pointermove", surPointerMove);
    cvs.addEventListener("pointerup", surPointerFin);
    cvs.addEventListener("pointercancel", surPointerFin);
    cvs.addEventListener("dblclick", surDoubleClic);
    return () => {
      cvs.removeEventListener("wheel", surMolette);
      cvs.removeEventListener("pointerdown", surPointerDown);
      cvs.removeEventListener("pointermove", surPointerMove);
      cvs.removeEventListener("pointerup", surPointerFin);
      cvs.removeEventListener("pointercancel", surPointerFin);
      cvs.removeEventListener("dblclick", surDoubleClic);
    };
  }, [actif]);

  return { refCanvas, domaine, setDomaine };
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
cd /Users/zakichair/axiom
git add apps/web/src/hooks/useDomaineZoom.ts
git commit -m "feat(graphes): hook useDomaineZoom (molette, pan, double-clic reset)"
```

---

### Task 3: Composants partagés — `BarrePeriodes` + `InfobulleGraphe` dans `ui.tsx`

**Files:**
- Modify: `apps/web/src/components/ui.tsx` (ajouter à la fin ; `Onglets` est aux lignes 350-375)

**Interfaces:**
- Consumes: `Onglets` (même fichier).
- Produces:
  - `PERIODES_STANDARD: ReadonlyArray<{ id: string; jours: number | null; label: string }>` — `[{id:"30j",jours:30,label:"30 j"},{id:"90j",jours:90,label:"90 j"},{id:"1a",jours:365,label:"1 a"},{id:"tout",jours:null,label:"Tout"}]`
  - `BarrePeriodes({ actif, onChange }: { actif: string | null; onChange: (p: { id: string; jours: number | null }) => void })`
  - `interface LigneInfobulle { label: string; valeur: string; couleur?: string }`
  - `InfobulleGraphe({ xPix, largeurGraphe, titre, lignes }: { xPix: number; largeurGraphe: number; titre: string; lignes: LigneInfobulle[] })` — à rendre DANS un parent `className="relative"` contenant le canvas.

- [ ] **Step 1: Ajouter les deux composants à la fin de `ui.tsx`**

```tsx
// ─────────────────────────── Graphes : périodes & infobulle ───────────────────────────

/** Préréglages de plage temporelle communs aux graphes canvas (STBL, CHAIN, VOL, BT). */
export const PERIODES_STANDARD: ReadonlyArray<{ id: string; jours: number | null; label: string }> = [
  { id: "30j", jours: 30, label: "30 j" },
  { id: "90j", jours: 90, label: "90 j" },
  { id: "1a", jours: 365, label: "1 a" },
  { id: "tout", jours: null, label: "Tout" },
];

/**
 * Boutons de période uniformes. `actif = null` → aucun bouton allumé (l'utilisateur a
 * zoomé/panné manuellement : plage personnalisée).
 */
export function BarrePeriodes({
  actif,
  onChange,
}: {
  actif: string | null;
  onChange: (p: { id: string; jours: number | null }) => void;
}) {
  return (
    <Onglets
      options={PERIODES_STANDARD.map((p) => ({ id: p.id, label: p.label }))}
      actif={actif ?? ""}
      onChange={(id) => {
        const p = PERIODES_STANDARD.find((x) => x.id === id);
        if (p) onChange(p);
      }}
    />
  );
}

export interface LigneInfobulle {
  label: string;
  valeur: string;
  couleur?: string;
}

/**
 * Curseur de graphe : trait vertical + infobulle overlay. À rendre dans un parent
 * `relative` qui contient le canvas. `xPix` en pixels CSS relatifs au graphe ;
 * l'infobulle bascule à gauche du trait près du bord droit.
 */
export function InfobulleGraphe({
  xPix,
  largeurGraphe,
  titre,
  lignes,
}: {
  xPix: number;
  largeurGraphe: number;
  titre: string;
  lignes: LigneInfobulle[];
}) {
  return (
    <>
      <div
        className="pointer-events-none absolute inset-y-0 w-px bg-text-dim/60"
        style={{ left: xPix }}
      />
      <div
        className="pointer-events-none absolute z-10 whitespace-nowrap rounded border border-border bg-surface px-2 py-1 text-[11px] tabular-nums text-text shadow-lg"
        style={{ left: Math.min(xPix + 10, Math.max(0, largeurGraphe - 150)), top: 6 }}
      >
        <div className="text-text-dim">{titre}</div>
        {lignes.map((l, i) => (
          <div key={i} style={l.couleur !== undefined ? { color: l.couleur } : undefined}>
            {l.label} : {l.valeur}
          </div>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
cd /Users/zakichair/axiom
git add apps/web/src/components/ui.tsx
git commit -m "feat(ui): BarrePeriodes et InfobulleGraphe partagés pour les graphes canvas"
```

---

### Task 4: STBL — migrer l'onglet Impression vers le kit (fenêtre de référence)

**Files:**
- Modify: `apps/web/src/components/StablecoinsWindow.tsx` — `dessinerImpression` (~l.315-393), `VueImpression` (~l.405-…), interface `Survol`, PERIODES locales (~l.304-312).
- Test: `apps/web/src/components/stablecoinsWindow.util.test.ts` (inchangé — `tronquerSerie`/`pointLePlusProche` restent).

**Interfaces:**
- Consumes: Tasks 1-3 (`Domaine`, `indicesVisibles`, `valeurVersPixel`, `pixelVersValeur`, `domainePourPreset`, `useDomaineZoom`, `BarrePeriodes`, `InfobulleGraphe`, `PERIODES_STANDARD`).
- Produces: `dessinerImpression(canvas, serie, domaine)` — le patron « fonction de dessin qui reçoit le domaine » repris par les tâches 5-9. `VueChaines` (l.~530) et `VueEmetteur` (l.~700) appellent aussi `dessinerImpression` : leur passer le domaine complet de leur série (`{min: serie[0].time, max: serie[dernier].time}`) sans autre changement.

- [ ] **Step 0: Committer l'en-cours STBL si présent**

```bash
cd /Users/zakichair/axiom && git status --short
# Si StablecoinsWindow.tsx / stablecoinsWindow.util.* apparaissent modifiés :
git add apps/web/src/components/StablecoinsWindow.tsx apps/web/src/components/stablecoinsWindow.util.ts apps/web/src/components/stablecoinsWindow.util.test.ts
git commit -m "feat(stbl): curseur infos + reperes de dates sur le chart Impression"
```

- [ ] **Step 1: Adapter `dessinerImpression` au domaine**

Signature : `function dessinerImpression(canvas: HTMLCanvasElement, serie: PointSupply[], domaine: Domaine): void`.
Remplacements dans le corps (le reste — marges, tokens, barres — ne bouge pas) :

```ts
// AVANT (échelle sur toute la série) :
//   const t0 = serie[0]!.time; const t1 = serie[serie.length - 1]!.time;
//   const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * cssW;
// APRÈS (échelle sur le domaine visible, points hors-champ exclus) :
const { debut, fin } = indicesVisibles(serie, (p) => p.time, domaine);
const visibles = serie.slice(debut, fin + 1);
if (visibles.length < 2) return;
const x = (t: number) => valeurVersPixel(domaine, t, cssW);
```

Toutes les boucles qui itéraient `serie` itèrent `visibles` (ligne de supply, `bornes(...)` pour l'échelle Y, `serieImpressionQuotidienne(visibles)` pour les barres — le point de bord inclus par `indicesVisibles` garantit le 1er delta). Les repères de dates utilisent `domaine.min`, `(domaine.min+domaine.max)/2`, `domaine.max` au lieu de `t0/milieu/t1`. Import à ajouter : `import { indicesVisibles, valeurVersPixel, pixelVersValeur, domainePourPreset, type Domaine } from "../lib/domaineAxe";`.

- [ ] **Step 2: Recâbler `VueImpression` sur le kit**

Supprimer `PERIODES`/`Periode` locales (l.~298-312) et l'état `periodeId`+`tronquerSerie` d'affichage. Nouveau câblage :

```tsx
const bornes = useMemo<Domaine | null>(
  () =>
    historique.length >= 2
      ? { min: historique[0]!.time, max: historique[historique.length - 1]!.time }
      : null,
  [historique],
);
const [presetId, setPresetId] = useState<string | null>("90j");
const { refCanvas, domaine, setDomaine } = useDomaineZoom(bornes, () => setPresetId(null));

// (Ré)applique le préréglage actif quand les bornes arrivent ou changent — le hook
// vient de réinitialiser le domaine au tout, on le resserre sur le preset courant.
useEffect(() => {
  if (bornes === null || presetId === null) return;
  const jours = PERIODES_STANDARD.find((p) => p.id === presetId)?.jours ?? null;
  setDomaine(domainePourPreset(bornes, jours));
}, [bornes?.min, bornes?.max]);

useEffect(() => {
  const canvas = refCanvas.current;
  if (canvas && domaine !== null) dessinerImpression(canvas, historique, domaine);
}, [historique, domaine]);
```

JSX : `<Onglets options={PERIODES...}>` → `<BarrePeriodes actif={presetId} onChange={(p) => { setPresetId(p.id); if (bornes) setDomaine(domainePourPreset(bornes, p.jours)); }} />`. Le `<canvas ref={canvasRef}>` devient `ref={refCanvas}`. Le handler `onSurvol` existant remplace son calcul de `t` par `pixelVersValeur(domaine, e.clientX - rect.left, rect.width)` et son `xPix` par `valeurVersPixel(domaine, point.time, rect.width)` ; le JSX du tooltip inline est remplacé par `<InfobulleGraphe xPix={survol.xPix} largeurGraphe={survol.largeur} titre={formatDateComplete(survol.point.time)} lignes={[...]} />` avec les 4 lignes actuelles (Supply, Δ jour coloré via `couleurDelta`, USDT, USDC). Les 2 autres appels (`VueChaines` l.~530, `VueEmetteur` l.~700) passent le domaine complet de leur série.

- [ ] **Step 3: Vérifier**

Run: `npx tsc --noEmit && npx vitest run src/components/stablecoinsWindow.util.test.ts`
Expected: 0 erreur TS, 21 tests PASS.

- [ ] **Step 4: Vérification visuelle**

Lancer `npm run dev -- --port 5174`, ouvrir STBL → Impression (thème Dark) : molette zoome autour du curseur, drag panne, double-clic reset, boutons 30j/90j/1a/Tout, aucun bouton actif après un geste, curseur/infobulle et dates suivent le domaine. Arrêter le serveur.

- [ ] **Step 5: Commit**

```bash
cd /Users/zakichair/axiom
git add apps/web/src/components/StablecoinsWindow.tsx
git commit -m "feat(stbl): zoom/pan/periodes uniformes sur le chart Impression (kit domaineAxe)"
```

---

### Task 5: CHAIN — kit complet sur la courbe hashrate

**Files:**
- Modify: `apps/web/src/components/OnchainWindow.tsx` — `CourbeHashrate` (l.263-335), `CarteHashrate` (l.342-379).

**Interfaces:**
- Consumes: Tasks 1-3. `PointMetrique = { time: number; value: number }` (time en ms).
- Produces: rien (feuille).

- [ ] **Step 1: Adapter `CourbeHashrate`**

Le dessin (useEffect l.279-328) passe d'une échelle par index (`step = largeur / (n-1)`) à une échelle temporelle sur le domaine + labels de dates + curseur :

```tsx
function CourbeHashrate({ points }: { points: PointMetrique[] }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [largeur, setLargeur] = useState(0);
  // (ResizeObserver existant inchangé)

  const bornes = useMemo<Domaine | null>(
    () =>
      points.length >= 2
        ? { min: points[0]!.time, max: points[points.length - 1]!.time }
        : null,
    [points],
  );
  const [presetId, setPresetId] = useState<string | null>("1a");
  const { refCanvas, domaine, setDomaine } = useDomaineZoom(bornes, () => setPresetId(null));
  const [survol, setSurvol] = useState<{ xPix: number; point: PointMetrique } | null>(null);

  useEffect(() => {
    const cvs = refCanvas.current;
    if (cvs === null || largeur <= 0 || domaine === null) return;
    // … mise en place dpr/clearRect existante …
    const { debut, fin } = indicesVisibles(points, (p) => p.time, domaine);
    const visibles = points.slice(debut, fin + 1);
    if (visibles.length < 2) return;
    const PAD_B = 14; // marge basse pour les repères de dates
    const h = COURBE_H - 6 - 6 - PAD_B;
    const xDe = (t: number) => valeurVersPixel(domaine, t, largeur);
    // min/max/yDe et les DEUX tracés (aire + trait) : itérer `visibles`,
    // x = xDe(p.time) au lieu de i * step ; l'aire ferme sur COURBE_H - PAD_B.
    // Repères de dates (pattern STBL) :
    const cDim = lireTokenCanvas("--text-dim", "#9ca3af");
    ctx.fillStyle = cDim;
    ctx.font = "10px system-ui, sans-serif";
    const yLabel = COURBE_H - 3;
    ctx.fillText(formatDateCourte(domaine.min), 2, yLabel);
    const milieu = formatDateCourte((domaine.min + domaine.max) / 2);
    ctx.fillText(milieu, largeur / 2 - ctx.measureText(milieu).width / 2, yLabel);
    const finTxt = formatDateCourte(domaine.max);
    ctx.fillText(finTxt, largeur - 2 - ctx.measureText(finTxt).width, yLabel);
  }, [points, largeur, domaine]);

  const surSurvol = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (domaine === null || points.length < 2) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const t = pixelVersValeur(domaine, e.clientX - rect.left, rect.width);
    let point = points[0]!;
    for (const p of points) if (Math.abs(p.time - t) < Math.abs(point.time - t)) point = p;
    setSurvol({ xPix: valeurVersPixel(domaine, point.time, rect.width), point });
  };

  return (
    <div ref={wrapRef} className="relative w-full">
      <BarrePeriodes
        actif={presetId}
        onChange={(p) => {
          setPresetId(p.id);
          if (bornes) setDomaine(domainePourPreset(bornes, p.jours));
        }}
      />
      <canvas
        ref={refCanvas}
        style={{ width: "100%", height: COURBE_H }}
        onMouseMove={surSurvol}
        onMouseLeave={() => setSurvol(null)}
      />
      {survol && (
        <InfobulleGraphe
          xPix={survol.xPix}
          largeurGraphe={largeur}
          titre={formatDateComplete(survol.point.time)}
          lignes={[{ label: "Hashrate", valeur: fmtHashrate(survol.point.value) }]}
        />
      )}
    </div>
  );
}
```

Notes d'intégration : retirer `aria-hidden` du canvas (il devient interactif) ; `cvsRef` → `refCanvas` du hook ; imports `Domaine/indicesVisibles/valeurVersPixel/pixelVersValeur/domainePourPreset`, `useDomaineZoom`, `BarrePeriodes/InfobulleGraphe`, `formatDateCourte/formatDateComplete` (vérifier ce que `format.ts` importe déjà dans ce fichier ; `fmtHashrate` et `fmtJour` sont locaux). Les deux spans DOM de dates dans `CarteHashrate` (l.367-371) sont supprimés (remplacés par les labels canvas) ; le span min/max reste.

- [ ] **Step 2: Vérifier + commit**

Run: `npx tsc --noEmit` → 0 erreur. Vérification visuelle CHAIN (zoom/pan/reset/périodes/curseur/dates), puis :

```bash
cd /Users/zakichair/axiom
git add apps/web/src/components/OnchainWindow.tsx
git commit -m "feat(chain): zoom/pan/periodes/curseur sur la courbe hashrate"
```

---

### Task 6: VOL — kit complet sur les séries RV30/DVOL

**Files:**
- Modify: `apps/web/src/components/VolWindow.tsx` — `drawSeries` (l.190-258), `draw` (l.260-…), composant hôte (chercher `draw(canvas` et le `<canvas` associé : `grep -n "draw(\|<canvas" apps/web/src/components/VolWindow.tsx`).

**Interfaces:**
- Consumes: Tasks 1-3. `VolData` : `times: number[]`, `rv30: (number|null)[]`, `dvol?: { time: number; value: number }[]`.
- Produces: rien (feuille).

- [ ] **Step 1: Adapter `drawSeries` + `draw` au domaine**

`drawSeries(ctx, data, x0, y0, w, h, tk, domaine: Domaine)` et `draw(canvas, data, domaine: Domaine)` :

```ts
// AVANT : const depuis = Date.now() - 365 * 24 * 60 * 60 * 1000;  (fenêtre fixe 1 an)
// APRÈS : filtrage par le domaine visible (mêmes structures rv/dvol) :
const rv: { time: number; value: number }[] = [];
data.times.forEach((t, i) => {
  const v = data.rv30[i];
  if (v !== null && v !== undefined) rv.push({ time: t, value: v });
});
const rvIdx = indicesVisibles(rv, (p) => p.time, domaine);
const rvVis = rv.slice(rvIdx.debut, rvIdx.fin + 1);
const dvolTous = data.dvol ?? [];
const dvIdx = indicesVisibles(dvolTous, (p) => p.time, domaine);
const dvolVis = dvolTous.slice(dvIdx.debut, dvIdx.fin + 1);
// tMin/tMax ne se calculent plus : xAt utilise le domaine.
const xAt = (t: number): number => left + valeurVersPixel(domaine, t, plotW);
// vMin/vMax : sur [...rvVis, ...dvolVis] (auto-scale Y sur la plage visible).
// ligne(rvVis, tk.up); ligne(dvolVis, tk.accent);
// Labels dates (nouveaux, sous le tracé) :
ctx.fillStyle = tk.dim;
ctx.fillText(formatDateCourte(domaine.min), left, bottom + 14);
const finTxt = formatDateCourte(domaine.max);
ctx.fillText(finTxt, left + plotW - ctx.measureText(finTxt).width, bottom + 14);
```

Le composant hôte : bornes = min/max sur l'union des temps rv/dvol (memo sur `data`) ; préréglage initial `"1a"` (`domainePourPreset(bornes, 365)`) ; `useDomaineZoom` + `BarrePeriodes` + curseur `InfobulleGraphe` avec 2 lignes — `RV30 : xx.x %` (couleur `tk.up` → `lireTokenCanvas("--up", ...)`) et `DVOL : xx.x %` (accent), valeur = point le plus proche du temps survolé dans chaque série, `VALEUR_ABSENTE` si absente. Wrapper `relative` autour du canvas.

- [ ] **Step 2: Vérifier + commit**

`npx tsc --noEmit` → 0 erreur ; vérification visuelle VOL ; commit `feat(vol): zoom/pan/periodes/curseur sur RV30-DVOL`.

---

### Task 7: BT — kit complet sur l'equity curve

**Files:**
- Modify: `apps/web/src/components/BacktestWindow.tsx` — `dessinerEquity` (l.268-362) + composant canvas (l.364-…).

**Interfaces:**
- Consumes: Tasks 1-3. `PointEquity = { temps: number; equity: number; drawdownPct: number }` (`packages/backtest/src/types.ts:153`).
- Produces: rien (feuille).

- [ ] **Step 1: Passer l'échelle X de l'index au temps + domaine**

`dessinerEquity(canvas, resultat, domaine: Domaine)` :

```ts
// AVANT : const xAt = (i: number): number => pad + (i / (n - 1)) * (largeur - 2 * pad);
// APRÈS :
const { debut, fin } = indicesVisibles(points, (p) => p.temps, domaine);
const visibles = points.slice(debut, fin + 1);
if (visibles.length < 2) { /* message « trop peu de points » existant */ return; }
const xAt = (t: number): number => pad + valeurVersPixel(domaine, t, largeur - 2 * pad);
// Toutes les boucles itèrent `visibles` avec xAt(p.temps) au lieu de xAt(i).
// min/max equity et maxDd : sur `visibles` (auto-scale sur la plage visible).
// Labels dates domaine.min/max en bas (pattern Task 6), couleur colDim.
```

Composant : bornes = `{min: points[0].temps, max: points[n-1].temps}` quand `resultat` change ; préréglage initial `"tout"` (un backtest peut être court) ; `BarrePeriodes` + curseur avec lignes `Equity : formatUsd(p.equity)` et `Drawdown : formatPct(-p.drawdownPct)` (couleur `--down` si > 0) + titre `formatDateComplete(p.temps)`.

- [ ] **Step 2: Vérifier + commit**

`npx tsc --noEmit` ; lancer un backtest en visuel et tester les gestes ; commit `feat(bt): zoom/pan/periodes/curseur sur l'equity curve`.

---

### Task 8: OMON — zoom d'axe strike sur le smile IV + histogramme OI

**Files:**
- Modify: `apps/web/src/components/OptionsWindow.tsx` — `dessinerSmile` (l.117-~250), histogramme OI (fonction vers l.255, `grep -n "function dessiner" apps/web/src/components/OptionsWindow.tsx`), composant hôte (canvas + `Segmente` l.521-556).

**Interfaces:**
- Consumes: Tasks 1-3. `OptionPoint` (champ `strike: number`, `markIv`, OI par point).
- Produces: rien (feuille). **Pas de `BarrePeriodes`** (axe = strike, pas le temps).

- [ ] **Step 1: Domaine strike partagé entre les deux canvas**

Dans le composant hôte : `bornes = {min, max}` des strikes de l'échéance sélectionnée (memo ; se réinitialise au changement de devise/échéance via la dépendance aux bornes du hook). `useDomaineZoom` sur le canvas du smile. `dessinerSmile(canvas, points, underlying, maxPain, domaine)` : `px` devient `padL + valeurVersPixel(domaine, s, plotW)` ; `finies` filtrées par `indicesVisibles` sur `strike` (points triés par strike — vérifier, sinon trier avant) ; étiquettes X min/max = `formatStrike(domaine.min)`/`formatStrike(domaine.max)` ; les repères verticaux (sous-jacent, max pain) ne se dessinent que si leur strike est dans le domaine. L'histogramme OI reçoit LE MÊME `domaine` (axes alignés). Curseur : point au strike le plus proche, lignes `IV : xx.x %`, `OI : …` (+ call/put si les points portent le côté), titre `Strike formatStrike(p.strike)`.

- [ ] **Step 2: Vérifier + commit**

`npx tsc --noEmit` ; visuel OMON (zoomer sur les strikes ATM, vérifier alignement smile/OI, reset au changement d'échéance) ; commit `feat(omon): zoom d'axe strike + curseur sur smile IV et OI`.

---

### Task 9: TERM + RATE — zoom d'axe échéances / maturités

**Files:**
- Modify: `apps/web/src/components/TermStructureWindow.tsx` (dessin l.144-219 : `px(ms)` avec `xMin/xMax` sur `expiryMs`, marges l.163-166).
- Modify: `apps/web/src/components/CourbeTaux.tsx` (`dessinerCourbe` l.50-157 : `xOf(annees)`, labels maturités l.132-146 ; composant `CourbeTaux` l.159-…).

**Interfaces:**
- Consumes: Tasks 1-3. TERM : points `{ expiryMs, basisAnnualise }` par actif (BTC/ETH). RATE : `SerieCourbe[]` de `PointCourbe { anneesTri, taux, maturite }`.
- Produces: rien (feuilles). Pas de `BarrePeriodes` ni l'un ni l'autre.

- [ ] **Step 1: TERM**

Bornes = min/max des `expiryMs` des deux actifs. `px` → `padL + valeurVersPixel(domaine, ms, plotW)` ; points filtrés par domaine ; étiquettes X = `formatDateCourte(domaine.min/max)`. Curseur : échéance la plus proche, lignes `BTC : x.x %` / `ETH : x.x %` (basis annualisé, `VALEUR_ABSENTE` si l'actif n'a pas cette échéance), titre = `formatDateCourte(échéance)`.

- [ ] **Step 2: RATE (CourbeTaux)**

Bornes = min/max de `anneesTri` sur toutes les séries. `xOf` → `left + valeurVersPixel(domaine, annees, plotW)` ; points filtrés ; labels maturités existants (l.138-145) : n'afficher que ceux dont `anneesTri` est dans le domaine (le dédoublonnage/espacement existant reste). Curseur : maturité la plus proche, une ligne PAR série visible (`s.label : x.xx %`, couleur `couleurSerie(s.couleurTokenIndex)`), titre = label de maturité du point.

- [ ] **Step 3: Vérifier + commit**

`npx tsc --noEmit` ; visuel TERM et RATE ; commit `feat(term,rate): zoom d'axe + curseur (echeances, maturites)`.

---

### Task 10: Gate final — suite complète + vérification visuelle 7 fenêtres × 2 thèmes

**Files:** aucun nouveau (corrections éventuelles uniquement).

- [ ] **Step 1: Suite complète**

Run: `cd /Users/zakichair/axiom/apps/web && npx tsc --noEmit && npx vitest run`
Expected: 0 erreur TS, tous les tests PASS (dont les 13 de domaineAxe et les 21 de stablecoinsWindow.util).

- [ ] **Step 2: Vérification visuelle exhaustive**

`npm run dev -- --port 5174` (5173 = serveur de Zaki, ne pas toucher), via chrome-devtools MCP, pour CHACUNE des 7 fenêtres (STBL Impression, CHAIN, VOL, BT après un run, OMON, TERM, RATE) × 2 thèmes (Dark, Cute) : molette zoome autour du curseur, drag panne, double-clic reset, curseur/infobulle lisible (contraste Cute), labels d'axe présents, `BarrePeriodes` sur les 4 fenêtres temporelles seulement, plus AUCUN bouton actif après un geste manuel. Vérifier console : aucune erreur. Arrêter le serveur (kill du PID sur 5174 uniquement).

- [ ] **Step 3: Commit final (si corrections)**

```bash
cd /Users/zakichair/axiom
git add -A apps/web/src
git commit -m "fix(graphes): ajustements post-verification visuelle du kit domaineAxe"
```
