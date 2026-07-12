/**
 * Store UI de la fenêtre GLOBE — Zustand VANILLA (hors render-loop React).
 *
 * `open` MIROITE l'état de `windowManagerStore` (source de vérité géométrie/ouverture,
 * cf. `mirrorOpenState`). Ne tient que la CONFIG BASSE FRÉQUENCE : bascules des couches
 * de données (chokepoints maritimes / trafic aérien) et rotation automatique. Les angles
 * de vue (λ/φ/zoom) vivent dans des refs de GlobeWindow — jamais dans un store, jamais
 * dans du state React (contrainte « aucun re-render par frame »). Volontairement
 * ÉPHÉMÈRE : non persisté (comme derivatives-ui / dom-ui).
 */
import { createStore } from "zustand/vanilla";
import type { Commande } from "../commands/registry"; // type-only : aucune dépendance runtime croisée
import { windowManagerStore, mirrorOpenState } from "./windowManager";

/** Couches de données affichables sur le globe. */
export interface CouchesGlobe {
  /** Chokepoints maritimes IMF PortWatch (hebdo ~J-5). */
  chokepoints: boolean;
  /** Trafic aérien OpenSky (instantané, poll ~2 min). */
  avions: boolean;
  /** Événements géopolitiques GDELT (15 min, via daemon). */
  evenements: boolean;
  /** Conflits armés confirmés UCDP (~1 mois de lag, via daemon). */
  conflits: boolean;
  /** Front Ukraine ISW (polygones, direct navigateur). */
  ukraine: boolean;
}

export interface GlobeUiState {
  /** true quand la fenêtre Globe est ouverte. */
  open: boolean;
  /** Visibilité des couches de données. */
  couches: CouchesGlobe;
  /** Rotation automatique lente quand il n'y a pas d'interaction. */
  rotationAuto: boolean;
  /** Ouvre la fenêtre Globe. */
  openGlobe: () => void;
  /** Ferme la fenêtre Globe. */
  closeGlobe: () => void;
  /** Bascule l'ouverture de la fenêtre (mnémonique GLOBE). */
  toggleGlobe: () => void;
  /** Bascule la visibilité d'une couche. */
  toggleCouche: (couche: keyof CouchesGlobe) => void;
  /** Active/désactive la rotation automatique. */
  setRotationAuto: (active: boolean) => void;
}

export const globeUiStore = createStore<GlobeUiState>((set, get) => ({
  open: false,
  couches: { chokepoints: true, avions: true, evenements: true, conflits: true, ukraine: true },
  rotationAuto: true,
  openGlobe: () => windowManagerStore.getState().openWindow("globe"),
  closeGlobe: () => windowManagerStore.getState().closeWindow("globe"),
  toggleGlobe: () => windowManagerStore.getState().toggleWindow("globe"),
  toggleCouche: (couche) => {
    const couches = get().couches;
    set({ couches: { ...couches, [couche]: !couches[couche] } });
  },
  setRotationAuto: (active) => set({ rotationAuto: active }),
}));

mirrorOpenState("globe", globeUiStore);

/**
 * Commandes de palette du Globe (à greffer par l'intégrateur via `enregistrerCommandes`,
 * cf. App.tsx). Mnémonique GLOBE — même action que l'entrée du menu Fonctions.
 */
export const commandes: Commande[] = [
  {
    id: "panneau:globe",
    mnemonique: "GLOBE",
    libelle: "Globe (géopolitique, chokepoints & trafic aérien)",
    categorie: "panneau",
    motsCles: [
      "globe",
      "monde",
      "carte",
      "chokepoints",
      "detroits",
      "maritime",
      "petroliers",
      "avions",
      "trafic aerien",
      "opensky",
      "portwatch",
      "geopolitique",
      "conflits",
      "guerre",
      "coup d'etat",
      "protestations",
      "ukraine",
      "gdelt",
      "ucdp",
      "isw",
      "crises",
    ],
    apercu: "Ouvre / ferme le globe : conflits géopolitiques, chokepoints maritimes, trafic aérien",
    action: () => globeUiStore.getState().toggleGlobe(),
  },
];
