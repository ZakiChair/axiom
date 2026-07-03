# Confinement des fenêtres flottantes à la zone de travail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Les fenêtres flottantes AXIOM (position, resize, snap, recalage) se réfèrent désormais à la zone de travail réelle de l'application (le conteneur du graphe, qui exclut naturellement la toolbar, la barre de dessin et le panneau latéral) au lieu de `window.innerWidth`/`window.innerHeight`, avec un confinement **strict** : une fenêtre ne peut plus jamais chevaucher ce chrome.

**Architecture:** Un `WorkspaceRect` (x/y/width/height, mesuré via `getBoundingClientRect()` sur le conteneur du graphe) remplace `viewportWidth`/`viewportHeight` dans les 5 fonctions géométriques pures existantes et devient un champ d'état (`workspace`) du store, mis à jour par un seul `ResizeObserver` côté `App.tsx` (remplace l'ancien listener `window.resize`).

**Tech Stack:** React 19, Zustand (store vanilla), TypeScript, Vitest.

## Global Constraints

- Comментaires et identifiants en français, cohérents avec le reste de `windowManager.ts`/`FloatingWindow.tsx`/`App.tsx`.
- Aucune nouvelle dépendance npm (`ResizeObserver` est une API navigateur native).
- Confinement **strict** : une fenêtre ne peut jamais dépasser le workspace, même partiellement pendant un drag/resize — pas de marge de tolérance comme l'ancien `VISIBLE_MARGIN` (40px), qui est retiré.
- `pnpm test` / `pnpm -r typecheck` (pnpm workspace, pas npm) depuis `apps/web/` ou la racine.
- Tests dans `apps/web/src/store/windowManager.test.ts` (fichier existant) — `environment: node`, pas de jsdom, pas de test `.tsx` (convention du repo — vérification manuelle navigateur pour `FloatingWindow.tsx`/`App.tsx`).

---

### Task 1: `WorkspaceRect` + les 5 fonctions géométriques pures

**Files:**
- Modify: `apps/web/src/store/windowManager.ts` (section fonctions pures, entre `WINDOW_REGISTRY` et `WindowManagerState`)
- Modify: `apps/web/src/store/windowManager.test.ts` (describe blocks `cascadePosition`, `clampPosition`, `clampSize`, `detectSnapZone`, `snapGeometry`)

**Interfaces:**
- Consumes: rien de nouveau.
- Produces: `export interface WorkspaceRect { x: number; y: number; width: number; height: number }` et les 5 fonctions avec leur nouvelle signature (ci-dessous) — utilisées par Task 2 (store), Task 3 (`FloatingWindow.tsx`).

- [ ] **Step 1: Lire le fichier actuel pour confirmer son état exact**

Ouvrir `apps/web/src/store/windowManager.ts` en entier et repérer précisément : la définition de `MIN_WIDTH`/`MIN_HEIGHT`/`VISIBLE_MARGIN`, et les 5 fonctions `cascadePosition`, `clampPosition`, `clampSize`, `detectSnapZone`, `snapGeometry` (entre `WINDOW_REGISTRY` et `export interface WindowManagerState`). Le contenu ci-dessous part de l'état connu au moment de la rédaction de ce plan — confirmer qu'il correspond avant d'éditer ; s'il diffère, adapter en conservant l'intention (nouvelles signatures/comportement décrits ici).

- [ ] **Step 2: Réécrire les tests des 5 fonctions avec les nouvelles signatures (RED attendu)**

Dans `apps/web/src/store/windowManager.test.ts`, remplacer intégralement les 5 `describe` blocks `cascadePosition`, `clampPosition`, `clampSize`, `detectSnapZone`, `snapGeometry` (et leur import en tête de fichier) par :

```ts
import {
  cascadePosition,
  clampPosition,
  clampSize,
  detectSnapZone,
  snapGeometry,
  windowManagerStore,
  mirrorOpenState,
  WINDOW_REGISTRY,
  GROUP_PALETTE,
  type EtatFenetre,
  type WorkspaceRect,
} from "./windowManager";
```

```ts
describe("cascadePosition", () => {
  const workspace: WorkspaceRect = { x: 0, y: 0, width: 1920, height: 1080 };

  it("place la 1ère fenêtre proche du coin haut-gauche du workspace (marge 48px)", () => {
    expect(cascadePosition(0, workspace, 480, 640)).toEqual({ x: 48, y: 48 });
  });

  it("décale chaque fenêtre suivante de 28px en diagonale", () => {
    expect(cascadePosition(1, workspace, 480, 640)).toEqual({ x: 76, y: 76 });
    expect(cascadePosition(2, workspace, 480, 640)).toEqual({ x: 104, y: 104 });
  });

  it("ne dépasse jamais le workspace moins la fenêtre et la marge", () => {
    const etroit: WorkspaceRect = { x: 0, y: 0, width: 600, height: 400 };
    const { x, y } = cascadePosition(50, etroit, 480, 300);
    expect(x).toBeLessThanOrEqual(600 - 480 - 48);
    expect(y).toBeLessThanOrEqual(400 - 300 - 48);
  });

  it("ancre la cascade à l'origine du workspace (x/y non nuls)", () => {
    const decale: WorkspaceRect = { x: 200, y: 100, width: 1920, height: 1080 };
    expect(cascadePosition(0, decale, 480, 640)).toEqual({ x: 248, y: 148 });
  });
});

describe("clampPosition", () => {
  const workspace: WorkspaceRect = { x: 0, y: 0, width: 1920, height: 1080 };

  it("laisse une position déjà dans le workspace inchangée", () => {
    expect(clampPosition(100, 100, 480, 640, workspace)).toEqual({ x: 100, y: 100 });
  });

  it("confinement strict : ramène le bord gauche à l'intérieur du workspace", () => {
    expect(clampPosition(-1000, 100, 480, 640, workspace).x).toBe(0);
  });

  it("confinement strict : ramène le bord droit à l'intérieur du workspace", () => {
    // width=480 -> maxX = 1920 - 480 = 1440
    expect(clampPosition(5000, 100, 480, 640, workspace).x).toBe(1440);
  });

  it("confinement strict sur l'axe Y : bord haut et bord bas", () => {
    expect(clampPosition(100, -500, 480, 640, workspace).y).toBe(0);
    // height=640 -> maxY = 1080 - 640 = 440
    expect(clampPosition(100, 5000, 480, 640, workspace).y).toBe(440);
  });

  it("respecte une origine de workspace non nulle (x/y > 0)", () => {
    const decale: WorkspaceRect = { x: 200, y: 100, width: 800, height: 600 };
    expect(clampPosition(0, 0, 300, 200, decale)).toEqual({ x: 200, y: 100 });
    // maxX = 200+800-300=700 ; maxY = 100+600-200=500
    expect(clampPosition(9999, 9999, 300, 200, decale)).toEqual({ x: 700, y: 500 });
  });
});

describe("clampSize", () => {
  const workspace: WorkspaceRect = { x: 0, y: 0, width: 1920, height: 1080 };

  it("laisse une taille déjà dans les bornes inchangée", () => {
    expect(clampSize(480, 640, 320, 240, workspace)).toEqual({ width: 480, height: 640 });
  });

  it("remonte sous le minimum", () => {
    expect(clampSize(100, 100, 320, 240, workspace)).toEqual({ width: 320, height: 240 });
  });

  it("plafonne à la largeur/hauteur du workspace (pas du viewport)", () => {
    const etroit: WorkspaceRect = { x: 0, y: 0, width: 500, height: 300 };
    expect(clampSize(2000, 2000, 320, 240, etroit)).toEqual({ width: 500, height: 300 });
  });
});

describe("detectSnapZone", () => {
  const workspace: WorkspaceRect = { x: 0, y: 0, width: 1920, height: 1080 };

  it("détecte le bord gauche du workspace (cursorX < workspace.x + 8)", () => {
    expect(detectSnapZone(4, 500, workspace)).toBe("left");
  });

  it("détecte le bord droit du workspace (cursorX > workspace.x + workspace.width - 8)", () => {
    expect(detectSnapZone(1917, 500, workspace)).toBe("right");
  });

  it("détecte le bord haut du workspace (cursorY < workspace.y + 8), prioritaire sur gauche/droite", () => {
    expect(detectSnapZone(4, 4, workspace)).toBe("top");
  });

  it("retourne null hors des zones de bord", () => {
    expect(detectSnapZone(960, 500, workspace)).toBeNull();
  });

  it("un curseur hors du workspace (au-delà du bord) compte quand même dans la zone (ex. survole la barre de dessin à gauche)", () => {
    const decale: WorkspaceRect = { x: 200, y: 100, width: 800, height: 600 };
    expect(detectSnapZone(50, 500, decale)).toBe("left"); // bien avant workspace.x=200, toujours "left"
    expect(detectSnapZone(500, 500, decale)).toBeNull(); // au milieu du workspace
  });
});

describe("snapGeometry", () => {
  const workspace: WorkspaceRect = { x: 0, y: 0, width: 1920, height: 1080 };

  it('"left" -> moitié gauche du workspace, pleine hauteur', () => {
    expect(snapGeometry("left", workspace)).toEqual({ x: 0, y: 0, width: 960, height: 1080 });
  });

  it('"right" -> moitié droite du workspace, pleine hauteur', () => {
    expect(snapGeometry("right", workspace)).toEqual({ x: 960, y: 0, width: 960, height: 1080 });
  });

  it('"top" -> workspace entier (pas le viewport)', () => {
    expect(snapGeometry("top", workspace)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it("respecte l'origine d'un workspace décalé", () => {
    const decale: WorkspaceRect = { x: 200, y: 100, width: 800, height: 600 };
    expect(snapGeometry("left", decale)).toEqual({ x: 200, y: 100, width: 400, height: 600 });
    expect(snapGeometry("right", decale)).toEqual({ x: 600, y: 100, width: 400, height: 600 });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run (depuis `apps/web/`) : `npx vitest run src/store/windowManager.test.ts -t "cascadePosition|clampPosition|clampSize|detectSnapZone|snapGeometry"`
Expected: FAIL — erreurs de type (signatures incompatibles) ou `WorkspaceRect` non exporté.

- [ ] **Step 4: Réécrire les 5 fonctions dans `windowManager.ts`**

Le fichier a cet ordre actuellement : `MIN_WIDTH`/`MIN_HEIGHT`/`VISIBLE_MARGIN`, puis `export interface EtatFenetre { ... }` (id/open/x/y/width/height/z/minimized/groupColor — **NE PAS toucher cette interface**), puis le bloc `cascadePosition` → `snapGeometry`. Deux modifications séparées :
1. Supprimer la ligne `const VISIBLE_MARGIN = 40;` (n'a plus d'usage — le confinement strict n'a plus de notion de marge partiellement-visible).
2. Remplacer tout le bloc de `cascadePosition` jusqu'à la fin de `snapGeometry` (après `EtatFenetre`, donc — `EtatFenetre` reste exactement où il est, entre les deux) par :

```ts
/** Rectangle de la zone de travail des fenêtres flottantes (le conteneur du graphe,
 * PAS window.innerWidth/innerHeight) — exclut toolbar/barre de dessin/panneau latéral.
 * Mesuré par App.tsx via ResizeObserver, injecté dans toutes les fonctions ci-dessous
 * (elles restent pures, testables sans DOM). */
export interface WorkspaceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Position en cascade pour l'ouverture initiale d'une fenêtre (évite l'empilement
 * exact au même endroit). `index` = nombre de fenêtres déjà ouvertes. */
export function cascadePosition(
  index: number,
  workspace: WorkspaceRect,
  width: number,
  height: number
): { x: number; y: number } {
  const STEP = 28;
  const MARGIN = 48;
  const rawX = workspace.x + MARGIN + (index % 8) * STEP;
  const rawY = workspace.y + MARGIN + (index % 8) * STEP;
  const x = Math.min(rawX, Math.max(workspace.x + MARGIN, workspace.x + workspace.width - width - MARGIN));
  const y = Math.min(rawY, Math.max(workspace.y + MARGIN, workspace.y + workspace.height - height - MARGIN));
  return { x, y };
}

/** Confine une position au workspace — STRICTEMENT (la fenêtre entière, pas seulement
 * un bord, doit rester dans le rect). Suppose `width`/`height` déjà plafonnés via
 * `clampSize` contre le MÊME workspace (sinon le résultat peut légèrement déborder). */
export function clampPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  workspace: WorkspaceRect
): { x: number; y: number } {
  const clampedX = Math.min(Math.max(x, workspace.x), workspace.x + workspace.width - width);
  const clampedY = Math.min(Math.max(y, workspace.y), workspace.y + workspace.height - height);
  return { x: clampedX, y: clampedY };
}

/** Contraint une taille entre les minimums et les dimensions du workspace. */
export function clampSize(
  width: number,
  height: number,
  minWidth: number,
  minHeight: number,
  workspace: WorkspaceRect
): { width: number; height: number } {
  return {
    width: Math.min(Math.max(width, minWidth), workspace.width),
    height: Math.min(Math.max(height, minHeight), workspace.height),
  };
}

/** Zone de snap façon Aero — uniquement les bords (pas les coins/quarts dans ce lot). */
export type SnapZone = "left" | "right" | "top";

/** Distance au bord (px) déclenchant une zone de snap pendant un drag d'en-tête. */
const SNAP_EDGE_PX = 8;

/** Détecte la zone de snap active pour une position de curseur donnée, relative au
 * workspace (pas au viewport). `null` hors zone. Le bord haut est prioritaire (testé
 * en premier) : un curseur dans le coin haut-gauche déclenche "top", pas "left". Un
 * curseur au-delà du bord du workspace (ex. sur la barre de dessin ou le panneau
 * latéral) compte toujours dans la zone correspondante. */
export function detectSnapZone(
  cursorX: number,
  cursorY: number,
  workspace: WorkspaceRect
): SnapZone | null {
  if (cursorY < workspace.y + SNAP_EDGE_PX) return "top";
  if (cursorX < workspace.x + SNAP_EDGE_PX) return "left";
  if (cursorX > workspace.x + workspace.width - SNAP_EDGE_PX) return "right";
  return null;
}

/** Géométrie cible pour une zone de snap (moitié gauche/droite pleine hauteur, ou
 * workspace entier pour "top" — maximise DANS la zone de travail, jamais par-dessus
 * la toolbar/le panneau). */
export function snapGeometry(
  zone: SnapZone,
  workspace: WorkspaceRect
): { x: number; y: number; width: number; height: number } {
  if (zone === "left") {
    return { x: workspace.x, y: workspace.y, width: workspace.width / 2, height: workspace.height };
  }
  if (zone === "right") {
    return {
      x: workspace.x + workspace.width / 2,
      y: workspace.y,
      width: workspace.width / 2,
      height: workspace.height,
    };
  }
  return { x: workspace.x, y: workspace.y, width: workspace.width, height: workspace.height };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/store/windowManager.test.ts -t "cascadePosition|clampPosition|clampSize|detectSnapZone|snapGeometry"`
Expected: PASS (18 tests).

Note : à ce stade, le fichier ne compile probablement PAS encore dans son ensemble (le reste du fichier — `WindowManagerState`, `windowManagerStore`, `FloatingWindow.tsx` — référence encore les anciennes signatures). C'est attendu ; Task 2 et Task 3 les corrigent. Ne pas lancer la suite complète tant que Task 2 n'est pas faite.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/store/windowManager.ts apps/web/src/store/windowManager.test.ts
git commit -m "feat(window-manager): WorkspaceRect + confinement strict des 5 fonctions géométriques"
```

---

### Task 2: État `workspace` + action `setWorkspace` + `reclampAll`/`openWindow` mis à jour

**Files:**
- Modify: `apps/web/src/store/windowManager.ts` (interface + implémentation du store)
- Modify: `apps/web/src/store/windowManager.test.ts` (beforeEach, describe `reclampAll`, describe `openWindow` si nécessaire)

**Interfaces:**
- Consumes: `WorkspaceRect`, `cascadePosition`, `clampPosition`, `clampSize` (Task 1).
- Produces: champ `workspace: WorkspaceRect` sur `WindowManagerState`, action `setWorkspace(workspace: WorkspaceRect): void`, `reclampAll(workspace: WorkspaceRect): void` (signature simplifiée à un seul paramètre) — utilisés par Task 4 (`App.tsx`).

- [ ] **Step 1: Mettre à jour le `beforeEach` de réinitialisation**

Dans `apps/web/src/store/windowManager.test.ts`, le premier `beforeEach` (`windowManagerStore.setState({ windows: {}, nextZ: 1, groupSymbols: {}, dragPreview: null })`) devient :

```ts
beforeEach(() => {
  windowManagerStore.setState({
    windows: {},
    nextZ: 1,
    groupSymbols: {},
    dragPreview: null,
    workspace: { x: 0, y: 0, width: 1920, height: 1080 },
  });
});
```

Le DEUXIÈME `beforeEach` de ce fichier (celui qui fait `vi.stubGlobal("window", { innerWidth: 1920, innerHeight: 1080 })`, avec son commentaire expliquant qu'`openWindow` lisait `window.innerWidth/innerHeight`) et le `afterEach` associé (`vi.unstubAllGlobals()`) sont **supprimés** — `openWindow` ne lit plus `window.*` (Step 3 ci-dessous), et le workspace par défaut ci-dessus (1920×1080) reproduit exactement les mêmes valeurs numériques que l'ancien stub, donc les tests `openWindow`/z-order existants n'ont PAS besoin de changer leurs valeurs attendues.

- [ ] **Step 2: Réécrire les tests `reclampAll` (RED attendu)**

Remplacer le `describe("reclampAll", ...)` existant par :

```ts
describe("reclampAll", () => {
  it("confinement strict : la fenêtre entière rentre dans le nouveau workspace (position ET taille)", () => {
    windowManagerStore.getState().openWindow("derivatives"); // defaultWidth 420, defaultHeight 640
    windowManagerStore.getState().moveWindow("derivatives", 1800, 100);
    const cible = { x: 0, y: 0, width: 500, height: 400 };
    windowManagerStore.getState().reclampAll(cible);
    const w = windowManagerStore.getState().windows.derivatives!;
    expect(w.x).toBeGreaterThanOrEqual(cible.x);
    expect(w.y).toBeGreaterThanOrEqual(cible.y);
    expect(w.x + w.width).toBeLessThanOrEqual(cible.x + cible.width);
    expect(w.y + w.height).toBeLessThanOrEqual(cible.y + cible.height);
  });

  it("ne touche pas une fenêtre déjà dans les bornes", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().moveWindow("derivatives", 100, 100);
    const before = windowManagerStore.getState().windows.derivatives!;
    windowManagerStore.getState().reclampAll({ x: 0, y: 0, width: 1920, height: 1080 });
    const after = windowManagerStore.getState().windows.derivatives!;
    expect(after).toEqual(before);
  });

  it("ignore les fenêtres fermées (ne les recadre pas)", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().moveWindow("derivatives", 5000, 100);
    windowManagerStore.getState().closeWindow("derivatives");
    windowManagerStore.getState().reclampAll({ x: 0, y: 0, width: 800, height: 600 });
    const w = windowManagerStore.getState().windows.derivatives!;
    expect(w.x).toBe(5000);
  });

  it("recale contre une origine de workspace non nulle", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().moveWindow("derivatives", 0, 0);
    windowManagerStore.getState().reclampAll({ x: 200, y: 100, width: 1000, height: 800 });
    const w = windowManagerStore.getState().windows.derivatives!;
    expect(w.x).toBeGreaterThanOrEqual(200);
    expect(w.y).toBeGreaterThanOrEqual(100);
  });
});

describe("setWorkspace", () => {
  it("met à jour l'état workspace ET recale les fenêtres ouvertes", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().moveWindow("derivatives", 1800, 100);
    windowManagerStore.getState().setWorkspace({ x: 0, y: 0, width: 500, height: 400 });
    expect(windowManagerStore.getState().workspace).toEqual({ x: 0, y: 0, width: 500, height: 400 });
    const w = windowManagerStore.getState().windows.derivatives!;
    expect(w.x + w.width).toBeLessThanOrEqual(500);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/store/windowManager.test.ts -t "reclampAll|setWorkspace"`
Expected: FAIL — `setWorkspace is not a function`, et `reclampAll`/`openWindow` encore sur l'ancienne signature (le fichier source n'est pas encore modifié).

- [ ] **Step 4: Mettre à jour `WindowManagerState` et le store**

Dans `apps/web/src/store/windowManager.ts`, dans `export interface WindowManagerState { ... }`, ajouter le champ `workspace` (à côté de `dragPreview`) :

```ts
  /** Zone de travail actuelle (rect du conteneur du graphe, exclut toolbar/barre de
   * dessin/panneau latéral) — mesurée par App.tsx via ResizeObserver, jamais persistée
   * (recalculée à chaque montage). Référentiel de TOUT le placement/redimensionnement/
   * snap des fenêtres flottantes, à la place de window.innerWidth/innerHeight. */
  workspace: WorkspaceRect;
```

et changer la signature de `reclampAll`, en ajoutant `setWorkspace` juste après :

```ts
  reclampAll: (workspace: WorkspaceRect) => void;
  setDragPreview: (preview: { x: number; y: number; width: number; height: number } | null) => void;
  setWorkspace: (workspace: WorkspaceRect) => void;
```

Dans le corps du store (`createStore<WindowManagerState>((set, get) => ({ ... }))`), ajouter l'état initial `workspace: { x: 0, y: 0, width: 1920, height: 1080 },` à côté de `dragPreview: null,` (valeur de repli avant la première mesure par `App.tsx` — ne lit jamais `window.*` au chargement du module, cohérent avec le reste du fichier).

Dans `openWindow`, remplacer l'appel à `cascadePosition` :

```ts
    const { x, y } = cascadePosition(openCount, state.workspace, width, height);
```

(au lieu de `cascadePosition(openCount, window.innerWidth, window.innerHeight, width, height)`).

Remplacer l'implémentation de `reclampAll` par :

```ts
  reclampAll: (workspace) => {
    const state = get();
    const next: Record<string, EtatFenetre> = {};
    let changed = false;
    for (const [id, w] of Object.entries(state.windows)) {
      if (!w.open) {
        next[id] = w;
        continue;
      }
      const size = clampSize(w.width, w.height, MIN_WIDTH, MIN_HEIGHT, workspace);
      const pos = clampPosition(w.x, w.y, size.width, size.height, workspace);
      if (pos.x !== w.x || pos.y !== w.y || size.width !== w.width || size.height !== w.height) {
        changed = true;
        next[id] = { ...w, ...pos, ...size };
      } else {
        next[id] = w;
      }
    }
    if (changed) set({ windows: next });
  },
```

Ajouter `setWorkspace` juste après `setDragPreview` :

```ts
  setWorkspace: (workspace) => {
    set({ workspace });
    get().reclampAll(workspace);
  },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/store/windowManager.test.ts`
Expected: PASS — l'intégralité du fichier de test (toutes les descriptions, y compris `openWindow`/z-order/`WINDOW_REGISTRY` inchangées).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/store/windowManager.ts apps/web/src/store/windowManager.test.ts
git commit -m "feat(window-manager): état workspace + setWorkspace, reclampAll/openWindow migrés"
```

---

### Task 3: `FloatingWindow.tsx` — drag et resize lisent le workspace

**Files:**
- Modify: `apps/web/src/components/FloatingWindow.tsx`

**Interfaces:**
- Consumes: `windowManagerStore.getState().workspace` (Task 2), `clampPosition`, `clampSize`, `detectSnapZone`, `snapGeometry` avec leurs nouvelles signatures (Task 1).
- Produces: rien de consommé par une tâche suivante — comportement terminal du drag/resize.

- [ ] **Step 1: Lire le fichier actuel pour confirmer `demarrerDrag`/`demarrerResize`**

Ouvrir `apps/web/src/components/FloatingWindow.tsx` et repérer les fonctions `demarrerDrag` et `demarrerResize` — le contenu ci-dessous part de leur état connu au moment de la rédaction de ce plan (aucun changement d'import n'est nécessaire : `clampPosition`, `clampSize`, `detectSnapZone`, `snapGeometry`, `MIN_WIDTH`, `MIN_HEIGHT`, `windowManagerStore`, `type SnapZone` sont déjà importés depuis `../store/windowManager`).

- [ ] **Step 2: Remplacer `demarrerDrag`**

```tsx
  const demarrerDrag = (e: React.PointerEvent): void => {
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    e.preventDefault();
    focus();
    const depart = { x: e.clientX, y: e.clientY, wx: etat.x, wy: etat.y };
    let dernierePosition = { x: depart.wx, y: depart.wy };
    let derniereZone: SnapZone | null = null;
    const onMove = (ev: PointerEvent): void => {
      const workspace = windowManagerStore.getState().workspace;
      const dx = ev.clientX - depart.x;
      const dy = ev.clientY - depart.y;
      const { x, y } = clampPosition(depart.wx + dx, depart.wy + dy, etat.width, etat.height, workspace);
      dernierePosition = { x, y };
      if (rootRef.current) {
        rootRef.current.style.left = `${x}px`;
        rootRef.current.style.top = `${y}px`;
      }
      const zone = detectSnapZone(ev.clientX, ev.clientY, workspace);
      if (zone !== derniereZone) {
        derniereZone = zone;
        windowManagerStore.getState().setDragPreview(zone ? snapGeometry(zone, workspace) : null);
      }
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (derniereZone) {
        const geo = snapGeometry(derniereZone, windowManagerStore.getState().workspace);
        windowManagerStore.getState().moveWindow(id, geo.x, geo.y);
        windowManagerStore.getState().resizeWindow(id, geo.width, geo.height);
      } else {
        windowManagerStore.getState().moveWindow(id, dernierePosition.x, dernierePosition.y);
      }
      windowManagerStore.getState().setDragPreview(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
```

Changements vs l'existant : `window.innerWidth`/`window.innerHeight` → `windowManagerStore.getState().workspace` (relu à chaque `pointermove`, pas figé au `pointerdown`, pour suivre un éventuel changement de workspace en cours de drag — ex. bascule plein écran au clavier pendant le drag) ; `clampPosition` reçoit désormais `etat.height` en 4ème argument (nouvelle signature Task 1).

- [ ] **Step 3: Remplacer `demarrerResize`**

```tsx
  const demarrerResize = (poignee: (typeof POIGNEES)[number]): ((e: React.PointerEvent) => void) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    focus();
    const depart = { x: e.clientX, y: e.clientY, w: etat.width, h: etat.height, wx: etat.x, wy: etat.y };
    let dernierEtat = { width: depart.w, height: depart.h, x: depart.wx, y: depart.wy };
    const onMove = (ev: PointerEvent): void => {
      const workspace = windowManagerStore.getState().workspace;
      const dx = ev.clientX - depart.x;
      const dy = ev.clientY - depart.y;
      const largeurBrute = depart.w + poignee.dw * dx;
      const hauteurBrute = depart.h + poignee.dh * dy;
      const { width, height } = clampSize(largeurBrute, hauteurBrute, MIN_WIDTH, MIN_HEIGHT, workspace);
      const xBrut = poignee.dx ? depart.wx + (depart.w - width) : depart.wx;
      const yBrut = poignee.dy ? depart.wy + (depart.h - height) : depart.wy;
      // Confinement strict : la poignée "w"/"n"/"nw"… peut recalculer x/y au-delà du
      // bord du workspace quand la taille brute demandée dépasse ce qui est disponible
      // de ce côté — clampPosition (appliqué à width/height déjà cohérents) referme
      // systématiquement l'écart, quelle que soit la poignée utilisée.
      const { x, y } = clampPosition(xBrut, yBrut, width, height, workspace);
      dernierEtat = { width, height, x, y };
      if (rootRef.current) {
        rootRef.current.style.width = `${width}px`;
        rootRef.current.style.height = `${height}px`;
        rootRef.current.style.left = `${x}px`;
        rootRef.current.style.top = `${y}px`;
      }
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      windowManagerStore.getState().resizeWindow(id, dernierEtat.width, dernierEtat.height);
      windowManagerStore.getState().moveWindow(id, dernierEtat.x, dernierEtat.y);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
```

Changements vs l'existant : `window.innerWidth`/`window.innerHeight` → `workspace` ; ajout de l'appel `clampPosition` après le calcul par poignée (nouveau — nécessaire pour le confinement strict, cf. commentaire dans le code) ; `onUp` appelle désormais `moveWindow` **inconditionnellement** (au lieu de `if (poignee.dx || poignee.dy)`) puisque `x`/`y` sont maintenant TOUJOURS recalculés par le clamp — pour une poignée qui ne déplace pas l'origine (ex. "e"), `xBrut`/`yBrut` valent `depart.wx`/`depart.wy` (déjà dans le workspace par invariant), donc `moveWindow` est un no-op inoffensif dans ce cas, pas une régression.

- [ ] **Step 4: Vérification manuelle — reportée**

Ce fichier n'a pas de test automatisé (composant, convention du repo). La vérification interactive (drag/resize contre chaque bord du workspace, confirmation qu'aucune fenêtre ne peut plus chevaucher la toolbar/le panneau) est effectuée par le contrôleur après la Task 4 (une fois `App.tsx` branché sur le vrai `ResizeObserver` — avant ça, `workspace` resterait à sa valeur de repli 1920×1080 et ne refléterait pas la vraie disposition de l'app).

- [ ] **Step 5: Confirmer que le fichier compile et que la suite de tests existante ne régresse pas**

Run (depuis `apps/web/`) : `npx vitest run` et `pnpm -r typecheck` (depuis la racine du repo). Ce composant n'a pas ses propres tests, mais une erreur de type ici ferait échouer `pnpm -r typecheck` globalement — confirmer que ce n'est pas le cas.
Expected: `pnpm -r typecheck` → 0 erreur sur les 6 projets ; `vitest run` → même nombre de tests qu'avant cette tâche (aucun nouveau test dans cette tâche, aucune régression attendue).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/FloatingWindow.tsx
git commit -m "feat(window-manager): drag/resize confinés au workspace (plus au viewport navigateur)"
```

---

### Task 4: `App.tsx` — `ResizeObserver` sur la zone de graphe, remplace le listener `resize`

**Files:**
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `windowManagerStore.getState().setWorkspace(workspace)` (Task 2).
- Produces: rien de consommé par une tâche suivante — comportement terminal.

- [ ] **Step 1: Lire le fichier actuel pour confirmer l'effet `resize` et le div du `ChartGrid`**

Ouvrir `apps/web/src/App.tsx` et repérer : l'import React en tête de fichier (`import { useEffect } from "react";`), l'effet actuel qui écoute `window.addEventListener("resize", ...)` et appelle `windowManagerStore.getState().reclampAll(window.innerWidth, window.innerHeight)`, et le div `<div className="min-w-0 flex-1"><ChartGrid /></div>` dans le JSX (à l'intérieur de `<main>`, entre `{!plein && <DrawingToolbar />}` et l'`<aside>`).

- [ ] **Step 2: Étendre l'import React**

```tsx
import { useEffect, useRef } from "react";
```

(au lieu de `import { useEffect } from "react";`)

- [ ] **Step 3: Ajouter le ref, juste après les hooks `useStore` existants dans le corps de `App()`**

```tsx
  const chartAreaRef = useRef<HTMLDivElement>(null);
```

(à ajouter juste après `const plein = useStore(fullscreenStore, (s) => s.plein);`)

- [ ] **Step 4: Remplacer l'effet `resize` par le `ResizeObserver`**

Remplacer l'effet actuel (`// Recalage des fenêtres flottantes au resize du navigateur…` jusqu'à son `}, []);`) par :

```tsx
  // Zone de travail des fenêtres flottantes = la zone du graphe (exclut toolbar/barre
  // de dessin/panneau latéral) — mesurée sur ce div, PAS sur window.innerWidth/innerHeight.
  // Un seul ResizeObserver capture aussi bien le resize du navigateur QUE le bascule
  // plein écran (qui démonte/remonte la toolbar et le panneau, changeant la taille de
  // ce div) — un seul point d'entrée au lieu d'un listener par déclencheur. Débounce
  // 150ms conservé (même esprit que l'ancien listener resize).
  useEffect(() => {
    const el = chartAreaRef.current;
    if (!el) return;
    let minuteur: ReturnType<typeof setTimeout> | undefined;
    const mesurer = (): void => {
      const rect = el.getBoundingClientRect();
      windowManagerStore.getState().setWorkspace({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    };
    mesurer();
    const observer = new ResizeObserver(() => {
      if (minuteur !== undefined) clearTimeout(minuteur);
      minuteur = setTimeout(mesurer, 150);
    });
    observer.observe(el);
    return () => {
      if (minuteur !== undefined) clearTimeout(minuteur);
      observer.disconnect();
    };
  }, []);
```

- [ ] **Step 5: Attacher le ref au div du `ChartGrid`**

```tsx
        <div ref={chartAreaRef} className="min-w-0 flex-1">
          <ChartGrid />
        </div>
```

(au lieu de `<div className="min-w-0 flex-1">`)

- [ ] **Step 6: `pnpm -r typecheck` et suite de tests complète**

Run (depuis la racine) : `pnpm -r typecheck`
Expected: 0 erreur sur les 6 projets.

Run (depuis `apps/web/`) : `npx vitest run`
Expected: PASS, même décompte que fin de Task 2 (aucun nouveau test dans cette tâche — composant sans test automatisé, convention du repo).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat(window-manager): ResizeObserver sur la zone de graphe, remplace le listener resize navigateur"
```

---

### Task 5: Vérification manuelle navigateur (contrôleur)

Cette tâche n'a pas de sous-agent dédié — le contrôleur (session principale) l'exécute lui-même après la Task 4, avec `pnpm dev` et un navigateur réel (ex. via chrome-devtools-mcp/Playwright), en couvrant :

1. **Ouvrir plusieurs fenêtres** (ex. ECO, RATE) et confirmer qu'aucune, à l'ouverture (cascade), ne chevauche la toolbar ni le panneau latéral.
2. **Glisser une fenêtre vers chaque bord** (gauche/droite/haut) — confirmer que l'aperçu de snap ET la géométrie finale s'arrêtent exactement à la bordure du graphe (pas de la fenêtre navigateur), sans jamais recouvrir la toolbar ni le panneau.
3. **Redimensionner une fenêtre depuis chaque poignée** (bords ET coins), y compris en tirant délibérément au-delà de la zone de graphe — confirmer qu'elle reste toujours entièrement dans le workspace.
4. **Rétrécir la fenêtre du navigateur** avec des fenêtres ouvertes près des bords — confirmer le recalage contre le NOUVEAU rect du graphe (pas le viewport brut).
5. **Basculer plein écran (touche F ou ⌘/Ctrl+Shift+F selon les raccourcis existants)** avec une fenêtre ouverte — confirmer qu'elle peut alors utiliser tout l'écran (toolbar/panneau démontés → workspace = viewport complet), puis revenir en mode normal et confirmer qu'elle se recale automatiquement en dehors de la zone maintenant occupée par la toolbar/le panneau si nécessaire.
6. Capturer une régression éventuelle sur les fonctionnalités déjà vérifiées lors du lot précédent (poignées élargies, overlay de snap theme-aware) — pas de nouveau test dédié, juste confirmer l'absence de régression visuelle.

Aucun commit dédié à cette tâche (vérification uniquement) — si un bug est trouvé, le corriger dans un commit de fix séparé avant de considérer le lot terminé.
