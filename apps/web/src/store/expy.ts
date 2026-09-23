/**
 * EXPY — store du journal de trades (conteneur persisté). Consomme le modèle PUR de
 * `data/expy.ts` ; toute la logique de calcul (R, expectancy, équité) vit là-bas. Ici
 * on ne gère que le CYCLE DE VIE des trades saisis manuellement et leur persistance.
 *
 * PERSISTANCE : localStorage clé `axiom:expy:v1`, réécrite à CHAQUE mutation. Lecture et
 * écriture tolérantes (patron `userPresets` du screener / `notes`) : une erreur d'écriture
 * conserve l'état en mémoire, expose une erreur lisible et permet un réessai sans doublon.
 * Le préfixe `axiom:` fait entrer le journal dans la sauvegarde globale (persist.ts) sans
 * câblage supplémentaire.
 *
 * IMPORT/EXPORT : `exporter()` sérialise le journal en JSON pretty re-importable.
 * `importer(json)` valide LIGNE PAR LIGNE (champs requis + types) ; une ligne invalide est
 * écartée et comptée, une ligne dont l'id est déjà présent (existant OU doublon intra-lot)
 * est conservée telle quelle — l'existant n'est jamais écrasé. Retour `{ ajoutes, ignores }`
 * avec `ajoutes + ignores` = nombre de lignes du tableau JSON valide.
 */
import { createStore } from "zustand/vanilla";
import type { TradeJournal } from "../data/expy";
import { EXCHANGE_IDS } from "@axiom/types";
import { miroiterTravailPersonnel } from "../data/daemon";

/** Clé localStorage du journal. Incluse d'office dans l'export/import de sauvegarde. */
export const EXPY_STORAGE_KEY = "axiom:expy:v1";

export interface ExpyState {
  trades: TradeJournal[];
  erreurSauvegarde: string | null;
  /** Ajoute un trade (id généré). Persiste. */
  ajouter: (t: Omit<TradeJournal, "id">) => { id: string; enregistre: boolean };
  /** Corrige le même trade après une création non enregistrée. */
  modifier: (id: string, patch: Partial<Omit<TradeJournal, "id">>) => void;
  /** Clôture le trade `id` : pose `sortie` ET `fermeTs`. No-op si id inconnu. Persiste. */
  cloturer: (id: string, sortie: number, fermeTs: number) => void;
  /** Supprime le trade `id`. Persiste. */
  supprimer: (id: string) => void;
  /**
   * Importe un JSON de trades. Validation par ligne, fusion par id (existant conservé).
   * Retourne le nombre de lignes ajoutées et ignorées (invalides ou id déjà présent).
   */
  importer: (json: string) => { ajoutes: number; ignores: number };
  /** Sérialise le journal en JSON pretty re-importable. */
  exporter: () => string;
  reessayerSauvegarde: () => boolean;
}

/** Brouillon purement mémoire de la saisie restée en attente après échec local. */
export interface SaisieExpyEnAttente {
  id: string;
  form: {
    symbol: string;
    direction: "long" | "short";
    entree: string;
    stop: string;
    taille: string;
    sortie: string;
    tags: string;
    note: string;
  };
}

export const expyUiStore = createStore<{
  saisieEnAttente: SaisieExpyEnAttente | null;
  retenirSaisieEnAttente: (saisie: SaisieExpyEnAttente | null) => void;
}>((set) => ({
  saisieEnAttente: null,
  retenirSaisieEnAttente: (saisieEnAttente) => set({ saisieEnAttente }),
}));

/** Identifiant de trade (crypto.randomUUID si dispo, repli horodaté). Patron du screener. */
function genTradeId(): string {
  const c = globalThis.crypto;
  const suffix = c && typeof c.randomUUID === "function" ? c.randomUUID() : Date.now().toString(36);
  return `trade:${suffix}`;
}

/** Lecture tolérante du journal persisté (localStorage absent / JSON corrompu / non-tableau → []). */
export function chargerTrades(): TradeJournal[] {
  try {
    const raw = localStorage.getItem(EXPY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(estTradeValide);
  } catch {
    return [];
  }
}

const ERREUR_SAUVEGARDE = "Non enregistré sur cet appareil. Réessayez la sauvegarde.";

/** Le miroir daemon n'entre pas dans le statut d'écriture locale. */
function persister(trades: TradeJournal[]): boolean {
  try {
    const valeur = JSON.stringify(trades);
    localStorage.setItem(EXPY_STORAGE_KEY, valeur);
    try { miroiterTravailPersonnel(EXPY_STORAGE_KEY, valeur); } catch { /* miroir facultatif */ }
    return true;
  } catch {
    return false;
  }
}

/** Valide un enregistrement importé : tous les champs requis présents et bien typés. */
function estTradeValide(v: unknown): v is TradeJournal {
  if (typeof v !== "object" || v === null) return false;
  const t = v as Record<string, unknown>;
  const estNombre = (x: unknown): boolean => typeof x === "number" && Number.isFinite(x);
  const estNombreOuNull = (x: unknown): boolean => x === null || estNombre(x);
  if (typeof t.id !== "string" || t.id.length === 0) return false;
  if (typeof t.symbol !== "string") return false;
  if (t.source !== undefined && (typeof t.source !== "string" || !(EXCHANGE_IDS as readonly string[]).includes(t.source))) return false;
  if (t.decisionIds !== undefined && (!Array.isArray(t.decisionIds) || !t.decisionIds.every((id) => typeof id === "string" && id.length > 0))) return false;
  if (t.direction !== "long" && t.direction !== "short") return false;
  if (!estNombre(t.entree) || !estNombre(t.stopInitial) || !estNombre(t.taille)) return false;
  if (!estNombreOuNull(t.sortie)) return false;
  if (!estNombre(t.ouvertTs) || !estNombreOuNull(t.fermeTs)) return false;
  if (!Array.isArray(t.tags) || !t.tags.every((tag) => typeof tag === "string")) return false;
  if (t.note !== undefined && typeof t.note !== "string") return false;
  return true;
}

export const expyStore = createStore<ExpyState>((set, get) => ({
  trades: chargerTrades(),
  erreurSauvegarde: null,

  ajouter: (t) => {
    const id = genTradeId();
    const trades = [...get().trades, { ...t, id }];
    const enregistre = persister(trades);
    set({ trades, erreurSauvegarde: enregistre ? null : ERREUR_SAUVEGARDE });
    return { id, enregistre };
  },

  modifier: (id, patch) => {
    if (!get().trades.some((t) => t.id === id)) return;
    const trades = get().trades.map((t) => t.id === id ? { ...t, ...patch } : t);
    const ok = persister(trades);
    set({ trades, erreurSauvegarde: ok ? null : ERREUR_SAUVEGARDE });
  },

  cloturer: (id, sortie, fermeTs) => {
    if (!get().trades.some((t) => t.id === id)) return;
    const trades = get().trades.map((t) => (t.id === id ? { ...t, sortie, fermeTs } : t));
    const ok = persister(trades);
    set({ trades, erreurSauvegarde: ok ? null : ERREUR_SAUVEGARDE });
  },

  supprimer: (id) => {
    const trades = get().trades.filter((t) => t.id !== id);
    const ok = persister(trades);
    set({ trades, erreurSauvegarde: ok ? null : ERREUR_SAUVEGARDE });
  },

  importer: (json) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return { ajoutes: 0, ignores: 0 };
    }
    if (!Array.isArray(parsed)) return { ajoutes: 0, ignores: 0 };

    const trades = [...get().trades];
    const vus = new Set(trades.map((t) => t.id));
    let ajoutes = 0;
    let ignores = 0;
    for (const ligne of parsed) {
      if (!estTradeValide(ligne) || vus.has(ligne.id)) {
        ignores += 1;
        continue;
      }
      vus.add(ligne.id);
      trades.push(ligne);
      ajoutes += 1;
    }
    if (ajoutes > 0) {
      const ok = persister(trades);
      set({ trades, erreurSauvegarde: ok ? null : ERREUR_SAUVEGARDE });
    }
    return { ajoutes, ignores };
  },

  exporter: () => JSON.stringify(get().trades, null, 2),
  reessayerSauvegarde: () => {
    const ok = persister(get().trades);
    set({ erreurSauvegarde: ok ? null : ERREUR_SAUVEGARDE });
    return ok;
  },
}));
