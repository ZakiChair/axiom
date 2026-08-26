/**
 * Store réglages Coinalyze — Zustand VANILLA.
 *
 * Gère UNIQUEMENT la présence d'une clé API Coinalyze (drapeau `hasKey`), pas sa
 * valeur : la clé elle-même vit dans localStorage (`axiom:coinalyze:key`) et dans
 * le module data/coinalyze (injectée via `setCoinalyzeApiKey`). On ne place JAMAIS
 * la clé dans le state React/Zustand — elle n'est ni rendue ni loggée.
 *
 * Hydratation au chargement : la clé persistée est lue puis injectée dans le
 * provider, et `hasKey` reflète sa disponibilité selon le déploiement.
 */
import { createStore } from "zustand/vanilla";
import { setCoinalyzeApiKey } from "../data/coinalyze";
import { IS_VERCEL } from "../lib/deployment";

const STORAGE_KEY = "axiom:coinalyze:key";

/**
 * Lecture tolérante de la clé PERSONNELLE : clé persistée, sinon `null`.
 * En local, `null` laisse le proxy /coinalyzeapi fournir le repli `.env` ; sur Vercel,
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

export function hasUsableCoinalyzeKey(personalKey: string | null, isVercel: boolean): boolean {
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

export interface CoinalyzeKeyState {
  /**
   * En local, le proxy conserve le repli `.env` historique. Sur Vercel, true seulement
   * si une clé personnelle est présente dans localStorage.
   */
  hasKey: boolean;
  /** Enregistre une clé personnelle (localStorage + provider). Vide => équivaut à clearKey. */
  setKey: (key: string) => void;
  /** Supprime la clé personnelle (retour au repli du proxy local). */
  clearKey: () => void;
}

const persistedKey = readKey();
setCoinalyzeApiKey(persistedKey);

export const coinalyzeKeyStore = createStore<CoinalyzeKeyState>((set) => ({
  hasKey: hasUsableCoinalyzeKey(persistedKey, IS_VERCEL),

  setKey: (key) => {
    const k = key.trim();
    const value = k.length > 0 ? k : null;
    writeKey(value);
    setCoinalyzeApiKey(value);
    set({ hasKey: hasUsableCoinalyzeKey(value, IS_VERCEL) });
  },

  clearKey: () => {
    writeKey(null);
    setCoinalyzeApiKey(null);
    set({ hasKey: hasUsableCoinalyzeKey(null, IS_VERCEL) });
  },
}));
