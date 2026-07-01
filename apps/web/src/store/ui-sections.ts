/**
 * Store de l'état replié des sections de la sidebar — Zustand VANILLA (hors render-loop).
 *
 * Rend l'accordéon de `SidebarSection` CONTRÔLABLE et PERSISTABLE : au lieu d'un
 * `useState` interne perdu au rechargement, l'état ouvert/replié de chaque section
 * vit ici, indexé par le TITRE de la section (unique : « Watchlist », « Alertes »,
 * « Comparer (base 100) »…). Une clé ABSENTE de la carte => la section retombe sur
 * son `defaultOpen` (le composant reste maître de son défaut).
 *
 * Basse fréquence (repli/dépli manuel) : les composants peuvent s'y abonner sans
 * risque de re-render sur tick. Persisté par `persist.ts` (clé de session) et
 * capturé par les workspaces (`workspaces.ts`).
 */
import { createStore } from "zustand/vanilla";

export interface UiSectionsState {
  /** État ouvert (true) / replié (false) par TITRE de section ; clé absente => défaut du composant. */
  open: Record<string, boolean>;
  /**
   * Bascule une section. `fallbackOpen` = `defaultOpen` du composant, utilisé comme
   * valeur de départ quand la section n'a encore jamais été (dé)pliée manuellement.
   */
  toggle: (id: string, fallbackOpen: boolean) => void;
  /** Force l'état ouvert/replié d'une section. */
  setOpen: (id: string, open: boolean) => void;
  /** Remplace TOUTE la carte (restauration persist.ts / application de workspace). */
  setAll: (open: Record<string, boolean>) => void;
}

export const uiSectionsStore = createStore<UiSectionsState>((set, get) => ({
  open: {},

  toggle: (id, fallbackOpen) => {
    const current = get().open[id] ?? fallbackOpen;
    set({ open: { ...get().open, [id]: !current } });
  },

  setOpen: (id, open) => set({ open: { ...get().open, [id]: open } }),

  setAll: (open) => set({ open: { ...open } }),
}));
