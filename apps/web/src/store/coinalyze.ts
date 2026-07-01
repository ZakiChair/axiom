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

/**
 * Lecture tolérante de la clé PERSONNELLE : clé persistée, sinon `null`.
 * `null` = aucune clé côté front → le proxy /coinalyzeapi fournit la clé de repli
 * (.env). On ne committe plus de clé « par défaut » dans le source (cf. data/coinalyze.ts).
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

export interface CoinalyzeKeyState {
  /**
   * true si une clé est utilisable. TOUJOURS vrai : une clé de repli est fournie par
   * le proxy (.env), donc l'UI affiche les données dérivées sans jamais bloquer sur un
   * formulaire « clé requise ». Une clé personnelle saisie dans les Réglages remplace
   * simplement le repli. Si le .env est vide, l'API renvoie 401 (message clair dans l'UI).
   */
  hasKey: boolean;
  /** Enregistre une clé personnelle (localStorage + provider). Vide => équivaut à clearKey. */
  setKey: (key: string) => void;
  /** Supprime la clé personnelle (retour au repli du proxy). */
  clearKey: () => void;
}

// Hydratation : injecte la clé personnelle persistée (ou null) dans le provider.
// null => le provider n'envoie aucune clé et le proxy injecte le repli (.env).
setCoinalyzeApiKey(readKey());

export const coinalyzeKeyStore = createStore<CoinalyzeKeyState>((set) => ({
  // Toujours vrai : cf. commentaire de `hasKey` ci-dessus.
  hasKey: true,

  setKey: (key) => {
    const k = key.trim();
    const value = k.length > 0 ? k : null;
    writeKey(value);
    setCoinalyzeApiKey(value);
    set({ hasKey: true });
  },

  clearKey: () => {
    writeKey(null);
    setCoinalyzeApiKey(null);
    set({ hasKey: true });
  },
}));
