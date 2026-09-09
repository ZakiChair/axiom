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
import type { IdentitePublication } from "../data/macro/publicationArchive";
import { windowManagerStore, mirrorOpenState } from "./windowManager";

export interface EvtsUiState {
  open: boolean;
  openEvts: () => void;
  closeEvts: () => void;
  toggleEvts: () => void;
  /** Occurrence demandée depuis ECO ; l'étude ne substitue jamais une autre date. */
  selection: (IdentitePublication & { id: string; title: string; time: number; timeApprox: boolean; source: string }) | null;
  ouvrirEvenement: (selection: IdentitePublication & { id: string; title: string; time: number; timeApprox: boolean; source: string }) => void;
  retourToutesOccurrences: () => void;
  /** Incrémente après import local pour réhydrater les lecteurs de l'archive. */
  archiveVersion: number;
  rafraichirArchives: () => void;
  /** Retour forward médian par type d'évènement (« méd +24 h : -0.8% »), pour la fenêtre
   *  BRIEF et le suffixe des marqueurs ECO (Task 4). `symbole` = le symbole SUR LEQUEL la
   *  stat a été calculée (marché courant, éventuellement un symbole de groupe) : les
   *  marqueurs ne suffixent que si ce symbole == symbole du chart maître (honnêteté
   *  d'échantillon — jamais une stat d'un autre symbole sans le dire). Mis à jour après
   *  chaque calcul réussi (≥ 1 fenêtre alignée). */
  statsParType: Partial<Record<TypeEvenement, { symbole: string; libelle: string }>>;
  setStatParType: (type: TypeEvenement, symbole: string, libelle: string) => void;
}

export const evtsUiStore = createStore<EvtsUiState>((set) => ({
  open: false,
  openEvts: () => windowManagerStore.getState().openWindow("evts"),
  closeEvts: () => windowManagerStore.getState().closeWindow("evts"),
  toggleEvts: () => windowManagerStore.getState().toggleWindow("evts"),
  selection: null,
  ouvrirEvenement: (selection) => {
    set({ selection });
    windowManagerStore.getState().openWindow("evts");
  },
  retourToutesOccurrences: () => set({ selection: null }),
  archiveVersion: 0,
  rafraichirArchives: () => set((state) => ({ archiveVersion: state.archiveVersion + 1 })),
  statsParType: {},
  setStatParType: (type, symbole, libelle) =>
    set((s) => ({ statsParType: { ...s.statsParType, [type]: { symbole, libelle } } })),
}));

mirrorOpenState("evts", evtsUiStore);
