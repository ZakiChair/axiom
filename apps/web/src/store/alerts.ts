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
import { validerComposite, type AlertDef, type Condition, type Declenchement, type SensCroisement } from "@axiom/alerts";
import type { ExchangeId, Timeframe } from "@axiom/types";
import { daemonPret, kvPut } from "../data/daemon";

const STORAGE_KEY = "axiom:alerts:v1";
/** Namespace + clé KV où les défs sont miroitées vers le daemon (Phase 2.E3). */
const NS_ALERTES = "alerts";
const CLE_DEFS = "defs";
/** Fenêtre de coalescence des envois de défs au daemon (ms). */
const DEBOUNCE_SYNC_MS = 400;
/** Borne du journal affiché/persisté (les entrées plus anciennes sont évincées). */
const MAX_JOURNAL = 100;
/** Titre de section sidebar des alertes (clé `uiSectionsStore`). */
export const SECTION_ALERTES = "Alertes";

/** Champs requis pour créer une alerte (le reste est initialisé par le store). */
export interface NouvelleAlerte {
  symbol: string;
  source: ExchangeId;
  condition: Condition;
  /** TF d'évaluation des conditions de bougie (absent = def héritée, TF affiché). */
  timeframe?: Timeframe;
  message?: string;
}

/**
 * Construit une `NouvelleAlerte` prix-croise au niveau donné (clic-droit chart, lot B4).
 * PURE — n'écrit pas le store (appeler `alertsStore.getState().ajouter(...)` ensuite).
 */
export function alertePrixAuNiveau(
  symbol: string,
  source: ExchangeId,
  niveau: number,
  sens: SensCroisement,
  message?: string,
): NouvelleAlerte {
  return {
    symbol: symbol.toUpperCase(),
    source,
    condition: { type: "prix-croise", niveau, sens },
    ...(message !== undefined ? { message } : {}),
  };
}

/**
 * Arrondit un niveau de prix pour une alerte (~5 chiffres significatifs, 2–8 décimales).
 * PURE — aligne le niveau capturé au pixel sur une valeur stable et lisible.
 */
export function arrondirNiveauAlerte(prix: number): number {
  if (!Number.isFinite(prix)) return prix;
  const abs = Math.abs(prix);
  if (abs === 0) return 0;
  const decimals = Math.min(8, Math.max(2, 4 - Math.floor(Math.log10(abs))));
  const f = 10 ** decimals;
  return Math.round(prix * f) / f;
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

/** Garde de forme d'une def persistée (patron `estTradeValide` d'expy.ts) : champs
 * requis + types. Un item corrompu est ÉCARTÉ à l'hydratation — sans cette garde,
 * `demarrerAlertes` (App.tsx, useEffect sans try/catch) lit `d.actif && d.condition.type`
 * → TypeError → ErrorBoundary racine à CHAQUE boot tant que la clé n'est pas purgée. */
function estAlertDefValide(v: unknown): v is AlertDef {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Record<string, unknown>;
  if (typeof d.id !== "string" || d.id.length === 0) return false;
  if (typeof d.symbol !== "string" || typeof d.source !== "string") return false;
  if (typeof d.actif !== "boolean") return false;
  if (!d.condition || typeof d.condition !== "object") return false;
  if (typeof (d.condition as Record<string, unknown>).type !== "string") return false;
  if (!Array.isArray(d.declenchements) || !d.declenchements.every((t) => typeof t === "number")) return false;
  return true;
}

/** Garde de forme d'une entrée de journal persistée. */
function estDeclenchementValide(v: unknown): v is Declenchement {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Record<string, unknown>;
  return (
    typeof d.alertId === "string" &&
    typeof d.ts === "number" &&
    typeof d.valeur === "number" &&
    typeof d.message === "string"
  );
}

/** Lecture tolérante de l'état persisté, validée PAR ÉLÉMENT (localStorage absent /
 * JSON corrompu / item invalide => écarté). Exportée pour les tests. */
export function lireInitial(): Persiste {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { defs: [], journal: [] };
    const parsed = JSON.parse(raw) as Partial<Persiste>;
    const defsBrutes = Array.isArray(parsed.defs) ? parsed.defs : [];
    const journalBrut = Array.isArray(parsed.journal) ? parsed.journal : [];
    const defs = defsBrutes.filter(estAlertDefValide);
    const journal = journalBrut.filter(estDeclenchementValide);
    const ecartes = defsBrutes.length - defs.length + (journalBrut.length - journal.length);
    if (ecartes > 0) console.warn(`[AXIOM] alerts : ${ecartes} item(s) corrompu(s) écarté(s) à l'hydratation`);
    return { defs, journal };
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

  ajouter: (a) => {
    if (a.condition.type === "composite" && !validerComposite(a.condition.conditions)) return;
    set((s) => ({
      defs: [
        ...s.defs,
        {
          id: genId(),
          symbol: a.symbol.toUpperCase(),
          source: a.source,
          condition: a.condition,
          timeframe: a.timeframe,
          message: a.message,
          actif: true,
          // `arme` volontairement absent (undefined) : la 1re évaluation calibre le côté.
          declenchements: [],
        },
      ],
    }));
  },

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
