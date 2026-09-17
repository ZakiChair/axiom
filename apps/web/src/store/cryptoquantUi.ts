/**
 * Magasin d'INTENTION des deux sections CryptoQuant — Zustand VANILLA (hors render-loop).
 *
 * Décision du propriétaire du 2026-09-18 : les entrées CQTAKR (menu « Marché & dérivés »)
 * et CQMINE (« On-chain & stablecoins ») NAVIGUENT vers des sections déjà livrées — aucune
 * fenêtre du registre, aucun indicateur nouveau. Une entrée pose ici une cible ; la section
 * visée, dès qu'elle est montée, la lit, se déplie, défile à l'écran puis la consomme.
 *
 * Volontairement MINUSCULE : la Toolbar l'importe, il entre donc dans le chemin d'entrée
 * (budget JS initial). `ENTREES_CQ` y est la SOURCE UNIQUE du mnémonique, du libellé, de la
 * clé de badge et de la fenêtre hôte — le menu Fonctions et la palette ⌘K la lisent au lieu
 * de recopier ces littéraux (deux fois le même texte dans le chunk d'entrée). Aucun import
 * de composant, aucun accès au DOM, aucune persistance hors le marquage « vue » du badge
 * (délégué à `marquerVue`, best-effort).
 */
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { marquerVue, windowManagerStore } from "./windowManager";

/** Section CryptoQuant visée par une entrée de navigation. */
export type CibleCq = "takers" | "mineurs";

export interface EntreeCq {
  mnemonique: string;
  libelle: string;
  /**
   * Clé du badge « nouveau » (préfixe localStorage de `marquerVue`/`estNouvelle`, qui
   * accepte n'importe quelle chaîne). Préfixe `section:` : ce ne sont PAS des fenêtres du
   * registre — un id de fenêtre ici éteindrait le badge de DES ou de CHAIN.
   */
  badge: string;
  /** Fenêtre hôte : DES pour les flux takers, CHAIN pour les mineurs cotés. */
  fenetre: string;
}

/** Les deux entrées de navigation, telles que les affichent le menu Fonctions et ⌘K. */
export const ENTREES_CQ: Record<CibleCq, EntreeCq> = {
  takers: {
    mnemonique: "CQTAKR",
    libelle: "Flux takers toutes places (CryptoQuant)",
    badge: "section:cq-takers",
    fenetre: "derivatives",
  },
  mineurs: {
    mnemonique: "CQMINE",
    libelle: "Production des mineurs cotés (CryptoQuant)",
    badge: "section:cq-mineurs",
    fenetre: "onchain",
  },
};

export interface CryptoquantUiState {
  /** Section à déplier au prochain rendu ; `null` quand aucune demande n'est en cours. */
  cible: CibleCq | null;
  /** Ouvre la fenêtre hôte, éteint le badge et demande le dépliage de `cible`. */
  demander: (cible: CibleCq) => void;
  /** Efface la demande — SEULEMENT si `cible` est bien la demande courante. */
  consommer: (cible: CibleCq) => void;
}

export const cryptoquantUiStore = createStore<CryptoquantUiState>((set, get) => ({
  cible: null,
  demander: (cible) => {
    const entree = ENTREES_CQ[cible];
    marquerVue(entree.badge);
    windowManagerStore.getState().openWindow(entree.fenetre);
    set({ cible });
  },
  // Les deux sections vivent dans des fenêtres distinctes mais peuvent être montées
  // ensemble : celle qui n'est pas visée ne doit pas effacer la demande de l'autre.
  consommer: (cible) => {
    if (get().cible === cible) set({ cible: null });
  },
}));

/**
 * Cible courante, pour un composant qui dérive son dépliage au RENDU.
 *
 * `useStore` de zustand v4 rend l'état INITIAL en rendu serveur (`getServerState ??
 * getInitialState`) : une demande posée avant le rendu y serait invisible, or les tests web
 * tournent en environnement node (`renderToStaticMarkup`, aucun effet exécuté). On s'abonne
 * donc pour le re-render et on lit l'état COURANT, identique au navigateur.
 */
export function useCibleCq(): CibleCq | null {
  useStore(cryptoquantUiStore, (s) => s.cible);
  return cryptoquantUiStore.getState().cible;
}
