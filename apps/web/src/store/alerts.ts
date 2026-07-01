/**
 * Store alertes — Zustand VANILLA (hors render-loop React).
 *
 * Détient les définitions d'alertes (`defs`) + le journal des déclenchements
 * (`journal`, plus récent en tête, borné). Les mutations sont BASSE fréquence
 * (création / bascule / suppression, et transitions d'armement au fil des
 * franchissements) : le panneau peut donc s'y abonner sans risque de re-render
 * sur tick — les prix live ne transitent PAS par ce store.
 *
 * PERSISTANCE : localStorage INTERNE au store (clé `axiom:alerts:v1`), hydratée à
 * la création puis sauvegardée à chaque changement. À TERME, cette persistance sera
 * migrée vers `store/persist.ts` (hydrate/enable centralisés) — cf. VIGILANCE.
 *
 * Le moteur d'évaluation vit dans `@axiom/alerts` (pur, réutilisable par le daemon
 * de Phase 2) ; ce store n'est qu'un conteneur d'état + un journal.
 */
import { createStore } from "zustand/vanilla";
import type { AlertDef, Condition, Declenchement } from "@axiom/alerts";
import type { ExchangeId } from "@axiom/types";

const STORAGE_KEY = "axiom:alerts:v1";
/** Borne du journal affiché/persisté (les entrées plus anciennes sont évincées). */
const MAX_JOURNAL = 100;

/** Champs requis pour créer une alerte (le reste est initialisé par le store). */
export interface NouvelleAlerte {
  symbol: string;
  source: ExchangeId;
  condition: Condition;
  message?: string;
}

export interface AlertsState {
  defs: AlertDef[];
  /** Journal des déclenchements (plus récent en tête). */
  journal: Declenchement[];
  /** Crée une alerte (id généré, active, non calibrée) et la persiste. */
  ajouter: (a: NouvelleAlerte) => void;
  supprimer: (id: string) => void;
  basculerActif: (id: string) => void;
  /**
   * Applique un LOT de defs mises à jour par le moteur (fusion PAR id) : remplace les
   * defs de même id, laisse les autres intactes, n'en ressuscite aucune supprimée.
   */
  appliquerMisesAJour: (defs: AlertDef[]) => void;
  /** Ajoute une entrée au journal (bornée). */
  ajouterJournal: (d: Declenchement) => void;
  viderJournal: () => void;
}

/** Identifiant unique (crypto.randomUUID si dispo, repli horodaté sinon). */
function genId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `al_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Forme persistée (sous-ensemble sérialisable de l'état). */
interface Persiste {
  defs: AlertDef[];
  journal: Declenchement[];
}

/** Lecture tolérante de l'état persisté (localStorage absent / JSON corrompu => défauts). */
function lireInitial(): Persiste {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { defs: [], journal: [] };
    const parsed = JSON.parse(raw) as Partial<Persiste>;
    return {
      defs: Array.isArray(parsed.defs) ? parsed.defs : [],
      journal: Array.isArray(parsed.journal) ? parsed.journal : [],
    };
  } catch {
    return { defs: [], journal: [] };
  }
}

/** Écriture tolérante (quota / mode privé => silencieux : la persistance est best-effort). */
function sauvegarder(state: AlertsState): void {
  try {
    const payload: Persiste = { defs: state.defs, journal: state.journal };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

const initial = lireInitial();

export const alertsStore = createStore<AlertsState>((set, get) => ({
  defs: initial.defs,
  journal: initial.journal,

  ajouter: (a) =>
    set((s) => ({
      defs: [
        ...s.defs,
        {
          id: genId(),
          symbol: a.symbol.toUpperCase(),
          source: a.source,
          condition: a.condition,
          message: a.message,
          actif: true,
          // `arme` volontairement absent (undefined) : la 1re évaluation calibre le côté.
          declenchements: [],
        },
      ],
    })),

  supprimer: (id) => set((s) => ({ defs: s.defs.filter((d) => d.id !== id) })),

  basculerActif: (id) =>
    set((s) => ({
      defs: s.defs.map((d) => (d.id === id ? { ...d, actif: !d.actif } : d)),
    })),

  appliquerMisesAJour: (maj) =>
    set((s) => {
      if (maj.length === 0) return s;
      const parId = new Map(maj.map((d) => [d.id, d]));
      return { defs: s.defs.map((d) => parId.get(d.id) ?? d) };
    }),

  ajouterJournal: (d) =>
    set((s) => ({ journal: [d, ...s.journal].slice(0, MAX_JOURNAL) })),

  viderJournal: () => set({ journal: [] }),
}));

// Persistance interne : sauvegarde à chaque changement (basse fréquence).
alertsStore.subscribe((state) => sauvegarder(state));
