/**
 * Store ECO — calendrier économique. Zustand VANILLA (hors render-loop React).
 *
 * Tient l'état du PANNEAU non modal (ouvert/fermé), les évènements fusionnés (source
 * partagée entre la fenêtre — liste — et les marqueurs chart), les filtres d'affichage
 * (impact / pays) et la bascule des marqueurs verticaux. Éphémère : NON persisté
 * (comme derivatives-ui.ts). Les données lentes sont, elles, mises en cache par
 * data/eco.ts (localStorage 12 h) — pas ici.
 *
 * Le calendrier étant BASSE fréquence (1 poll par session), il peut vivre dans le
 * state (aucune écriture sur tick) sans enfreindre la règle « données HF hors React ».
 */
import { createStore } from "zustand/vanilla";
import type { Commande } from "../commands/registry";
import { chargerEvenementsEco, type EcoEvent, type EcoImpact } from "../data/eco";
import { windowManagerStore, mirrorOpenState } from "./windowManager";

/** Impacts affichables (ordre des filtres, fort → faible). */
export const ECO_IMPACTS: readonly EcoImpact[] = ["high", "medium", "low", "holiday"];

/** État de chargement du calendrier. */
export type EcoStatus = "idle" | "loading" | "ready" | "error";

export interface EcoState {
  /** Panneau ECO ouvert ? */
  open: boolean;
  /** Évènements fusionnés (triés chronologiquement). */
  events: EcoEvent[];
  /** Statut du dernier chargement. */
  status: EcoStatus;
  /** Message d'erreur affichable (null si aucun). */
  error: string | null;
  /** Vrai si le dernier refresh a été bridé par la garde de débit (2 fetch / 5 min). */
  brideDebit: boolean;
  /** Impacts VISIBLES dans la liste (les marqueurs, eux, ne visent que « high »). */
  impacts: Record<EcoImpact, boolean>;
  /** Filtre pays (devise), null = tous. */
  pays: string | null;
  /** Marqueurs verticaux « fort impact » actifs sur le chart. */
  markersEnabled: boolean;

  openEco: () => void;
  closeEco: () => void;
  toggleEco: () => void;

  /** (Re)charge le calendrier. `force` ignore le cache (soumis à la garde de débit). */
  refresh: (force?: boolean) => void;

  toggleImpact: (i: EcoImpact) => void;
  setPays: (p: string | null) => void;
  toggleMarkers: () => void;
}

/** Filtres impact par défaut : tout visible. */
function impactsParDefaut(): Record<EcoImpact, boolean> {
  return { high: true, medium: true, low: true, holiday: true };
}

export const ecoStore = createStore<EcoState>((set, get) => ({
  open: false,
  events: [],
  status: "idle",
  error: null,
  brideDebit: false,
  impacts: impactsParDefaut(),
  pays: null,
  markersEnabled: false,

  openEco: () => windowManagerStore.getState().openWindow("eco"),
  closeEco: () => windowManagerStore.getState().closeWindow("eco"),
  toggleEco: () => windowManagerStore.getState().toggleWindow("eco"),

  refresh: (force = false) => {
    if (get().status === "loading") return; // pas de fetch concurrent
    set({ status: "loading", error: null, brideDebit: false });
    chargerEvenementsEco({ force })
      .then((r) => {
        set({
          events: r.events,
          status: "ready",
          error: r.events.length === 0 ? "Calendrier indisponible pour le moment." : null,
          brideDebit: r.brideDebit ?? false,
        });
      })
      .catch(() => set({ status: "error", error: "Échec du chargement du calendrier." }));
  },

  toggleImpact: (i) => set((s) => ({ impacts: { ...s.impacts, [i]: !s.impacts[i] } })),
  setPays: (p) => set({ pays: p }),
  toggleMarkers: () => set((s) => ({ markersEnabled: !s.markersEnabled })),
}));

mirrorOpenState("eco", ecoStore);

/**
 * Commandes ECO pour la palette (⌘K). EXPORTÉ pour que l'agent intégrateur les
 * greffe via `enregistrerCommandes(ecoCommands)` (import de TYPE seul de registry.ts,
 * aucun effet de bord importé). Mnémonique Bloomberg « ECO ».
 */
export const ecoCommands: Commande[] = [
  {
    id: "panneau:eco",
    mnemonique: "ECO",
    libelle: "Calendrier économique",
    categorie: "panneau",
    motsCles: ["eco", "calendrier", "economique", "fomc", "cpi", "nfp", "fred", "forexfactory", "news"],
    apercu: "Ouvre / ferme le calendrier économique",
    action: () => ecoStore.getState().toggleEco(),
  },
];
