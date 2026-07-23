/**
 * EXPY — store du journal de trades (conteneur persisté). Consomme le modèle PUR de
 * `data/expy.ts` ; toute la logique de calcul (R, expectancy, équité) vit là-bas. Ici
 * on ne gère que le CYCLE DE VIE des trades saisis manuellement et leur persistance.
 *
 * PERSISTANCE : localStorage clé `axiom:expy:v1`, réécrite à CHAQUE mutation. Lecture et
 * écriture tolérantes (patron `userPresets` du screener / `notes`) : localStorage absent,
 * JSON corrompu ou quota plein n'ont aucun effet fonctionnel — best-effort silencieux.
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

/** Clé localStorage du journal. Incluse d'office dans l'export/import de sauvegarde. */
export const EXPY_STORAGE_KEY = "axiom:expy:v1";

export interface ExpyState {
  trades: TradeJournal[];
  /** Ajoute un trade (id généré). Persiste. */
  ajouter: (t: Omit<TradeJournal, "id">) => void;
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
}

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

/** Écriture tolérante (quota / mode privé → silencieux : persistance best-effort). */
function persister(trades: TradeJournal[]): void {
  try {
    localStorage.setItem(EXPY_STORAGE_KEY, JSON.stringify(trades));
  } catch {
    /* quota / mode privé : la persistance est best-effort */
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

  ajouter: (t) => {
    const trades = [...get().trades, { ...t, id: genTradeId() }];
    persister(trades);
    set({ trades });
  },

  cloturer: (id, sortie, fermeTs) => {
    const trades = get().trades.map((t) => (t.id === id ? { ...t, sortie, fermeTs } : t));
    persister(trades);
    set({ trades });
  },

  supprimer: (id) => {
    const trades = get().trades.filter((t) => t.id !== id);
    persister(trades);
    set({ trades });
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
      persister(trades);
      set({ trades });
    }
    return { ajoutes, ignores };
  },

  exporter: () => JSON.stringify(get().trades, null, 2),
}));
