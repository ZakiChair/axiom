/**
 * Stores ON-CHAIN — Zustand VANILLA (hors render-loop React).
 *
 * Deux préoccupations, réunies ici car partagées par la fenêtre « CHAIN » et les Réglages :
 *  1. `onchainUiStore` : état d'ouverture de la fenêtre non modale (comme derivatives-ui).
 *     Éphémère → NON persisté.
 *  2. `bgeometricsKeyStore` : présence d'une clé BGeometrics (bitcoin-data.com). La clé est
 *     OPTIONNELLE (la source fonctionne sans clé, quota 15 req/jour ; la clé relève le quota).
 *     Comme coinalyze/fred : on ne place JAMAIS la VALEUR de la clé dans le state (ni rendue
 *     ni loggée) — elle vit dans localStorage et n'est lue qu'à la demande via `getBgeometricsKey`.
 *
 * Ce module exporte aussi `commandes` (tableau conforme à la palette) : l'INTÉGRATEUR
 * l'enregistre via `enregistrerCommandes` (import de TYPE seulement vers commands/registry).
 */
import { createStore } from "zustand/vanilla";
import type { Commande } from "../commands/registry";

// ─────────────────────────── UI (ouverture de la fenêtre CHAIN) ───────────────────────────

export interface OnchainUiState {
  /** true quand la fenêtre On-chain est ouverte. */
  open: boolean;
  openOnchain: () => void;
  closeOnchain: () => void;
  /** Bascule (utilisé par le mnémonique CHAIN). */
  toggleOnchain: () => void;
}

export const onchainUiStore = createStore<OnchainUiState>((set, get) => ({
  open: false,
  openOnchain: () => set({ open: true }),
  closeOnchain: () => set({ open: false }),
  toggleOnchain: () => set({ open: !get().open }),
}));

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
   * true si une clé PERSONNELLE est configurée. Contrairement à coinalyze/fred (repli
   * .env via proxy), BGeometrics est appelé en DIRECT sans repli : `hasKey` reflète donc
   * la présence réelle d'une clé. Sans clé, la source reste utilisable (quota réduit).
   */
  hasKey: boolean;
  /** Enregistre une clé personnelle (localStorage). Vide => équivaut à clearKey. */
  setKey: (key: string) => void;
  /** Supprime la clé personnelle. */
  clearKey: () => void;
}

export const bgeometricsKeyStore = createStore<BgeometricsKeyState>((set) => ({
  hasKey: readKey() !== null,

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
