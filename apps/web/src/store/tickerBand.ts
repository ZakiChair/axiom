/**
 * Store bandeau ticker news — Zustand VANILLA (hors render-loop React).
 *
 * Tient la visibilité du bandeau d'actualités défilant (TickerBand, sous la Toolbar)
 * et la persiste lui-même dans localStorage (clé dédiée `axiom:tickerBand:v1`, même
 * pattern autonome que `store/theme` — pas de passage par store/persist : un seul
 * booléen, hydratation synchrone à l'import). Visible par défaut.
 *
 * Le tableau `commandes` est exporté pour la palette (mnémonique TICKER) : l'intégrateur
 * l'enregistre via `enregistrerCommandes` (import de TYPE seul depuis commands/registry
 * → aucune dépendance runtime, pas de cycle), comme store/news.
 */
import { createStore } from "zustand/vanilla";
import type { Commande } from "../commands/registry";

/** Clé localStorage dédiée à la visibilité du bandeau. */
const STORAGE_KEY = "axiom:tickerBand:v1";

/** Lecture tolérante de la visibilité persistée (absente/corrompue => visible). */
function lireVisible(): boolean {
  try {
    const brut = localStorage.getItem(STORAGE_KEY);
    if (brut === null) return true;
    return (JSON.parse(brut) as unknown) !== false; // seul `false` explicite masque
  } catch {
    return true;
  }
}

/** Écriture tolérante (mode privé / quota => silencieux). */
function ecrireVisible(visible: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(visible));
  } catch {
    /* persistance best-effort */
  }
}

export interface TickerBandState {
  /** true quand le bandeau est affiché (sous la Toolbar). */
  visible: boolean;
  /** Affiche / masque le bandeau (persisté). */
  basculer: () => void;
}

export const tickerBandStore = createStore<TickerBandState>((set, get) => ({
  visible: lireVisible(),
  basculer: () => {
    const visible = !get().visible;
    ecrireVisible(visible);
    set({ visible });
  },
}));

// ─────────────────────────── Commandes de palette (additives) ───────────────────────────

/** Commande TICKER greffée dans la palette par l'intégrateur (`enregistrerCommandes`). */
export const commandes: Commande[] = [
  {
    id: "panneau:ticker",
    mnemonique: "TICKER",
    libelle: "Bandeau actualités défilant",
    categorie: "panneau",
    motsCles: ["ticker", "bandeau", "news", "defilant", "marquee", "headlines", "macro", "bloomberg", "cnbc"],
    apercu: "Affiche / masque le bandeau d'actualités défilant",
    action: () => tickerBandStore.getState().basculer(),
  },
];
