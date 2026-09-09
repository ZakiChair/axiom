import { createStore, type StoreApi } from "zustand/vanilla";
import type { QualiteMetrique } from "../data/qualiteMetrique";

export interface EntreeQualiteMetrique {
  libelle: string;
  qualite: QualiteMetrique;
}

export interface QualiteMetriquesState {
  metriques: Record<string, EntreeQualiteMetrique>;
}

export const qualiteMetriquesStore: StoreApi<QualiteMetriquesState> = createStore(() => ({ metriques: {} }));

export function enregistrerQualite(id: string, libelle: string, qualite: QualiteMetrique): void {
  qualiteMetriquesStore.setState((state) => ({
    metriques: { ...state.metriques, [id]: { libelle, qualite } },
  }));
}
