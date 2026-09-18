/**
 * Store de la clé CryptoQuant PERSONNELLE (offre BASIC, licence personnelle) — Zustand VANILLA.
 *
 * Spec 2026-09-16 §4.2. Même patron que store/sosovalue.ts et store/onchain.ts (BGeometrics) :
 *  - la VALEUR de la clé ne vit que dans localStorage (`axiom:cryptoquant:key`) et n'est lue
 *    qu'à la demande par `getCryptoquantKey` ; elle n'entre JAMAIS dans le state (ni rendue,
 *    ni loggée) ;
 *  - `hasKey` ne reflète que la clé personnelle réellement persistée : le repli `.env` du proxy
 *    Vite / daemon local n'est pas visible ici (badge Réglages cohérent avec BGeometrics/CCData) ;
 *  - `version` est incrémenté à CHAQUE setKey/clearKey : une rotation vraie → vraie laisse
 *    `hasKey` inchangé, les sections DES/CHAIN et le client s'abonnent donc à `version`
 *    (rechargement, oubli des refus 403 mémorisés en session).
 *
 * ZÉRO dépendance vers les modules de données : le client CryptoQuant
 * (data/onchain/cryptoquant.ts) reste dans un chunk chargé à la demande par les sections.
 * La clé est exclue des sauvegardes JSON par `CLES_CREDENTIALS_LOCALES` (store/persist.ts).
 *
 * Le message « clé requise » (`RAISON_CLE_CRYPTOQUANT`, `messageSansCleCq`) vit aussi ici :
 * ce module est déjà partagé par les Réglages, les sections DES et CHAIN et le client, il
 * n'ajoute donc aucun chunk. Le client ré-exporte la constante, les vues l'importent d'ici.
 */
import { createStore, type StoreApi } from "zustand/vanilla";

/** Emplacement localStorage de la clé personnelle (préfixe `axiom:`, exclu de l'export). */
export const CLE_STOCKAGE_CRYPTOQUANT = "axiom:cryptoquant:key";

/** Raison du statut `cle-requise` quand aucune clé n'est active (définition unique). */
export const RAISON_CLE_CRYPTOQUANT = "Clé CryptoQuant personnelle requise (Réglages ⚙).";
/** Message SansCle : base sans point final + complément selon le déploiement, point final unique. */
export function messageSansCleCq(vercel: boolean): string {
  const base = RAISON_CLE_CRYPTOQUANT.slice(0, -1);
  return vercel
    ? `${base} — licence personnelle, aucun repli serveur sur ce déploiement.`
    : `${base} — ou CRYPTOQUANT_API_KEY dans apps/web/.env pour le proxy Vite et le daemon.`;
}

/** Lecture tolérante : clé personnelle rognée, sinon `null` (absente, blanche, stockage refusé). */
export function getCryptoquantKey(): string | null {
  try {
    const valeur = localStorage.getItem(CLE_STOCKAGE_CRYPTOQUANT)?.trim() ?? "";
    return valeur.length > 0 ? valeur : null;
  } catch {
    return null;
  }
}

/** Écriture/suppression tolérante (quota, mode privé → silencieux ; `hasKey` relit ensuite). */
function ecrireCle(cle: string | null): void {
  try {
    if (cle === null) localStorage.removeItem(CLE_STOCKAGE_CRYPTOQUANT);
    else localStorage.setItem(CLE_STOCKAGE_CRYPTOQUANT, cle);
  } catch {
    /* best-effort : la persistance de la clé n'est pas bloquante */
  }
}

export interface CryptoquantKeyState {
  /** true si une clé PERSONNELLE est réellement persistée sur ce poste. */
  hasKey: boolean;
  /** Compteur sans secret, incrémenté à chaque setKey/clearKey (rotation vraie → vraie comprise). */
  version: number;
  /** Enregistre la clé personnelle ; une chaîne blanche équivaut à clearKey. */
  setKey: (cle: string) => void;
  /** Supprime la clé personnelle. */
  clearKey: () => void;
}

export const cryptoquantKeyStore: StoreApi<CryptoquantKeyState> = createStore<CryptoquantKeyState>((set) => ({
  hasKey: getCryptoquantKey() !== null,
  version: 0,

  setKey: (cle) => {
    const normalisee = cle.trim();
    ecrireCle(normalisee.length > 0 ? normalisee : null);
    // Relire plutôt que supposer : un stockage refusé ne doit pas afficher « configurée ».
    set((s) => ({ hasKey: getCryptoquantKey() !== null, version: s.version + 1 }));
  },

  clearKey: () => {
    ecrireCle(null);
    set((s) => ({ hasKey: getCryptoquantKey() !== null, version: s.version + 1 }));
  },
}));
