/**
 * Store de comparaison multi-courbes — Zustand VANILLA (hors render-loop React).
 *
 * Liste des symboles superposés au sous-pane « Comparaison (base 100) » (cap 4),
 * chacun avec une couleur STABLE assignée à l'ajout (1re couleur libre de la
 * palette). Modifié seulement à l'ajout/suppression (BASSE fréquence) : aucune
 * donnée live ne transite ici. Lu par le panneau CompareControl (légende) et par
 * le contrôleur de comparaison du Chart (souscription impérative).
 *
 * PERSISTANCE : la liste des symboles comparés est persistée par store/persist.ts
 * (clé `axiom:sessionUi:v1`, champ `compare`) et ré-ajoutée au boot — persistance
 * DÉLÉGUÉE, ne pas en recréer ici. Le `ChartState` figé de @axiom/types est inchangé.
 */
import { createStore } from "zustand/vanilla";

/** Nombre maximum de symboles de comparaison (cap produit). */
export const MAX_COMPARE = 4;

/**
 * Palette des courbes comparées : TOKENS de série du thème (jamais de vert/rouge
 * pur — pas de confusion avec up/down). Les couleurs hex héritées d'anciennes
 * persistances restent acceptées (cf. couleurAffichable).
 */
export const COMPARE_PALETTE = ["--serie-3", "--serie-6", "--serie-2", "--serie-4"] as const;

/** Couleur du symbole PRINCIPAL (référence base 100) : gris neutre du thème. */
export const MAIN_COLOR = "--text-dim";

/** Token CSS (--x) → `var(--x)` pour les styles inline ; hex hérité inchangé. */
export function couleurAffichable(c: string): string {
  return c.startsWith("--") ? `var(${c})` : c;
}

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
