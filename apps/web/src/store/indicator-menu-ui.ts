/**
 * Store UI du menu « Indicateurs » — Zustand VANILLA (hors render-loop React).
 *
 * Tient l'ouverture du panneau et l'onglet courant (catalogue technique | mesures
 * macro). Volontairement éphémère : NON persisté (ne pas l'enregistrer dans persist.ts)
 * — même statut que `settings-ui`, dont il reprend le patron.
 *
 * POURQUOI un store plutôt qu'un simple useState dans le composant : la commande
 * Launchpad « MACRO » doit pouvoir ouvrir le menu DIRECTEMENT sur l'onglet Macro,
 * depuis l'extérieur du composant (les mesures macro ayant quitté la sidebar, l'ancien
 * `focusPanneauSidebar` n'a plus de cible).
 */
import { createStore } from "zustand/vanilla";

export type OngletIndicateurs = "techniques" | "macro";

export interface IndicatorMenuUiState {
  open: boolean;
  onglet: OngletIndicateurs;
  /**
   * Instance dont l'éditeur de paramètres doit s'ouvrir à l'affichage du panneau
   * (⚙ d'une légende du graphe, double-clic sur un pane). Consommé UNE fois par
   * `IndicatorMenu` puis remis à null : c'est une intention de navigation, pas un
   * état de sélection — sans quoi rouvrir le menu redéplierait toujours la même.
   */
  instanceCible: string | null;
  /** Ouvre / ferme le panneau (bouton de la toolbar). */
  basculer: () => void;
  /** Ferme le panneau (clic extérieur, Échap, ouverture d'un autre panneau). */
  fermer: () => void;
  setOnglet: (onglet: OngletIndicateurs) => void;
  /** Ouvre le panneau directement sur l'onglet Macro (commande Launchpad « MACRO »). */
  ouvrirSurMacro: () => void;
  /** Ouvre le panneau sur l'onglet technique, éditeur déplié sur cette instance. */
  ouvrirSurInstance: (instanceId: string) => void;
  /** Accuse réception de `instanceCible` (appelé par le menu après dépliage). */
  cibleConsommee: () => void;
}

export const indicatorMenuUiStore = createStore<IndicatorMenuUiState>((set) => ({
  open: false,
  onglet: "techniques",
  instanceCible: null,
  basculer: () => set((s) => ({ open: !s.open })),
  fermer: () => set({ open: false }),
  setOnglet: (onglet) => set({ onglet }),
  ouvrirSurMacro: () => set({ open: true, onglet: "macro" }),
  ouvrirSurInstance: (instanceId) =>
    set({ open: true, onglet: "techniques", instanceCible: instanceId }),
  cibleConsommee: () => set({ instanceCible: null }),
}));
