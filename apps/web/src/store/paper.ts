/**
 * PAPER TRADING — store (conteneur persisté) + MOTEUR temps réel.
 *
 * Ce module branche l'évaluateur PUR de `data/paper.ts` sur le flux ticker live :
 *  - le STORE tient l'état (solde/ordres/positions/executions) + `derniersPrix` par symbole,
 *    et expose les mutations utilisateur (placer/annuler/modifier TP-SL/clôturer/setSolde) ;
 *  - le MOTEUR (`demarrerMoteurPaper`) souscrit `subscribeTickers` sur l'UNION des symboles
 *    des ordres + positions actifs. À chaque `TickerUpdate` : `evaluerTickDetaille` puis maj de
 *    `derniersPrix`. Toute clôture de genre tp/sl produite par le tick alimente le JOURNAL EXPY
 *    (`expyStore.ajouter(tradeJournalDepuisCloture(...))`) — d'où l'usage d'`evaluerTickDetaille`
 *    qui expose la position AVANT son retrait de l'état (l'exécution seule ne porte pas le
 *    prixEntree/sl/ouvertTs nécessaires au trade de journal).
 *
 * CYCLE D'ABONNEMENT : re-souscription UNIQUEMENT quand l'ENSEMBLE des symboles actifs CHANGE
 * (comparaison de clés, pas de resub par tick) ; résiliation quand l'ensemble est vide. Le
 * moteur ne démarre PAS à l'import (patron `demarrerAlertes`) : il est amorcé au montage de
 * l'App via `demarrerMoteurPaper()` et ne souscrit que s'il y a des ordres/positions actifs.
 *
 * CLÔTURE MANUELLE : `cloturer(positionId)` sort AU DERNIER PRIX CONNU du symbole
 * (`derniersPrix`) ; prix inconnu → no-op (message discret côté UI T3). Elle alimente aussi EXPY.
 *
 * PERSISTANCE : localStorage clé `axiom:paper:v1` (solde/ordres/positions/executions — PAS
 * `derniersPrix`, éphémère), réécrite à CHAQUE mutation du sous-ensemble persisté, tolérante
 * (patron `expy`/`portfolio` : quota / mode privé / JSON corrompu → best-effort silencieux).
 * Le préfixe `axiom:` fait entrer l'état dans la sauvegarde globale (persist.ts) sans câblage.
 */
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import type { Unsubscribe } from "@axiom/types";
import {
  cloturerPosition,
  evaluerTickDetaille,
  tradeJournalDepuisCloture,
  type EtatPaper,
  type OrdrePaper,
} from "../data/paper";
import { subscribeTickers, type TickerUpdate } from "../data/ticker";
import { expyStore } from "./expy";

/** Clé localStorage. Incluse d'office dans l'export/import de sauvegarde (préfixe axiom:). */
export const PAPER_STORAGE_KEY = "axiom:paper:v1";
/** Solde de départ par défaut du compte paper (aucune valeur spécifiée par la spec). */
export const SOLDE_INITIAL = 100_000;

export interface PaperState extends EtatPaper {
  /** Dernier prix connu par symbole (alimenté par les ticks ; NON persisté). */
  derniersPrix: Record<string, number>;
  /** Place un ordre (id + creeTs générés). Fill immédiat si le prix du symbole est déjà connu. */
  placerOrdre: (o: Omit<OrdrePaper, "id" | "creeTs">) => void;
  /** Annule un ordre EN ATTENTE (no-op si id inconnu / déjà rempli). */
  annulerOrdre: (id: string) => void;
  /** Redéfinit le TP/SL d'une position (null = retire le niveau). No-op si id inconnu. */
  modifierTpSl: (positionId: string, tp: number | null, sl: number | null) => void;
  /** Clôture une position au dernier prix connu du symbole. No-op si prix inconnu. Alimente EXPY. */
  cloturer: (positionId: string) => void;
  /** Redéfinit le solde (dépôt/retrait fictif, reset). */
  setSolde: (v: number) => void;
}

/** Store paper trading. */
export type PaperStore = StoreApi<PaperState>;

/** Identifiant d'ordre (crypto.randomUUID si dispo, repli horodaté). Patron des autres stores. */
function genOrdreId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return `paper:${c.randomUUID()}`;
  return `paper:${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Ensemble (trié, dédupliqué) des symboles ACTIFS = union des symboles des ordres et des
 * positions. C'est l'ensemble sur lequel le moteur souscrit le flux ticker. PURE & testée.
 */
export function symbolesActifs(etat: EtatPaper): string[] {
  const s = new Set<string>();
  for (const o of etat.ordres) s.add(o.symbol);
  for (const p of etat.positions) s.add(p.symbol);
  return [...s].sort();
}

/** Sous-ensemble persisté (éphémère `derniersPrix` exclu). */
interface PaperPersiste {
  solde: number;
  ordres: OrdrePaper[];
  positions: EtatPaper["positions"];
  executions: EtatPaper["executions"];
}

/** Lecture tolérante de l'état persisté (localStorage absent / JSON corrompu → défauts). */
export function chargerPaper(): PaperPersiste {
  try {
    const raw = localStorage.getItem(PAPER_STORAGE_KEY);
    if (!raw) return { solde: SOLDE_INITIAL, ordres: [], positions: [], executions: [] };
    const p = JSON.parse(raw) as Partial<PaperPersiste>;
    return {
      solde: typeof p.solde === "number" && Number.isFinite(p.solde) ? p.solde : SOLDE_INITIAL,
      ordres: Array.isArray(p.ordres) ? p.ordres : [],
      positions: Array.isArray(p.positions) ? p.positions : [],
      executions: Array.isArray(p.executions) ? p.executions : [],
    };
  } catch {
    return { solde: SOLDE_INITIAL, ordres: [], positions: [], executions: [] };
  }
}

/** Écriture tolérante du sous-ensemble persisté (quota / mode privé → silencieux). */
function persister(st: PaperState): void {
  try {
    const payload: PaperPersiste = {
      solde: st.solde,
      ordres: st.ordres,
      positions: st.positions,
      executions: st.executions,
    };
    localStorage.setItem(PAPER_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* best-effort */
  }
}

const initial = chargerPaper();

export const paperStore = createStore<PaperState>((set, get) => ({
  solde: initial.solde,
  ordres: initial.ordres,
  positions: initial.positions,
  executions: initial.executions,
  derniersPrix: {},

  placerOrdre: (o) => {
    const ordre: OrdrePaper = { ...o, id: genOrdreId(), creeTs: Date.now() };
    set((s) => ({ ordres: [...s.ordres, ordre] }));
    // Fill opportuniste immédiat si le prix du symbole est DÉJÀ connu (déjà souscrit) : un
    // market s'exécute sans attendre le prochain tick réseau. Sinon l'ordre dort jusqu'à ce
    // que le moteur souscrive le symbole et reçoive son premier tick.
    const last = get().derniersPrix[o.symbol];
    if (last !== undefined) appliquerTick(o.symbol, last, Date.now());
  },

  annulerOrdre: (id) => set((s) => ({ ordres: s.ordres.filter((o) => o.id !== id) })),

  modifierTpSl: (positionId, tp, sl) =>
    set((s) => ({
      positions: s.positions.map((p) => (p.id === positionId ? { ...p, tp, sl } : p)),
    })),

  cloturer: (positionId) => {
    const st = get();
    const p = st.positions.find((x) => x.id === positionId);
    if (!p) return; // id inconnu
    const last = st.derniersPrix[p.symbol];
    if (last === undefined) return; // prix inconnu → no-op (message discret côté UI T3)
    const suivant = cloturerPosition(st, positionId, last, Date.now());
    // Pont EXPY : la clôture manuelle est un trade fermé (position AVANT retrait + exécution).
    const exec = suivant.executions[suivant.executions.length - 1];
    if (exec) expyStore.getState().ajouter(tradeJournalDepuisCloture(p, exec));
    set({
      solde: suivant.solde,
      ordres: suivant.ordres,
      positions: suivant.positions,
      executions: suivant.executions,
    });
  },

  setSolde: (v) => set({ solde: v }),
}));

/**
 * Applique un tick sur le store : évalue (evaluerTickDetaille), alimente EXPY pour chaque
 * clôture tp/sl, puis met à jour l'état ET `derniersPrix`. Interne (hors API publique du store).
 */
function appliquerTick(symbol: string, last: number, nowMs: number): void {
  const st = paperStore.getState();
  const { etat, clotures } = evaluerTickDetaille(st, symbol, last, nowMs);
  // Pont EXPY : chaque clôture tp/sl (position AVANT retrait) → journal.
  for (const c of clotures) {
    expyStore.getState().ajouter(tradeJournalDepuisCloture(c.position, c.exec));
  }
  // maj de l'état (références inchangées si rien exécuté → garde de persistance neutre) +
  // `derniersPrix` (toujours mis à jour, même sur un tick sans exécution).
  paperStore.setState({
    solde: etat.solde,
    ordres: etat.ordres,
    positions: etat.positions,
    executions: etat.executions,
    derniersPrix: { ...st.derniersPrix, [symbol]: last },
  });
}

// Persistance interne : sauvegarde à chaque changement du SOUS-ENSEMBLE persisté (les ticks
// ne touchant que `derniersPrix` n'écrivent PAS — évite le martèlement de localStorage).
paperStore.subscribe((state, prev) => {
  if (
    state.solde === prev.solde &&
    state.ordres === prev.ordres &&
    state.positions === prev.positions &&
    state.executions === prev.executions
  ) {
    return;
  }
  persister(state);
});

// ─────────────────────────── Moteur temps réel ───────────────────────────

/** Singleton : évite les doubles souscriptions (ex. double montage React StrictMode). */
let arreter: Unsubscribe | null = null;

/**
 * Démarre le moteur paper trading (idempotent : un second appel arrête d'abord le précédent).
 * Souscrit `subscribeTickers` sur l'union des symboles actifs, re-souscrit quand l'ensemble
 * CHANGE, résilie quand il est vide. Ne souscrit rien tant qu'aucun ordre/position n'existe.
 * À câbler UNE fois au montage de l'App (patron `demarrerAlertes`). Renvoie l'arrêt.
 */
export function demarrerMoteurPaper(): Unsubscribe {
  if (arreter) arreter();

  let unsubTicker: Unsubscribe = () => {};
  let cleActive = "";

  const onTick = (u: TickerUpdate): void => {
    appliquerTick(u.symbol, u.price, Date.now());
  };

  // (Re)souscription uniquement quand l'ENSEMBLE des symboles actifs change (comparaison de clé).
  const resync = (): void => {
    const symbols = symbolesActifs(paperStore.getState());
    const cle = symbols.join(",");
    if (cle === cleActive) return;
    cleActive = cle;
    unsubTicker();
    unsubTicker = symbols.length === 0 ? () => {} : subscribeTickers(symbols, onTick);
  };

  // Un tick ne modifiant que `derniersPrix` ne change ni les ordres ni les positions → on
  // n'y recalcule pas l'ensemble. On ne resynchronise que sur mutation ordres/positions.
  const unsubStore = paperStore.subscribe((state, prev) => {
    if (state.ordres === prev.ordres && state.positions === prev.positions) return;
    resync();
  });

  resync(); // amorçage : souscrit seulement s'il y a déjà des symboles actifs (reprise au boot)

  const stop = (): void => {
    unsubStore();
    unsubTicker();
    cleActive = "";
  };
  arreter = () => {
    stop();
    arreter = null;
  };
  return arreter;
}
