/**
 * Boucle WebSocket reconnectante partagée par les adaptateurs d'exchange
 * (Binance / Kraken / Coinbase). Centralise le cycle de vie fragile commun aux
 * cinq flux (kline + trades) et corrige trois défauts d'intégrité (cf. roadmap 0.2) :
 *
 *  - Backoff exponentiel plafonné (1s → 30s). Le compteur d'essais n'est PLUS remis
 *    à zéro dans `onopen` (sinon un cycle accept/drop immédiat boucle à 1s) mais au
 *    1er message reçu OU après `stableResetMs` de connexion maintenue.
 *  - Watchdog de staleness : sans AUCUN message pendant `staleMs` (les heartbeats
 *    comptent comme activité), la socket est fermée de force → la reconnexion prend
 *    le relais. Détecte les connexions « zombies » qui ne lèvent jamais `onclose`.
 *  - Détection de reconnexion : `onReconnected` est appelé après chaque
 *    rétablissement (jamais à la 1re connexion) — les flux kline y déclenchent leur
 *    resync REST.
 *
 * Report d'état dans `healthStore` (reconnecting/connected/stale/closed/error). Le
 * parsing/emission des messages (`onMessage`) et l'envoi de la souscription à
 * l'ouverture (`onOpen`) restent propres à chaque adaptateur.
 */
import type { Unsubscribe } from "@axiom/types";
import { healthStore } from "../store/health";

export interface WsLoopOptions {
  /** URL du endpoint WS. */
  url: string;
  /** Identifiant de source pour le registre santé (ex. "binance", "kraken:trades"). */
  source: string;
  /** Envoi de la souscription à l'ouverture (Kraken/Coinbase) ; omis pour Binance. */
  onOpen?: (ws: WebSocket) => void;
  /**
   * Traite le payload brut d'un message (parse + emit côté adaptateur). Renvoie
   * `true` s'il s'agissait d'un message de DONNÉES (≠ ack/heartbeat) : seuls les
   * messages de données réarment le backoff à zéro. Les heartbeats/acks comptent
   * malgré tout comme activité pour le watchdog (via l'horodatage interne).
   */
  onMessage: (data: string) => boolean | void;
  /** Appelé après une RECONNEXION réussie (jamais à la 1re connexion) → resync REST. */
  onReconnected?: () => void;
  /** Seuil de staleness du watchdog (défaut 60s). */
  staleMs?: number;
  /** Durée de connexion maintenue avant remise à zéro du backoff (défaut 10s). */
  stableResetMs?: number;
}

const DEFAULT_STALE_MS = 60_000;
const DEFAULT_STABLE_RESET_MS = 10_000;
const MAX_BACKOFF_MS = 30_000;
/** Période de vérification du watchdog (bornée pour rester réactif). */
const WATCHDOG_PERIOD_MS = 15_000;
/**
 * Fréquence max de mise à jour du healthStore sur message : les flux de trades
 * peuvent émettre des dizaines de messages/s ; on ne pousse au store (métadonnées
 * d'affichage) qu'au plus une fois par seconde. Le horodatage interne du watchdog,
 * lui, est mis à jour à CHAQUE message (précision de la détection de staleness).
 */
const HEALTH_MIN_PUSH_MS = 1_000;

export function connectWsLoop(o: WsLoopOptions): Unsubscribe {
  const staleMs = o.staleMs ?? DEFAULT_STALE_MS;
  const stableResetMs = o.stableResetMs ?? DEFAULT_STABLE_RESET_MS;

  let ws: WebSocket | null = null;
  let closedByUser = false;
  let hasConnected = false; // ≥1 connexion réussie => les suivantes sont des reconnexions
  let attempt = 0;
  let lastMessageTs = 0;
  let lastHealthPushTs = 0; // dernier push au healthStore (throttle d'affichage)
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stableTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdogTimer: ReturnType<typeof setInterval> | null = null;

  const clearStable = (): void => {
    if (stableTimer) {
      clearTimeout(stableTimer);
      stableTimer = null;
    }
  };
  const clearWatchdog = (): void => {
    if (watchdogTimer) {
      clearInterval(watchdogTimer);
      watchdogTimer = null;
    }
  };

  const armWatchdog = (): void => {
    clearWatchdog();
    watchdogTimer = setInterval(() => {
      if (Date.now() - lastMessageTs <= staleMs) return;
      // Connexion « zombie » : plus aucun message depuis staleMs. On la ferme de
      // force ; `onclose` (closedByUser=false) relancera la reconnexion.
      healthStore.getState().setEtat(o.source, "stale");
      try {
        ws?.close();
      } catch {
        /* fermeture best-effort */
      }
    }, Math.min(staleMs, WATCHDOG_PERIOD_MS));
  };

  const connect = (): void => {
    healthStore.getState().setEtat(o.source, "reconnecting");
    const socket = new WebSocket(o.url);
    ws = socket;

    socket.onopen = () => {
      const wasReconnect = hasConnected;
      hasConnected = true;
      lastMessageTs = Date.now();
      healthStore.getState().setEtat(o.source, "connected", { dernierMessageTs: lastMessageTs });
      o.onOpen?.(socket);
      // Backoff : AUCUN reset ici (anti-flap). Reset programmé après stableResetMs
      // de connexion maintenue — couvre le cas « connexion stable mais silencieuse ».
      clearStable();
      stableTimer = setTimeout(() => {
        attempt = 0;
      }, stableResetMs);
      armWatchdog();
      if (wasReconnect) o.onReconnected?.();
    };

    socket.onmessage = (ev) => {
      lastMessageTs = Date.now(); // tout message (heartbeat/ack inclus) = activité watchdog
      const isData = o.onMessage(ev.data as string) === true;
      if (isData) attempt = 0; // seul un message de DONNÉES réarme le backoff (anti-flap)
      // Push au store throttlé (métadonnées d'affichage) : ne pas écrire à chaque
      // trade. Le horodatage watchdog (lastMessageTs) reste, lui, à chaque message.
      if (lastMessageTs - lastHealthPushTs >= HEALTH_MIN_PUSH_MS) {
        lastHealthPushTs = lastMessageTs;
        healthStore.getState().marquerMessage(o.source, lastMessageTs);
      }
    };

    socket.onerror = () => {
      healthStore.getState().marquerErreur(o.source, "erreur WebSocket");
      socket.close();
    };

    socket.onclose = () => {
      clearStable();
      clearWatchdog();
      if (closedByUser) {
        healthStore.getState().setEtat(o.source, "closed");
        return;
      }
      const delay = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** attempt);
      attempt += 1;
      healthStore.getState().setEtat(o.source, "reconnecting");
      reconnectTimer = setTimeout(connect, delay);
    };
  };

  connect();

  return () => {
    closedByUser = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    clearStable();
    clearWatchdog();
    healthStore.getState().setEtat(o.source, "closed");
    ws?.close();
  };
}
