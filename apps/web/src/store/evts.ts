/**
 * Store UI de l'étude d'évènements (EVTS). Zustand VANILLA (hors render-loop React).
 *
 * EXTRAIT du composant EvtsWindow (lazy-chargé) vers ce module LÉGER afin que les
 * marqueurs ECO (chart/ecoMarkers.ts, importé EAGER par App.tsx) puissent lire
 * `statsParType` sans tirer tout le composant — et ses dépendances lourdes (adapters,
 * lib/evts…) — dans le bundle principal. Même motif que store/eco.ts. Éphémère : NON
 * persisté. `mirrorOpenState` se resynchronise immédiatement à l'enregistrement, donc
 * ce chargement désormais EAGER (via ecoMarkers) reste correct — comme eco.
 */
import { createStore } from "zustand/vanilla";
import type { TypeEvenement } from "../data/macro/eventDates";
import { windowManagerStore, mirrorOpenState } from "./windowManager";

export interface EvtsUiState {
  open: boolean;
  openEvts: () => void;
  closeEvts: () => void;
  toggleEvts: () => void;
  /** Retour forward médian par type d'évènement (« méd +24 h : -0.8% »), pour la fenêtre
   *  BRIEF et le suffixe des marqueurs ECO (Task 4). Mis à jour après chaque calcul réussi
   *  (≥ 1 fenêtre alignée). */
  statsParType: Partial<Record<TypeEvenement, string>>;
  setStatParType: (type: TypeEvenement, libelle: string) => void;
}

export const evtsUiStore = createStore<EvtsUiState>((set) => ({
  open: false,
  openEvts: () => windowManagerStore.getState().openWindow("evts"),
  closeEvts: () => windowManagerStore.getState().closeWindow("evts"),
  toggleEvts: () => windowManagerStore.getState().toggleWindow("evts"),
  statsParType: {},
  setStatParType: (type, libelle) =>
    set((s) => ({ statsParType: { ...s.statsParType, [type]: libelle } })),
}));

mirrorOpenState("evts", evtsUiStore);
