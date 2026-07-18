# Règle de mesure découvrable + suppression rapide des indicateurs overlay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre l'outil de mesure de prix découvrable via un bouton dans la barre de dessin, et permettre la suppression en un clic des indicateurs « overlay » (VWAP ancré, EMA, BOLL…) directement depuis le pane prix.

**Architecture:** Deux ajouts indépendants et non-régressifs sur `apps/web/src/chart/` : (1) un nouvel outil `"measure"` dans le registre `drawing.ts`, consommé par `measureTool.ts` (mode « armé » sans Shift) et exposé par `DrawingToolbar.tsx` ; (2) un nouveau contrôleur DOM `OverlayLegend`, calqué sur `PaneHeaders`, branché dans `ChartInstance.tsx`.

**Tech Stack:** React 19 (TS), Zustand vanilla stores, klinecharts 9.8.12, Vitest.

## Global Constraints

- Langue des commentaires/docs/libellés UI : français (convention du dépôt).
- Aucune régression sur le comportement existant : Shift+glisser doit continuer à fonctionner quel que soit l'outil actif ; les dessins classiques (droites, rectangles, Fibonacci…) gardent leur suppression par clic droit / Suppr / « Effacer tout » inchangée.
- Suivre les conventions déjà en place dans les fichiers touchés (constante locale `CANDLE_PANE_ID` dupliquée par fichier, pattern contrôleur `constructor(chart, container) → sync() → dispose()`, mocks de test existants) plutôt qu'en introduire de nouvelles.
- `pnpm --filter @axiom/web typecheck` et `pnpm --filter @axiom/web test` doivent rester verts après chaque tâche.

---

## Task 1: Nouvel outil `"measure"` dans le registre de dessin

**Files:**
- Modify: `apps/web/src/chart/drawing.ts:41-55` (type `DrawingToolId`), `:64-78` (`TOOL_OVERLAY`)
- Test: `apps/web/src/chart/drawing.test.ts`

**Interfaces:**
- Consumes: rien (fondation).
- Produces: `DrawingToolId` inclut désormais `"measure"` ; `TOOL_OVERLAY.measure === null` — consommé par `measureTool.ts` (Task 2, lit `drawingStore.getState().tool`) et `DrawingToolbar.tsx` (Task 3, nouvelle entrée `TOOLS`).

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `apps/web/src/chart/drawing.test.ts`, dans les imports en tête de fichier, `drawingStore` :

```ts
import {
  bindChart,
  coinsRectangle,
  drawingStore,
  exportChartImage,
  restoreDrawings,
  selectTool,
  setFocusChart,
  unbindChart,
} from "./drawing";
```

Puis ajouter ce bloc juste après le `describe("drawing.ts — picker d'ancrage AVWAP"...)` (avant `describe("coinsRectangle — rectangle 2 points"...)`, ligne ~310) :

```ts
describe("drawing.ts — outil « measure »", () => {
  it("selectTool(\"measure\") met à jour drawingStore sans créer d'overlay", () => {
    const a = createMockChart();
    const createSpy = vi.spyOn(a.chart, "createOverlay");
    bindChart(a.chart, { exchange: EXCHANGE, symbol: SYMBOL }, 0);
    setFocusChart(0);

    selectTool("measure");

    expect(drawingStore.getState().tool).toBe("measure");
    expect(createSpy).not.toHaveBeenCalled();

    unbindChart(a.chart);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd apps/web && npx vitest run src/chart/drawing.test.ts`
Expected: FAIL — erreur TypeScript/runtime, `"measure"` n'est pas une valeur valide de `DrawingToolId` (ou `TOOL_OVERLAY` n'a pas d'entrée `measure`).

- [ ] **Step 3: Implémenter**

Dans `apps/web/src/chart/drawing.ts`, modifier le type `DrawingToolId` :

```ts
export type DrawingToolId =
  | "cursor"
  | "measure"
  | "trendLine"
  | "ray"
  | "extended"
  | "horizontalLine"
  | "horizontalRay"
  | "verticalLine"
  | "priceLine"
  | "parallelChannel"
  | "priceChannel"
  | "rect"
  | "fib"
  | "fibTrend"
  | "volumeRange"
  | "avwapAnchor";
```

Puis dans `TOOL_OVERLAY`, ajouter l'entrée juste après `cursor` :

```ts
const TOOL_OVERLAY: Record<DrawingToolId, string | null> = {
  cursor: null,
  measure: null, // règle transitoire (MeasureTool) : pas d'overlay createOverlay, cf. chart/measureTool.ts
  trendLine: "segment", // droite de tendance (2 points)
  // ... (reste inchangé)
```

Aucune autre modification n'est nécessaire dans `selectTool` : la garde existante
`if (name === null || activeChart === null) return;` sort déjà avant tout `createOverlay`
dès que `TOOL_OVERLAY[tool]` vaut `null` (comme pour `avwapAnchor`, qui lui a un branchement
dédié parce qu'il doit en plus déclencher `startAvwapAnchor` — `"measure"` n'a pas besoin de
ce branchement).

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `cd apps/web && npx vitest run src/chart/drawing.test.ts`
Expected: PASS (tous les tests du fichier, y compris le nouveau).

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: aucune erreur (en particulier dans `DrawingToolbar.tsx`, qui exhaustively type-check `TOOLS: ToolDef[]` contre `DrawingToolId` — Task 3 doit ajouter l'entrée `"measure"` pour rester valide si un `satisfies`/exhaustivité existait ; sinon aucun impact avant Task 3).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/chart/drawing.ts apps/web/src/chart/drawing.test.ts
git commit -m "feat(chart): outil de dessin \"measure\" (pas d'overlay créé)"
```

---

## Task 2: Mode armé de `MeasureTool` (clic-glisser sans Shift quand l'outil est actif)

**Files:**
- Modify: `apps/web/src/chart/measureTool.ts`

**Interfaces:**
- Consumes: `drawingStore` (exporté par `./drawing`, `{ getState(): { tool: DrawingToolId }, subscribe(listener) }`) ; `DrawingToolId` valeur `"measure"` (Task 1).
- Produces: `MeasureTool` continue d'exposer la même API publique (`constructor(chart, chartDom, container)`, `dispose()`) — aucun changement de signature, donc aucun impact sur `ChartInstance.tsx` pour cette tâche.

- [ ] **Step 1: Modifier les imports et l'interface interne**

Dans `apps/web/src/chart/measureTool.ts`, ajouter l'import et étendre `DragEnCours` :

```ts
import type { Chart as KLineChartInstance } from "klinecharts";
import { formatPct, formatPrice } from "../lib/format";
import { drawingStore } from "./drawing";
```

```ts
interface DragEnCours {
  debut: PointMesure;
  startRelX: number;
  startRelY: number;
  /** true si déclenché par le mode armé (bouton « Règle »), false si Shift+glisser. */
  viaToolbar: boolean;
}
```

- [ ] **Step 2: Ajouter l'abonnement au store dans le constructeur + le champ de désabonnement**

Ajouter le champ privé, juste après `private drag: DragEnCours | null = null;` :

```ts
private drag: DragEnCours | null = null;
private readonly unsubscribeDrawingStore: () => void;
```

Dans le constructeur, après `window.addEventListener("mousedown", this.onMouseDown, { capture: true });` :

```ts
window.addEventListener("mousedown", this.onMouseDown, { capture: true });
// Mode armé (bouton « Règle ») : si l'utilisateur change d'outil PENDANT un glissement
// déclenché sans Shift, on l'annule proprement. Un Shift-drag en cours n'est jamais
// affecté (il ne dépend pas de l'outil sélectionné, cf. onMouseDown).
this.unsubscribeDrawingStore = drawingStore.subscribe((state) => {
  if (state.tool !== "measure" && this.drag?.viaToolbar) this.annuler();
});
```

- [ ] **Step 3: Étendre `onMouseDown` pour accepter le mode armé**

Remplacer la garde initiale et la construction de `this.drag` :

```ts
private onMouseDown = (e: MouseEvent): void => {
  // Shift + clic gauche (raccourci global, marche avec n'importe quel outil actif) OU
  // clic gauche seul quand l'outil « Règle » est armé depuis la barre de dessin — et
  // uniquement sur CE graphe (target dans chartDom).
  const arme = drawingStore.getState().tool === "measure";
  if (!(e.shiftKey || arme) || e.button !== 0) return;
  if (!(e.target instanceof Node) || !this.chartDom.contains(e.target)) return;
  const bound = this.chart.getSize(CANDLE_PANE_ID);
  if (!bound) return;
  const { x, y } = this.relatif(e.clientX, e.clientY);
  if (x < bound.left || x > bound.left + bound.width) return;
  if (y < bound.top || y > bound.top + bound.height) return;
  const debut = this.pointDepuisPixel(x, y);
  if (!debut) return;
  // Capture window + stopPropagation → KLineChart ne reçoit pas le mousedown et ne
  // démarre aucun pan pendant que l'on mesure.
  e.preventDefault();
  e.stopPropagation();
  // Shift prioritaire sur le mode armé : un Shift-drag reste un Shift-drag même si
  // l'outil « Règle » est sélectionné (jamais annulé par un changement d'outil).
  this.drag = { debut, startRelX: x, startRelY: y, viaToolbar: arme && !e.shiftKey };
  this.container.style.userSelect = "none";
  window.addEventListener("mousemove", this.onMouseMove, { capture: true });
  window.addEventListener("mouseup", this.onMouseUp, { capture: true });
  window.addEventListener("keydown", this.onKeyDown);
  window.addEventListener("blur", this.onBlur);
  this.dessiner(x, y); // rectangle dégénéré au clic (écart 0)
};
```

- [ ] **Step 4: Désabonner dans `dispose()`**

```ts
dispose(): void {
  window.removeEventListener("mousedown", this.onMouseDown, {
    capture: true,
  } as EventListenerOptions);
  this.unsubscribeDrawingStore();
  this.annuler();
  this.rect.remove();
  this.label.remove();
}
```

- [ ] **Step 5: Typecheck + suite existante (pas de test dédié pour le mode armé)**

Pas de nouveau test automatisé pour cette étape : au-delà de la convention du fichier
(« Le contrôleur DOM/événements est vérifié par rendu réel »), c'est une contrainte DURE —
l'environnement de test de ce package tourne en Node SANS DOM (cf. le commentaire de
`drawing.test.ts` : « pas de DOM ici, environnement de test Node »), et le constructeur de
`MeasureTool` appelle `document.createElement`. Il est donc IMPOSSIBLE d'instancier la
classe dans `vitest run` tel qu'il est configuré aujourd'hui. La vérification du mode armé
se fait en Step 6 de la Task 3 (manuel, dev server) une fois le bouton câblé.

Run: `cd apps/web && npx tsc --noEmit && npx vitest run src/chart/measureTool.test.ts`
Expected: 0 erreur typecheck ; les 9 tests existants de `calculerMesure`/`formaterDuree` passent toujours (comportement pur inchangé).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/chart/measureTool.ts
git commit -m "feat(chart): mode armé de MeasureTool (clic-glisser sans Shift via l'outil « Règle »)"
```

---

## Task 3: Bouton « Règle » dans la barre de dessin

**Files:**
- Modify: `apps/web/src/components/DrawingToolbar.tsx`

**Interfaces:**
- Consumes: `DrawingToolId` valeur `"measure"` (Task 1) ; `selectTool` (déjà importé) ; `drawingStore` via `useStore(drawingStore, (s) => s.tool)` (déjà utilisé dans ce fichier).
- Produces: rien de consommé par d'autres tâches (bout de chaîne UI).

- [ ] **Step 1: Ajouter l'icône `RulerIcon`**

Dans `apps/web/src/components/DrawingToolbar.tsx`, juste après `CursorIcon` (avant `TrendLineIcon`) :

```tsx
/** Règle de mesure (barre à graduations). */
function RulerIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="3" y="9" width="18" height="6" rx="1" />
      <line x1="7" y1="9" x2="7" y2="12" />
      <line x1="11" y1="9" x2="11" y2="12" />
      <line x1="15" y1="9" x2="15" y2="12" />
      <line x1="19" y1="9" x2="19" y2="12" />
    </svg>
  );
}
```

- [ ] **Step 2: Ajouter l'entrée dans `TOOLS`, en 2e position**

```ts
const TOOLS: ToolDef[] = [
  { id: "cursor", label: "Curseur", Icon: CursorIcon },
  {
    id: "measure",
    label: "Règle de mesure — clic-glisser (raccourci : Shift+glisser, marche avec n'importe quel outil)",
    Icon: RulerIcon,
  },
  { id: "trendLine", label: "Droite de tendance", Icon: TrendLineIcon },
  // ... (reste inchangé)
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: 0 erreur (le littéral `"measure"` doit être assignable à `DrawingToolId`, confirmé par Task 1).

- [ ] **Step 4: Vérification manuelle (pas de fichier de test pour ce composant — convention du dépôt, `DrawingToolbar.tsx` n'a jamais eu de test dédié)**

```bash
cd apps/web && npm run dev
```

Dans le navigateur :
1. Ouvrir le graphe, cliquer sur le bouton Règle (2e icône de la barre de dessin, en dessous du curseur) → il doit s'illuminer (état actif).
2. Clic-glisser sur le graphe SANS tenir Shift → un rectangle coloré + une étiquette (%, Δ prix, nb bougies, durée) doivent apparaître pendant le glissement, et disparaître au relâchement.
3. Refaire un clic-glisser immédiatement, sans recliquer sur le bouton Règle → doit fonctionner à nouveau (mode répétable).
4. Cliquer sur « Curseur » → un clic-glisser sans Shift ne doit plus rien mesurer (pan normal du graphe).
5. Reste sur « Curseur » (ou n'importe quel autre outil), tenir Shift + glisser → la mesure doit toujours fonctionner (raccourci global inchangé).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/DrawingToolbar.tsx
git commit -m "feat(chart): bouton « Règle de mesure » dans la barre de dessin"
```

---

## Task 4: `overlayLegend.ts` — filtre pur + contrôleur DOM

**Files:**
- Create: `apps/web/src/chart/overlayLegend.ts`
- Test: `apps/web/src/chart/overlayLegend.test.ts`

**Interfaces:**
- Consumes: `indicatorsStore` (`{ getState(): { indicators: ActiveIndicator[] }, subscribe }`, `remove(instanceId)`), `formatInstanceLabel(def, params)` — tous exportés par `../store/indicators` ; `getIndicator(defId)` exporté par `@axiom/indicators` ; `ActionType`, `DomPosition` exportés par `klinecharts`.
- Produces: `export function overlayIndicators(indicators: readonly ActiveIndicator[]): { instanceId: string; label: string }[]` (pure, testée) ; `export class OverlayLegend { constructor(chart: Chart, container: HTMLElement); sync(): void; dispose(): void }` — consommé par `ChartInstance.tsx` (Task 5).

- [ ] **Step 1: Écrire le test qui échoue**

Créer `apps/web/src/chart/overlayLegend.test.ts` :

```ts
/**
 * Tests de la fonction PURE `overlayIndicators` : filtre les instances actives à
 * `def.pane === "overlay"` (EMA/BOLL/VWAP ancré…) et exclut les indicateurs à pane
 * séparé (RSI/MACD…). Le contrôleur DOM (`OverlayLegend`) est vérifié par rendu réel,
 * même convention que `measureTool.ts`/`paneHeaders.tsx` (pas de test dédié pour lui).
 */
import { describe, expect, it } from "vitest";
import { overlayIndicators } from "./overlayLegend";
import type { ActiveIndicator } from "../store/indicators";

describe("overlayIndicators", () => {
  it("garde une instance overlay (anchoredVwap) et calcule son libellé", () => {
    const indicators: ActiveIndicator[] = [
      { instanceId: "vwap-1", defId: "anchoredVwap", params: { anchorTime: 1_700_000_000_000 } },
    ];
    const result = overlayIndicators(indicators);
    expect(result).toHaveLength(1);
    expect(result[0]?.instanceId).toBe("vwap-1");
    expect(result[0]?.label).toContain("Anchored VWAP");
  });

  it("exclut une instance à pane séparé (rsi)", () => {
    const indicators: ActiveIndicator[] = [
      { instanceId: "rsi-1", defId: "rsi", params: { length: 14, source: "close" } },
    ];
    expect(overlayIndicators(indicators)).toEqual([]);
  });

  it("ignore silencieusement un defId inconnu (indicateur retiré du catalogue)", () => {
    const indicators: ActiveIndicator[] = [{ instanceId: "ghost-1", defId: "n-existe-pas", params: {} }];
    expect(overlayIndicators(indicators)).toEqual([]);
  });

  it("préserve l'ordre d'entrée pour un mélange overlay + séparé", () => {
    const indicators: ActiveIndicator[] = [
      { instanceId: "rsi-1", defId: "rsi", params: { length: 14, source: "close" } },
      { instanceId: "vwap-1", defId: "anchoredVwap", params: { anchorTime: 0 } },
    ];
    expect(overlayIndicators(indicators).map((r) => r.instanceId)).toEqual(["vwap-1"]);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd apps/web && npx vitest run src/chart/overlayLegend.test.ts`
Expected: FAIL — `Cannot find module './overlayLegend'` (le fichier n'existe pas encore).

- [ ] **Step 3: Implémenter**

Créer `apps/web/src/chart/overlayLegend.ts` :

```ts
/**
 * Légende des indicateurs « overlay » (EMA, BOLL, VWAP ancré…) sur le pane prix : une
 * ligne empilée par instance, croix ✕ = suppression instantanée. Pattern contrôleur
 * identique à `PaneHeaders` (panes séparés RSI/MACD), sans poignée de drag — l'ordre des
 * indicateurs overlay n'a pas d'utilité fonctionnelle (ils partagent tous `candle_pane`,
 * contrairement aux panes séparés empilés en hauteur).
 *
 * Positionné en haut à DROITE du pane prix pour ne pas chevaucher la légende native
 * (nom + valeur) de klinecharts, ancrée en haut-gauche — même convention que
 * `PaneHeaders` pour les panes séparés.
 */
import type { Chart } from "klinecharts";
import { ActionType, DomPosition } from "klinecharts";
import { getIndicator } from "@axiom/indicators";
import { indicatorsStore, formatInstanceLabel, type ActiveIndicator } from "../store/indicators";

const CANDLE_PANE_ID = "candle_pane";
/** Espace vertical entre deux lignes empilées (px). */
const ROW_GAP = 2;

interface EntreeLegende {
  instanceId: string;
  label: string;
}

/** Filtre les instances actives à `def.pane === "overlay"` (EMA/BOLL/VWAP…). PURE. */
export function overlayIndicators(indicators: readonly ActiveIndicator[]): EntreeLegende[] {
  const result: EntreeLegende[] = [];
  for (const inst of indicators) {
    const def = getIndicator(inst.defId);
    if (!def || def.pane !== "overlay") continue;
    result.push({ instanceId: inst.instanceId, label: formatInstanceLabel(def, inst.params) });
  }
  return result;
}

export class OverlayLegend {
  private readonly chart: Chart;
  private readonly container: HTMLElement;
  private readonly els = new Map<string, HTMLDivElement>();
  private readonly onPaneDrag = (): void => this.repositionnerTout();
  private readonly onDataReady = (): void => this.repositionnerTout();

  constructor(chart: Chart, container: HTMLElement) {
    this.chart = chart;
    this.container = container;
    this.chart.subscribeAction(ActionType.OnPaneDrag, this.onPaneDrag);
    this.chart.subscribeAction(ActionType.OnDataReady, this.onDataReady);
  }

  /** Réconcilie la légende avec la liste courante d'indicateurs overlay. */
  sync(): void {
    const entries = overlayIndicators(indicatorsStore.getState().indicators);
    const wanted = new Set(entries.map((e) => e.instanceId));
    for (const [id, el] of this.els) {
      if (!wanted.has(id)) {
        el.remove();
        this.els.delete(id);
      }
    }
    for (const entry of entries) {
      let el = this.els.get(entry.instanceId);
      if (!el) {
        el = this.creerElement(entry);
        this.els.set(entry.instanceId, el);
        this.container.appendChild(el);
      } else {
        const croix = el.querySelector<HTMLButtonElement>("[data-role=close]");
        if (croix) croix.setAttribute("aria-label", `Fermer ${entry.label}`);
      }
    }
    this.repositionnerTout();
  }

  private creerElement(entry: EntreeLegende): HTMLDivElement {
    const el = document.createElement("div");
    el.className =
      "pointer-events-auto absolute z-10 flex items-center gap-1.5 rounded bg-surface/90 px-1.5 py-0.5 text-[10px] text-text-dim shadow-sm";

    const croix = document.createElement("button");
    croix.textContent = "✕";
    croix.type = "button";
    croix.setAttribute("data-role", "close");
    croix.setAttribute("aria-label", `Fermer ${entry.label}`);
    croix.className = "leading-none text-text-dim hover:text-text";
    croix.addEventListener("click", () => indicatorsStore.getState().remove(entry.instanceId));

    el.append(croix);
    return el;
  }

  private repositionnerTout(): void {
    const main = this.chart.getSize(CANDLE_PANE_ID, DomPosition.Main);
    if (!main) {
      for (const el of this.els.values()) el.style.display = "none";
      return;
    }
    let y = main.top + 2;
    for (const entry of overlayIndicators(indicatorsStore.getState().indicators)) {
      const el = this.els.get(entry.instanceId);
      if (!el) continue;
      el.style.display = "";
      el.style.top = `${y}px`;
      el.style.left = `${Math.max(2, main.left + main.width - el.offsetWidth - 4)}px`;
      y += el.offsetHeight + ROW_GAP;
    }
  }

  dispose(): void {
    this.chart.unsubscribeAction(ActionType.OnPaneDrag, this.onPaneDrag);
    this.chart.unsubscribeAction(ActionType.OnDataReady, this.onDataReady);
    for (const el of this.els.values()) el.remove();
    this.els.clear();
  }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `cd apps/web && npx vitest run src/chart/overlayLegend.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/chart/overlayLegend.ts apps/web/src/chart/overlayLegend.test.ts
git commit -m "feat(chart): OverlayLegend — légende + suppression rapide des indicateurs overlay"
```

---

## Task 5: Brancher `OverlayLegend` dans `ChartInstance.tsx`

**Files:**
- Modify: `apps/web/src/chart/ChartInstance.tsx:33-63` (imports), `:340-351` (montage), `:448-451` (cleanup effet montage), `:643-650` (sync post-backfill)

**Interfaces:**
- Consumes: `OverlayLegend` (`constructor(chart, container)`, `sync()`, `dispose()`) exporté par `./overlayLegend` (Task 4).
- Produces: rien (bout de chaîne, intégration finale).

- [ ] **Step 1: Importer `OverlayLegend`**

Dans `apps/web/src/chart/ChartInstance.tsx`, à côté de l'import de `PaneHeaders` (chercher l'import existant du module `./paneHeaders` et ajouter juste après ou avant) :

```ts
import { OverlayLegend } from "./overlayLegend";
```

- [ ] **Step 2: Instancier et abonner au montage**

Remplacer (lignes ~340-344) :

```ts
    // En-têtes overlay des panes séparés (croix + drag-reorder) : le contrôleur lit
    // `indicatorsStore` lui-même (pas besoin de brancher `state`).
    const paneHeaders = new PaneHeaders(chart, container);
    const unsubscribePaneHeaders = indicatorsStore.subscribe(() => paneHeaders.sync());
    paneHeaders.sync();
```

par :

```ts
    // En-têtes overlay des panes séparés (croix + drag-reorder) : le contrôleur lit
    // `indicatorsStore` lui-même (pas besoin de brancher `state`).
    const paneHeaders = new PaneHeaders(chart, container);
    // Légende des indicateurs overlay (EMA/BOLL/VWAP ancré…) sur le pane prix : croix ✕
    // de suppression directe, même cycle de vie que paneHeaders (cf. chart/overlayLegend.ts).
    const overlayLegend = new OverlayLegend(chart, container);
    const unsubscribePaneHeaders = indicatorsStore.subscribe(() => {
      paneHeaders.sync();
      overlayLegend.sync();
    });
    paneHeaders.sync();
    overlayLegend.sync();
```

- [ ] **Step 3: Disposer au démontage**

Remplacer (lignes ~448-451) :

```ts
      unsubscribePaneHeaders();
      paneHeaders.dispose();
      measureTool.dispose();
      candleReadout.dispose();
```

par :

```ts
      unsubscribePaneHeaders();
      paneHeaders.dispose();
      overlayLegend.dispose();
      measureTool.dispose();
      candleReadout.dispose();
```

- [ ] **Step 4: Resynchroniser après le backfill initial (même besoin que `paneHeaders` — cf. commentaire existant)**

Remplacer (ligne ~650) :

```ts
        paneHeaders.sync();
```

par :

```ts
        paneHeaders.sync();
        overlayLegend.sync();
```

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 6: Vérification manuelle (contrôleur DOM branché sur un vrai chart — pas de test unitaire, cf. convention `PaneHeaders`)**

```bash
cd apps/web && npm run dev
```

Dans le navigateur :
1. Barre de dessin → outil « Ancrage VWAP » → cliquer sur une bougie. Un badge avec une
   croix ✕ doit apparaître en haut à droite du graphe prix (à côté/au-dessus de la légende
   native klinecharts en haut-gauche).
2. Cliquer sur la croix ✕ → le VWAP disparaît immédiatement du graphe ET de la section
   « Actifs » du menu Indicateurs.
3. Ajouter EMA(20) + EMA(50) + VWAP ancré simultanément (menu Indicateurs) → 3 lignes
   empilées doivent apparaître, chacune supprimable indépendamment sans toucher aux autres.
4. Ajouter RSI (pane séparé) en plus → vérifier qu'il N'apparaît PAS dans cette nouvelle
   légende (il garde son propre en-tête `PaneHeaders` existant, pane séparé en dessous).
5. Changer de layout (grille 2×2) et redimensionner un pane prix → la légende doit rester
   correctement positionnée (pas de croix orpheline hors du graphe).

- [ ] **Step 7: Suite complète + commit**

Run: `cd apps/web && npx vitest run && npx tsc --noEmit`
Expected: tous les tests passent, 0 erreur typecheck.

```bash
git add apps/web/src/chart/ChartInstance.tsx
git commit -m "feat(chart): branche OverlayLegend dans ChartInstance (montage/sync/dispose)"
```

---

## Task 6: Vérification finale de non-régression

**Files:** aucun (validation transverse).

**Interfaces:** aucune (dernière tâche).

- [ ] **Step 1: Suite de tests complète du package web**

Run: `cd apps/web && npx vitest run`
Expected: tous les tests passent (existants + les nouveaux des Tasks 1 et 4).

- [ ] **Step 2: Typecheck complet**

Run: `cd apps/web && npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 3: Vérification manuelle croisée (dev server)**

```bash
cd apps/web && npm run dev
```

1. Dessiner une droite de tendance → clic droit dessus → doit toujours se supprimer
   instantanément (non-régression Task 1/2, le nouvel outil « measure » ne doit rien
   avoir cassé dans `TOOL_OVERLAY`/`selectTool`).
2. Sélectionner l'outil « Rectangle », tenir Shift et glisser → la règle de mesure doit
   toujours s'afficher par-dessus (Shift prioritaire sur n'importe quel outil actif,
   y compris un autre outil de dessin en cours de sélection).
3. Outil « Règle » actif, clic-glisser répété 3 fois de suite sans rien recliquer →
   les 3 mesures s'affichent et s'effacent proprement, aucune ne reste « collée ».
4. VWAP + EMA actifs → suppression via la nouvelle légende ET via le menu Indicateurs
   (les deux chemins doivent rester cohérents, `indicatorsStore` étant la seule source
   de vérité).

- [ ] **Step 4: Commit final (si des ajustements ont été faits pendant la vérification)**

```bash
git add -A
git status --short
# Ne commit que s'il y a des changements réels issus d'ajustements de la Step 3.
git commit -m "fix(chart): ajustements de vérification finale règle/overlay legend"
```
