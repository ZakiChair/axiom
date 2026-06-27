/**
 * Store de comparaison multi-courbes — Zustand VANILLA (hors render-loop React).
 *
 * Liste des symboles superposés au sous-pane « Comparaison (base 100) » (cap 4),
 * chacun avec une couleur STABLE assignée à l'ajout (1re couleur libre de la
 * palette). Modifié seulement à l'ajout/suppression (BASSE fréquence) : aucune
 * donnée live ne transite ici. Lu par le panneau CompareControl (légende) et par
 * le contrôleur de comparaison du Chart (souscription impérative).
 *
 * Session-only : non persisté (cohérent avec l'orderflow ; le `ChartState` figé de
 * @axiom/types ne comporte pas de champ comparaison — on ne modifie pas les types).
 */
import { createStore } from "zustand/vanilla";

/** Nombre maximum de symboles de comparaison (cap produit). */
export const MAX_COMPARE = 4;

/**
 * Palette des courbes comparées : 4 teintes vives DISTINCTES des bougies up/down
 * (jamais de vert/rouge pur, pour ne pas évoquer la hausse/baisse) et entre elles.
 */
export const COMPARE_PALETTE = ["#f59e0b", "#3b82f6", "#a855f7", "#ec4899"] as const;

/**
 * Couleur de la ligne du symbole PRINCIPAL (référence base 100). Gris neutre :
 * lisible sur tous les thèmes et distinct de la palette des comparés. Partagé
 * entre le contrôleur (ligne) et la légende (pastille) -> garantit leur cohérence.
 */
export const MAIN_COLOR = "#94a3b8";

/** Un symbole comparé + sa couleur (assignée à l'ajout, stable jusqu'au retrait). */
export interface CompareSymbol {
  symbol: string;
  color: string;
}

export interface CompareState {
  symbols: CompareSymbol[];
  /** Ajoute un symbole (MAJ, dédup, cap 4) en lui attribuant la 1re couleur libre. */
  add: (symbol: string) => void;
  /** Retire un symbole (libère sa couleur). */
  remove: (symbol: string) => void;
  /** Vide la liste (retrait global). */
  clear: () => void;
}

/** 1re couleur de la palette non utilisée par la liste courante (repli : 1re couleur). */
function firstFreeColor(used: CompareSymbol[]): string {
  const taken = new Set(used.map((s) => s.color));
  return COMPARE_PALETTE.find((c) => !taken.has(c)) ?? COMPARE_PALETTE[0];
}

export const compareStore = createStore<CompareState>((set, get) => ({
  symbols: [],

  add: (symbol) => {
    const s = symbol.trim().toUpperCase();
    if (s.length === 0) return;
    const current = get().symbols;
    if (current.length >= MAX_COMPARE) return; // cap atteint : on ignore
    if (current.some((c) => c.symbol === s)) return; // déjà présent : dédup
    set({ symbols: [...current, { symbol: s, color: firstFreeColor(current) }] });
  },

  remove: (symbol) => {
    set({ symbols: get().symbols.filter((c) => c.symbol !== symbol) });
  },

  clear: () => set({ symbols: [] }),
}));
