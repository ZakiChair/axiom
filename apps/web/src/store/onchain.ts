/**
 * Stores ON-CHAIN — Zustand VANILLA (hors render-loop React).
 *
 * Deux préoccupations, réunies ici car partagées par la fenêtre « CHAIN » et les Réglages :
 *  1. `onchainUiStore` : état d'ouverture de la fenêtre non modale (comme derivatives-ui).
 *     Éphémère → NON persisté.
 *  2. `bgeometricsKeyStore` : présence d'une clé BGeometrics (bitcoin-data.com). La clé est
 *     OPTIONNELLE (la source fonctionne sans clé, quota IP ~15 req/jour ; une clé gratuite
 *     plafonne aussi à 10 req/heure et 15 req/jour — seule une offre payante relève le quota).
 *     Comme coinalyze/fred : on ne place JAMAIS la VALEUR de la clé dans le state (ni rendue
 *     ni loggée) — elle vit dans localStorage et n'est lue qu'à la demande via `getBgeometricsKey`.
 *
 * Ce module exporte aussi `commandes` (tableau conforme à la palette) : l'INTÉGRATEUR
 * l'enregistre via `enregistrerCommandes` (import de TYPE seulement vers commands/registry).
 */
import { createStore } from "zustand/vanilla";
import type { Commande } from "../commands/registry";
import { windowManagerStore, mirrorOpenState } from "./windowManager";
// Module sans dépendance : n'embarque pas le client BGeometrics dans le bundle initial.
import { oublierRefusAbonnementBg } from "../data/onchain/refusAbonnementBg";

// ─────────────────────────── UI (ouverture de la fenêtre CHAIN) ───────────────────────────

export interface OnchainUiState {
  /** true quand la fenêtre On-chain est ouverte. */
  open: boolean;
  openOnchain: () => void;
  closeOnchain: () => void;
  /** Bascule (utilisé par le mnémonique CHAIN). */
  toggleOnchain: () => void;
}

export const onchainUiStore = createStore<OnchainUiState>(() => ({
  open: false,
  openOnchain: () => windowManagerStore.getState().openWindow("onchain"),
  closeOnchain: () => windowManagerStore.getState().closeWindow("onchain"),
  toggleOnchain: () => windowManagerStore.getState().toggleWindow("onchain"),
}));

mirrorOpenState("onchain", onchainUiStore);

// ─────────────────────────── Clé BGeometrics (optionnelle) ───────────────────────────

const STORAGE_KEY = "axiom:bgeometrics:key";

/** Lecture tolérante de la clé personnelle : clé persistée, sinon `null`. */
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

/** Lit la clé BGeometrics persistée (à passer à `fetchBgeometrics`). Jamais rendue. */
export function getBgeometricsKey(): string | null {
  return readKey();
}

export interface BgeometricsKeyState {
  /**
   * true si une clé PERSONNELLE est configurée. Comme coinalyze/fred, BGeometrics dispose
   * désormais d'un repli .env (proxy `/bgapi`, en-tête `Bearer`) : `hasKey` ne reflète donc
   * que la clé personnelle (prioritaire) — un repli .env donne accès même sans elle, avec les
   * mêmes plafonds de l'offre gratuite (10 req/heure et 15 req/jour).
   * Sans aucune clé, la source reste utilisable (quota IP réduit).
   */
  hasKey: boolean;
  /** Compteur sans secret, incrémenté même lors d'une rotation vraie→vraie. */
  version: number;
  /** Enregistre une clé personnelle (localStorage). Vide => équivaut à clearKey. */
  setKey: (key: string) => void;
  /** Supprime la clé personnelle. */
  clearKey: () => void;
}

export const bgeometricsKeyStore = createStore<BgeometricsKeyState>((set) => ({
  hasKey: readKey() !== null,
  version: 0,

  setKey: (key) => {
    const k = key.trim();
    const value = k.length > 0 ? k : null;
    writeKey(value);
    // Le refus d'abonnement mémorisé valait pour l'ancienne clé.
    oublierRefusAbonnementBg();
    set((s) => ({ hasKey: value !== null, version: s.version + 1 }));
  },

  clearKey: () => {
    writeKey(null);
    oublierRefusAbonnementBg();
    set((s) => ({ hasKey: false, version: s.version + 1 }));
  },
}));

// ─────────────────────────── Commande de palette (mnémonique CHAIN) ───────────────────────────

/** Commandes exposées à la palette (enregistrées par l'intégrateur). */
export const commandes: Commande[] = [
  {
    id: "panneau:onchain",
    mnemonique: "CHAIN",
    libelle: "On-chain — réseau BTC, valorisation, ETF",
    categorie: "panneau",
    motsCles: [
      "onchain",
      "on-chain",
      "chain",
      "mvrv",
      "sopr",
      "nupl",
      "hashrate",
      "mempool",
      "halving",
      "frais",
      "coinmetrics",
      "bgeometrics",
      "etf",
    ],
    apercu: "Ouvre / ferme la fenêtre on-chain",
    action: () => onchainUiStore.getState().toggleOnchain(),
  },
];
