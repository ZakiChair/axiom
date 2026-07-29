/**
 * Store du dénominateur CHOISI pour le bouton de ratio scindé (Zustand VANILLA).
 *
 * Réglage unique : l'actif servant de dénominateur au bouton « ÷X ▾ » du bandeau
 * (ETH par défaut, SOL au choix). Le ÷BTC a son propre bouton, un clic, et n'est PAS
 * concerné par cette préférence.
 *
 * ⚠️ Ce store ne dit PAS quel ratio est affiché : le ratio ACTIF se déduit du symbole
 * seul (`data/ratio.ts` → `estRatio`, sans état). Ici ne vit que la PRÉFÉRENCE, qui
 * pilote le libellé et l'action du bouton.
 *
 * Persistance déléguée à persist.ts (patron refSymbol : snapshot / hydrate / subscribe)
 * — ce store ne touche JAMAIS localStorage lui-même.
 */
import { createStore } from "zustand/vanilla";
import type { DenominateurId } from "../data/ratio";

/** Dénominateur proposé par défaut (le plus courant après BTC, qui a son propre bouton). */
export const DENOMINATEUR_DEFAUT: DenominateurId = "ETH";

export interface DenominateurState {
  denominateur: DenominateurId;
  setDenominateur: (denom: DenominateurId) => void;
}

export const denominateurStore = createStore<DenominateurState>((set) => ({
  denominateur: DENOMINATEUR_DEFAUT,
  setDenominateur: (denom) => set({ denominateur: denom }),
}));
