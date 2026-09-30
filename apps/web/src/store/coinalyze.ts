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
import { hasServerCredential, serverCredentialsStore } from "./serverCredentials";
import { IS_VERCEL } from "../lib/deployment";

const STORAGE_KEY = "axiom:coinalyze:key";

/**
 * Lecture tolérante de la clé PERSONNELLE : clé persistée, sinon `null`.
 * En local, `null` laisse le proxy /coinalyzeapi fournir le repli `.env` ; sur Vercel,
 * le repli serveur est annoncé par /api/config. Aucune valeur par défaut ne vit dans le source.
 */
function readKey(): string | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)?.trim() ?? "";
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function hasUsableCoinalyzeKey(personalKey: string | null, isVercel: boolean, serverConfigured = hasServerCredential("coinalyze")): boolean {
  return !isVercel || serverConfigured || (personalKey?.trim().length ?? 0) > 0;
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
   * si une clé personnelle ou une capacité serveur est disponible.
   */
  hasKey: boolean;
  hasPersonalKey: boolean;
  /** Enregistre une clé personnelle (localStorage + provider). Vide => équivaut à clearKey. */
  setKey: (key: string) => void;
  /** Supprime la clé personnelle (retour au repli du proxy local). */
  clearKey: () => void;
}

const persistedKey = readKey();
setCoinalyzeApiKey(persistedKey);

export const coinalyzeKeyStore = createStore<CoinalyzeKeyState>((set) => ({
  hasPersonalKey: readKey() !== null,
  hasKey: hasUsableCoinalyzeKey(persistedKey, IS_VERCEL),

  setKey: (key) => {
    const k = key.trim();
    const value = k.length > 0 ? k : null;
    writeKey(value);
    setCoinalyzeApiKey(value);
    set({ hasPersonalKey: readKey() !== null, hasKey: hasUsableCoinalyzeKey(value, IS_VERCEL) });
  },

  clearKey: () => {
    writeKey(null);
    setCoinalyzeApiKey(null);
    set({ hasPersonalKey: readKey() !== null, hasKey: hasUsableCoinalyzeKey(null, IS_VERCEL) });
  },
}));

serverCredentialsStore.subscribe(() => {
  coinalyzeKeyStore.setState({ hasKey: hasUsableCoinalyzeKey(readKey(), IS_VERCEL) });
});
