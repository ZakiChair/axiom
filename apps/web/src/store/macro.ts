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

/** Lecture tolérante (localStorage indisponible / mode privé => null). */
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
  /** true si une clé FRED est configurée (l'UI affiche alors le M2 plutôt que le formulaire). */
  hasKey: boolean;
  /** Enregistre une clé (localStorage). Vide => équivaut à clearKey. */
  setKey: (key: string) => void;
  /** Supprime la clé configurée. */
  clearKey: () => void;
}

// Hydratation au chargement : `hasKey` reflète la présence d'une clé persistée.
const initialKey = readKey();

export const fredKeyStore = createStore<FredKeyState>((set) => ({
  hasKey: initialKey !== null,

  setKey: (key) => {
    const k = key.trim();
    const value = k.length > 0 ? k : null;
    writeKey(value);
    set({ hasKey: value !== null });
  },

  clearKey: () => {
    writeKey(null);
    set({ hasKey: false });
  },
}));
