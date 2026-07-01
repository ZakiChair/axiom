/**
 * Store santé des sources de données — Zustand VANILLA (hors render-loop React).
 *
 * Registre par SOURCE (ex. "binance", "kraken:trades", "twelvedata:quotes") de
 * l'état du flux : connecté / stale / en reconnexion / fermé / polling / erreur,
 * horodatage du dernier message reçu, dernière erreur, et quota éventuel.
 *
 * Écrit HORS React par les adaptateurs WS (via `wsLoop`) et par `pollLoop` ; lu en
 * BASSE fréquence par le futur panneau « santé des sources » et par l'agent ticker.
 * Les écritures sont fréquentes (un message WS ~1/s) mais ne portent que des
 * métadonnées d'état : aucun composant ne doit s'abonner à `dernierMessageTs` dans
 * le rendu (sinon re-render sur tick — cf. BUILD-CONTRACT).
 *
 * Convention de clé `source` : `"<exchange>"` pour le flux principal (kline) et
 * `"<exchange>:<canal>"` pour les flux secondaires (ex. `"binance:trades"`), afin
 * que chaque flux ait sa propre ligne sans écraser les autres.
 */
import { createStore } from "zustand/vanilla";

/** États possibles d'une source de données. */
export type EtatSource =
  | "connected" // WS ouvert, messages reçus normalement
  | "stale" // WS ouvert mais aucun message depuis > seuil (watchdog déclenché)
  | "reconnecting" // établissement ou rétablissement de la connexion en cours
  | "closed" // désabonnement volontaire (démontage / changement de symbole)
  | "polling" // source REST pollée (pas de WS) : dernier cycle réussi
  | "error"; // dernier cycle / évènement en erreur

/** Quota d'API restant pour une source à débit limité. */
export interface QuotaSource {
  utilise: number;
  limite: number;
  /** Fenêtre du quota, ex. "1min", "1jour", "1mois". */
  fenetre: string;
  /**
   * Composante JOURNALIÈRE optionnelle, en plus de la fenêtre principale (ex. Twelve
   * Data : 8 req/min ET ~800 crédits/jour). Affichée en second segment (« … · 142/800 j »).
   */
  jour?: { utilise: number; limite: number };
}

/** Santé d'une source à un instant donné. */
export interface SanteSource {
  source: string;
  etat: EtatSource;
  /** ms epoch du dernier message/cycle reçu ; 0 si aucun encore. */
  dernierMessageTs: number;
  derniereErreur?: string;
  quota?: QuotaSource;
}

export interface HealthState {
  /** Registre indexé par identifiant de source. */
  sources: Record<string, SanteSource>;
  /** Pose/écrase l'état d'une source (crée l'entrée au besoin) ; `patch` complète les champs. */
  setEtat: (source: string, etat: EtatSource, patch?: Partial<SanteSource>) => void;
  /** Marque un message reçu : `dernierMessageTs` = maintenant ; repasse stale→connected. */
  marquerMessage: (source: string, ts?: number) => void;
  /** Enregistre une erreur (etat="error" + `derniereErreur`) sans effacer le quota. */
  marquerErreur: (source: string, message: string) => void;
  /** Met à jour le quota d'une source (posé par l'agent ticker / les pollers à quota). */
  setQuota: (source: string, quota: QuotaSource) => void;
  /** Retire une source du registre (nettoyage). */
  retirer: (source: string) => void;
}

/** Entrée par défaut d'une source encore inconnue du registre. */
function baseSource(source: string): SanteSource {
  return { source, etat: "reconnecting", dernierMessageTs: 0 };
}

export const healthStore = createStore<HealthState>((set) => ({
  sources: {},

  setEtat: (source, etat, patch) =>
    set((s) => {
      const prev = s.sources[source] ?? baseSource(source);
      return { sources: { ...s.sources, [source]: { ...prev, ...patch, source, etat } } };
    }),

  marquerMessage: (source, ts) =>
    set((s) => {
      const prev = s.sources[source] ?? baseSource(source);
      // Un message reçu lève l'état "stale" (le flux reparle) ; sinon l'état est conservé.
      const etat: EtatSource = prev.etat === "stale" ? "connected" : prev.etat;
      return {
        sources: { ...s.sources, [source]: { ...prev, source, etat, dernierMessageTs: ts ?? Date.now() } },
      };
    }),

  marquerErreur: (source, message) =>
    set((s) => {
      const prev = s.sources[source] ?? baseSource(source);
      return {
        sources: { ...s.sources, [source]: { ...prev, source, etat: "error", derniereErreur: message } },
      };
    }),

  setQuota: (source, quota) =>
    set((s) => {
      // Une source dont le PREMIER signal est un quota est une source REST à débit
      // limité (Coinalyze, Twelve Data), pas un flux WS en attente de connexion : on
      // l'amorce en "polling" (et non "reconnecting") pour un affichage honnête tant
      // qu'aucun poller n'a posé d'état plus précis.
      const prev = s.sources[source] ?? { source, etat: "polling" as EtatSource, dernierMessageTs: 0 };
      return { sources: { ...s.sources, [source]: { ...prev, source, quota } } };
    }),

  retirer: (source) =>
    set((s) => {
      if (!(source in s.sources)) return s;
      const next = { ...s.sources };
      delete next[source];
      return { sources: next };
    }),
}));
