# Gestionnaire de fenêtres AXIOM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformer les 14 fenêtres Bloomberg dockées (exclusion mutuelle, position fixe) en fenêtres flottantes façon Launchpad (drag/resize/z-order/minimize/groupes liés par couleur), et rendre les panes d'indicateurs du chart directement fermables (croix) et réordonnables (drag) sans passer par le menu Indicateurs.

**Architecture:** Un store central `windowManagerStore` devient la source de vérité unique de la géométrie/état de toutes les fenêtres ; un composant chrome générique `<FloatingWindow>` enveloppe chacune des 14 fenêtres existantes (dont le contenu interne reste inchangé) ; les 14 stores `*UiStore` existants sont migrés pour déléguer à `windowManagerStore` tout en restant 100% rétro-compatibles avec leurs consommateurs actuels (mirroring). Côté chart, un nouveau contrôleur `PaneHeaders` (même pattern que les contrôleurs existants `ChartIndicators`/`OrderflowController`) ajoute un overlay DOM léger par pane séparé.

**Tech Stack:** React 18 + TypeScript strict + Zustand vanilla (hors render-loop) + KLineChart 9.8.12 + Tailwind. Aucune nouvelle dépendance.

## Global Constraints

- Commentaires et documentation en FRANÇAIS (préférence projet).
- TypeScript strict, `noUncheckedIndexedAccess` actif.
- AUCUNE nouvelle dépendance npm. Ne pas modifier les `package.json` existants.
- Pas de re-render React sur tick — toute donnée haute fréquence (drag/resize en cours) passe par des mutations DOM impératives ou des stores Zustand vanilla, jamais par du state React local à 60fps.
- Suivre les conventions de test existantes : vitest, fichiers `X.test.ts` à côté de `X.ts`, valeurs attendues expliquées en commentaire. Les fichiers qui intègrent directement une instance `Chart` de KLineChart (ex. `chart/indicators.ts`) ne sont PAS unit-testés dans ce projet (aucun mock de `Chart` n'existe) — vérification manuelle à la place (Chrome DevTools MCP), cohérent avec le reste du code.
- **Correction technique établie pendant la recherche de ce plan** (croisement context7 vs `node_modules/.pnpm/klinecharts@9.8.12/node_modules/klinecharts/dist/index.d.ts`, seule source faisant foi) : `PaneOptions` (utilisé par `createIndicator` ET `setPaneOptions`) a exactement les champs `{ id?, height?, minHeight?, dragEnabled?, position?: 'top'|'bottom', gap?, axisOptions? }` — **PAS de champ `order` ni `state`**. Conséquence : le réordonnancement des panes se fait par retrait + recréation dans le nouvel ordre (pas par un setter natif), et il n'y a PAS de minimize natif de pane (fonctionnalité abandonnée, hors périmètre).
- Commit après chaque tâche complétée et vérifiée.

---

## Task 1: `store/windowManager.ts` — modèle de données + helpers purs

**Files:**
- Create: `apps/web/src/store/windowManager.ts`
- Test: `apps/web/src/store/windowManager.test.ts`

**Interfaces:**
- Produces: `EtatFenetre { id, open, x, y, width, height, z, minimized, groupColor }`, `windowManagerStore` (Zustand vanilla store) avec actions `openWindow(id)`, `closeWindow(id)`, `toggleWindow(id)`, `focusWindow(id)`, `moveWindow(id,x,y)`, `resizeWindow(id,width,height)`, `minimizeWindow(id)`, `restoreWindow(id)`, `setGroup(id,color|null)`, `setGroupSymbol(color,symbol)`, `setAll(windows)`. Fonctions pures exportées `cascadePosition`, `clampPosition`, `clampSize`. Fonction `mirrorOpenState(id, target)`. Constante `WINDOW_REGISTRY` (14 entrées : id/title/mnemonic/defaultWidth/defaultHeight). Constante `GROUP_PALETTE` (réexport de `COMPARE_PALETTE`).

- [ ] **Step 1: Écrire les tests des fonctions pures géométriques**

```ts
// apps/web/src/store/windowManager.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import {
  cascadePosition,
  clampPosition,
  clampSize,
  windowManagerStore,
  WINDOW_REGISTRY,
  GROUP_PALETTE,
} from "./windowManager";

beforeEach(() => {
  windowManagerStore.setState({ windows: {}, nextZ: 1, groupSymbols: {} });
});

describe("cascadePosition", () => {
  it("place la 1ère fenêtre proche du coin haut-gauche (marge 48px)", () => {
    expect(cascadePosition(0, 1920, 1080, 480, 640)).toEqual({ x: 48, y: 48 });
  });

  it("décale chaque fenêtre suivante de 28px en diagonale", () => {
    expect(cascadePosition(1, 1920, 1080, 480, 640)).toEqual({ x: 76, y: 76 });
    expect(cascadePosition(2, 1920, 1080, 480, 640)).toEqual({ x: 104, y: 104 });
  });

  it("ne dépasse jamais le viewport moins la fenêtre et la marge", () => {
    // Viewport étroit : la position brute (index=10 -> 48+10*28=328) dépasserait
    // 1200 - 480 - 48 = 672 ? non ; on force un cas qui dépasse réellement.
    const { x, y } = cascadePosition(50, 600, 400, 480, 300);
    expect(x).toBeLessThanOrEqual(600 - 480 - 48);
    expect(y).toBeLessThanOrEqual(400 - 300 - 48);
  });
});

describe("clampPosition", () => {
  it("laisse une position déjà dans l'écran inchangée", () => {
    expect(clampPosition(100, 100, 480, 1920, 1080)).toEqual({ x: 100, y: 100 });
  });

  it("empêche l'en-tête de sortir par la gauche au-delà de -width+40px visibles", () => {
    // width=480, VISIBLE_MARGIN=40 -> minX = 40 - 480 = -440
    expect(clampPosition(-1000, 100, 480, 1920, 1080).x).toBe(-440);
  });

  it("empêche l'en-tête de sortir par la droite (garde 40px visibles)", () => {
    // maxX = viewportWidth - 40 = 1880
    expect(clampPosition(5000, 100, 480, 1920, 1080).x).toBe(1880);
  });

  it("empêche l'en-tête de sortir en haut (y >= 0)", () => {
    expect(clampPosition(100, -500, 480, 1920, 1080).y).toBe(0);
  });

  it("empêche l'en-tête de sortir en bas (garde 40px visibles)", () => {
    expect(clampPosition(100, 5000, 480, 1920, 1080).y).toBe(1080 - 40);
  });
});

describe("clampSize", () => {
  it("respecte les minimums", () => {
    expect(clampSize(100, 50, 320, 240, 1920, 1080)).toEqual({ width: 320, height: 240 });
  });

  it("ne dépasse pas le viewport", () => {
    expect(clampSize(5000, 5000, 320, 240, 1920, 1080)).toEqual({ width: 1920, height: 1080 });
  });

  it("laisse une taille valide inchangée", () => {
    expect(clampSize(600, 500, 320, 240, 1920, 1080)).toEqual({ width: 600, height: 500 });
  });
});

describe("WINDOW_REGISTRY", () => {
  it("contient exactement les 14 fenêtres attendues, sans doublon d'id ni de mnémonique", () => {
    expect(WINDOW_REGISTRY).toHaveLength(14);
    const ids = WINDOW_REGISTRY.map((w) => w.id);
    const mnemos = WINDOW_REGISTRY.map((w) => w.mnemonic);
    expect(new Set(ids).size).toBe(14);
    expect(new Set(mnemos).size).toBe(14);
  });
});

describe("GROUP_PALETTE", () => {
  it("réutilise la palette de comparaison existante (cohérence visuelle)", () => {
    expect(GROUP_PALETTE.length).toBeGreaterThanOrEqual(4);
  });
});
```

- [ ] **Step 2: Lancer les tests, vérifier qu'ils échouent (module inexistant)**

Run: `cd ~/axiom && pnpm --filter @axiom/web test -- src/store/windowManager.test.ts`
Expected: FAIL — `Cannot find module './windowManager'`

- [ ] **Step 3: Implémenter `store/windowManager.ts`**

```ts
// apps/web/src/store/windowManager.ts
/**
 * Gestionnaire de fenêtres flottantes AXIOM (« Launchpad ») — Zustand VANILLA, hors
 * render-loop React. Source de vérité UNIQUE de la géométrie/état (position, taille,
 * z-order, minimize, groupe de couleur) des 14 fenêtres Bloomberg non modales.
 *
 * Chaque fenêtre garde son propre store métier (`*UiStore`, ex. `derivativesUiStore`)
 * pour sa logique interne ; ces stores DÉLÈGUENT `open`/`close`/`toggle` ici via
 * `mirrorOpenState` (cf. store correspondant) pour rester 100% rétro-compatibles avec
 * leurs consommateurs existants (`useStore(derivativesUiStore, s => s.open)` continue
 * de fonctionner sans aucune modification des composants).
 *
 * Design des fonctions géométriques : PURES et exportées séparément des actions du
 * store, pour rester testables sans DOM (cf. windowManager.test.ts). Les actions du
 * store (qui lisent `window.innerWidth/innerHeight`) les appellent avec les dimensions
 * réelles du viewport — même pattern que `isMarketOpen` (pur) + call site qui injecte
 * `Date.now()`.
 */
import { createStore } from "zustand/vanilla";
import { COMPARE_PALETTE } from "./compare";

/** Palette des groupes liés — réutilise la palette de comparaison multi-symboles
 * existante (déjà choisie pour être lisible sur les 5 thèmes du terminal). */
export const GROUP_PALETTE: readonly string[] = COMPARE_PALETTE;

/** Registre statique des 14 fenêtres Bloomberg : titre/mnémonique/taille par défaut
 * (largeur = ancienne largeur fixe du dock, hauteur = valeur raisonnable par défaut,
 * l'utilisateur redimensionne ensuite librement). Utilisé par `App.tsx` (montage),
 * `TaskbarMinimized.tsx` (libellé des pastilles) et `openWindow` (taille initiale). */
export const WINDOW_REGISTRY: readonly {
  id: string;
  title: string;
  mnemonic: string;
  defaultWidth: number;
  defaultHeight: number;
}[] = [
  { id: "derivatives", title: "Produits dérivés", mnemonic: "DES", defaultWidth: 420, defaultHeight: 640 },
  { id: "eco", title: "Calendrier économique", mnemonic: "ECO", defaultWidth: 440, defaultHeight: 640 },
  { id: "news", title: "Actualités crypto", mnemonic: "NEWS", defaultWidth: 440, defaultHeight: 640 },
  { id: "corr", title: "Corrélations", mnemonic: "CORR", defaultWidth: 480, defaultHeight: 640 },
  { id: "onchain", title: "On-chain", mnemonic: "CHAIN", defaultWidth: 460, defaultHeight: 640 },
  { id: "marketMap", title: "Vue marché (treemap)", mnemonic: "IMAP", defaultWidth: 1100, defaultHeight: 720 },
  { id: "portfolio", title: "Portefeuille", mnemonic: "PORT", defaultWidth: 460, defaultHeight: 640 },
  { id: "notes", title: "Notes / journal", mnemonic: "NOTE", defaultWidth: 440, defaultHeight: 640 },
  { id: "screener", title: "Screener d'actifs", mnemonic: "EQS", defaultWidth: 680, defaultHeight: 680 },
  { id: "termStructure", title: "Structure par terme", mnemonic: "TERM", defaultWidth: 480, defaultHeight: 640 },
  { id: "options", title: "Options (smile IV, max pain)", mnemonic: "OMON", defaultWidth: 480, defaultHeight: 640 },
  { id: "dom", title: "Carnet d'ordres (DOM / depth)", mnemonic: "DOM", defaultWidth: 560, defaultHeight: 680 },
  { id: "backtest", title: "Backtest de stratégie", mnemonic: "BT", defaultWidth: 720, defaultHeight: 680 },
  { id: "replay", title: "Replay de marché", mnemonic: "REPLAY", defaultWidth: 420, defaultHeight: 640 },
] as const;

/** Espace minimal toujours visible d'une fenêtre (pixels), pour le drag comme le resize. */
export const MIN_WIDTH = 320;
export const MIN_HEIGHT = 240;
const VISIBLE_MARGIN = 40;

export interface EtatFenetre {
  id: string;
  open: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  minimized: boolean;
  groupColor: string | null;
}

/** Position en cascade pour l'ouverture initiale d'une fenêtre (évite l'empilement
 * exact au même endroit). `index` = nombre de fenêtres déjà ouvertes. */
export function cascadePosition(
  index: number,
  viewportWidth: number,
  viewportHeight: number,
  width: number,
  height: number
): { x: number; y: number } {
  const STEP = 28;
  const MARGIN = 48;
  const rawX = MARGIN + (index % 8) * STEP;
  const rawY = MARGIN + (index % 8) * STEP;
  const x = Math.min(rawX, Math.max(MARGIN, viewportWidth - width - MARGIN));
  const y = Math.min(rawY, Math.max(MARGIN, viewportHeight - height - MARGIN));
  return { x, y };
}

/** Contraint une position pour garder au moins `VISIBLE_MARGIN` px de l'en-tête
 * visible à l'écran (utile après un redimensionnement de la fenêtre navigateur). */
export function clampPosition(
  x: number,
  y: number,
  width: number,
  viewportWidth: number,
  viewportHeight: number
): { x: number; y: number } {
  const minX = VISIBLE_MARGIN - width;
  const maxX = viewportWidth - VISIBLE_MARGIN;
  const clampedX = Math.min(Math.max(x, minX), maxX);
  const clampedY = Math.min(Math.max(y, 0), Math.max(0, viewportHeight - VISIBLE_MARGIN));
  return { x: clampedX, y: clampedY };
}

/** Contraint une taille entre les minimums et le viewport. */
export function clampSize(
  width: number,
  height: number,
  minWidth: number,
  minHeight: number,
  viewportWidth: number,
  viewportHeight: number
): { width: number; height: number } {
  return {
    width: Math.min(Math.max(width, minWidth), viewportWidth),
    height: Math.min(Math.max(height, minHeight), viewportHeight),
  };
}

export interface WindowManagerState {
  windows: Record<string, EtatFenetre>;
  /** Compteur global de z-index — incrémenté à chaque focus/ouverture/restore. */
  nextZ: number;
  /** Couleur de groupe -> dernier symbole diffusé aux fenêtres/composants de ce groupe. */
  groupSymbols: Record<string, string>;

  openWindow: (id: string) => void;
  closeWindow: (id: string) => void;
  toggleWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  moveWindow: (id: string, x: number, y: number) => void;
  resizeWindow: (id: string, width: number, height: number) => void;
  minimizeWindow: (id: string) => void;
  restoreWindow: (id: string) => void;
  setGroup: (id: string, color: string | null) => void;
  setGroupSymbol: (color: string, symbol: string) => void;
  /** Restauration depuis la persistance (déjà validée par l'appelant). */
  setAll: (windows: Record<string, EtatFenetre>) => void;
}

export const windowManagerStore = createStore<WindowManagerState>((set, get) => ({
  windows: {},
  nextZ: 1,
  groupSymbols: {},

  openWindow: (id) => {
    const state = get();
    const existing = state.windows[id];
    const nextZ = state.nextZ;
    if (existing) {
      set({
        windows: { ...state.windows, [id]: { ...existing, open: true, minimized: false, z: nextZ } },
        nextZ: nextZ + 1,
      });
      return;
    }
    const entry = WINDOW_REGISTRY.find((w) => w.id === id);
    const width = entry?.defaultWidth ?? 480;
    const height = entry?.defaultHeight ?? 640;
    const openCount = Object.values(state.windows).filter((w) => w.open).length;
    const { x, y } = cascadePosition(openCount, window.innerWidth, window.innerHeight, width, height);
    set({
      windows: {
        ...state.windows,
        [id]: { id, open: true, x, y, width, height, z: nextZ, minimized: false, groupColor: null },
      },
      nextZ: nextZ + 1,
    });
  },

  closeWindow: (id) => {
    const existing = get().windows[id];
    if (!existing) return;
    set({ windows: { ...get().windows, [id]: { ...existing, open: false } } });
  },

  toggleWindow: (id) => {
    const isOpen = get().windows[id]?.open ?? false;
    if (isOpen) get().closeWindow(id);
    else get().openWindow(id);
  },

  focusWindow: (id) => {
    const existing = get().windows[id];
    if (!existing) return;
    const nextZ = get().nextZ;
    set({ windows: { ...get().windows, [id]: { ...existing, z: nextZ } }, nextZ: nextZ + 1 });
  },

  moveWindow: (id, x, y) => {
    const existing = get().windows[id];
    if (!existing) return;
    set({ windows: { ...get().windows, [id]: { ...existing, x, y } } });
  },

  resizeWindow: (id, width, height) => {
    const existing = get().windows[id];
    if (!existing) return;
    set({ windows: { ...get().windows, [id]: { ...existing, width, height } } });
  },

  minimizeWindow: (id) => {
    const existing = get().windows[id];
    if (!existing) return;
    set({ windows: { ...get().windows, [id]: { ...existing, minimized: true } } });
  },

  restoreWindow: (id) => {
    const existing = get().windows[id];
    if (!existing) return;
    const nextZ = get().nextZ;
    set({
      windows: { ...get().windows, [id]: { ...existing, minimized: false, z: nextZ } },
      nextZ: nextZ + 1,
    });
  },

  setGroup: (id, color) => {
    const existing = get().windows[id];
    if (!existing) return;
    set({ windows: { ...get().windows, [id]: { ...existing, groupColor: color } } });
  },

  setGroupSymbol: (color, symbol) => {
    set({ groupSymbols: { ...get().groupSymbols, [color]: symbol } });
  },

  setAll: (windows) => set({ windows }),
}));

/**
 * Synchronise le champ `open` d'un store `*UiStore` EXISTANT avec `windowManagerStore`
 * (source de vérité). À appeler une fois au chargement du module du store concerné.
 * Capte aussi bien les changements déclenchés par les commandes (`openEco()` etc.) que
 * ceux déclenchés par le chrome `<FloatingWindow>` (croix, minimize, restore).
 */
export function mirrorOpenState(
  id: string,
  target: { getState: () => { open: boolean }; setState: (partial: { open: boolean }) => void }
): void {
  windowManagerStore.subscribe((state) => {
    const isOpen = state.windows[id]?.open ?? false;
    if (isOpen !== target.getState().open) {
      target.setState({ open: isOpen });
    }
  });
}
```

- [ ] **Step 4: Lancer les tests, vérifier qu'ils passent**

Run: `cd ~/axiom && pnpm --filter @axiom/web test -- src/store/windowManager.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: Typecheck**

Run: `cd ~/axiom && pnpm --filter @axiom/web typecheck`
Expected: aucune erreur

- [ ] **Step 6: Commit**

```bash
cd ~/axiom
git add apps/web/src/store/windowManager.ts apps/web/src/store/windowManager.test.ts
git commit -m "feat(window-manager): store central windowManagerStore + helpers géométriques purs"
```

---

## Task 2: `store/indicators.ts` — action `reorder`

**Files:**
- Modify: `apps/web/src/store/indicators.ts`
- Test: `apps/web/src/store/indicators.test.ts`

**Interfaces:**
- Consumes: `ActiveIndicator { instanceId, defId, params }` (existant).
- Produces: `IndicatorsState.reorder: (order: string[]) => void` — réordonne le tableau `indicators` selon la liste d'`instanceId` fournie ; toute instance absente de `order` est ajoutée en fin (garde-fou anti-perte).

- [ ] **Step 1: Écrire le test (échoue — `reorder` n'existe pas)**

Ajouter à la fin de `apps/web/src/store/indicators.test.ts` (respecter le style existant du fichier : `beforeEach` réinitialise déjà `indicatorsStore` à `{ indicators: [] }`) :

```ts
describe("reorder", () => {
  it("réordonne selon la liste d'instanceId fournie", () => {
    indicatorsStore.setState({
      indicators: [
        { instanceId: "a", defId: "rsi", params: {} },
        { instanceId: "b", defId: "macd", params: {} },
        { instanceId: "c", defId: "ema", params: {} },
      ],
    });
    indicatorsStore.getState().reorder(["c", "a", "b"]);
    expect(indicatorsStore.getState().indicators.map((i) => i.instanceId)).toEqual(["c", "a", "b"]);
  });

  it("ajoute en fin toute instance absente de l'ordre fourni (garde-fou)", () => {
    indicatorsStore.setState({
      indicators: [
        { instanceId: "a", defId: "rsi", params: {} },
        { instanceId: "b", defId: "macd", params: {} },
      ],
    });
    indicatorsStore.getState().reorder(["b"]);
    expect(indicatorsStore.getState().indicators.map((i) => i.instanceId)).toEqual(["b", "a"]);
  });

  it("ignore les ids inconnus dans l'ordre fourni", () => {
    indicatorsStore.setState({ indicators: [{ instanceId: "a", defId: "rsi", params: {} }] });
    indicatorsStore.getState().reorder(["inconnu", "a"]);
    expect(indicatorsStore.getState().indicators.map((i) => i.instanceId)).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Run: `cd ~/axiom && pnpm --filter @axiom/web test -- src/store/indicators.test.ts`
Expected: FAIL — `reorder is not a function`

- [ ] **Step 3: Ajouter `reorder` à l'interface et à l'implémentation**

Dans `apps/web/src/store/indicators.ts`, ajouter à l'interface `IndicatorsState` (juste après `setAll`) :

```ts
  /** Réordonne les instances selon l'ordre d'instanceId fourni (drag des en-têtes de
   * pane, cf. chart/paneHeaders.tsx). Toute instance absente de `order` est ajoutée
   * en fin (garde-fou anti-perte). */
  reorder: (order: string[]) => void;
```

Et dans `createStore<IndicatorsState>((set, get) => ({ ... }))`, ajouter juste après l'implémentation de `remove` :

```ts
  reorder: (order) => {
    const current = get().indicators;
    const byId = new Map(current.map((i) => [i.instanceId, i]));
    const reordered = order
      .map((id) => byId.get(id))
      .filter((i): i is ActiveIndicator => i !== undefined);
    const missing = current.filter((i) => !order.includes(i.instanceId));
    set({ indicators: [...reordered, ...missing] });
  },
```

- [ ] **Step 4: Lancer le test, vérifier qu'il passe**

Run: `cd ~/axiom && pnpm --filter @axiom/web test -- src/store/indicators.test.ts`
Expected: PASS (22 tests)

- [ ] **Step 5: Commit**

```bash
cd ~/axiom
git add apps/web/src/store/indicators.ts apps/web/src/store/indicators.test.ts
git commit -m "feat(indicators): action reorder (support du drag des en-têtes de pane)"
```

---

## Task 3: `chart/paneOrder.ts` — calcul pur de l'ordre de dépôt

**Files:**
- Create: `apps/web/src/chart/paneOrder.ts`
- Test: `apps/web/src/chart/paneOrder.test.ts`

**Interfaces:**
- Produces: `computeDropOrder(paneIds: string[], draggedId: string, dropIndex: number): string[]`

- [ ] **Step 1: Écrire le test (échoue — module inexistant)**

```ts
// apps/web/src/chart/paneOrder.test.ts
import { describe, expect, it } from "vitest";
import { computeDropOrder } from "./paneOrder";

describe("computeDropOrder", () => {
  it("déplace l'élément déplacé à l'index de dépôt demandé", () => {
    expect(computeDropOrder(["a", "b", "c"], "a", 2)).toEqual(["b", "c", "a"]);
    expect(computeDropOrder(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
  });

  it("laisse l'ordre inchangé si l'index de dépôt correspond à la position actuelle", () => {
    expect(computeDropOrder(["a", "b", "c"], "b", 1)).toEqual(["a", "b", "c"]);
  });

  it("borne l'index de dépôt entre 0 et la longueur du tableau sans l'élément déplacé", () => {
    expect(computeDropOrder(["a", "b", "c"], "a", -5)).toEqual(["a", "b", "c"]);
    expect(computeDropOrder(["a", "b", "c"], "a", 99)).toEqual(["b", "c", "a"]);
  });

  it("est un no-op si l'id déplacé est absent de la liste", () => {
    expect(computeDropOrder(["a", "b"], "x", 0)).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Run: `cd ~/axiom && pnpm --filter @axiom/web test -- src/chart/paneOrder.test.ts`
Expected: FAIL — `Cannot find module './paneOrder'`

- [ ] **Step 3: Implémenter**

```ts
// apps/web/src/chart/paneOrder.ts
/**
 * Calcul PUR de l'ordre d'une liste de panes après un drag-and-drop (aucune
 * dépendance à KLineChart). Utilisé par `chart/paneHeaders.tsx`.
 */

/** Retourne le nouvel ordre de `paneIds` après avoir déplacé `draggedId` à
 * l'index `dropIndex` (calculé PARMI les éléments restants, une fois `draggedId`
 * retiré). `dropIndex` est borné à [0, longueur restante]. */
export function computeDropOrder(paneIds: string[], draggedId: string, dropIndex: number): string[] {
  if (!paneIds.includes(draggedId)) return paneIds;
  const withoutDragged = paneIds.filter((id) => id !== draggedId);
  const clampedIndex = Math.min(Math.max(dropIndex, 0), withoutDragged.length);
  return [...withoutDragged.slice(0, clampedIndex), draggedId, ...withoutDragged.slice(clampedIndex)];
}
```

- [ ] **Step 4: Lancer le test, vérifier qu'il passe**

Run: `cd ~/axiom && pnpm --filter @axiom/web test -- src/chart/paneOrder.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
cd ~/axiom
git add apps/web/src/chart/paneOrder.ts apps/web/src/chart/paneOrder.test.ts
git commit -m "feat(chart): calcul pur computeDropOrder (drag-reorder des panes)"
```

---

## Task 4: `chart/indicators.ts` — resize natif + réordonnancement + export `axiomPaneId`

**Files:**
- Modify: `apps/web/src/chart/indicators.ts`

**Interfaces:**
- Consumes: `computeDropOrder` non utilisé ici (utilisé par Task 9) ; `getIndicator` (déjà importé de `@axiom/indicators`).
- Produces: `export function axiomPaneId(instanceId: string): string` (était privée), utilisée par `chart/paneHeaders.tsx` (Task 9).

**Contexte technique (vérifié sur le `.d.ts` installé, pas seulement context7) :** `PaneOptions` n'a PAS de champ `order`. KLineChart empile les panes séparés dans leur ORDRE DE CRÉATION. Pour réordonner, `sync()` doit détecter un changement d'ordre (même jeu d'instanceId, position différente) et retirer TOUS les panes séparés concernés pour les laisser être recréés dans le bon ordre par la suite de la méthode — les calculs restent mémoïsés (`computeCache`), seul le montage de pane est refait (opération légère).

Il n'y a pas de test automatisé pour ce fichier (aucun mock de `Chart` dans le projet — convention existante) : la vérification se fait manuellement à la Task 14.

- [ ] **Step 1: Exporter `axiomPaneId`**

Dans `apps/web/src/chart/indicators.ts`, remplacer :

```ts
function axiomPaneId(instanceId: string): string {
  return `axiom_${instanceId}`;
}
```

par :

```ts
/** Id de pane séparé déterministe pour une instance non-overlay. Exportée : réutilisée
 * par `chart/paneHeaders.tsx` pour positionner l'en-tête de fermeture/réordonnancement. */
export function axiomPaneId(instanceId: string): string {
  return `axiom_${instanceId}`;
}
```

- [ ] **Step 2: Activer le redimensionnement natif à la création d'un pane**

Remplacer, dans la méthode `sync()` :

```ts
      const created = this.chart.createIndicator(
        { name, shortName: formatInstanceLabel(def, inst.params), extendData: result },
        true, // isStack : coexistence des overlays sur le pane prix.
        { id: paneId }
      );
```

par :

```ts
      const created = this.chart.createIndicator(
        { name, shortName: formatInstanceLabel(def, inst.params), extendData: result },
        true, // isStack : coexistence des overlays sur le pane prix.
        { id: paneId, dragEnabled: true, minHeight: 60 }
      );
```

- [ ] **Step 3: Détecter un changement d'ordre et forcer la recréation des panes séparés concernés**

Dans `sync()`, juste après le bloc de retrait des instances désactivées (`for (const [instanceId, info] of this.active) { if (!wanted.has(instanceId)) {...} }`) et AVANT la boucle `for (const inst of instances)`, insérer :

```ts
    // Détection d'un changement d'ORDRE des panes séparés (même jeu d'instanceId,
    // position différente) : KLineChart n'a pas de setter d'ordre natif (PaneOptions
    // n'a pas de champ `order` en v9.8.12) — seul l'ordre de CRÉATION détermine
    // l'empilement visuel. On retire les panes concernés pour les laisser être
    // recréés dans le bon ordre par la boucle ci-dessous (coût : recréation de pane,
    // PAS recalcul — `computeCache` est conservé).
    const ordreVoulu = instances
      .filter((i) => getIndicator(i.defId)?.pane !== "overlay")
      .map((i) => i.instanceId);
    const ordreMonte = [...this.active.entries()]
      .filter(([, info]) => info.paneId !== CANDLE_PANE_ID)
      .map(([instanceId]) => instanceId);
    if (ordreVoulu.length === ordreMonte.length && ordreVoulu.join(",") !== ordreMonte.join(",")) {
      for (const instanceId of ordreVoulu) {
        const info = this.active.get(instanceId);
        if (info) {
          this.chart.removeIndicator(info.paneId, info.name);
          this.active.delete(instanceId);
        }
      }
    }
```

- [ ] **Step 4: Typecheck**

Run: `cd ~/axiom && pnpm --filter @axiom/web typecheck`
Expected: aucune erreur

- [ ] **Step 5: Lancer la suite de tests complète (non-régression — ce fichier n'a pas ses propres tests, mais `store/indicators.test.ts` et les tests d'intégration ne doivent pas casser)**

Run: `cd ~/axiom && pnpm --filter @axiom/web test`
Expected: PASS (tous les tests existants verts)

- [ ] **Step 6: Commit**

```bash
cd ~/axiom
git add apps/web/src/chart/indicators.ts
git commit -m "feat(chart): resize natif des panes + réordonnancement par recréation, export axiomPaneId"
```

---

## Task 5: `components/FloatingWindow.tsx` — chrome générique

**Files:**
- Create: `apps/web/src/components/FloatingWindow.tsx`

**Interfaces:**
- Consumes: `windowManagerStore`, `EtatFenetre`, `clampPosition`, `clampSize`, `MIN_WIDTH`, `MIN_HEIGHT`, `GROUP_PALETTE` (de `../store/windowManager`).
- Produces: `<FloatingWindow id title mnemonic>{children}</FloatingWindow>` — composant React monté une fois par fenêtre dans `App.tsx` (Task 8).

Pas de test dédié : composant React avec interactions pointer, comme les autres composants du projet (`Watchlist.tsx`, `DrawingToolbar.tsx`…) — aucun n'a de test de rendu (pas de `@testing-library/react` dans les devDependencies, conforme à BUILD-CONTRACT « aucune nouvelle dépendance »). Vérification manuelle à la Task 14.

- [ ] **Step 1: Implémenter le composant**

```tsx
// apps/web/src/components/FloatingWindow.tsx
/**
 * Chrome générique d'une fenêtre flottante (Launchpad) — enveloppe le contenu de
 * chacune des 14 fenêtres Bloomberg (ECO, NEWS, CORR…). Gère position/taille/z-order/
 * minimize/fermeture/groupe de couleur via `windowManagerStore` (source de vérité
 * unique). Le contenu métier de chaque fenêtre reste inchangé (monté en enfant).
 *
 * Drag/resize en pointer events maison (aucune nouvelle dépendance). Écritures
 * DOM impératives pendant le drag/resize (pas de state React à 60fps) : seule la
 * position FINALE (pointerup) déclenche un `set()` Zustand — les déplacements
 * intermédiaires manipulent `style.left/top/width/height` directement.
 */
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import {
  windowManagerStore,
  clampPosition,
  clampSize,
  MIN_WIDTH,
  MIN_HEIGHT,
  GROUP_PALETTE,
  type EtatFenetre,
} from "../store/windowManager";

export interface FloatingWindowProps {
  id: string;
  title: string;
  mnemonic: string;
  children: React.ReactNode;
}

type PoigneeResize = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const POIGNEES: { id: PoigneeResize; className: string; dw: number; dh: number; dx: number; dy: number }[] = [
  { id: "e", className: "right-0 top-2 bottom-2 w-1.5 cursor-ew-resize", dw: 1, dh: 0, dx: 0, dy: 0 },
  { id: "w", className: "left-0 top-2 bottom-2 w-1.5 cursor-ew-resize", dw: -1, dh: 0, dx: 1, dy: 0 },
  { id: "s", className: "bottom-0 left-2 right-2 h-1.5 cursor-ns-resize", dw: 0, dh: 1, dx: 0, dy: 0 },
  { id: "n", className: "top-0 left-2 right-2 h-1.5 cursor-ns-resize", dw: 0, dh: -1, dx: 0, dy: 1 },
  { id: "se", className: "right-0 bottom-0 h-3 w-3 cursor-nwse-resize", dw: 1, dh: 1, dx: 0, dy: 0 },
  { id: "sw", className: "left-0 bottom-0 h-3 w-3 cursor-nesw-resize", dw: -1, dh: 1, dx: 1, dy: 0 },
  { id: "ne", className: "right-0 top-0 h-3 w-3 cursor-nesw-resize", dw: 1, dh: -1, dx: 0, dy: 1 },
  { id: "nw", className: "left-0 top-0 h-3 w-3 cursor-nwse-resize", dw: -1, dh: -1, dx: 1, dy: 1 },
];

export function FloatingWindow({ id, title, mnemonic, children }: FloatingWindowProps) {
  const etat = useStore(windowManagerStore, (s) => s.windows[id]);
  const rootRef = useRef<HTMLDivElement>(null);
  const [menuGroupeOuvert, setMenuGroupeOuvert] = useState(false);

  if (!etat || !etat.open || etat.minimized) return null;

  const focus = (): void => windowManagerStore.getState().focusWindow(id);

  const demarrerDrag = (e: React.PointerEvent): void => {
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    e.preventDefault();
    focus();
    const depart = { x: e.clientX, y: e.clientY, wx: etat.x, wy: etat.y };
    const onMove = (ev: PointerEvent): void => {
      const dx = ev.clientX - depart.x;
      const dy = ev.clientY - depart.y;
      const { x, y } = clampPosition(depart.wx + dx, depart.wy + dy, etat.width, window.innerWidth, window.innerHeight);
      if (rootRef.current) {
        rootRef.current.style.left = `${x}px`;
        rootRef.current.style.top = `${y}px`;
      }
      windowManagerStore.getState().moveWindow(id, x, y);
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const demarrerResize = (poignee: (typeof POIGNEES)[number]): ((e: React.PointerEvent) => void) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    focus();
    const depart = { x: e.clientX, y: e.clientY, w: etat.width, h: etat.height, wx: etat.x, wy: etat.y };
    const onMove = (ev: PointerEvent): void => {
      const dx = ev.clientX - depart.x;
      const dy = ev.clientY - depart.y;
      const largeurBrute = depart.w + poignee.dw * dx;
      const hauteurBrute = depart.h + poignee.dh * dy;
      const { width, height } = clampSize(
        largeurBrute,
        hauteurBrute,
        MIN_WIDTH,
        MIN_HEIGHT,
        window.innerWidth,
        window.innerHeight
      );
      const x = poignee.dx ? depart.wx + (depart.w - width) : depart.wx;
      const y = poignee.dy ? depart.wy + (depart.h - height) : depart.wy;
      if (rootRef.current) {
        rootRef.current.style.width = `${width}px`;
        rootRef.current.style.height = `${height}px`;
        rootRef.current.style.left = `${x}px`;
        rootRef.current.style.top = `${y}px`;
      }
      windowManagerStore.getState().resizeWindow(id, width, height);
      if (poignee.dx || poignee.dy) windowManagerStore.getState().moveWindow(id, x, y);
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      ref={rootRef}
      role="complementary"
      aria-label={title}
      onPointerDownCapture={focus}
      style={{
        position: "fixed",
        left: etat.x,
        top: etat.y,
        width: etat.width,
        height: etat.height,
        zIndex: etat.z,
      }}
      className="flex flex-col rounded border border-border bg-surface shadow-2xl"
    >
      <header
        onPointerDown={demarrerDrag}
        className="flex shrink-0 cursor-move items-center justify-between gap-2 rounded-t border-b border-border bg-bg px-2 py-1.5"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="w-14 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-text-dim">
            {mnemonic}
          </span>
          <span className="truncate text-xs font-medium text-text">{title}</span>
        </div>
        <div className="relative flex shrink-0 items-center gap-1" data-no-drag>
          <button
            type="button"
            title="Couleur de groupe"
            onClick={() => setMenuGroupeOuvert((o) => !o)}
            className="h-3.5 w-3.5 rounded-full border border-border"
            style={{ backgroundColor: etat.groupColor ?? "transparent" }}
          />
          {menuGroupeOuvert && (
            <div className="absolute right-0 top-5 z-10 flex gap-1 rounded border border-border bg-surface p-1 shadow-xl">
              <button
                type="button"
                title="Aucun groupe"
                onClick={() => {
                  windowManagerStore.getState().setGroup(id, null);
                  setMenuGroupeOuvert(false);
                }}
                className="h-4 w-4 rounded-full border border-border"
              />
              {GROUP_PALETTE.map((couleur) => (
                <button
                  key={couleur}
                  type="button"
                  title={couleur}
                  onClick={() => {
                    windowManagerStore.getState().setGroup(id, couleur);
                    setMenuGroupeOuvert(false);
                  }}
                  className="h-4 w-4 rounded-full"
                  style={{ backgroundColor: couleur }}
                />
              ))}
            </div>
          )}
          <button
            type="button"
            title="Réduire"
            onClick={() => windowManagerStore.getState().minimizeWindow(id)}
            className="rounded px-1 text-xs leading-none text-text-dim hover:bg-bg hover:text-text"
          >
            —
          </button>
          <button
            type="button"
            title="Fermer"
            onClick={() => windowManagerStore.getState().closeWindow(id)}
            className="rounded px-1 text-xs leading-none text-text-dim hover:bg-bg hover:text-text"
          >
            ✕
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {POIGNEES.map((p) => (
        <div key={p.id} onPointerDown={demarrerResize(p)} className={`absolute ${p.className}`} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd ~/axiom && pnpm --filter @axiom/web typecheck`
Expected: aucune erreur (le composant n'est pas encore monté nulle part — ce sera fait en Task 8 — mais doit compiler seul)

- [ ] **Step 3: Commit**

```bash
cd ~/axiom
git add apps/web/src/components/FloatingWindow.tsx
git commit -m "feat(window-manager): composant chrome FloatingWindow (drag/resize/groupe/minimize)"
```

---

## Task 6: `components/TaskbarMinimized.tsx`

**Files:**
- Create: `apps/web/src/components/TaskbarMinimized.tsx`

**Interfaces:**
- Consumes: `windowManagerStore`, `WINDOW_REGISTRY` (de `../store/windowManager`).
- Produces: `<TaskbarMinimized />` — monté une fois dans `App.tsx` (Task 8).

- [ ] **Step 1: Implémenter**

```tsx
// apps/web/src/components/TaskbarMinimized.tsx
/**
 * Barre de tâches des fenêtres réduites — une pastille par fenêtre `minimized`,
 * clic = restaure + passe au premier plan. Vide (donc invisible) si aucune fenêtre
 * n'est réduite.
 */
import { useStore } from "zustand";
import { windowManagerStore, WINDOW_REGISTRY } from "../store/windowManager";

export function TaskbarMinimized() {
  const windows = useStore(windowManagerStore, (s) => s.windows);
  const reduites = Object.values(windows).filter((w) => w.open && w.minimized);

  if (reduites.length === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 flex gap-1 border-t border-border bg-surface px-2 py-1">
      {reduites.map((w) => {
        const entry = WINDOW_REGISTRY.find((r) => r.id === w.id);
        return (
          <button
            key={w.id}
            type="button"
            onClick={() => {
              windowManagerStore.getState().restoreWindow(w.id);
            }}
            className="flex items-center gap-1.5 rounded border border-border bg-bg px-2 py-1 text-[11px] text-text-dim hover:text-text"
          >
            <span className="font-semibold uppercase tracking-wider">{entry?.mnemonic ?? w.id}</span>
            <span className="max-w-[140px] truncate">{entry?.title ?? w.id}</span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd ~/axiom && pnpm --filter @axiom/web typecheck`
Expected: aucune erreur

- [ ] **Step 3: Commit**

```bash
cd ~/axiom
git add apps/web/src/components/TaskbarMinimized.tsx
git commit -m "feat(window-manager): barre de tâches des fenêtres réduites"
```

---

## Task 7: Migrer les 14 stores `*UiStore` vers `windowManagerStore`

**Files:**
- Modify: `apps/web/src/store/derivatives-ui.ts`
- Modify: `apps/web/src/store/eco.ts`
- Modify: `apps/web/src/store/news.ts`
- Modify: `apps/web/src/components/CorrWindow.tsx` (bloc `corrUiStore` uniquement, lignes ~45-56)
- Modify: `apps/web/src/store/onchain.ts`
- Modify: `apps/web/src/store/marketmap-ui.ts`
- Modify: `apps/web/src/store/portfolio.ts` (bloc `portfolioUiStore` uniquement, lignes ~294-308)
- Modify: `apps/web/src/store/notes.ts` (bloc `notesUiStore` uniquement, lignes ~210-231)
- Modify: `apps/web/src/store/screener.ts` (bloc open, lignes ~51-58 et ~139-142)
- Modify: `apps/web/src/components/TermStructureWindow.tsx` (bloc `termStructureUiStore`, lignes ~28-39)
- Modify: `apps/web/src/components/OptionsWindow.tsx` (bloc `optionsUiStore`, lignes ~27-38)
- Modify: `apps/web/src/store/dom-ui.ts`
- Modify: `apps/web/src/store/backtest.ts` (bloc open, lignes ~256-262 et ~322-326)
- Modify: `apps/web/src/store/replay.ts` (bloc open, lignes ~111-125)

**Interfaces:**
- Consumes: `windowManagerStore`, `mirrorOpenState` (de `../store/windowManager` ou `./windowManager` selon la profondeur du fichier).
- Produces: aucune interface publique nouvelle — chaque store garde EXACTEMENT sa signature `open`/`openX`/`closeX`/`toggleX` actuelle (rétro-compatibilité totale avec tous les consommateurs existants : composants, palette, Toolbar).

**Règle de transformation (identique pour les 14, exemple canonique ci-dessous) :** `openX`/`closeX`/`toggleX` délèguent à `windowManagerStore` au lieu de faire leur propre `set({open:...})` ; un appel à `mirrorOpenState(id, store)` en bas du fichier garde `store.getState().open` synchronisé avec `windowManagerStore` dans les DEUX sens (commande palette → ouverture, ET croix du chrome → fermeture se répercutent l'une sur l'autre). Toute logique métier annexe (paramètres, effets de bord) est CONSERVÉE telle quelle.

- [ ] **Step 1: `store/derivatives-ui.ts` (exemple canonique — le plus simple)**

Remplacer tout le contenu par :

```ts
/**
 * Store UI des Produits dérivés — Zustand VANILLA (hors render-loop React).
 *
 * `open` MIROITE l'état de `windowManagerStore` (source de vérité géométrie/ouverture
 * de toutes les fenêtres flottantes) — cf. `mirrorOpenState`. Les données et clés
 * Coinalyze restent dans leurs stores/providers dédiés.
 */
import { createStore } from "zustand/vanilla";
import { windowManagerStore, mirrorOpenState } from "./windowManager";

export interface DerivativesUiState {
  /** true quand le panneau Produits dérivés est ouvert. */
  open: boolean;
  /** Ouvre le panneau Produits dérivés. */
  openDerivatives: () => void;
  /** Ferme le panneau Produits dérivés. */
  closeDerivatives: () => void;
  /** Bascule l'ouverture du panneau (utilisé par le mnémonique DES). */
  toggleDerivatives: () => void;
}

export const derivativesUiStore = createStore<DerivativesUiState>(() => ({
  open: false,
  openDerivatives: () => windowManagerStore.getState().openWindow("derivatives"),
  closeDerivatives: () => windowManagerStore.getState().closeWindow("derivatives"),
  toggleDerivatives: () => windowManagerStore.getState().toggleWindow("derivatives"),
}));

mirrorOpenState("derivatives", derivativesUiStore);
```

- [ ] **Step 2: `store/eco.ts` (store combiné — ne toucher QUE le bloc open, garder `events/status/error/impacts/pays/markersEnabled/refresh/toggleImpact/setPays/toggleMarkers` intacts)**

Ajouter l'import en haut du fichier : `import { windowManagerStore, mirrorOpenState } from "./windowManager";`

Remplacer dans l'objet `createStore<EcoState>((set, get) => ({...}))` :

```ts
  openEco: () => set({ open: true }),
  closeEco: () => set({ open: false }),
  toggleEco: () => set({ open: !get().open }),
```

par :

```ts
  openEco: () => windowManagerStore.getState().openWindow("eco"),
  closeEco: () => windowManagerStore.getState().closeWindow("eco"),
  toggleEco: () => windowManagerStore.getState().toggleWindow("eco"),
```

Ajouter en bas du fichier (après la définition de `ecoStore`) : `mirrorOpenState("eco", ecoStore);`

- [ ] **Step 3: `store/news.ts`**

Ajouter l'import : `import { windowManagerStore, mirrorOpenState } from "./windowManager";`

Remplacer :

```ts
  openNews: () => set({ open: true }),
  closeNews: () => set({ open: false }),
  toggleNews: () => set({ open: !get().open }),
```

par :

```ts
  openNews: () => windowManagerStore.getState().openWindow("news"),
  closeNews: () => windowManagerStore.getState().closeWindow("news"),
  toggleNews: () => windowManagerStore.getState().toggleWindow("news"),
```

Ajouter après `newsUiStore` : `mirrorOpenState("news", newsUiStore);`

- [ ] **Step 4: `components/CorrWindow.tsx` (bloc `corrUiStore` uniquement)**

Ajouter l'import : `import { windowManagerStore, mirrorOpenState } from "../store/windowManager";`

Remplacer :

```ts
export const corrUiStore = createStore<CorrUiState>((set, get) => ({
  open: false,
  openCorr: () => set({ open: true }),
  closeCorr: () => set({ open: false }),
  toggleCorr: () => set({ open: !get().open }),
```

par :

```ts
export const corrUiStore = createStore<CorrUiState>(() => ({
  open: false,
  openCorr: () => windowManagerStore.getState().openWindow("corr"),
  closeCorr: () => windowManagerStore.getState().closeWindow("corr"),
  toggleCorr: () => windowManagerStore.getState().toggleWindow("corr"),
```

(garder la fermeture `}));` telle quelle si d'autres champs suivaient — vérifier qu'aucun autre champ n'existe dans ce bloc avant de fermer ; sinon les conserver après ces trois lignes). Ajouter juste après la fermeture du store : `mirrorOpenState("corr", corrUiStore);`

- [ ] **Step 5: `store/onchain.ts`**

Ajouter l'import : `import { windowManagerStore, mirrorOpenState } from "./windowManager";`

Remplacer :

```ts
  openOnchain: () => set({ open: true }),
  closeOnchain: () => set({ open: false }),
  toggleOnchain: () => set({ open: !get().open }),
```

par :

```ts
  openOnchain: () => windowManagerStore.getState().openWindow("onchain"),
  closeOnchain: () => windowManagerStore.getState().closeWindow("onchain"),
  toggleOnchain: () => windowManagerStore.getState().toggleWindow("onchain"),
```

Ajouter après `onchainUiStore` : `mirrorOpenState("onchain", onchainUiStore);`

- [ ] **Step 6: `store/marketmap-ui.ts`**

Remplacer tout le contenu par :

```ts
/**
 * Store UI de la Vue marché (IMAP) — Zustand VANILLA (hors render-loop React).
 *
 * `open` MIROITE l'état de `windowManagerStore` — cf. `mirrorOpenState`. Les données
 * CoinGecko vivent dans leur module dédié (data/marketOverview.ts).
 */
import { createStore } from "zustand/vanilla";
import { windowManagerStore, mirrorOpenState } from "./windowManager";

export interface MarketMapUiState {
  /** true quand le panneau Vue marché est ouvert. */
  open: boolean;
  /** Ouvre le panneau. */
  openMarketMap: () => void;
  /** Ferme le panneau. */
  closeMarketMap: () => void;
  /** Bascule l'ouverture (utilisé par le mnémonique IMAP). */
  toggleMarketMap: () => void;
}

export const marketMapUiStore = createStore<MarketMapUiState>(() => ({
  open: false,
  openMarketMap: () => windowManagerStore.getState().openWindow("marketMap"),
  closeMarketMap: () => windowManagerStore.getState().closeWindow("marketMap"),
  toggleMarketMap: () => windowManagerStore.getState().toggleWindow("marketMap"),
}));

mirrorOpenState("marketMap", marketMapUiStore);
```

- [ ] **Step 7: `store/portfolio.ts` (bloc `portfolioUiStore` uniquement)**

Ajouter l'import : `import { windowManagerStore, mirrorOpenState } from "./windowManager";`

Remplacer :

```ts
export const portfolioUiStore = createStore<PortfolioUiState>((set, get) => ({
  open: false,
  openPortfolio: () => set({ open: true }),
  closePortfolio: () => set({ open: false }),
  togglePortfolio: () => set({ open: !get().open }),
}));
```

par :

```ts
export const portfolioUiStore = createStore<PortfolioUiState>(() => ({
  open: false,
  openPortfolio: () => windowManagerStore.getState().openWindow("portfolio"),
  closePortfolio: () => windowManagerStore.getState().closeWindow("portfolio"),
  togglePortfolio: () => windowManagerStore.getState().toggleWindow("portfolio"),
}));

mirrorOpenState("portfolio", portfolioUiStore);
```

- [ ] **Step 8: `store/notes.ts` (bloc `notesUiStore` uniquement — `proposerNote`/`consommerBrouillon` conservés)**

Ajouter l'import : `import { windowManagerStore, mirrorOpenState } from "./windowManager";`

Remplacer :

```ts
export const notesUiStore = createStore<NotesUiState>((set, get) => ({
  open: false,
  brouillon: null,
  openNotes: () => set({ open: true }),
  closeNotes: () => set({ open: false }),
  toggleNotes: () => set({ open: !get().open }),
  proposerNote: (b) => set({ open: true, brouillon: b }),
  consommerBrouillon: () => set({ brouillon: null }),
}));
```

par :

```ts
export const notesUiStore = createStore<NotesUiState>((set) => ({
  open: false,
  brouillon: null,
  openNotes: () => windowManagerStore.getState().openWindow("notes"),
  closeNotes: () => windowManagerStore.getState().closeWindow("notes"),
  toggleNotes: () => windowManagerStore.getState().toggleWindow("notes"),
  proposerNote: (b) => {
    set({ brouillon: b });
    windowManagerStore.getState().openWindow("notes");
  },
  consommerBrouillon: () => set({ brouillon: null }),
}));

mirrorOpenState("notes", notesUiStore);
```

- [ ] **Step 9: `store/screener.ts` (action `toggle`, pas `toggleScreener`)**

Ajouter l'import : `import { windowManagerStore, mirrorOpenState } from "./windowManager";`

Remplacer :

```ts
export const screenerStore = createStore<ScreenerState>((set, get) => ({
  open: false,
  openScreener: () => set({ open: true }),
  closeScreener: () => set({ open: false }),
  toggle: () => set({ open: !get().open }),
```

par :

```ts
export const screenerStore = createStore<ScreenerState>((set, get) => ({
  open: false,
  openScreener: () => windowManagerStore.getState().openWindow("screener"),
  closeScreener: () => windowManagerStore.getState().closeWindow("screener"),
  toggle: () => windowManagerStore.getState().toggleWindow("screener"),
```

(garder `(set, get)` si le reste du store — le « Builder de filtres » — utilise encore `set`/`get`, ce qui est le cas). Ajouter après la fermeture de `screenerStore` : `mirrorOpenState("screener", screenerStore);`

- [ ] **Step 10: `components/TermStructureWindow.tsx` (bloc `termStructureUiStore`)**

Ajouter l'import : `import { windowManagerStore, mirrorOpenState } from "../store/windowManager";`

Remplacer :

```ts
export const termStructureUiStore = createStore<TermStructureUiState>((set, get) => ({
  open: false,
  openTermStructure: () => set({ open: true }),
  closeTermStructure: () => set({ open: false }),
  toggleTermStructure: () => set({ open: !get().open }),
```

par :

```ts
export const termStructureUiStore = createStore<TermStructureUiState>(() => ({
  open: false,
  openTermStructure: () => windowManagerStore.getState().openWindow("termStructure"),
  closeTermStructure: () => windowManagerStore.getState().closeWindow("termStructure"),
  toggleTermStructure: () => windowManagerStore.getState().toggleWindow("termStructure"),
```

Ajouter après la fermeture du store : `mirrorOpenState("termStructure", termStructureUiStore);`

- [ ] **Step 11: `components/OptionsWindow.tsx` (bloc `optionsUiStore`)**

Ajouter l'import : `import { windowManagerStore, mirrorOpenState } from "../store/windowManager";`

Remplacer :

```ts
export const optionsUiStore = createStore<OptionsUiState>((set, get) => ({
  open: false,
  openOptions: () => set({ open: true }),
  closeOptions: () => set({ open: false }),
  toggleOptions: () => set({ open: !get().open }),
```

par :

```ts
export const optionsUiStore = createStore<OptionsUiState>(() => ({
  open: false,
  openOptions: () => windowManagerStore.getState().openWindow("options"),
  closeOptions: () => windowManagerStore.getState().closeWindow("options"),
  toggleOptions: () => windowManagerStore.getState().toggleWindow("options"),
```

Ajouter après la fermeture du store : `mirrorOpenState("options", optionsUiStore);`

- [ ] **Step 12: `store/dom-ui.ts` (`openDom(tab?)` conserve son paramètre optionnel)**

Ajouter l'import : `import { windowManagerStore, mirrorOpenState } from "./windowManager";`

Remplacer :

```ts
export const domUiStore = createStore<DomUiState>((set, get) => ({
  open: false,
  tab: "ladder",
  facteurPas: 1,
  seuilGrosTrade: 100_000,
  openDom: (tab) => set(tab ? { open: true, tab } : { open: true }),
  closeDom: () => set({ open: false }),
  toggleDom: () => set({ open: !get().open }),
```

par :

```ts
export const domUiStore = createStore<DomUiState>((set) => ({
  open: false,
  tab: "ladder",
  facteurPas: 1,
  seuilGrosTrade: 100_000,
  openDom: (tab) => {
    if (tab) set({ tab });
    windowManagerStore.getState().openWindow("dom");
  },
  closeDom: () => windowManagerStore.getState().closeWindow("dom"),
  toggleDom: () => windowManagerStore.getState().toggleWindow("dom"),
```

(les lignes suivantes `setTab`/`setFacteurPas`/`setSeuilGrosTrade` restent inchangées ; si elles utilisaient `get()`, le garder dans la signature — vérifier avant de retirer `get` du destructuring). Ajouter après la fermeture du store : `mirrorOpenState("dom", domUiStore);`

- [ ] **Step 13: `store/backtest.ts` (action `toggle`, pas `toggleBacktest`)**

Ajouter l'import : `import { windowManagerStore, mirrorOpenState } from "./windowManager";`

Remplacer :

```ts
export const backtestStore = createStore<BacktestState>((set, get) => ({
  open: false,
  openBacktest: () => set({ open: true }),
  closeBacktest: () => set({ open: false }),
  toggle: () => set({ open: !get().open }),
```

par :

```ts
export const backtestStore = createStore<BacktestState>((set, get) => ({
  open: false,
  openBacktest: () => windowManagerStore.getState().openWindow("backtest"),
  closeBacktest: () => windowManagerStore.getState().closeWindow("backtest"),
  toggle: () => windowManagerStore.getState().toggleWindow("backtest"),
```

(garder `(set, get)` — le « Builder » qui suit utilise `set`/`get`). Ajouter après la fermeture de `backtestStore` : `mirrorOpenState("backtest", backtestStore);`

- [ ] **Step 14: `store/replay.ts` (effets de bord `rafraichirJours`/`rafraichirStatut` CONSERVÉS)**

Ajouter l'import : `import { windowManagerStore, mirrorOpenState } from "./windowManager";`

Remplacer :

```ts
export const replayStore = createStore<ReplayState>((set, get) => ({
  open: false,
  openReplay: () => {
    set({ open: true });
    get().rafraichirJours();
    get().rafraichirStatut();
  },
  closeReplay: () => set({ open: false }),
  toggle: () => {
    const ouvrir = !get().open;
    set({ open: ouvrir });
    if (ouvrir) {
      get().rafraichirJours();
      get().rafraichirStatut();
    }
```

par :

```ts
export const replayStore = createStore<ReplayState>((set, get) => ({
  open: false,
  openReplay: () => {
    windowManagerStore.getState().openWindow("replay");
    get().rafraichirJours();
    get().rafraichirStatut();
  },
  closeReplay: () => windowManagerStore.getState().closeWindow("replay"),
  toggle: () => {
    const etaitOuvert = windowManagerStore.getState().windows["replay"]?.open ?? false;
    windowManagerStore.getState().toggleWindow("replay");
    if (!etaitOuvert) {
      get().rafraichirJours();
      get().rafraichirStatut();
    }
```

(le reste du corps de `toggle` — s'il y en avait — et la fermeture du store restent inchangés). Ajouter après la fermeture de `replayStore` : `mirrorOpenState("replay", replayStore);`

- [ ] **Step 15: Typecheck complet**

Run: `cd ~/axiom && pnpm --filter @axiom/web typecheck`
Expected: aucune erreur — si une erreur apparaît sur un `get()`/`set()` devenu inutilisé dans un des 14 fichiers (paramètre de callback non lu), retirer le paramètre inutilisé de la signature de la fonction concernée (ex. `(set, get) => (...)` → `(set) => (...)` si `get` n'est plus utilisé ailleurs dans CE fichier).

- [ ] **Step 16: Lancer toute la suite de tests (non-régression)**

Run: `cd ~/axiom && pnpm --filter @axiom/web test`
Expected: PASS — tous les tests existants verts (aucun test ne ciblait directement le comportement interne de `openX`/`closeX`, seulement `open` en tant que valeur, qui reste correcte via le mirror)

- [ ] **Step 17: Commit**

```bash
cd ~/axiom
git add apps/web/src/store/derivatives-ui.ts apps/web/src/store/eco.ts apps/web/src/store/news.ts \
  apps/web/src/components/CorrWindow.tsx apps/web/src/store/onchain.ts apps/web/src/store/marketmap-ui.ts \
  apps/web/src/store/portfolio.ts apps/web/src/store/notes.ts apps/web/src/store/screener.ts \
  apps/web/src/components/TermStructureWindow.tsx apps/web/src/components/OptionsWindow.tsx \
  apps/web/src/store/dom-ui.ts apps/web/src/store/backtest.ts apps/web/src/store/replay.ts
git commit -m "refactor(window-manager): les 14 stores *UiStore délèguent à windowManagerStore (mirroring rétro-compatible)"
```

---

## Task 8: Retirer le wrapper de positionnement des 14 fenêtres

**Files:**
- Modify (les 14) : `EcoWindow.tsx`, `NewsWindow.tsx`, `CorrWindow.tsx`, `OnchainWindow.tsx`, `MarketMapWindow.tsx`, `PortfolioWindow.tsx`, `NotesWindow.tsx`, `ScreenerWindow.tsx`, `TermStructureWindow.tsx`, `OptionsWindow.tsx`, `DomWindow.tsx`, `BacktestWindow.tsx`, `ReplayWindow.tsx`, `DerivativesWindow.tsx` (tous dans `apps/web/src/components/`)

**Interfaces:**
- Aucune signature de fonction/export ne change — seul le JSX RENDU par chaque `export function XWindow()` est modifié (retrait du wrapper externe positionné + du bouton de fermeture interne, désormais fournis par `<FloatingWindow>` qui les enveloppera en Task 9).

**Règle de transformation (identique pour les 14) :** chaque fichier a un JSX racine de la forme :
```tsx
<aside role="complementary" aria-label="..." aria-hidden={!open} className={`fixed right-0 top-0 z-40 flex h-full w-[min(Npx,Mvw)] flex-col border-l border-border bg-surface shadow-2xl transition-transform duration-200 ${open ? "translate-x-0" : "pointer-events-none translate-x-full"}`}>
  <header ...>
    ...titre + sous-titre...
    <button onClick={closeX} aria-label="Fermer ...">✕</button>
  </header>
  <div className="flex-1 overflow-y-auto ...">
    ...corps...
  </div>
</aside>
```
Transformer en (utiliser un `Fragment` `<>...</>` car il n'y a plus de racine unique nécessaire — le composant retourne directement son contenu, monté par l'appelant dans `<FloatingWindow>`) :
```tsx
<>
  <header ...>
    ...titre + sous-titre (INCHANGÉ, y compris le `<h2>` — garder la duplication mineure
    avec le titre du chrome FloatingWindow est un choix assumé : modification chirurgicale,
    zéro risque de perdre un sous-titre dynamique spécifique à la fenêtre)...
    {/* bouton de fermeture retiré : le chrome FloatingWindow en fournit un */}
  </header>
  <div className="flex-1 overflow-y-auto ...">
    ...corps (INCHANGÉ)...
  </div>
</>
```
Retirer aussi, dans chaque fichier, la ligne `const open = useStore(xUiStore, (s) => s.open);` SI ELLE N'EST PLUS UTILISÉE ailleurs dans le fichier après ce changement (elle reste nécessaire si le corps du composant a un `useEffect([open, ...])` de gating des requêtes — NE PAS la retirer dans ce cas, elle est encore lue). Retirer la variable `closeX` (ex. `closeDerivatives`) SEULEMENT si elle n'est plus utilisée après le retrait du bouton — sinon la garder si elle sert ailleurs.

- [ ] **Step 1: `DerivativesWindow.tsx`**

Remplacer (repérer via `git show HEAD -- apps/web/src/components/DerivativesWindow.tsx` pour le contenu EXACT au moment de l'implémentation, la structure de référence est) :

```tsx
    <aside
      role="complementary"
      aria-label="Produits dérivés"
      aria-hidden={!open}
      className={`fixed right-0 top-0 z-40 flex h-full w-[min(420px,92vw)] flex-col border-l border-border bg-surface shadow-2xl transition-transform duration-200 ${
        open ? "translate-x-0" : "pointer-events-none translate-x-full"
      }`}
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-text">Produits dérivés</h2>
            <p className="mt-0.5 text-[11px] text-text-dim">
              {isBinance ? `${coinalyzeSymbol} · Coinalyze` : "Coinalyze · Binance uniquement"}
            </p>
          </div>
          <button
            type="button"
            onClick={closeDerivatives}
            aria-label="Fermer les produits dérivés"
            className="rounded p-1 text-lg leading-none text-text-dim transition hover:bg-bg hover:text-text"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
```

par :

```tsx
    <>
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-text">Produits dérivés</h2>
            <p className="mt-0.5 text-[11px] text-text-dim">
              {isBinance ? `${coinalyzeSymbol} · Coinalyze` : "Coinalyze · Binance uniquement"}
            </p>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
```

Et à la toute fin du `return (...)` du composant, remplacer la fermeture `</aside>` par `</>`. Si `closeDerivatives` n'est plus utilisé nulle part ailleurs dans le fichier après ce retrait (vérifier avec `grep -n closeDerivatives apps/web/src/components/DerivativesWindow.tsx`), retirer aussi sa ligne `const closeDerivatives = useStore(derivativesUiStore, (s) => s.closeDerivatives);`.

- [ ] **Step 2: `EcoWindow.tsx`** — même transformation : wrapper `fixed right-0 top-0 z-40 ... w-[min(440px,94vw)] ...` → `<>`/`</>`, retrait du bouton fermer dans le `<header>`, retrait de `closeEco` si devenu inutilisé.

- [ ] **Step 3: `NewsWindow.tsx`** — même transformation, wrapper `w-[min(440px,94vw)] ... font-mono ...` (noter la classe `font-mono` additionnelle sur le wrapper : la reporter sur le `<header>` ou un conteneur interne pour ne pas perdre ce style — par exemple ajouter `font-mono` à la className du premier enfant conservé si la police doit s'appliquer à tout le contenu, sinon vérifier où elle est réellement utilisée avant de la déplacer).

- [ ] **Step 4: `CorrWindow.tsx`** — même transformation, wrapper `w-[min(480px,94vw)]`.

- [ ] **Step 5: `OnchainWindow.tsx`** — même transformation, wrapper `w-[min(460px,94vw)]`.

- [ ] **Step 6: `MarketMapWindow.tsx`** — même transformation, wrapper `w-[min(1100px,96vw)]`.

- [ ] **Step 7: `PortfolioWindow.tsx`** — même transformation, wrapper `w-[min(460px,94vw)]`.

- [ ] **Step 8: `NotesWindow.tsx`** — même transformation, wrapper `w-[min(440px,94vw)]`.

- [ ] **Step 9: `ScreenerWindow.tsx`** — même transformation, wrapper `w-[min(680px,96vw)]`.

- [ ] **Step 10: `TermStructureWindow.tsx`** — même transformation, wrapper `w-[min(480px,94vw)]`.

- [ ] **Step 11: `OptionsWindow.tsx`** — même transformation, wrapper `w-[min(480px,94vw)]`.

- [ ] **Step 12: `DomWindow.tsx`** — même transformation, wrapper `w-[min(560px,94vw)]`.

- [ ] **Step 13: `BacktestWindow.tsx`** — même transformation, wrapper `w-[min(720px,96vw)]`.

- [ ] **Step 14: `ReplayWindow.tsx`** — même transformation, wrapper `w-[min(420px,94vw)]`.

- [ ] **Step 15: Typecheck**

Run: `cd ~/axiom && pnpm --filter @axiom/web typecheck`
Expected: aucune erreur — si une variable `open`/`closeX` est signalée comme non utilisée dans un fichier, la retirer de ce fichier précisément (ne pas la retirer dans les autres si elle y sert encore).

- [ ] **Step 16: Lancer toute la suite de tests**

Run: `cd ~/axiom && pnpm --filter @axiom/web test`
Expected: PASS — ces fichiers n'ont pas de tests dédiés (composants), aucune régression attendue sur les tests existants d'autres modules.

- [ ] **Step 17: Build**

Run: `cd ~/axiom && pnpm --filter @axiom/web build`
Expected: succès (à ce stade, aucune de ces 14 fenêtres n'est encore montée dans `App.tsx` sous `<FloatingWindow>` — Task 9 s'en charge — donc le rendu réel n'est pas encore vérifiable visuellement, seule la compilation est vérifiée ici).

- [ ] **Step 18: Commit**

```bash
cd ~/axiom
git add apps/web/src/components/EcoWindow.tsx apps/web/src/components/NewsWindow.tsx \
  apps/web/src/components/CorrWindow.tsx apps/web/src/components/OnchainWindow.tsx \
  apps/web/src/components/MarketMapWindow.tsx apps/web/src/components/PortfolioWindow.tsx \
  apps/web/src/components/NotesWindow.tsx apps/web/src/components/ScreenerWindow.tsx \
  apps/web/src/components/TermStructureWindow.tsx apps/web/src/components/OptionsWindow.tsx \
  apps/web/src/components/DomWindow.tsx apps/web/src/components/BacktestWindow.tsx \
  apps/web/src/components/ReplayWindow.tsx apps/web/src/components/DerivativesWindow.tsx
git commit -m "refactor(window-manager): retrait du wrapper positionné des 14 fenêtres (repris par FloatingWindow)"
```

---

## Task 9: `App.tsx` — monter les 14 fenêtres sous `<FloatingWindow>`, retirer `PANNEAUX_DROITE`

**Files:**
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `FloatingWindow` (Task 5), `TaskbarMinimized` (Task 6), `WINDOW_REGISTRY` (Task 1), les 14 composants `*Window` (déjà importés aujourd'hui).

- [ ] **Step 1: Ajouter les imports**

En haut de `App.tsx`, ajouter :

```ts
import { FloatingWindow } from "./components/FloatingWindow";
import { TaskbarMinimized } from "./components/TaskbarMinimized";
import { WINDOW_REGISTRY } from "./store/windowManager";
```

- [ ] **Step 2: Construire la table composant↔id et remplacer le montage explicite**

Juste avant `export function App()`, ajouter (après le bloc `GRID_MODES` existant, avant tout bloc `PANNEAUX_DROITE`) :

```tsx
/** Association id de fenêtre (WINDOW_REGISTRY) -> composant de contenu. Utilisé pour
 * monter chaque fenêtre sous <FloatingWindow> de façon générique (au lieu de 14 JSX
 * explicites) et pour retirer PANNEAUX_DROITE (l'exclusion mutuelle est remplacée par
 * le z-order de windowManagerStore — plusieurs fenêtres peuvent désormais coexister). */
const WINDOW_COMPONENTS: Record<string, () => JSX.Element> = {
  derivatives: DerivativesWindow,
  eco: EcoWindow,
  news: NewsWindow,
  corr: CorrWindow,
  onchain: OnchainWindow,
  marketMap: MarketMapWindow,
  portfolio: PortfolioWindow,
  notes: NotesWindow,
  screener: ScreenerWindow,
  termStructure: TermStructureWindow,
  options: OptionsWindow,
  dom: DomWindow,
  backtest: BacktestWindow,
  replay: ReplayWindow,
};
```

- [ ] **Step 3: Retirer le bloc `PANNEAUX_DROITE` et son `useEffect` d'exclusion mutuelle**

Supprimer entièrement (déclaration du tableau `PANNEAUX_DROITE` ET le `useEffect` qui l'utilise dans `export function App()`, identifié par le commentaire « Exclusion mutuelle des panneaux dockés à droite »). Ce comportement est désormais géré par `windowManagerStore` (z-order, plusieurs fenêtres coexistantes) — vérifier qu'AUCUNE autre partie du fichier ne référence `PANNEAUX_DROITE` avant suppression (`grep -n PANNEAUX_DROITE apps/web/src/App.tsx` doit ne renvoyer que ce bloc).

- [ ] **Step 4: Remplacer le montage individuel des 14 `<XWindow />` par une boucle, et ajouter `<TaskbarMinimized />`**

Repérer dans le JSX de `App.tsx` les montages existants du type `<DerivativesWindow />`, `<EcoWindow />`, etc. (probablement groupés en fin de composant, après `<ChartGrid />`/la sidebar). Les remplacer par :

```tsx
{WINDOW_REGISTRY.map((entry) => {
  const Contenu = WINDOW_COMPONENTS[entry.id];
  if (!Contenu) return null;
  return (
    <FloatingWindow key={entry.id} id={entry.id} title={entry.title} mnemonic={entry.mnemonic}>
      <Contenu />
    </FloatingWindow>
  );
})}
<TaskbarMinimized />
```

- [ ] **Step 5: Typecheck**

Run: `cd ~/axiom && pnpm --filter @axiom/web typecheck`
Expected: aucune erreur (si un import de composant `*Window` devient orphelin car remplacé par l'entrée dans `WINDOW_COMPONENTS`, il reste nécessaire — ne PAS le retirer, il est utilisé dans l'objet)

- [ ] **Step 6: Lancer toute la suite de tests**

Run: `cd ~/axiom && pnpm --filter @axiom/web test`
Expected: PASS

- [ ] **Step 7: Build**

Run: `cd ~/axiom && pnpm --filter @axiom/web build`
Expected: succès

- [ ] **Step 8: Commit**

```bash
cd ~/axiom
git add apps/web/src/App.tsx
git commit -m "refactor(window-manager): App.tsx monte les 14 fenêtres sous FloatingWindow, retire PANNEAUX_DROITE"
```

---

## Task 10: `chart/paneHeaders.tsx` — en-têtes de pane (croix + drag-reorder)

**Files:**
- Create: `apps/web/src/chart/paneHeaders.tsx`
- Modify: `apps/web/src/chart/ChartInstance.tsx`

**Interfaces:**
- Consumes: `indicatorsStore`, `formatInstanceLabel` (de `../store/indicators`), `getIndicator` (de `@axiom/indicators`), `axiomPaneId` (de `./indicators`, Task 4), `computeDropOrder` (de `./paneOrder`, Task 3).
- Produces: `class PaneHeaders { constructor(chart, container); sync(): void; dispose(): void }`, instancié dans `ChartInstance.tsx` comme `ChartIndicators`/`OrderflowController`.

- [ ] **Step 1: Implémenter `PaneHeaders`**

```tsx
// apps/web/src/chart/paneHeaders.tsx
/**
 * En-têtes overlay DOM des panes d'indicateurs séparés (RSI, MACD…) : croix de
 * fermeture directe (appelle `indicatorsStore.remove`) et poignée de drag pour
 * réordonner. Pattern contrôleur identique à `ChartIndicators`/`OrderflowController`
 * (constructor(chart, container) -> sync() -> dispose()).
 *
 * Les indicateurs en overlay (EMA sur les bougies, `def.pane === "overlay"`) n'ont
 * pas de pane séparé : pas d'en-tête flottant pour eux, ils restent gérés depuis le
 * menu Indicateurs.
 *
 * Positionnement : `chart.getSize(paneId)` renvoie un `Bounding { top, left, width,
 * height, ... }` (vérifié sur klinecharts@9.8.12/dist/index.d.ts). Recalculé sur
 * l'événement natif `onPaneDrag` (redimensionnement manuel d'un pane) ET à chaque
 * `sync()` (ajout/retrait/réordonnancement d'indicateur).
 *
 * Réordonnancement : PaneOptions n'a pas de champ `order` en v9.8.12 — le calcul du
 * nouvel ordre (`computeDropOrder`) est appliqué à `indicatorsStore.reorder(...)`,
 * qui déclenche `ChartIndicators.sync()` (abonné à `indicatorsStore`) — c'est CE
 * contrôleur qui retire/recrée les panes dans le nouvel ordre (cf. chart/indicators.ts
 * Task 4). `PaneHeaders` ne manipule donc jamais directement l'ordre des panes.
 */
import type { Chart } from "klinecharts";
import { ActionType } from "klinecharts";
import { getIndicator } from "@axiom/indicators";
import { indicatorsStore, formatInstanceLabel } from "../store/indicators";
import { axiomPaneId } from "./indicators";
import { computeDropOrder } from "./paneOrder";

interface EnTetePane {
  instanceId: string;
  paneId: string;
  label: string;
}

/** Panes séparés (hors overlay) VOULUS, dans l'ordre courant du store. */
function panesSepares(): EnTetePane[] {
  const result: EnTetePane[] = [];
  for (const inst of indicatorsStore.getState().indicators) {
    const def = getIndicator(inst.defId);
    if (!def || def.pane === "overlay") continue;
    result.push({ instanceId: inst.instanceId, paneId: axiomPaneId(inst.instanceId), label: formatInstanceLabel(def, inst.params) });
  }
  return result;
}

export class PaneHeaders {
  private readonly chart: Chart;
  private readonly container: HTMLElement;
  private readonly els = new Map<string, HTMLDivElement>();
  private draggingId: string | null = null;
  private readonly onPaneDrag = (): void => this.repositionnerTout();

  constructor(chart: Chart, container: HTMLElement) {
    this.chart = chart;
    this.container = container;
    this.chart.subscribeAction(ActionType.OnPaneDrag, this.onPaneDrag);
  }

  /** Réconcilie les en-têtes avec la liste courante d'indicateurs à pane séparé. */
  sync(): void {
    const panes = panesSepares();
    const wanted = new Set(panes.map((p) => p.instanceId));
    for (const [id, el] of this.els) {
      if (!wanted.has(id)) {
        el.remove();
        this.els.delete(id);
      }
    }
    for (const pane of panes) {
      let el = this.els.get(pane.instanceId);
      if (!el) {
        el = this.creerElement(pane);
        this.els.set(pane.instanceId, el);
        this.container.appendChild(el);
      } else {
        const label = el.querySelector<HTMLSpanElement>("[data-role=label]");
        if (label) label.textContent = pane.label;
      }
    }
    this.repositionnerTout();
  }

  private repositionnerTout(): void {
    for (const pane of panesSepares()) {
      const el = this.els.get(pane.instanceId);
      if (el) this.positionner(pane.paneId, el);
    }
  }

  private creerElement(pane: EnTetePane): HTMLDivElement {
    const el = document.createElement("div");
    el.className =
      "pointer-events-auto absolute left-2 z-10 flex items-center gap-1.5 rounded bg-surface/90 px-1.5 py-0.5 text-[10px] text-text-dim shadow-sm";

    const poignee = document.createElement("span");
    poignee.textContent = "⠿";
    poignee.className = "cursor-grab select-none";
    poignee.addEventListener("pointerdown", (e) => this.demarrerDrag(e, pane.instanceId));

    const label = document.createElement("span");
    label.textContent = pane.label;
    label.setAttribute("data-role", "label");
    label.className = "max-w-[120px] truncate";

    const croix = document.createElement("button");
    croix.textContent = "✕";
    croix.type = "button";
    croix.className = "leading-none text-text-dim hover:text-text";
    croix.addEventListener("click", () => indicatorsStore.getState().remove(pane.instanceId));

    el.append(poignee, label, croix);
    return el;
  }

  private positionner(paneId: string, el: HTMLDivElement): void {
    const bounding = this.chart.getSize(paneId);
    if (!bounding) {
      el.style.display = "none";
      return;
    }
    el.style.display = "";
    el.style.top = `${bounding.top + 2}px`;
  }

  private demarrerDrag(e: PointerEvent, instanceId: string): void {
    e.preventDefault();
    this.draggingId = instanceId;
    const onMove = (ev: PointerEvent): void => this.pendantDrag(ev);
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      this.draggingId = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  private pendantDrag(e: PointerEvent): void {
    if (!this.draggingId) return;
    const panes = panesSepares();
    const containerRect = this.container.getBoundingClientRect();
    const relativeY = e.clientY - containerRect.top;
    let dropIndex = 0;
    for (const pane of panes) {
      if (pane.instanceId === this.draggingId) continue;
      const bounding = this.chart.getSize(pane.paneId);
      if (bounding && bounding.top + bounding.height / 2 < relativeY) dropIndex++;
    }
    const order = computeDropOrder(
      panes.map((p) => p.instanceId),
      this.draggingId,
      dropIndex
    );
    indicatorsStore.getState().reorder(order);
  }

  dispose(): void {
    this.chart.unsubscribeAction(ActionType.OnPaneDrag, this.onPaneDrag);
    for (const el of this.els.values()) el.remove();
    this.els.clear();
  }
}
```

- [ ] **Step 2: Monter `PaneHeaders` dans `ChartInstance.tsx`**

Dans `apps/web/src/chart/ChartInstance.tsx`, ajouter l'import : `import { PaneHeaders } from "./paneHeaders";`

Juste après le bloc existant :

```ts
    const indicators = new ChartIndicators(chart);
    const unsubscribeIndicators = indicatorsStore.subscribe((state) => {
      indicators.sync(state.indicators, store.getState().candles);
    });
```

ajouter :

```ts
    // En-têtes overlay des panes séparés (croix + drag-reorder) : le contrôleur lit
    // `indicatorsStore` lui-même (pas besoin de brancher `state` du subscribe ci-dessus).
    const paneHeaders = new PaneHeaders(chart, container);
    const unsubscribePaneHeaders = indicatorsStore.subscribe(() => paneHeaders.sync());
    paneHeaders.sync();
```

Repérer le bloc de nettoyage `return () => { ... }` de ce `useEffect` (là où `unsubscribeIndicators()` est déjà appelé) et y ajouter :

```ts
      unsubscribePaneHeaders();
      paneHeaders.dispose();
```

- [ ] **Step 3: Typecheck**

Run: `cd ~/axiom && pnpm --filter @axiom/web typecheck`
Expected: aucune erreur

- [ ] **Step 4: Lancer toute la suite de tests**

Run: `cd ~/axiom && pnpm --filter @axiom/web test`
Expected: PASS

- [ ] **Step 5: Build**

Run: `cd ~/axiom && pnpm --filter @axiom/web build`
Expected: succès

- [ ] **Step 6: Commit**

```bash
cd ~/axiom
git add apps/web/src/chart/paneHeaders.tsx apps/web/src/chart/ChartInstance.tsx
git commit -m "feat(chart): en-têtes de pane (croix de fermeture + drag-reorder) via PaneHeaders"
```

---

## Task 11: Groupes liés — symbole indépendant pour Produits dérivés

**Files:**
- Modify: `apps/web/src/components/DerivativesWindow.tsx`

**Interfaces:**
- Consumes: `windowManagerStore` (pour lire `groupColor`/`groupSymbols` de la fenêtre `"derivatives"`).

**Portée (rappel du spec approuvé) :** la propagation de symbole par groupe s'applique aux slots de la grille multi-chart (déjà existants, hors périmètre de CE plan — cf. section « Écarts vs spec » ci-dessous) et à Produits dérivés. Les autres fenêtres reçoivent une couleur de groupe pour l'organisation visuelle uniquement (déjà couvert par `FloatingWindow`, Task 5 — aucune action requise ici).

**Écart vs le spec approuvé :** le spec supposait que `chart-layout.ts` avait un `linked: boolean` PAR SLOT, transformable en `groupColor`. En réalité `chart-layout.ts` a UN SEUL `linked: boolean` global pour toute la grille (pas par slot) — un changement plus profond que prévu. Ce plan NE TOUCHE PAS `chart-layout.ts` : les groupes liés couvrent les 14 fenêtres Bloomberg + Produits dérivés uniquement. Étendre aux slots de grille est reporté à un lot ultérieur.

- [ ] **Step 1: Lire le symbole effectif depuis le groupe si la fenêtre en a un**

Dans `apps/web/src/components/DerivativesWindow.tsx`, repérer la ligne actuelle qui lit le symbole global :

```ts
  const symbol = useStore(marketStore, (s) => s.symbol);
```

La remplacer par :

```ts
  const symbolGlobal = useStore(marketStore, (s) => s.symbol);
  const groupColor = useStore(windowManagerStore, (s) => s.windows["derivatives"]?.groupColor ?? null);
  const symbolGroupe = useStore(windowManagerStore, (s) => (groupColor ? s.groupSymbols[groupColor] : undefined));
  const symbol = symbolGroupe ?? symbolGlobal;
```

Ajouter l'import : `import { windowManagerStore } from "../store/windowManager";`

- [ ] **Step 2: Typecheck**

Run: `cd ~/axiom && pnpm --filter @axiom/web typecheck`
Expected: aucune erreur

- [ ] **Step 3: Lancer toute la suite de tests**

Run: `cd ~/axiom && pnpm --filter @axiom/web test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd ~/axiom
git add apps/web/src/components/DerivativesWindow.tsx
git commit -m "feat(window-manager): Produits dérivés suit le symbole de son groupe lié si assigné"
```

---

## Task 12: Persistance — `store/persist.ts`

**Files:**
- Modify: `apps/web/src/store/persist.ts`

**Interfaces:**
- Consumes: `windowManagerStore`, `EtatFenetre`, `WINDOW_REGISTRY` (de `./windowManager`).
- Produces: clé localStorage dédiée `axiom:windowManager:v1` (dual-write daemon automatique via `writeJson`, même mécanisme que `ChartState`).

- [ ] **Step 1: Ajouter l'import et la clé**

Ajouter en haut du fichier : `import { windowManagerStore, type EtatFenetre } from "./windowManager";`

Ajouter à côté de `const CHART_KEY = "axiom:chartState:v1";` : `const WINDOW_MANAGER_KEY = "axiom:windowManager:v1";`

- [ ] **Step 2: Ajouter la section save/restore**

Après la fonction `saveChartState()` (et avant la section suivante « Watchlist »), ajouter :

```ts
// ─────────────────────────── WindowManager (géométrie des fenêtres flottantes) ───────────────────────────

/** Construit l'état persistable du gestionnaire de fenêtres. */
function currentWindowManagerState(): Record<string, EtatFenetre> {
  return windowManagerStore.getState().windows;
}

export function saveWindowManagerState(): void {
  writeJson(WINDOW_MANAGER_KEY, currentWindowManagerState());
}

/** Validation légère d'une fenêtre persistée (repli sur des valeurs sûres si un champ
 * est corrompu/manquant — même esprit que `migratePersistedIndicators`). */
function validateEtatFenetre(id: string, raw: unknown): EtatFenetre | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Partial<EtatFenetre>;
  if (
    typeof r.x !== "number" ||
    typeof r.y !== "number" ||
    typeof r.width !== "number" ||
    typeof r.height !== "number" ||
    typeof r.z !== "number"
  ) {
    return null;
  }
  return {
    id,
    open: false, // toujours restauré FERMÉ (évite 14 fenêtres à l'écran au démarrage)
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    z: r.z,
    minimized: false,
    groupColor: typeof r.groupColor === "string" ? r.groupColor : null,
  };
}

/** Restaure la géométrie des fenêtres depuis localStorage (position/taille/groupe —
 * toujours restaurées FERMÉES, l'utilisateur les rouvre via la palette/Toolbar). */
function hydrateWindowManager(): void {
  const persisted = readJson<Record<string, unknown>>(WINDOW_MANAGER_KEY);
  if (!persisted) return;
  const windows: Record<string, EtatFenetre> = {};
  for (const entry of WINDOW_REGISTRY) {
    const validated = validateEtatFenetre(entry.id, persisted[entry.id]);
    if (validated) windows[entry.id] = validated;
  }
  windowManagerStore.getState().setAll(windows);
}
```

- [ ] **Step 3: Brancher l'hydratation et la sauvegarde automatique**

Dans `hydrateStores()`, ajouter l'appel :

```ts
export function hydrateStores(): void {
  hydrateChart();
  hydrateWindowManager();
  hydrateWatchlist();
  hydrateSession();
}
```

Dans `enablePersistence()`, ajouter l'abonnement (à côté de `indicatorsStore.subscribe(() => saveChartState());`) :

```ts
  windowManagerStore.subscribe(() => saveWindowManagerState());
```

- [ ] **Step 4: Typecheck**

Run: `cd ~/axiom && pnpm --filter @axiom/web typecheck`
Expected: aucune erreur

- [ ] **Step 5: Lancer toute la suite de tests**

Run: `cd ~/axiom && pnpm --filter @axiom/web test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd ~/axiom
git add apps/web/src/store/persist.ts
git commit -m "feat(window-manager): persistance de la géométrie des fenêtres (localStorage + dual-write daemon)"
```

---

## Task 13: Workspaces — `store/workspaces.ts`

**Files:**
- Modify: `apps/web/src/store/workspaces.ts`

**Interfaces:**
- Modifie `WorkspaceContent` (ajoute `windowGeometry: Record<string, EtatFenetre>`), `snapshot()`, `applyContent()`.

- [ ] **Step 1: Ajouter l'import**

Ajouter : `import { windowManagerStore, type EtatFenetre } from "./windowManager";`

- [ ] **Step 2: Étendre `WorkspaceContent`**

Ajouter un champ à l'interface :

```ts
export interface WorkspaceContent {
  exchange: ExchangeId;
  symbol: string;
  timeframe: Timeframe;
  indicators: ActiveIndicator[];
  orderflow: boolean;
  volumeProfile: boolean;
  revenue: boolean;
  compare: string[];
  macroOverlays: MacroOverlayId[];
  theme: ThemeId;
  sections: Record<string, boolean>;
  priceScale: PriceScaleType;
  /** Géométrie des fenêtres flottantes (position/taille/groupe) — toujours appliquée
   * FERMÉE (cohérent avec `hydrateWindowManager`, cf. persist.ts). */
  windowGeometry: Record<string, EtatFenetre>;
}
```

- [ ] **Step 3: Étendre `snapshot()`**

Ajouter au retour de `snapshot()` : `windowGeometry: windowManagerStore.getState().windows,`

- [ ] **Step 4: Étendre `applyContent()`**

Ajouter dans `applyContent(c)` :

```ts
  windowManagerStore.getState().setAll(c.windowGeometry);
```

- [ ] **Step 5: Typecheck**

Run: `cd ~/axiom && pnpm --filter @axiom/web typecheck`
Expected: aucune erreur

- [ ] **Step 6: Lancer toute la suite de tests**

Run: `cd ~/axiom && pnpm --filter @axiom/web test`
Expected: PASS (si des tests existants de `workspaces.test.ts` construisent un `WorkspaceContent` littéral, les mettre à jour avec `windowGeometry: {}` — vérifier `apps/web/src/store/workspaces.test.ts` s'il existe et corriger les fixtures qui échoueraient au typecheck)

- [ ] **Step 7: Commit**

```bash
cd ~/axiom
git add apps/web/src/store/workspaces.ts
git commit -m "feat(window-manager): les workspaces incluent la géométrie des fenêtres flottantes"
```

---

## Task 14: Vérification manuelle (Chrome DevTools MCP)

**Files:** aucun (vérification runtime, pas de code).

- [ ] **Step 1: Build + lancer le daemon**

```bash
cd ~/axiom
pnpm --filter @axiom/web build
~/.bun/bin/bun apps/daemon/src/index.ts &
sleep 2
curl -s http://127.0.0.1:8787/health
```

Expected: `{"ok":true,...}`

- [ ] **Step 2: Ouvrir l'app et vérifier CHAQUE fenêtre individuellement**

Naviguer sur `http://127.0.0.1:8787/` (Chrome DevTools MCP), ouvrir successivement les 14 fenêtres (palette ⌘K par mnémonique : ECO, NEWS, CORR, CHAIN, IMAP, PORT, NOTE, EQS, TERM, OMON, DOM, BT, REPLAY, DES). Pour CHACUNE, vérifier au screenshot : le contenu s'affiche correctement (pas de layout cassé suite au retrait du wrapper), le drag par l'en-tête fonctionne, le resize par au moins 2 poignées fonctionne, la croix ferme la fenêtre, le bouton « — » la réduit (pastille apparaît dans la barre de tâches en bas), cliquer la pastille la restaure. Lister au fil de l'eau toute fenêtre en régression visuelle.

- [ ] **Step 3: Vérifier la coexistence de plusieurs fenêtres + le z-order**

Ouvrir 3 fenêtres simultanément (ex. ECO, NEWS, DES), vérifier qu'elles restent TOUTES visibles (pas d'exclusion mutuelle), que cliquer sur l'une la fait passer devant les autres.

- [ ] **Step 4: Vérifier les groupes liés**

Assigner la même couleur à Produits dérivés et changer le symbole actif du chart (le symbole global) — vérifier si Produits dérivés bascule bien sur `symbolGroupe` seulement s'il en a un assigné (sinon il doit continuer à suivre le symbole global, comportement par défaut).

- [ ] **Step 5: Vérifier les panes d'indicateurs**

Ajouter 3 indicateurs à pane séparé (ex. RSI, MACD, ATR) via le menu Indicateurs. Vérifier : une croix apparaît sur chaque pane et le ferme directement (sans repasser par le menu) ; le drag de la poignée réordonne visuellement les panes ET persiste au reload (F5) ; le redimensionnement de hauteur d'un pane (bord natif KLineChart) fonctionne toujours. **Point d'attention explicite (cf. Task 4)** : confirmer empiriquement que le retrait+recréation produit bien le NOUVEL ordre voulu (et pas l'inverse) — sinon, inverser le sens de calcul dans `computeDropOrder`/`pendantDrag` (fichier `chart/paneOrder.ts` ou `chart/paneHeaders.tsx`, pas de refonte nécessaire, juste un ajustement de signe/ordre).

- [ ] **Step 6: Vérifier la persistance**

Positionner/redimensionner 2-3 fenêtres, recharger la page (F5) — les fenêtres doivent réapparaître FERMÉES mais avec leur position/taille/groupe conservés à la prochaine ouverture. Sauvegarder un workspace nommé, changer la disposition, recharger le workspace — la géométrie doit être restaurée.

- [ ] **Step 7: Vérifier l'absence de régression sur les fonctionnalités existantes**

Chart mono/multi (grille 2×2 déjà existante), watchlist, alertes, thèmes — un tour rapide pour confirmer qu'aucun de ces éléments n'a été perturbé par les changements de `App.tsx`/`persist.ts`/`workspaces.ts`.

- [ ] **Step 8: Arrêter le daemon**

```bash
kill %1
```

- [ ] **Step 9: Consigner les régressions trouvées (s'il y en a) comme correctifs ciblés, puis commit final**

Si des régressions ont été trouvées et corrigées pendant cette vérification, committer séparément avec un message décrivant précisément le correctif (fichier + comportement corrigé), PAS un commit générique « fix bugs ».

---

## Self-Review (fait par l'auteur du plan, pas une étape à exécuter)

1. **Couverture du spec** : Launchpad complet (drag/resize/z-order/minimize) → Tasks 5, 8, 9. Groupes liés v1 (portée : fenêtres + Dérivés) → Tasks 5, 11 (chart-layout.ts explicitement exclu, écart documenté). Panes fermables/réordonnables → Tasks 2, 3, 4, 10. Persistance/workspaces → Tasks 12, 13. Vérification manuelle → Task 14. Aucune section du spec approuvé sans tâche correspondante.
2. **Corrections techniques significatives faites pendant ce plan (au-delà du spec, à connaître avant exécution)** : (a) `PaneOptions` n'a pas de champ `order`/`state` en v9.8.12 réellement installée (contrairement à ce que context7 seul indiquait) → réordonnancement par retrait/recréation (Task 4), pas de minimize natif de pane (bonus abandonné). (b) `chart-layout.ts` a un `linked: boolean` GLOBAL, pas par slot → les groupes liés ne couvrent PAS la grille multi-chart dans ce plan (Task 11, écart documenté).
3. **Cohérence des types/noms** : `EtatFenetre`, `WindowManagerState`, `WINDOW_REGISTRY`, `mirrorOpenState`, `axiomPaneId`, `computeDropOrder`, `indicatorsStore.reorder` — mêmes noms exacts utilisés de bout en bout entre les tasks qui les définissent et celles qui les consomment.
