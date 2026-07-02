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
 *  - `start()` capture le slot FOCUS, crée le moteur, le publie comme adaptateur actif,
 *    et incrémente `gen` → `ChartInstance` du slot se REMONTE et se branche sur le moteur
 *    (WS live suspendues via le cycle de démontage existant).
 *  - `seek(t)` recrée le moteur à un nouveau curseur et incrémente `gen` → remontage +
 *    reseed instantané.
 *  - `stop()` efface l'adaptateur actif et passe `active=false` → remontage → live + resync.
 *
 * 100 % dégradé si le daemon est absent (les appels échouent en silence, `daemonAbsent`).
 */
import { createStore } from "zustand/vanilla";
import type { Timeframe } from "@axiom/types";
import type { Commande } from "../commands/registry";
import { chartLayoutStore } from "./chart-layout";
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

function arreterPoll(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
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
    set({ symbole: s.trim().toUpperCase() });
    get().rafraichirStatut();
  },
  setJour: (j) => {
    set({ jour: j });
    get().rafraichirStatut();
  },
  setTf: (tf) => set({ tf }),

  statut: { etat: "absent" },
  jours: [],
  daemonAbsent: false,

  telecharger: () => {
    const { symbole, jour } = get();
    set({ statut: { etat: "en_cours", symbole, jour, recus: 0 } });
    void demanderTelechargement(symbole, jour)
      .then((s) => {
        set({ statut: s, daemonAbsent: false });
        arreterPoll();
        // Poll tant que le job n'est pas terminé.
        pollTimer = setInterval(() => {
          const cur = get();
          if (cur.symbole !== symbole || cur.jour !== jour) {
            arreterPoll();
            return;
          }
          void statutTelechargement(symbole, jour)
            .then((st) => {
              set({ statut: st });
              if (st.etat === "pret" || st.etat === "erreur" || st.etat === "absent") {
                arreterPoll();
                get().rafraichirJours();
              }
            })
            .catch(() => {
              set({ daemonAbsent: true });
              arreterPoll();
            });
        }, POLL_MS);
      })
      .catch(() => set({ daemonAbsent: true }));
  },

  rafraichirStatut: () => {
    const { symbole, jour } = get();
    void statutTelechargement(symbole, jour)
      .then((s) => set({ statut: s, daemonAbsent: false }))
      .catch(() => set({ daemonAbsent: true }));
  },

  rafraichirJours: () => {
    void listerJours()
      .then((j) => set({ jours: j, daemonAbsent: false }))
      .catch(() => set({ daemonAbsent: true }));
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
  playing: false,
  vitesse: 1,
  curseur: 0,
  progression: 0,

  start: () => {
    // Un seul rejeu à la fois : dispose le précédent.
    moteurReplayActif()?.dispose();
    const { symbole, jour, tf } = get();
    const slot = chartLayoutStore.getState().focus;
    const debut = debutJour(jour);
    const moteur = new MoteurReplay({
      symbole,
      jour,
      tf,
      onCurseur: (t) => set({ curseur: t, progression: (t - debut) / JOUR_MS }),
      onFin: () => set({ playing: false }),
    });
    definirMoteurActif(moteur);
    set({
      active: true,
      slot,
      gen: get().gen + 1,
      playing: false,
      vitesse: 1,
      curseur: moteur.position(),
      progression: (moteur.position() - debut) / JOUR_MS,
    });
  },

  stop: () => {
    moteurReplayActif()?.dispose();
    definirMoteurActif(null);
    set({ active: false, playing: false, gen: get().gen + 1 });
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
      set({ playing: true });
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
