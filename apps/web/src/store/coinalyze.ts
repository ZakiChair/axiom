/**
 * Store réglages Coinalyze — Zustand VANILLA.
 *
 * Gère UNIQUEMENT la présence d'une clé API Coinalyze (drapeau `hasKey`), pas sa
 * valeur : la clé elle-même vit dans localStorage (`axiom:coinalyze:key`) et dans
 * le module data/coinalyze (injectée via `setCoinalyzeApiKey`). On ne place JAMAIS
 * la clé dans le state React/Zustand — elle n'est ni rendue ni loggée.
 *
 * Hydratation au chargement : la clé persistée est lue puis injectée dans le
 * provider, et `hasKey` reflète sa présence.
 */
import { createStore } from "zustand/vanilla";
import { setCoinalyzeApiKey } from "../data/coinalyze";

const STORAGE_KEY = "axiom:coinalyze:key";

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

export interface CoinalyzeKeyState {
  /** true si une clé est configurée (l'UI bascule alors du formulaire vers les données). */
  hasKey: boolean;
  /** Enregistre une clé (localStorage + provider). Vide => équivaut à clearKey. */
  setKey: (key: string) => void;
  /** Supprime la clé configurée. */
  clearKey: () => void;
}

// Hydratation : injecte la clé persistée dans le provider dès le chargement du module.
const initialKey = readKey();
setCoinalyzeApiKey(initialKey);

export const coinalyzeKeyStore = createStore<CoinalyzeKeyState>((set) => ({
  hasKey: initialKey !== null,

  setKey: (key) => {
    const k = key.trim();
    const value = k.length > 0 ? k : null;
    writeKey(value);
    setCoinalyzeApiKey(value);
    set({ hasKey: value !== null });
  },

  clearKey: () => {
    writeKey(null);
    setCoinalyzeApiKey(null);
    set({ hasKey: false });
  },
}));
