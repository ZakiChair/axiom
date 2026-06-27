/**
 * Store thème — Zustand VANILLA (hors render-loop React).
 *
 * Tient le thème courant et le persiste dans localStorage (clé `axiom:theme`,
 * distincte de `axiom:chartState` / `axiom:watchlist`). À chaque changement — et
 * une fois au boot (exécution top-level de ce module, importé tôt par main.tsx) —
 * il pose l'attribut [data-theme="…"] sur <html> (document.documentElement) ;
 * tout le reste (variables CSS, classes Tailwind sémantiques, canvas KLineChart)
 * découle de cet attribut. Poser l'attribut AVANT le premier rendu évite le flash
 * « dark -> thème persisté » au rechargement.
 */
import { createStore } from "zustand/vanilla";

/** Thèmes disponibles (ordre = ordre d'affichage dans le sélecteur). */
export const THEMES = ["dark", "bloomberg", "matrix", "cute", "aurora"] as const;
export type ThemeId = (typeof THEMES)[number];

/** Clé localStorage dédiée au thème. */
const STORAGE_KEY = "axiom:theme";
/** Thème par défaut (rendu historique sombre). */
const DEFAULT_THEME: ThemeId = "dark";

/** Garde de type : valeur restaurée == thème connu ? */
function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/** Lecture tolérante du thème persisté (localStorage indisponible / valeur invalide => défaut). */
function readPersisted(): ThemeId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (isThemeId(raw)) return raw;
  } catch {
    /* localStorage indisponible (mode privé) : on retombe sur le défaut. */
  }
  return DEFAULT_THEME;
}

/** Pose l'attribut [data-theme] sur <html> : sélectionne le jeu de variables CSS. */
function applyTheme(theme: ThemeId): void {
  document.documentElement.setAttribute("data-theme", theme);
}

export interface ThemeState {
  theme: ThemeId;
  /** Change le thème : applique l'attribut, persiste, notifie les abonnés. */
  setTheme: (theme: ThemeId) => void;
}

export const themeStore = createStore<ThemeState>((set) => ({
  theme: readPersisted(),
  setTheme: (theme) => {
    applyTheme(theme); // d'abord le DOM : les abonnés (Chart) relisent des tokens à jour.
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* persistance best-effort */
    }
    set({ theme });
  },
}));

// Boot : pose l'attribut dès l'import du module (avant le premier rendu de main.tsx).
applyTheme(themeStore.getState().theme);
