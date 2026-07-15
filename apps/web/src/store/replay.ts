/**
 * Store du replay de marché (roadmap §4.4) — Zustand VANILLA (hors render-loop React).
 *
 * Détient : l'état d'ouverture de la fenêtre, la SÉLECTION (symbole/jour/TF), l'état du
 * TÉLÉCHARGEMENT (statut du job daemon + jours stockés), et l'état de LECTURE (actif,
 * slot cible, curseur, vitesse, lecture en cours). Le moteur de rejeu lui-même
 * (`MoteurReplay`) vit HORS du store (référence module) : le state ne porte que des
 * scalaires basse fréquence (le curseur est poussé ~10/s pour la barre de progression).
 *
 * Mécanique de branchement (voir data/replayFeed.ts + chart/ChartInstance.tsx) :
 *  - `start()` capture le slot FOCUS ET son identité live, applique atomiquement l'identité
 *    Binance/symbole/TF du rejeu, crée le moteur puis incrémente `gen`. Le slot ne peut donc
 *    jamais attribuer des bougies de replay à l'ancien marché affiché.
 *  - `seek(t)` recrée le moteur à un nouveau curseur et incrémente `gen` → remontage +
 *    reseed instantané.
 *  - `stop()` efface l'adaptateur, restaure atomiquement l'identité live capturée, puis
 *    remonte la couche données. Un changement manuel d'identité quitte plutôt le replay en
 *    conservant la nouvelle sélection de l'utilisateur.
 *
 * 100 % dégradé si le daemon est absent (les appels échouent en silence, `daemonAbsent`).
 */
import { createStore } from "zustand/vanilla";
import type { Timeframe } from "@axiom/types";
import type { Commande } from "../commands/registry";
import { chartLayoutStore, visibleSlotCount } from "./chart-layout";
import {
  marketIdentity,
  marketStore,
  sameMarketIdentity,
  type MarketIdentity,
} from "./market";
import {
  demanderTelechargement,
  definirMoteurActif,
  JOUR_MS,
  listerJours,
  MoteurReplay,
  moteurReplayActif,
  purgerJour,
  REPLAY_TFS,
  statutTelechargement,
  VITESSES,
  debutJour,
  type JobStatut,
  type JourStocke,
} from "../data/replayFeed";
import { windowManagerStore, mirrorOpenState } from "./windowManager";

export { REPLAY_TFS, VITESSES };

/** Intervalle de poll du statut de téléchargement (ms). */
const POLL_MS = 1_500;

/** Renvoie le jour `YYYY-MM-DD` (UTC) décalé de `n` jours par rapport à aujourd'hui. */
export function jourDecale(n: number): string {
  const d = new Date(Date.now() + n * JOUR_MS);
  return d.toISOString().slice(0, 10);
}

/** Jours proposés dans le sélecteur : les 7 derniers (hors aujourd'hui, dump non encore publié). */
export function joursProposes(): string[] {
  const out: string[] = [];
  for (let i = 1; i <= 7; i++) out.push(jourDecale(-i));
  return out;
}

export interface ReplayState {
  open: boolean;
  openReplay: () => void;
  closeReplay: () => void;
  toggle: () => void;

  // — Sélection —
  symbole: string;
  jour: string;
  tf: Timeframe;
  setSymbole: (s: string) => void;
  setJour: (j: string) => void;
  setTf: (tf: Timeframe) => void;

  // — Téléchargement —
  statut: JobStatut;
  jours: JourStocke[];
  daemonAbsent: boolean;
  telecharger: () => void;
  rafraichirStatut: () => void;
  rafraichirJours: () => void;
  purger: (symbole: string, jour: string) => void;

  // — Lecture —
  active: boolean;
  /** Slot (grille) cible du rejeu, capturé au démarrage (= focus). */
  slot: number;
  /** Générations : incrémentée à chaque start/seek pour forcer le remontage du slot. */
  gen: number;
  /** Identité live à restaurer à la sortie ; null si un changement utilisateur l'a remplacée. */
  returnMarket: MarketIdentity | null;
  /** Transition interne d'identité (évite propagation liée et auto-stop récursif). */
  identityTransition: boolean;
  playing: boolean;
  vitesse: number;
  /** Position du curseur (ms epoch). */
  curseur: number;
  /** Progression sur le jour [0..1]. */
  progression: number;

  start: () => void;
  stop: () => void;
  basculerLecture: () => void;
  setVitesse: (v: number) => void;
  seek: (t: number) => void;
}

/** Minuteur de poll du statut (module-scope, un seul à la fois). */
let pollTimer: ReturnType<typeof setInterval> | null = null;
/** Un seul poll par session : interdit les régressions `pret` → `en_cours` hors ordre. */
let pollInFlightRequestId: number | null = null;
/** Tokens monotones : une réponse réseau ancienne ne peut jamais écraser la sélection courante. */
let statusRequestId = 0;
let daysRequestId = 0;

function arreterPoll(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function replayIdentity(state: Pick<ReplayState, "symbole" | "tf">): MarketIdentity {
  return { exchange: "binance", symbol: state.symbole, timeframe: state.tf };
}

function marketAtSlot(slot: number): MarketIdentity | null {
  if (slot === 0) return marketIdentity(marketStore.getState());
  const config = chartLayoutStore.getState().slots[slot - 1];
  return config ? { ...config } : null;
}

function applyMarketAtSlot(slot: number, identity: MarketIdentity): void {
  if (slot === 0) marketStore.getState().setMarket(identity);
  else chartLayoutStore.getState().setSlotMarket(slot, identity);
}

function selectionMatches(
  state: Pick<ReplayState, "symbole" | "jour">,
  symbole: string,
  jour: string,
): boolean {
  return state.symbole === symbole && state.jour === jour;
}

function statusMatchesSelection(state: Pick<ReplayState, "symbole" | "jour" | "statut">): boolean {
  return (
    state.statut.etat === "pret" &&
    state.statut.symbole?.toUpperCase() === state.symbole &&
    state.statut.jour === state.jour
  );
}

export const replayStore = createStore<ReplayState>((set, get) => ({
  open: false,
  openReplay: () => {
    windowManagerStore.getState().openWindow("replay");
    get().rafraichirJours();
    get().rafraichirStatut();
  },
  closeReplay: () => windowManagerStore.getState().closeWindow("replay"),
  toggle: () => {
    const etaitOuvert = windowManagerStore.getState().windows["replay"]?.open ?? false;
    windowManagerStore.getState().toggleWindow("replay");
    if (!etaitOuvert) {
      get().rafraichirJours();
      get().rafraichirStatut();
    }
  },

  symbole: "BTCUSDT",
  jour: jourDecale(-1),
  tf: "1m",
  setSymbole: (s) => {
    if (get().active) return;
    const symbole = s.trim().toUpperCase();
    if (symbole.length === 0 || symbole === get().symbole) return;
    arreterPoll();
    statusRequestId++;
    set({ symbole, statut: { etat: "absent", symbole, jour: get().jour } });
    get().rafraichirStatut();
  },
  setJour: (j) => {
    if (get().active || j === get().jour) return;
    arreterPoll();
    statusRequestId++;
    set({ jour: j, statut: { etat: "absent", symbole: get().symbole, jour: j } });
    get().rafraichirStatut();
  },
  setTf: (tf) => {
    if (!get().active) set({ tf });
  },

  statut: { etat: "absent" },
  jours: [],
  daemonAbsent: false,

  telecharger: () => {
    const { symbole, jour } = get();
    arreterPoll();
    const requestId = ++statusRequestId;
    set({ statut: { etat: "en_cours", symbole, jour, recus: 0 } });
    void demanderTelechargement(symbole, jour)
      .then((s) => {
        if (requestId !== statusRequestId || !selectionMatches(get(), symbole, jour)) return;
        set({ statut: s, daemonAbsent: false });
        arreterPoll();
        // Poll tant que le job n'est pas terminé.
        pollTimer = setInterval(() => {
          const cur = get();
          if (cur.symbole !== symbole || cur.jour !== jour) {
            arreterPoll();
            return;
          }
          if (pollInFlightRequestId === requestId) return;
          pollInFlightRequestId = requestId;
          void statutTelechargement(symbole, jour)
            .then((st) => {
              if (requestId !== statusRequestId || !selectionMatches(get(), symbole, jour)) return;
              set({ statut: st });
              if (st.etat === "pret" || st.etat === "erreur" || st.etat === "absent") {
                arreterPoll();
                get().rafraichirJours();
              }
            })
            .catch(() => {
              if (requestId !== statusRequestId || !selectionMatches(get(), symbole, jour)) return;
              set({
                daemonAbsent: true,
                statut: {
                  etat: "erreur",
                  symbole,
                  jour,
                  erreur: "Daemon AXIOM indisponible.",
                },
              });
              arreterPoll();
            })
            .finally(() => {
              if (pollInFlightRequestId === requestId) pollInFlightRequestId = null;
            });
        }, POLL_MS);
      })
      .catch(() => {
        if (requestId === statusRequestId && selectionMatches(get(), symbole, jour)) {
          set({
            daemonAbsent: true,
            statut: {
              etat: "erreur",
              symbole,
              jour,
              erreur: "Daemon AXIOM indisponible.",
            },
          });
        }
      });
  },

  rafraichirStatut: () => {
    const { symbole, jour } = get();
    arreterPoll();
    const requestId = ++statusRequestId;
    void statutTelechargement(symbole, jour)
      .then((s) => {
        if (requestId === statusRequestId && selectionMatches(get(), symbole, jour)) {
          set({ statut: s, daemonAbsent: false });
        }
      })
      .catch(() => {
        if (requestId === statusRequestId && selectionMatches(get(), symbole, jour)) {
          set({ daemonAbsent: true });
        }
      });
  },

  rafraichirJours: () => {
    const requestId = ++daysRequestId;
    void listerJours()
      .then((j) => {
        if (requestId === daysRequestId) set({ jours: j, daemonAbsent: false });
      })
      .catch(() => {
        if (requestId === daysRequestId) set({ daemonAbsent: true });
      });
  },

  purger: (symbole, jour) => {
    void purgerJour(symbole, jour).then(() => {
      get().rafraichirJours();
      if (get().symbole === symbole && get().jour === jour) get().rafraichirStatut();
    });
  },

  active: false,
  slot: 0,
  gen: 0,
  returnMarket: null,
  identityTransition: false,
  playing: false,
  vitesse: 1,
  curseur: 0,
  progression: 0,

  start: () => {
    if (get().active) get().stop();
    const selection = get();
    if (!statusMatchesSelection(selection)) return;
    const { symbole, jour, tf } = selection;
    const slot = chartLayoutStore.getState().focus;
    const returnMarket = marketAtSlot(slot);
    if (returnMarket === null) return;
    const targetMarket = replayIdentity(selection);
    const debut = debutJour(jour);
    const moteur = new MoteurReplay({
      symbole,
      jour,
      tf,
      onCurseur: (t) => set({ curseur: t, progression: (t - debut) / JOUR_MS }),
      onFin: () => set({ playing: false }),
    });

    // La transition est publiée avant la mutation du store marché afin que les abonnements
    // de liaison multi-chart et d'auto-stop reconnaissent ce changement comme interne.
    set({ slot, returnMarket, identityTransition: true });
    applyMarketAtSlot(slot, targetMarket);
    if (!sameMarketIdentity(marketAtSlot(slot), targetMarket)) {
      applyMarketAtSlot(slot, returnMarket);
      set({ returnMarket: null, identityTransition: false });
      moteur.dispose();
      return;
    }
    definirMoteurActif(moteur);
    set({
      active: true,
      slot,
      gen: get().gen + 1,
      playing: false,
      vitesse: 1,
      curseur: moteur.position(),
      progression: (moteur.position() - debut) / JOUR_MS,
      identityTransition: false,
    });
  },

  stop: () => {
    const state = get();
    if (!state.active && moteurReplayActif() === null) return;
    const { slot, returnMarket } = state;
    moteurReplayActif()?.dispose();
    definirMoteurActif(null);
    set({
      active: false,
      playing: false,
      gen: state.gen + 1,
      identityTransition: true,
    });
    if (returnMarket !== null) applyMarketAtSlot(slot, returnMarket);
    set({ returnMarket: null, identityTransition: false });
  },

  basculerLecture: () => {
    const moteur = moteurReplayActif();
    if (moteur === null) return;
    if (moteur.estEnLecture()) {
      moteur.pause();
      set({ playing: false });
    } else {
      moteur.setVitesse(get().vitesse);
      moteur.lecture();
      // À la fin du jour (ou après un seek au maximum), `lecture()` reste volontairement
      // inactive : refléter l'état réel évite d'afficher ⏸ alors qu'aucun timer ne tourne.
      set({ playing: moteur.estEnLecture() });
    }
  },

  setVitesse: (v) => {
    moteurReplayActif()?.setVitesse(v);
    set({ vitesse: v });
  },

  seek: (t) => {
    if (!get().active) return;
    const { symbole, jour, tf, vitesse } = get();
    const debut = debutJour(jour);
    const cible = Math.max(debut, Math.min(debut + JOUR_MS, t));
    moteurReplayActif()?.dispose();
    const moteur = new MoteurReplay({
      symbole,
      jour,
      tf,
      curseurInitial: cible,
      onCurseur: (ct) => set({ curseur: ct, progression: (ct - debut) / JOUR_MS }),
      onFin: () => set({ playing: false }),
    });
    moteur.setVitesse(vitesse);
    definirMoteurActif(moteur);
    set({
      gen: get().gen + 1,
      playing: false,
      curseur: cible,
      progression: (cible - debut) / JOUR_MS,
    });
  },
}));

/**
 * Toute navigation marché explicite sur le slot rejoué signifie « revenir au live ».
 * On ne restaure alors pas l'identité capturée : la nouvelle sélection de l'utilisateur
 * doit gagner. Masquer le slot via un changement de layout arrête aussi proprement le moteur.
 */
function stopReplayIfTargetChanged(): void {
  const state = replayStore.getState();
  if (!state.active || state.identityTransition) return;
  if (state.slot >= visibleSlotCount(chartLayoutStore.getState().layout)) {
    state.stop();
    return;
  }
  if (sameMarketIdentity(marketAtSlot(state.slot), replayIdentity(state))) return;
  replayStore.setState({ returnMarket: null });
  replayStore.getState().stop();
}

marketStore.subscribe(stopReplayIfTargetChanged);
chartLayoutStore.subscribe(stopReplayIfTargetChanged);

mirrorOpenState("replay", replayStore);

// ─────────────────────────── Commande de palette (EXPORT pour l'intégrateur) ───────────────────────────

/**
 * Commande REPLAY pour la « command palette ». L'INTÉGRATEUR l'enregistre via
 * `enregistrerCommandes(commandes)` (cf. App.tsx / commands/registry.ts).
 */
export const commandes: Commande[] = [
  {
    id: "panneau:replay",
    mnemonique: "REPLAY",
    libelle: "Replay de marché",
    categorie: "panneau",
    motsCles: ["replay", "rejeu", "historique", "aggtrades", "backtest visuel", "marché passé"],
    apercu: "Ouvre / ferme le replay de marché (rejeu des trades d'un jour passé)",
    action: () => replayStore.getState().toggle(),
  },
];
