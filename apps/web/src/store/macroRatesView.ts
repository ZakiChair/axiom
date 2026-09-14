/**
 * Vue par défaut de l'onglet « Rendements » du panneau RATE (tableau ou courbe) — store
 * vanilla ÉPHÉMÈRE, jamais persisté (comme `windowManagerStore.dragPreview`), qui vit au
 * niveau module (donc survit à un démontage/remontage de `MacroRatesWindow`, contrairement
 * au state React local).
 *
 * Lu par `MacroRatesWindow` pour initialiser son state local `vue` au montage. `requete`
 * est incrémenté par `demanderCourbe()` (commande CRVF) pour forcer la resynchronisation
 * même si la fenêtre est déjà montée sur un autre onglet/vue — cf. le `nonce` de
 * rafraîchissement dans `MacroRatesWindow.tsx`, même principe.
 *
 * Second canal de requête : `requeteIndicateurs`, incrémenté par `demanderIndicateurs()`
 * (bouton « série » du calendrier ECO), force l'ouverture sur l'onglet « Indicateurs ».
 *
 * MUTUELLEMENT EXCLUSIFS — et c'est la SEULE chose qui les rend sûrs. Séparer les deux
 * compteurs ne suffit PAS : les deux effets qu'ils pilotent dans `MacroRatesWindow`
 * écrivent le MÊME state `onglet`. Et `FloatingWindow` DÉMONTE `MacroRatesWindow` à la
 * fermeture/réduction — un compteur resté non nul d'une commande ancienne redevient donc
 * actif au remontage suivant, en concurrence avec la commande la plus récente, et l'ordre
 * de déclaration des effets React ne doit JAMAIS servir d'arbitre entre les deux. C'est
 * pourquoi chaque action remet l'AUTRE compteur à 0 : LA DERNIÈRE COMMANDE GAGNE. Une
 * requête en attente d'une commande plus ancienne est annulée par la commande suivante, si
 * bien qu'au plus UN des deux compteurs peut être non nul à un instant donné, et qu'un
 * remontage ne rejoue jamais que l'intention la plus récente — le comportement attendu par
 * l'utilisateur.
 */
import { createStore } from "zustand/vanilla";
import { ORDRE_REGIONS, seriesDeIndicateur, type IndicateurMacro, type RegionMacro } from "../data/macro/catalogueMacro";
import type { HorizonMacro } from "../data/macro/horizon";

export type VueRendementsMode = "tableau" | "courbe";
export type { HorizonMacro } from "../data/macro/horizon";

export interface MacroRatesViewState {
  vue: VueRendementsMode;
  requete: number;
  /** Demande explicite d'ouverture en vue courbe (commande CRVF). Annule une requête Indicateurs en attente. */
  demanderCourbe: () => void;
  requeteIndicateurs: number;
  indicateur: IndicateurMacro;
  regions: RegionMacro[];
  horizonAnnees: HorizonMacro;
  connuLe: string | null;
  selectionnerIndicateur: (indicateur: IndicateurMacro) => void;
  selectionnerRegions: (regions: readonly RegionMacro[]) => void;
  selectionnerHorizon: (horizon: HorizonMacro) => void;
  selectionnerConnuLe: (connuLe: string | null) => void;
  /** Demande explicite d'ouverture sur l'onglet Indicateurs (bouton « série » d'ECO). Annule une requête CRVF en attente. */
  demanderIndicateurs: (selection?: { indicateur?: IndicateurMacro; region?: RegionMacro }) => void;
}

function horizonPourIndicateur(etat: MacroRatesViewState, indicateur: IndicateurMacro): HorizonMacro {
  if (indicateur === etat.indicateur) return etat.horizonAnnees;
  if (indicateur === "dette-pib") return "max";
  return etat.horizonAnnees === "max" || etat.horizonAnnees > 10 ? 5 : etat.horizonAnnees;
}

export const macroRatesViewStore = createStore<MacroRatesViewState>((set, get) => ({
  vue: "tableau",
  requete: 0,
  demanderCourbe: () => set({ vue: "courbe", requete: get().requete + 1, requeteIndicateurs: 0 }),
  requeteIndicateurs: 0,
  indicateur: "cpi-aa",
  regions: [...ORDRE_REGIONS],
  horizonAnnees: 5,
  connuLe: null,
  selectionnerIndicateur: (indicateur) => {
    const disponibles = ORDRE_REGIONS.filter((r) => seriesDeIndicateur(indicateur).some((d) => d.region === r));
    const etat = get();
    set({ indicateur, horizonAnnees: horizonPourIndicateur(etat, indicateur), ...(etat.regions.some((r) => disponibles.includes(r)) ? {} : { regions: disponibles }) });
  },
  selectionnerRegions: (regions) => set({ regions: ORDRE_REGIONS.filter((r) => regions.includes(r)) }),
  selectionnerHorizon: (horizonAnnees) => set({ horizonAnnees }),
  selectionnerConnuLe: (connuLe) => set({ connuLe }),
  demanderIndicateurs: (selection = {}) => set((etat) => ({
    requeteIndicateurs: etat.requeteIndicateurs + 1,
    requete: 0,
    ...(selection.indicateur ? { indicateur: selection.indicateur, horizonAnnees: horizonPourIndicateur(etat, selection.indicateur) } : {}),
    ...(selection.region ? { regions: [selection.region] } : {}),
  })),
}));
