/**
 * Pont CVD spot/perp → alertes — Zustand VANILLA hors render-loop.
 *
 * Le contrôleur orderflow publie l'état de divergence du symbole affiché
 * (dernière détection) ; le runtime d'alertes s'abonne et injecte
 * `cvdDivergenceKind` dans le contexte pur `@axiom/alerts`.
 *
 * Sémantique par symbole :
 *  - clé absente / `undefined` : pipeline indisponible (CVD S/P off ou non-Binance)
 *  - `null` : pipeline prêt, aucune divergence courante
 *  - kind : divergence active (dernier bucket détecté)
 */
import { createStore } from "zustand/vanilla";

/** Kind aligné sur `@axiom/alerts` / `detectCvdDivergences`. */
export type CvdDivKind = "spotUp_perpDown" | "spotDown_perpUp";

export interface CvdDivergenceState {
  /**
   * Dernier état connu par symbole upper-case.
   * Valeur `undefined` = absent du map = pipeline indisponible.
   */
  bySymbol: Record<string, CvdDivKind | null | undefined>;
  /** Publie un état (pipeline on). */
  setKind: (symbol: string, kind: CvdDivKind | null) => void;
  /** Retire le symbole (pipeline off) → non évaluable côté alertes. */
  clear: (symbol: string) => void;
}

export const cvdDivergenceStore = createStore<CvdDivergenceState>((set, get) => ({
  bySymbol: {},
  setKind: (symbol, kind) => {
    const key = symbol.toUpperCase();
    const prev = get().bySymbol[key];
    if (prev === kind) return; // évite notifs store inutiles
    set({ bySymbol: { ...get().bySymbol, [key]: kind } });
  },
  clear: (symbol) => {
    const key = symbol.toUpperCase();
    if (!(key in get().bySymbol)) return;
    const next = { ...get().bySymbol };
    delete next[key];
    set({ bySymbol: next });
  },
}));
