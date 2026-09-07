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

export type VueRendementsMode = "tableau" | "courbe";

export interface MacroRatesViewState {
  vue: VueRendementsMode;
  requete: number;
  /** Demande explicite d'ouverture en vue courbe (commande CRVF). Annule une requête Indicateurs en attente. */
  demanderCourbe: () => void;
  requeteIndicateurs: number;
  /** Demande explicite d'ouverture sur l'onglet Indicateurs (bouton « série » d'ECO). Annule une requête CRVF en attente. */
  demanderIndicateurs: () => void;
}

export const macroRatesViewStore = createStore<MacroRatesViewState>((set, get) => ({
  vue: "tableau",
  requete: 0,
  demanderCourbe: () => set({ vue: "courbe", requete: get().requete + 1, requeteIndicateurs: 0 }),
  requeteIndicateurs: 0,
  demanderIndicateurs: () => set({ requeteIndicateurs: get().requeteIndicateurs + 1, requete: 0 }),
}));
