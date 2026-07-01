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
import { daemonPret, kvPut } from "../data/daemon";

const STORAGE_KEY = "axiom:alerts:v1";
/** Namespace + clé KV où les défs sont miroitées vers le daemon (Phase 2.E3). */
const NS_ALERTES = "alerts";
const CLE_DEFS = "defs";
/** Fenêtre de coalescence des envois de défs au daemon (ms). */
const DEBOUNCE_SYNC_MS = 400;
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

// ─────────────────────────── Sync vers le daemon (Phase 2.E3) ───────────────────────────
//
// DUAL-WRITE (même esprit qu'E2) : en plus de localStorage, les DÉFS sont poussées au
// daemon (KV namespace « alerts », clé « defs ») pour l'évaluation « onglet fermé ». Le
// daemon garde son PROPRE état de ré-armement ; il ne lit que la liste des défs. On ne
// SONDE PAS le réseau (daemonPret est synchrone) : sans daemon détecté, aucun effet.

/** Envoi debouncé en attente. */
let minuteurSync: ReturnType<typeof setTimeout> | undefined;

/** Programme (debounce) un envoi des défs courantes au daemon, si détecté. */
function programmerSyncDaemon(defs: AlertDef[]): void {
  if (!daemonPret()) return;
  if (minuteurSync !== undefined) clearTimeout(minuteurSync);
  minuteurSync = setTimeout(() => {
    void kvPut(NS_ALERTES, CLE_DEFS, defs);
  }, DEBOUNCE_SYNC_MS);
}

/**
 * Pousse IMMÉDIATEMENT les défs courantes au daemon (si détecté). Appelé au démarrage
 * du runtime une fois le daemon confirmé présent (les mutations ultérieures passent par
 * le dual-write ci-dessous). Best-effort, silencieux sans daemon.
 */
export function pousserDefsDaemon(): void {
  if (!daemonPret()) return;
  void kvPut(NS_ALERTES, CLE_DEFS, alertsStore.getState().defs);
}

// Persistance interne : sauvegarde à chaque changement (basse fréquence) + miroir daemon
// des défs uniquement (le journal reste local ; le daemon a le sien en SQLite).
alertsStore.subscribe((state, prev) => {
  sauvegarder(state);
  if (state.defs !== prev.defs) programmerSyncDaemon(state.defs);
});
