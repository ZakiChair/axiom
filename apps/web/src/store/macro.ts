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
import { IS_VERCEL } from "../lib/deployment";

const STORAGE_KEY = "axiom:fred:key";

/**
 * Lecture tolérante de la clé PERSONNELLE : clé persistée, sinon `null`.
 * En local, `null` laisse le proxy /fredapi fournir le repli `.env` ; sur Vercel,
 * aucune clé de proxy n'existe. Aucune clé « par défaut » n'est committée dans le source.
 */
function readKey(): string | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)?.trim() ?? "";
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function hasUsableFredKey(personalKey: string | null, isVercel: boolean): boolean {
  return !isVercel || (personalKey?.trim().length ?? 0) > 0;
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
   * En local, le proxy conserve le repli `.env` historique. Sur Vercel, true seulement
   * si une clé personnelle est présente dans localStorage.
   */
  hasKey: boolean;
  /** Enregistre une clé personnelle (localStorage). Vide => équivaut à clearKey. */
  setKey: (key: string) => void;
  /** Supprime la clé personnelle (retour au repli du proxy local). */
  clearKey: () => void;
}

const persistedKey = readKey();

export const fredKeyStore = createStore<FredKeyState>((set) => ({
  hasKey: hasUsableFredKey(persistedKey, IS_VERCEL),

  setKey: (key) => {
    const k = key.trim();
    const value = k.length > 0 ? k : null;
    writeKey(value);
    set({ hasKey: hasUsableFredKey(value, IS_VERCEL) });
  },

  clearKey: () => {
    writeKey(null);
    set({ hasKey: hasUsableFredKey(null, IS_VERCEL) });
  },
}));
