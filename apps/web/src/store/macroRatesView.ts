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
 * Second canal de requête, INDÉPENDANT du premier : `requeteIndicateurs` est incrémenté
 * par `demanderIndicateurs()` (bouton « série » du calendrier ECO) pour forcer l'ouverture
 * sur l'onglet « Indicateurs ». Volontairement un compteur SÉPARÉ de `requete` — celui-ci
 * force l'onglet « Rendements » côté CRVF ; les fusionner ferait courir les deux commandes
 * l'une contre l'autre.
 */
import { createStore } from "zustand/vanilla";

export type VueRendementsMode = "tableau" | "courbe";

export interface MacroRatesViewState {
  vue: VueRendementsMode;
  requete: number;
  /** Demande explicite d'ouverture en vue courbe (commande CRVF). */
  demanderCourbe: () => void;
  requeteIndicateurs: number;
  /** Demande explicite d'ouverture sur l'onglet Indicateurs (bouton « série » d'ECO). */
  demanderIndicateurs: () => void;
}

export const macroRatesViewStore = createStore<MacroRatesViewState>((set, get) => ({
  vue: "tableau",
  requete: 0,
  demanderCourbe: () => set({ vue: "courbe", requete: get().requete + 1 }),
  requeteIndicateurs: 0,
  demanderIndicateurs: () => set({ requeteIndicateurs: get().requeteIndicateurs + 1 }),
}));
