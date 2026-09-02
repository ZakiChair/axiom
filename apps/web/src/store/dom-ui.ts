/**
 * Store UI du DOM (carnet d'ordres) — Zustand VANILLA (hors render-loop React).
 *
 * Tient l'état d'ouverture du PANNEAU (dockable, non modal), l'onglet actif
 * (échelle / profondeur / bande passante), le facteur d'agrégation par pas de prix
 * et le seuil de surlignage des gros trades. Volontairement ÉPHÉMÈRE : NON persisté
 * (comme derivatives-ui). Le carnet et les trades vivent hors React (refs/canvas).
 */
import { createStore } from "zustand/vanilla";
import type { Commande } from "../commands/registry"; // type-only : aucune dépendance runtime croisée
import { windowManagerStore, mirrorOpenState } from "./windowManager";

/** Onglets du panneau DOM. */
export type DomTab = "ladder" | "depth" | "tape";

/** Facteurs d'agrégation proposés (multiplicateurs du pas rond de base). */
export const FACTEURS_PAS = [1, 2, 5, 10, 25] as const;
/** Seuils de surlignage « gros trade » (notionnel USD) proposés dans la TAPE. */
export const SEUILS_GROS_TRADE = [50_000, 100_000, 250_000, 1_000_000] as const;
/** Notionnels (USD) du bandeau de coût d'exécution. */
export const NOTIONNELS_COUT = [10_000, 50_000, 250_000, 1_000_000] as const;

export interface DomUiState {
  /** true quand le panneau DOM est ouvert. */
  open: boolean;
  /** Onglet actif. */
  tab: DomTab;
  /** Multiplicateur du pas d'agrégation (× le pas rond dérivé du prix). */
  facteurPas: number;
  /** Seuil (USD) au-delà duquel un trade est surligné dans la TAPE. */
  seuilGrosTrade: number;
  /** Bandeau coût d'exécution visible (LADDER/DEPTH). Éphémère. */
  coutVisible: boolean;
  /** Ouvre le panneau (onglet optionnel). */
  openDom: (tab?: DomTab) => void;
  /** Ferme le panneau. */
  closeDom: () => void;
  /** Bascule l'ouverture du panneau (mnémonique DOM). */
  toggleDom: () => void;
  /** Change d'onglet. */
  setTab: (tab: DomTab) => void;
  /** Fixe le facteur d'agrégation par pas. */
  setFacteurPas: (facteur: number) => void;
  /** Fixe le seuil de surlignage des gros trades. */
  setSeuilGrosTrade: (seuil: number) => void;
  /** Affiche / masque le bandeau de coût. */
  toggleCout: () => void;
}

export const domUiStore = createStore<DomUiState>((set) => ({
  open: false,
  tab: "ladder",
  facteurPas: 1,
  seuilGrosTrade: 100_000,
  coutVisible: true,
  openDom: (tab) => {
    if (tab) set({ tab });
    windowManagerStore.getState().openWindow("dom");
  },
  closeDom: () => windowManagerStore.getState().closeWindow("dom"),
  toggleDom: () => windowManagerStore.getState().toggleWindow("dom"),
  setTab: (tab) => set({ tab }),
  setFacteurPas: (facteur) => set({ facteurPas: facteur }),
  setSeuilGrosTrade: (seuil) => set({ seuilGrosTrade: seuil }),
  toggleCout: () => set((s) => ({ coutVisible: !s.coutVisible })),
}));

mirrorOpenState("dom", domUiStore);

/**
 * Commandes de palette du DOM (à greffer par l'intégrateur via `enregistrerCommandes`).
 * DOM ouvre/ferme le panneau ; TAPE l'ouvre directement sur l'onglet time&sales.
 */
export const commandes: Commande[] = [
  {
    id: "panneau:dom",
    mnemonique: "DOM",
    libelle: "Carnet d'ordres (DOM / depth)",
    categorie: "panneau",
    motsCles: ["dom", "carnet", "order book", "depth", "profondeur", "ladder", "echelle", "liquidite"],
    apercu: "Ouvre / ferme le carnet d'ordres (échelle, profondeur, tape)",
    action: () => domUiStore.getState().toggleDom(),
  },
  {
    id: "panneau:dom-tape",
    mnemonique: "TAPE",
    libelle: "Time & Sales (tape)",
    categorie: "panneau",
    motsCles: ["tape", "time and sales", "time&sales", "trades", "transactions", "impressions"],
    apercu: "Ouvre le carnet d'ordres sur l'onglet time & sales",
    action: () => domUiStore.getState().openDom("tape"),
  },
  {
    id: "panneau:dom-cout",
    mnemonique: "DOMCOUT",
    libelle: "DOM — coût d'exécution",
    categorie: "panneau",
    motsCles: ["cout", "slippage", "execution", "bps", "carnet", "desequilibre"],
    apercu: "Ouvre le carnet et bascule le bandeau de coût d'exécution",
    action: () => {
      const s = domUiStore.getState();
      s.openDom();
      s.toggleCout();
    },
  },
];
