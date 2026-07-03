# Fenêtres responsives + snap façon Aero — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le gestionnaire de fenêtres flottantes AXIOM (`store/windowManager.ts` + `components/FloatingWindow.tsx`) se recale automatiquement quand le navigateur change de taille, a des poignées de resize plus faciles à attraper, et supporte le snap façon Windows Aero (glisser vers un bord = moitié gauche/droite ou plein écran).

**Architecture:** Trois ajouts indépendants au store existant (`reclampAll`, `dragPreview`+`setDragPreview`, `detectSnapZone`/`snapGeometry` — toutes des fonctions pures ou actions Zustand testables sans DOM, même pattern que `clampPosition`/`clampSize` déjà en place) + wiring dans `FloatingWindow.tsx` (drag existant) et `App.tsx` (nouveau listener resize + nouveau composant `SnapOverlay`).

**Tech Stack:** React 19, Zustand (store vanilla), Tailwind, Vitest (environnement `node`, pas de jsdom — tests de store uniquement, aucun test `.tsx` dans ce repo).

## Global Constraints

- Commentaires et identifiants de fonctions/variables en **français**, cohérent avec tout le fichier `windowManager.ts`/`FloatingWindow.tsx` existant.
- Aucune nouvelle dépendance npm.
- Les fonctions géométriques doivent rester **pures** (pas de lecture de `window.*` à l'intérieur) — c'est l'appelant (composant React) qui injecte `window.innerWidth`/`window.innerHeight`, exactement comme `clampPosition`/`clampSize` aujourd'hui.
- Tests dans `apps/web/src/store/windowManager.test.ts` (fichier existant, pas de nouveau fichier de test) — environnement `node`, `vi.stubGlobal("window", { innerWidth, innerHeight })` déjà en place dans un `beforeEach` du fichier.
- Aucun test `.tsx` pour les composants (convention du repo) — vérification manuelle navigateur pour tout ce qui touche `FloatingWindow.tsx`/`App.tsx`/`SnapOverlay.tsx`.
- Commande de test : `pnpm test` (= `vitest run`) depuis `apps/web/` (workspace pnpm, PAS npm).

---

### Task 1: `reclampAll` — recalage automatique de toutes les fenêtres

**Files:**
- Modify: `apps/web/src/store/windowManager.ts`
- Test: `apps/web/src/store/windowManager.test.ts`

**Interfaces:**
- Consumes: `clampPosition(x, y, width, viewportWidth, viewportHeight)`, `clampSize(width, height, minWidth, minHeight, viewportWidth, viewportHeight)`, `MIN_WIDTH`, `MIN_HEIGHT` — tous déjà exportés dans `windowManager.ts`.
- Produces: `reclampAll(viewportWidth: number, viewportHeight: number): void` sur `WindowManagerState`, utilisé par Task 2.

- [ ] **Step 1: Write the failing tests**

Dans `apps/web/src/store/windowManager.test.ts`, ajouter après le `describe("setAll", ...)` existant :

```ts
describe("reclampAll", () => {
  it("recale une fenêtre devenue hors-écran après rétrécissement du viewport", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().moveWindow("derivatives", 1800, 100);
    windowManagerStore.getState().reclampAll(1000, 800);
    const w = windowManagerStore.getState().windows.derivatives!;
    expect(w.x).toBeLessThanOrEqual(1000 - 40);
  });

  it("ne touche pas une fenêtre déjà dans les bornes", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().moveWindow("derivatives", 100, 100);
    const before = windowManagerStore.getState().windows.derivatives!;
    windowManagerStore.getState().reclampAll(1920, 1080);
    const after = windowManagerStore.getState().windows.derivatives!;
    expect(after).toEqual(before);
  });

  it("ignore les fenêtres fermées (ne les recadre pas)", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().moveWindow("derivatives", 5000, 100);
    windowManagerStore.getState().closeWindow("derivatives");
    windowManagerStore.getState().reclampAll(800, 600);
    const w = windowManagerStore.getState().windows.derivatives!;
    expect(w.x).toBe(5000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (depuis `apps/web/`) : `npx vitest run src/store/windowManager.test.ts -t reclampAll`
Expected: FAIL avec `windowManagerStore.getState().reclampAll is not a function`.

- [ ] **Step 3: Implement `reclampAll`**

Dans `apps/web/src/store/windowManager.ts`, ajouter à l'interface `WindowManagerState` (juste après `setAll`) :

```ts
  /** Recale position/taille de toutes les fenêtres OUVERTES contre un nouveau viewport
   * (déclenché par un resize du navigateur, cf. App.tsx) — même clamp pur que le
   * drag/resize interactif, appliqué en lot. */
  reclampAll: (viewportWidth: number, viewportHeight: number) => void;
```

Puis dans le corps du store (juste après l'implémentation de `setAll`) :

```ts
  reclampAll: (viewportWidth, viewportHeight) => {
    const state = get();
    const next: Record<string, EtatFenetre> = {};
    let changed = false;
    for (const [id, w] of Object.entries(state.windows)) {
      if (!w.open) {
        next[id] = w;
        continue;
      }
      const pos = clampPosition(w.x, w.y, w.width, viewportWidth, viewportHeight);
      const size = clampSize(w.width, w.height, MIN_WIDTH, MIN_HEIGHT, viewportWidth, viewportHeight);
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/store/windowManager.test.ts -t reclampAll`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full store test file to check no regression**

Run: `npx vitest run src/store/windowManager.test.ts`
Expected: PASS (tous les tests existants + les 3 nouveaux).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/store/windowManager.ts apps/web/src/store/windowManager.test.ts
git commit -m "feat(window-manager): reclampAll pour recaler les fenêtres au resize navigateur"
```

---

### Task 2: Listener resize navigateur (App.tsx)

**Files:**
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `windowManagerStore.getState().reclampAll(viewportWidth, viewportHeight)` (Task 1).
- Produces: rien de consommé par une tâche suivante — comportement terminal (effet de bord au resize).

- [ ] **Step 1: Étendre l'import existant de `windowManager.ts`**

Dans `apps/web/src/App.tsx`, remplacer la ligne d'import existante :

```ts
import { WINDOW_REGISTRY } from "./store/windowManager";
```

par :

```ts
import { WINDOW_REGISTRY, windowManagerStore } from "./store/windowManager";
```

- [ ] **Step 2: Ajouter le listener debounced**

Juste après le `useEffect` existant de `demarrerAlertes` (celui qui se termine par `}, []);` autour de la ligne 151), ajouter :

```tsx
  // Recalage des fenêtres flottantes au resize du navigateur — débounce 150ms pour
  // éviter un flot de set() pendant un drag continu de la bordure du navigateur.
  useEffect(() => {
    let minuteur: ReturnType<typeof setTimeout> | undefined;
    const onResize = (): void => {
      if (minuteur !== undefined) clearTimeout(minuteur);
      minuteur = setTimeout(() => {
        windowManagerStore.getState().reclampAll(window.innerWidth, window.innerHeight);
      }, 150);
    };
    window.addEventListener("resize", onResize);
    return () => {
      if (minuteur !== undefined) clearTimeout(minuteur);
      window.removeEventListener("resize", onResize);
    };
  }, []);
```

- [ ] **Step 3: Vérification manuelle navigateur**

Lancer `pnpm dev` depuis `apps/web/`, ouvrir 2-3 fenêtres flottantes (ex. ECO, NEWS) via `⌘K`, les positionner près du bord droit/bas. Rétrécir la fenêtre du navigateur (ou la barre latérale via devtools responsive) : après ~150ms, les fenêtres doivent se recaler dans le nouveau viewport sans rester hors-écran. Ré-agrandir le navigateur : les fenêtres ne doivent PAS revenir à leur position d'avant (le recalage est one-way, pas un undo — comportement attendu).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat(window-manager): recaler les fenêtres flottantes au resize du navigateur"
```

---

### Task 3: Poignées de resize élargies

**Files:**
- Modify: `apps/web/src/components/FloatingWindow.tsx`

**Interfaces:**
- Consumes: rien (tweak CSS pur sur `POIGNEES`, tableau déjà existant).
- Produces: rien.

- [ ] **Step 1: Élargir les 4 poignées de bord**

Dans `apps/web/src/components/FloatingWindow.tsx`, dans le tableau `POIGNEES`, remplacer les 4 entrées de bord (`e`, `w`, `s`, `n`) — les 4 entrées de coin (`se`, `sw`, `ne`, `nw`, déjà `h-3 w-3`) restent inchangées :

```ts
const POIGNEES: { id: PoigneeResize; className: string; dw: number; dh: number; dx: number; dy: number }[] = [
  { id: "e", className: "right-0 top-2 bottom-2 w-3 cursor-ew-resize", dw: 1, dh: 0, dx: 0, dy: 0 },
  { id: "w", className: "left-0 top-2 bottom-2 w-3 cursor-ew-resize", dw: -1, dh: 0, dx: 1, dy: 0 },
  { id: "s", className: "bottom-0 left-2 right-2 h-3 cursor-ns-resize", dw: 0, dh: 1, dx: 0, dy: 0 },
  { id: "n", className: "top-0 left-2 right-2 h-3 cursor-ns-resize", dw: 0, dh: -1, dx: 0, dy: 1 },
  { id: "se", className: "right-0 bottom-0 h-3 w-3 cursor-nwse-resize", dw: 1, dh: 1, dx: 0, dy: 0 },
  { id: "sw", className: "left-0 bottom-0 h-3 w-3 cursor-nesw-resize", dw: -1, dh: 1, dx: 1, dy: 0 },
  { id: "ne", className: "right-0 top-0 h-3 w-3 cursor-nesw-resize", dw: 1, dh: -1, dx: 0, dy: 1 },
  { id: "nw", className: "left-0 top-0 h-3 w-3 cursor-nwse-resize", dw: -1, dh: -1, dx: 1, dy: 1 },
];
```

(seul changement : `w-1.5`→`w-3` sur `e`/`w`, `h-1.5`→`h-3` sur `s`/`n` — passe la hitbox de 6px à 12px ; ces divs n'ont pas de couleur de fond visible, donc l'agrandissement est purement fonctionnel, aucun changement visuel.)

- [ ] **Step 2: Vérification manuelle navigateur**

`pnpm dev`, ouvrir une fenêtre flottante, survoler puis attraper chaque bord (pas seulement les coins) : le curseur `resize` doit apparaître sur une zone sensiblement plus large qu'avant, sans qu'aucun liseré visuel supplémentaire n'apparaisse.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/FloatingWindow.tsx
git commit -m "fix(window-manager): élargir la hitbox des poignées de resize (bords)"
```

---

### Task 4: `detectSnapZone` + `snapGeometry` (primitives pures)

**Files:**
- Modify: `apps/web/src/store/windowManager.ts`
- Test: `apps/web/src/store/windowManager.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `type SnapZone = "left" | "right" | "top"`, `detectSnapZone(cursorX, cursorY, viewportWidth, viewportHeight): SnapZone | null`, `snapGeometry(zone: SnapZone, viewportWidth, viewportHeight): { x, y, width, height }` — utilisés par Task 5 (état) et Task 6 (wiring drag).

- [ ] **Step 1: Write the failing tests**

Dans `apps/web/src/store/windowManager.test.ts`, mettre à jour l'import en haut du fichier pour inclure les deux nouvelles fonctions :

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
} from "./windowManager";
```

Puis ajouter (après le `describe("clampSize", ...)` existant, avant `describe("WINDOW_REGISTRY", ...)`) :

```ts
describe("detectSnapZone", () => {
  it("détecte le bord gauche (cursorX < 8)", () => {
    expect(detectSnapZone(4, 500, 1920, 1080)).toBe("left");
  });

  it("détecte le bord droit (cursorX > viewportWidth - 8)", () => {
    expect(detectSnapZone(1917, 500, 1920, 1080)).toBe("right");
  });

  it("détecte le bord haut (cursorY < 8), prioritaire sur gauche/droite", () => {
    expect(detectSnapZone(4, 4, 1920, 1080)).toBe("top");
  });

  it("retourne null hors des zones de bord", () => {
    expect(detectSnapZone(960, 500, 1920, 1080)).toBeNull();
  });
});

describe("snapGeometry", () => {
  it('"left" -> moitié gauche pleine hauteur', () => {
    expect(snapGeometry("left", 1920, 1080)).toEqual({ x: 0, y: 0, width: 960, height: 1080 });
  });

  it('"right" -> moitié droite pleine hauteur', () => {
    expect(snapGeometry("right", 1920, 1080)).toEqual({ x: 960, y: 0, width: 960, height: 1080 });
  });

  it('"top" -> plein viewport', () => {
    expect(snapGeometry("top", 1920, 1080)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/store/windowManager.test.ts -t "detectSnapZone|snapGeometry"`
Expected: FAIL — `detectSnapZone`/`snapGeometry` non exportés (erreur d'import ou `is not a function`).

- [ ] **Step 3: Implement**

Dans `apps/web/src/store/windowManager.ts`, ajouter juste après la définition de `clampSize` (avant `export interface WindowManagerState`) :

```ts
/** Zone de snap façon Aero — uniquement les bords (pas les coins/quarts dans ce lot). */
export type SnapZone = "left" | "right" | "top";

/** Distance au bord (px) déclenchant une zone de snap pendant un drag d'en-tête. */
const SNAP_EDGE_PX = 8;

/** Détecte la zone de snap active pour une position de curseur donnée. `null` hors zone.
 * Le bord haut est prioritaire (testé en premier) : un curseur dans le coin haut-gauche
 * déclenche "top" (plein écran), pas "left". */
export function detectSnapZone(
  cursorX: number,
  cursorY: number,
  viewportWidth: number,
  viewportHeight: number
): SnapZone | null {
  if (cursorY < SNAP_EDGE_PX) return "top";
  if (cursorX < SNAP_EDGE_PX) return "left";
  if (cursorX > viewportWidth - SNAP_EDGE_PX) return "right";
  return null;
}

/** Géométrie cible pour une zone de snap (moitié gauche/droite pleine hauteur, ou plein
 * viewport pour "top" — équivalent maximize). */
export function snapGeometry(
  zone: SnapZone,
  viewportWidth: number,
  viewportHeight: number
): { x: number; y: number; width: number; height: number } {
  if (zone === "left") return { x: 0, y: 0, width: viewportWidth / 2, height: viewportHeight };
  if (zone === "right") return { x: viewportWidth / 2, y: 0, width: viewportWidth / 2, height: viewportHeight };
  return { x: 0, y: 0, width: viewportWidth, height: viewportHeight };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/store/windowManager.test.ts -t "detectSnapZone|snapGeometry"`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/store/windowManager.ts apps/web/src/store/windowManager.test.ts
git commit -m "feat(window-manager): détection de zone + géométrie de snap (bords)"
```

---

### Task 5: `dragPreview` — état éphémère de l'aperçu de snap

**Files:**
- Modify: `apps/web/src/store/windowManager.ts`
- Test: `apps/web/src/store/windowManager.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: champ `dragPreview: { x, y, width, height } | null` sur `WindowManagerState`, action `setDragPreview(preview)`. Utilisés par Task 6 (écriture) et Task 7 (lecture, `SnapOverlay`).

- [ ] **Step 1: Write the failing test**

Dans `apps/web/src/store/windowManager.test.ts`, ajouter un nouveau `describe` juste après le `describe("reclampAll", ...)` ajouté en Task 1 (regroupe les tests d'actions du store — `setGroup`/`setGroupSymbol`/`setAll`/`reclampAll` — plutôt qu'au milieu des fonctions géométriques pures) :

```ts
describe("setDragPreview", () => {
  it("définit puis efface l'aperçu de snap", () => {
    windowManagerStore.getState().setDragPreview({ x: 0, y: 0, width: 960, height: 1080 });
    expect(windowManagerStore.getState().dragPreview).toEqual({ x: 0, y: 0, width: 960, height: 1080 });
    windowManagerStore.getState().setDragPreview(null);
    expect(windowManagerStore.getState().dragPreview).toBeNull();
  });
});
```

Mettre aussi à jour le `beforeEach` de réinitialisation en tête de fichier pour inclure le nouveau champ (évite une fuite d'état entre tests) :

```ts
beforeEach(() => {
  windowManagerStore.setState({ windows: {}, nextZ: 1, groupSymbols: {}, dragPreview: null });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/windowManager.test.ts -t setDragPreview`
Expected: FAIL — `setDragPreview is not a function`.

- [ ] **Step 3: Implement**

Dans `apps/web/src/store/windowManager.ts`, ajouter à l'interface `WindowManagerState` (avec les autres champs d'état, à côté de `groupSymbols`) :

```ts
  /** Aperçu de snap actif pendant un drag d'en-tête (géométrie cible de la zone
   * survolée) — état ÉPHÉMÈRE, jamais persisté (persist.ts construit explicitement
   * le sous-ensemble sauvegardé, ce champ n'y figure simplement pas). */
  dragPreview: { x: number; y: number; width: number; height: number } | null;
```

et l'action juste en dessous des autres actions de l'interface :

```ts
  setDragPreview: (preview: { x: number; y: number; width: number; height: number } | null) => void;
```

Dans le corps du store, ajouter `dragPreview: null,` à côté de `groupSymbols: {},` (état initial), et l'action à côté de `setGroupSymbol` :

```ts
  setDragPreview: (preview) => set({ dragPreview: preview }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/store/windowManager.test.ts`
Expected: PASS (tous les tests, y compris le nouveau).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/store/windowManager.ts apps/web/src/store/windowManager.test.ts
git commit -m "feat(window-manager): état dragPreview pour l'aperçu de snap"
```

---

### Task 6: Wiring du snap dans le drag de l'en-tête

**Files:**
- Modify: `apps/web/src/components/FloatingWindow.tsx`

**Interfaces:**
- Consumes: `detectSnapZone`, `snapGeometry`, `type SnapZone` (Task 4) ; `windowManagerStore.getState().setDragPreview` (Task 5) ; `moveWindow`/`resizeWindow` (déjà existants).
- Produces: rien de consommé par une tâche suivante (comportement terminal du drag).

- [ ] **Step 1: Étendre l'import du store**

Dans `apps/web/src/components/FloatingWindow.tsx`, remplacer :

```ts
import {
  windowManagerStore,
  clampPosition,
  clampSize,
  MIN_WIDTH,
  MIN_HEIGHT,
  GROUP_PALETTE,
} from "../store/windowManager";
```

par :

```ts
import {
  windowManagerStore,
  clampPosition,
  clampSize,
  detectSnapZone,
  snapGeometry,
  MIN_WIDTH,
  MIN_HEIGHT,
  GROUP_PALETTE,
  type SnapZone,
} from "../store/windowManager";
```

- [ ] **Step 2: Réécrire `demarrerDrag`**

Remplacer la fonction `demarrerDrag` existante par :

```ts
  const demarrerDrag = (e: React.PointerEvent): void => {
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    e.preventDefault();
    focus();
    const depart = { x: e.clientX, y: e.clientY, wx: etat.x, wy: etat.y };
    let dernierePosition = { x: depart.wx, y: depart.wy };
    let derniereZone: SnapZone | null = null;
    const onMove = (ev: PointerEvent): void => {
      const dx = ev.clientX - depart.x;
      const dy = ev.clientY - depart.y;
      const { x, y } = clampPosition(depart.wx + dx, depart.wy + dy, etat.width, window.innerWidth, window.innerHeight);
      dernierePosition = { x, y };
      if (rootRef.current) {
        rootRef.current.style.left = `${x}px`;
        rootRef.current.style.top = `${y}px`;
      }
      const zone = detectSnapZone(ev.clientX, ev.clientY, window.innerWidth, window.innerHeight);
      if (zone !== derniereZone) {
        derniereZone = zone;
        windowManagerStore
          .getState()
          .setDragPreview(zone ? snapGeometry(zone, window.innerWidth, window.innerHeight) : null);
      }
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (derniereZone) {
        const geo = snapGeometry(derniereZone, window.innerWidth, window.innerHeight);
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

- [ ] **Step 3: Vérification manuelle navigateur**

`pnpm dev`, ouvrir une fenêtre flottante, glisser son en-tête vers le bord gauche de l'écran (curseur à moins de 8px du bord) : rien de visible pour l'instant (l'aperçu arrive à la Task 7) mais au relâchement la fenêtre doit occuper exactement la moitié gauche de l'écran. Répéter à droite (moitié droite) et en haut (plein écran). Glisser sans toucher un bord : comportement de drag libre inchangé (pas de régression).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/FloatingWindow.tsx
git commit -m "feat(window-manager): appliquer le snap au relâchement du drag d'en-tête"
```

---

### Task 7: `SnapOverlay` — aperçu visuel pendant le drag

**Files:**
- Create: `apps/web/src/components/SnapOverlay.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `windowManagerStore.dragPreview` (Task 5, via `useStore`).
- Produces: rien.

- [ ] **Step 1: Créer `SnapOverlay.tsx`**

```tsx
/**
 * Aperçu semi-transparent affiché pendant le drag d'une fenêtre vers un bord (snap
 * façon Aero). Rendu CENTRALISÉ (monté une fois dans App.tsx, pas dans FloatingWindow)
 * pour garantir un z-index au-dessus de TOUTES les fenêtres quelle que soit celle en
 * cours de drag. Piloté par `windowManagerStore.dragPreview` (éphémère, non persisté).
 */
import { useStore } from "zustand";
import { windowManagerStore } from "../store/windowManager";

export function SnapOverlay() {
  const preview = useStore(windowManagerStore, (s) => s.dragPreview);
  if (!preview) return null;
  return (
    <div
      className="pointer-events-none fixed z-[9999] rounded border-2 border-accent bg-accent/20"
      style={{ left: preview.x, top: preview.y, width: preview.width, height: preview.height }}
    />
  );
}
```

- [ ] **Step 2: Monter `SnapOverlay` dans `App.tsx`**

Ajouter l'import à côté de celui de `TaskbarMinimized` :

```ts
import { TaskbarMinimized } from "./components/TaskbarMinimized";
import { SnapOverlay } from "./components/SnapOverlay";
```

Puis, dans le JSX, ajouter `<SnapOverlay />` juste après la boucle `{WINDOW_REGISTRY.map(...)}` et avant `<TaskbarMinimized />` :

```tsx
      })}
      <SnapOverlay />
      <TaskbarMinimized />
```

- [ ] **Step 3: Vérification manuelle navigateur**

`pnpm dev`, glisser une fenêtre vers le bord gauche : un rectangle semi-transparent (couleur accent du thème actif) doit apparaître à l'emplacement de la moitié gauche de l'écran PENDANT le drag, et disparaître au relâchement (remplacé par la fenêtre elle-même qui a pris cette géométrie). Tester aussi bord droit et haut. Vérifier sur au moins 2 thèmes (`ThemeSwitcher`) que la couleur accent reste lisible.

- [ ] **Step 4: Run la suite complète de tests (non-régression finale)**

Run (depuis `apps/web/`) : `pnpm test`
Expected: PASS, aucune régression sur l'ensemble de la suite.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/SnapOverlay.tsx apps/web/src/App.tsx
git commit -m "feat(window-manager): aperçu visuel du snap pendant le drag"
```
