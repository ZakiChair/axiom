/**
 * Store réglages MACRO (clé FRED) — Zustand VANILLA.
 *
 * Comme le store coinalyze : on ne place JAMAIS la VALEUR de la clé dans le state
 * React/Zustand (elle n'est ni rendue, ni loggée). Seul le drapeau `hasKey` est
 * exposé au rendu. La clé elle-même vit dans localStorage ("axiom:fred:key").
 *
 * Le fournisseur FRED (data/macro/fred.ts) n'a pas de point d'injection : on lui
 * passe la clé via `opts.apiKey` (chemin documenté du fournisseur, prioritaire sur
 * sa propre lecture localStorage). Le panneau lit donc la clé via `getFredKey()`
 * UNIQUEMENT pour la transmettre à `fetchSeries`, jamais pour l'afficher.
 */
import { createStore } from "zustand/vanilla";

const STORAGE_KEY = "axiom:fred:key";

/**
 * Lecture tolérante de la clé PERSONNELLE : clé persistée, sinon `null`.
 * `null` = aucune clé côté front → le proxy /fredapi fournit la clé de repli (.env).
 * On ne committe plus de clé « par défaut » dans le source (cf. data/macro/fred.ts).
 */
function readKey(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v !== null && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Écriture/suppression tolérante (quota / mode privé => silencieux). */
function writeKey(key: string | null): void {
  try {
    if (key === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, key);
  } catch {
    /* best-effort : la persistance de la clé n'est pas bloquante */
  }
}

/**
 * Lit la clé FRED persistée, à passer en `opts.apiKey` à fetchSeries.
 * Renvoyée à la demande (jamais conservée dans le state, jamais rendue).
 */
export function getFredKey(): string | null {
  return readKey();
}

export interface FredKeyState {
  /**
   * true si une clé FRED est utilisable. TOUJOURS vrai : une clé de repli est
   * fournie par le proxy (.env), donc l'UI affiche le M2 sans jamais bloquer sur un
   * formulaire « clé requise ». Une clé personnelle saisie dans les Réglages remplace
   * simplement le repli (le M2 se recharge alors avec elle).
   */
  hasKey: boolean;
  /** Enregistre une clé personnelle (localStorage). Vide => équivaut à clearKey. */
  setKey: (key: string) => void;
  /** Supprime la clé personnelle (retour au repli du proxy). */
  clearKey: () => void;
}

export const fredKeyStore = createStore<FredKeyState>((set) => ({
  // Toujours vrai : cf. commentaire de `hasKey` ci-dessus.
  hasKey: true,

  setKey: (key) => {
    const k = key.trim();
    const value = k.length > 0 ? k : null;
    writeKey(value);
    set({ hasKey: true });
  },

  clearKey: () => {
    writeKey(null);
    set({ hasKey: true });
  },
}));
