/**
 * Gestionnaire de fenêtres flottantes AXIOM (« Launchpad ») — Zustand VANILLA, hors
 * render-loop React. Source de vérité UNIQUE de la géométrie/état (position, taille,
 * z-order, minimize, groupe de couleur) des 21 fenêtres Bloomberg non modales.
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

/** Registre statique des 21 fenêtres Bloomberg : titre/mnémonique/taille par défaut
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
  { id: "marketMap", title: "Vue marché (treemap)", mnemonic: "MAP", defaultWidth: 1100, defaultHeight: 720 },
  { id: "portfolio", title: "Portefeuille", mnemonic: "PORT", defaultWidth: 460, defaultHeight: 640 },
  { id: "notes", title: "Notes / journal", mnemonic: "NOTE", defaultWidth: 440, defaultHeight: 640 },
  { id: "screener", title: "Screener d'actifs", mnemonic: "EQS", defaultWidth: 680, defaultHeight: 680 },
  { id: "termStructure", title: "Structure par terme", mnemonic: "TERM", defaultWidth: 480, defaultHeight: 640 },
  { id: "options", title: "Options (smile IV, max pain)", mnemonic: "OMON", defaultWidth: 480, defaultHeight: 640 },
  { id: "dom", title: "Carnet d'ordres (DOM / depth)", mnemonic: "DOM", defaultWidth: 560, defaultHeight: 680 },
  { id: "backtest", title: "Backtest de stratégie", mnemonic: "BT", defaultWidth: 720, defaultHeight: 680 },
  { id: "replay", title: "Replay de marché", mnemonic: "REPLAY", defaultWidth: 420, defaultHeight: 640 },
  { id: "macroRates", title: "Taux & Réserves souveraines", mnemonic: "RATE", defaultWidth: 560, defaultHeight: 680 },
  { id: "cot", title: "Rapport COT (CFTC)", mnemonic: "COT", defaultWidth: 520, defaultHeight: 680 },
  { id: "seasonality", title: "Saisonnalité", mnemonic: "SEAG", defaultWidth: 760, defaultHeight: 560 },
  { id: "vol", title: "Volatilité (cône RV, VRP)", mnemonic: "VOL", defaultWidth: 760, defaultHeight: 560 },
  { id: "fund", title: "Fiche société (FUND)", mnemonic: "FUND", defaultWidth: 480, defaultHeight: 640 },
  { id: "brief", title: "Point marché", mnemonic: "BRIEF", defaultWidth: 480, defaultHeight: 720 },
  { id: "globe", title: "Globe (chokepoints & trafic aérien)", mnemonic: "GLOBE", defaultWidth: 720, defaultHeight: 720 },
] as const;

/** Espace minimal toujours visible d'une fenêtre (pixels), pour le drag comme le resize. */
export const MIN_WIDTH = 320;
export const MIN_HEIGHT = 240;

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
  /** Géométrie d'avant le dernier snap Aero appliqué (gauche/droite/haut) — permet de
   * restaurer en glissant l'en-tête depuis l'état maximisé/ancré, comme Windows/macOS.
   * `null` si la fenêtre n'est pas actuellement dans un état issu d'un snap. */
  preSnapGeometry: { x: number; y: number; width: number; height: number } | null;
}

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

export interface WindowManagerState {
  windows: Record<string, EtatFenetre>;
  /** Compteur global de z-index — incrémenté à chaque focus/ouverture/restore. */
  nextZ: number;
  /** Couleur de groupe -> dernier symbole diffusé aux fenêtres/composants de ce groupe. */
  groupSymbols: Record<string, string>;
  /** Aperçu de snap actif pendant un drag d'en-tête (géométrie cible de la zone
   * survolée) — état ÉPHÉMÈRE, jamais persisté (persist.ts construit explicitement
   * le sous-ensemble sauvegardé, ce champ n'y figure simplement pas). */
  dragPreview: { x: number; y: number; width: number; height: number } | null;
  /** Zone de travail actuelle (rect du conteneur du graphe, exclut toolbar/barre de
   * dessin/panneau latéral) — mesurée par App.tsx via ResizeObserver, jamais persistée
   * (recalculée à chaque montage). Référentiel de TOUT le placement/redimensionnement/
   * snap des fenêtres flottantes, à la place de window.innerWidth/innerHeight. */
  workspace: WorkspaceRect;

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
  /** Applique une géométrie de snap Aero : sauvegarde la géométrie ACTUELLE dans
   * `preSnapGeometry` (pour restaurer plus tard en glissant l'en-tête), puis applique
   * la nouvelle géométrie. Remplace le couple moveWindow+resizeWindow pour un snap. */
  snapWindow: (id: string, geometrie: { x: number; y: number; width: number; height: number }) => void;
  setPreSnapGeometry: (id: string, preSnapGeometry: { x: number; y: number; width: number; height: number } | null) => void;
  setDragPreview: (preview: { x: number; y: number; width: number; height: number } | null) => void;
  /** Restauration depuis la persistance (déjà validée par l'appelant). */
  setAll: (windows: Record<string, EtatFenetre>) => void;
  /** Recale position/taille de toutes les fenêtres OUVERTES contre un nouveau workspace
   * (déclenché par un resize du navigateur, cf. App.tsx) — même clamp pur que le
   * drag/resize interactif, appliqué en lot. */
  reclampAll: (workspace: WorkspaceRect) => void;
  setWorkspace: (workspace: WorkspaceRect) => void;
}

export const windowManagerStore = createStore<WindowManagerState>((set, get) => ({
  windows: {},
  nextZ: 1,
  groupSymbols: {},
  dragPreview: null,
  workspace: { x: 0, y: 0, width: 1920, height: 1080 },

  openWindow: (id) => {
    const state = get();
    const existing = state.windows[id];
    const nextZ = state.nextZ;
    if (existing) {
      const size = clampSize(existing.width, existing.height, MIN_WIDTH, MIN_HEIGHT, state.workspace);
      const pos = clampPosition(existing.x, existing.y, size.width, size.height, state.workspace);
      set({
        windows: { ...state.windows, [id]: { ...existing, ...pos, ...size, open: true, minimized: false, z: nextZ } },
        nextZ: nextZ + 1,
      });
      return;
    }
    const entry = WINDOW_REGISTRY.find((w) => w.id === id);
    const width = entry?.defaultWidth ?? 480;
    const height = entry?.defaultHeight ?? 640;
    const openCount = Object.values(state.windows).filter((w) => w.open).length;
    const { x, y } = cascadePosition(openCount, state.workspace, width, height);
    set({
      windows: {
        ...state.windows,
        [id]: {
          id,
          open: true,
          x,
          y,
          width,
          height,
          z: nextZ,
          minimized: false,
          groupColor: null,
          preSnapGeometry: null,
        },
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

  snapWindow: (id, geometrie) => {
    const existing = get().windows[id];
    if (!existing) return;
    set({
      windows: {
        ...get().windows,
        [id]: {
          ...existing,
          ...geometrie,
          preSnapGeometry: { x: existing.x, y: existing.y, width: existing.width, height: existing.height },
        },
      },
    });
  },

  setPreSnapGeometry: (id, preSnapGeometry) => {
    const existing = get().windows[id];
    if (!existing) return;
    set({ windows: { ...get().windows, [id]: { ...existing, preSnapGeometry } } });
  },

  setDragPreview: (preview) => set({ dragPreview: preview }),

  setWorkspace: (workspace) => {
    set({ workspace });
    get().reclampAll(workspace);
  },

  setAll: (windows) =>
    set({
      windows,
      // Ne recule jamais : garde le nextZ courant si aucune fenêtre restaurée ne le
      // dépasse (pas atteignable aujourd'hui via workspaces/persist.ts, qui repartent
      // toujours de z cohérents — filet défensif pour un futur appelant).
      nextZ: Math.max(get().nextZ, ...Object.values(windows).map((w) => w.z), 0) + 1,
    }),

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
}));

/**
 * Synchronise le champ `open` d'un store `*UiStore` EXISTANT avec `windowManagerStore`
 * (source de vérité). À appeler une fois au chargement du module du store concerné.
 * Capte aussi bien les changements déclenchés par les commandes (`openEco()` etc.) que
 * ceux déclenchés par le chrome `<FloatingWindow>` (croix, minimize, restore).
 *
 * Sync IMMÉDIAT à l'enregistrement : indispensable pour le lazy-load des fenêtres
 * (le module store se charge APRÈS `openWindow`, sans nouvel évènement subscribe).
 */
export function mirrorOpenState(
  id: string,
  target: { getState: () => { open: boolean }; setState: (partial: { open: boolean }) => void }
): void {
  const sync = (isOpen: boolean): void => {
    if (isOpen !== target.getState().open) {
      target.setState({ open: isOpen });
    }
  };
  sync(windowManagerStore.getState().windows[id]?.open ?? false);
  windowManagerStore.subscribe((state) => {
    sync(state.windows[id]?.open ?? false);
  });
}
