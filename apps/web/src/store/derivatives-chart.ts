/**
 * Store des sous-panes dérivés SUR le chart — Zustand VANILLA (hors render-loop).
 *
 * Tient UNIQUEMENT les deux drapeaux d'activation des sous-panes tracés sur le
 * graphe par `chart/derivatives.ts` (pattern MacroController) :
 *   - `oi`      : sous-pane Open Interest (USD) du perpétuel actif ;
 *   - `funding` : sous-pane funding rate (%) du perpétuel actif.
 * Les séries elles-mêmes (Coinalyze, cadence lente) vivent dans le contrôleur, PAS
 * ici (cf. BUILD-CONTRACT : aucune donnée dans le store, comme orderflow/revenue/macro).
 *
 * Session-only : NON persisté (ne pas l'enregistrer dans persist.ts).
 */
import { createStore } from "zustand/vanilla";
import type { Commande } from "../commands/registry";

export interface DerivativesChartState {
  /** true quand le sous-pane Open Interest est affiché sur le chart. */
  oi: boolean;
  /** true quand le sous-pane funding rate est affiché sur le chart. */
  funding: boolean;
  /** Bascule le sous-pane Open Interest. */
  toggleOi: () => void;
  /** Bascule le sous-pane funding rate. */
  toggleFunding: () => void;
}

export const derivativesChartStore = createStore<DerivativesChartState>((set, get) => ({
  oi: false,
  funding: false,
  toggleOi: () => set({ oi: !get().oi }),
  toggleFunding: () => set({ funding: !get().funding }),
}));

// ─────────────────────────── Commandes de palette (enregistrées par l'intégrateur) ───────────────────────────

/** Commandes à greffer dans la palette (via `enregistrerCommandes`), cf. portfolio/notes. */
export const commandes: Commande[] = [
  {
    id: "action:deriv-oi-pane",
    mnemonique: "OI",
    libelle: "Open Interest (sous-pane) — activer / désactiver",
    categorie: "action",
    motsCles: ["open interest", "oi", "derives", "sous-pane", "coinalyze"],
    apercu: "Affiche l'Open Interest du perp actif sous le graphe",
    action: () => derivativesChartStore.getState().toggleOi(),
  },
  {
    id: "action:deriv-funding-pane",
    mnemonique: "FUND",
    libelle: "Funding rate (sous-pane) — activer / désactiver",
    categorie: "action",
    motsCles: ["funding", "taux", "derives", "sous-pane", "coinalyze"],
    apercu: "Affiche le funding du perp actif sous le graphe",
    action: () => derivativesChartStore.getState().toggleFunding(),
  },
];
