/**
 * wsLoop.ts — boucle WebSocket reconnectante PARTAGÉE du daemon (backoff exponentiel
 * plafonné 1s→30s + watchdog de staleness). Source UNIQUE remplaçant les deux copies
 * privées historiques de marketFeed.ts et liqFeed.ts (même machinerie ; seuls `onOpen`
 * — souscription Bybit/OKX — `staleMs` — liquidations sparses : 10 min — et `heartbeat`
 * — pings applicatifs Bybit/OKX (liqFeed) — diffèrent selon le consommateur).
 * Pattern hérité de apps/web/src/data/wsLoop.ts, ADAPTÉ : pas de healthStore côté
 * daemon (aucune remontée d'état, juste des reconnexions silencieuses).
 *
 * Le heartbeat applicatif (option `heartbeat`) et son armeur `armerHeartbeatWs` sont
 * repris de liqFeed.ts (lot B.4), avec la forme OBJET `{message, intervalleMs}` notée
 * au ledger (task-B.4-report / progress.md) plutôt que le `heartbeat?: string` initial —
 * unification faite ici (E.2), consommée par la bascule de liqFeed.ts (E.3).
 *
 * Testable SANS réseau ni vrais minuteurs : la fabrique de WebSocket (`creerWs`) et
 * l'horloge (`horloge`) sont injectables — bun:test n'a pas de fake timers.
 */

/** Horloge injectable (les identifiants de minuteur restent opaques). */
export interface HorlogeWs {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

/** Heartbeat applicatif par feed : message figé + intervalle (défaut PERIODE_HEARTBEAT_WS_MS). */
export interface OptionsHeartbeatWs {
  message: string;
  intervalleMs?: number;
}

/** Options de la boucle WS reconnectante. */
export interface OptionsBoucleWs {
  url: string;
  /** Envoi de la souscription à l'ouverture (Bybit/OKX) ; omis pour Binance. */
  onOpen?: (ws: WebSocket) => void;
  /**
   * Traite le payload brut d'un message. Renvoie `true` pour un message de DONNÉES
   * (réarme le backoff) ; acks/heartbeats comptent malgré tout comme activité watchdog.
   */
  onMessage: (data: string) => boolean | void;
  /** Seuil de staleness du watchdog (défaut 60 s ; liquidations sparses : 10 min). */
  staleMs?: number;
  /**
   * Heartbeat applicatif par feed (canaux creux : Bybit/OKX ferment sans trafic client).
   * Armé à CHAQUE ouverture, désarmé à la fermeture. Omis pour Binance (déjà bavard).
   */
  heartbeat?: OptionsHeartbeatWs;
  /** Injectable de test : fabrique de WebSocket (défaut : `new WebSocket(url)`). */
  creerWs?: (url: string) => WebSocket;
  /** Injectable de test : horloge (défaut : minuteurs globaux + Date.now). */
  horloge?: HorlogeWs;
}

const DELAI_STALE_DEFAUT_MS = 60_000;
const DELAI_STABLE_RESET_MS = 10_000;
const BACKOFF_MAX_MS = 30_000;
const PERIODE_WATCHDOG_MS = 15_000;

/** Cadence par défaut des heartbeats applicatifs (OKX coupe une WS silencieuse à 30 s ; Bybit v5 demande ~20 s). */
export const PERIODE_HEARTBEAT_WS_MS = 20_000;

/** Horloge réelle (défaut hors tests). */
const HORLOGE_REELLE: HorlogeWs = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
};

/**
 * Arme l'envoi périodique d'un heartbeat applicatif sur une WS : les canaux creux
 * (liquidations Bybit/OKX) sans trafic client se font fermer par le serveur en boucle
 * (cycle fermeture/backoff/re-souscription, données perdues dans les fenêtres de
 * reconnexion). Envoi best-effort (une WS fermée entre deux ticks ne jette pas :
 * `onclose` gère la reconnexion). Horloge injectable pour les tests (défaut réelle).
 * Renvoie la fonction de désarmement. Repris de liqFeed.ts (lot B.4).
 */
export function armerHeartbeatWs(
  ws: { send: (data: string) => void },
  message: string,
  intervalleMs: number = PERIODE_HEARTBEAT_WS_MS,
  horloge: HorlogeWs = HORLOGE_REELLE,
): () => void {
  const minuteur = horloge.setInterval(() => {
    try {
      ws.send(message);
    } catch {
      /* WS fermée entre deux ticks : le onclose relance la reconnexion */
    }
  }, intervalleMs);
  return () => horloge.clearInterval(minuteur);
}

/**
 * Ouvre une WebSocket reconnectante (backoff exponentiel 1s→30s + watchdog de
 * staleness). Renvoie une fonction d'arrêt. Comportements préservés des deux copies :
 * AUCUN reset du backoff dans onopen (anti-flap) — reset au 1er message de DONNÉES ou
 * après DELAI_STABLE_RESET_MS de connexion maintenue ; watchdog qui ferme de force une
 * connexion « zombie » silencieuse (onclose relance alors la reconnexion) ; heartbeat
 * applicatif optionnel, armé à l'ouverture et désarmé à la fermeture (liqFeed).
 */
export function connecterBoucleWs(o: OptionsBoucleWs): () => void {
  const staleMs = o.staleMs ?? DELAI_STALE_DEFAUT_MS;
  const creerWs = o.creerWs ?? ((url: string) => new WebSocket(url));
  const horloge = o.horloge ?? HORLOGE_REELLE;

  let ws: WebSocket | null = null;
  let fermeParUtilisateur = false;
  let essai = 0;
  let dernierMessageTs = 0;
  let minuteurReconnexion: unknown = null;
  let minuteurStable: unknown = null;
  let minuteurWatchdog: unknown = null;
  let desarmerHeartbeat: (() => void) | null = null;

  const nettoyerStable = (): void => {
    if (minuteurStable !== null) {
      horloge.clearTimeout(minuteurStable);
      minuteurStable = null;
    }
  };
  const nettoyerWatchdog = (): void => {
    if (minuteurWatchdog !== null) {
      horloge.clearInterval(minuteurWatchdog);
      minuteurWatchdog = null;
    }
  };
  const nettoyerHeartbeat = (): void => {
    if (desarmerHeartbeat !== null) {
      desarmerHeartbeat();
      desarmerHeartbeat = null;
    }
  };

  const armerWatchdog = (): void => {
    nettoyerWatchdog();
    minuteurWatchdog = horloge.setInterval(() => {
      if (horloge.now() - dernierMessageTs <= staleMs) return;
      // Connexion « zombie » (aucun message depuis staleMs) : on la ferme de force ;
      // `onclose` (fermeParUtilisateur=false) relance la reconnexion.
      try {
        ws?.close();
      } catch {
        /* fermeture best-effort */
      }
    }, Math.min(staleMs, PERIODE_WATCHDOG_MS));
  };

  const connecter = (): void => {
    const socket = creerWs(o.url);
    ws = socket;

    socket.onopen = (): void => {
      dernierMessageTs = horloge.now();
      o.onOpen?.(socket);
      // Backoff : AUCUN reset ici (anti-flap). Reset programmé après une connexion
      // maintenue DELAI_STABLE_RESET_MS (couvre « connecté mais silencieux »).
      nettoyerStable();
      minuteurStable = horloge.setTimeout(() => {
        essai = 0;
      }, DELAI_STABLE_RESET_MS);
      armerWatchdog();
      // Heartbeat applicatif par feed, armé à CHAQUE ouverture, désarmé à la fermeture.
      if (o.heartbeat) {
        nettoyerHeartbeat();
        desarmerHeartbeat = armerHeartbeatWs(socket, o.heartbeat.message, o.heartbeat.intervalleMs, horloge);
      }
    };

    socket.onmessage = (ev: MessageEvent): void => {
      dernierMessageTs = horloge.now(); // tout message = activité watchdog
      const estDonnee = o.onMessage(ev.data as string) === true;
      if (estDonnee) essai = 0; // seul un message de DONNÉES réarme le backoff
    };

    socket.onerror = (): void => {
      try {
        socket.close();
      } catch {
        /* best-effort */
      }
    };

    socket.onclose = (): void => {
      nettoyerHeartbeat();
      nettoyerStable();
      nettoyerWatchdog();
      if (fermeParUtilisateur) return;
      const delai = Math.min(BACKOFF_MAX_MS, 1_000 * 2 ** essai);
      essai += 1;
      minuteurReconnexion = horloge.setTimeout(connecter, delai);
    };
  };

  connecter();

  return () => {
    fermeParUtilisateur = true;
    if (minuteurReconnexion !== null) horloge.clearTimeout(minuteurReconnexion);
    nettoyerHeartbeat();
    nettoyerStable();
    nettoyerWatchdog();
    try {
      ws?.close();
    } catch {
      /* best-effort */
    }
  };
}
