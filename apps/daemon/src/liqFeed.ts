/**
 * liqFeed.ts — ingestion CONTINUE des liquidations perp Bybit, PROPRE au daemon.
 *
 * INVARIANT (BUILD-CONTRACT) : ceci NE touche PAS au chemin chaud du renderer.
 * Les WebSockets de marché du FRONT restent DIRECTES vers les exchanges ; ce flux-ci
 * est une connexion INDÉPENDANTE, ouverte par le daemon UNIQUEMENT pour accumuler à
 * FROID l'historique des liquidations (table `liquidations`, cf. liquidations.ts).
 * Aucun rendu, aucun partage avec le front — celui-ci reste 100 % direct.
 *
 * Une seule WS `wss://stream.bybit.com/v5/public/linear` avec souscription
 * `allLiquidation.<SYM>` pour chaque symbole surveillé. La liste des symboles vient du
 * KV (namespace « liq », clé « symboles »), pollée toutes les 60 s ; un changement
 * d'ensemble re-souscrit (reconnexion). Chaque message → `parseBybitLiqDaemon` →
 * `insererLiquidations`. Une purge quotidienne borne la taille du .db (rétention 30 j).
 *
 * La reconnexion réutilise le PATTERN de marketFeed.ts (backoff exponentiel plafonné
 * 1s→30s + watchdog de staleness), recopié ici et ADAPTÉ : pas de healthStore (logs
 * seulement) et un `onOpen` pour envoyer la souscription Bybit à l'ouverture.
 *
 * Parseur : COPIE ANNOTÉE de `parseBybitLiquidation` (apps/web/src/data/liquidations.ts).
 * L'import cross-package apps/web↔apps/daemon est INTERDIT → on recopie le strict
 * nécessaire. Convention figée par test : S="Sell" (taker vend) → LONG liquidé ;
 * S="Buy" (taker rachète) → SHORT liquidé.
 */
import { getDb } from "./db";
import { insererLiquidations, purgerLiquidations, type LiqFil } from "./liquidations";

const WS_URL = "wss://stream.bybit.com/v5/public/linear";
/** Préfixe de topic Bybit (souscription + routage des messages). */
const TOPIC_PREFIXE = "allLiquidation.";

/** Symboles surveillés par défaut si le KV `liq/symboles` est absent/illisible. */
export const SYMBOLES_DEFAUT: readonly string[] = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

/** Période de poll du KV `liq/symboles` (rafraîchit le jeu de symboles). */
const PERIODE_POLL_KV_MS = 60_000;
/** Cadence de la purge (quotidienne). */
const PERIODE_PURGE_MS = 24 * 3_600_000;
/** Rétention des liquidations (30 jours) — borne la taille du .db. */
const RETENTION_MS = 30 * 24 * 3_600_000;

// ─────────────────────────── Fonctions PURES (testées) ───────────────────────────

/** Une entrée `data[]` du message allLiquidation Bybit (champs bruts). */
interface BybitLiqEntry {
  T?: unknown; // timestamp (ms)
  S?: unknown; // "Buy" | "Sell" (côté taker de la liquidation)
  v?: unknown; // volume (base)
  p?: unknown; // prix
}
interface BybitLiqMessage {
  topic?: unknown;
  data?: unknown;
}

/**
 * Parse une entrée de liquidation Bybit en `LiqFil` (venue « bybit »), ou `null` si
 * illisible. Copie ANNOTÉE de `parseBybitLiquidation` du front : mêmes gardes (qty/prix
 * finis, prix > 0, S ∈ {Buy,Sell}) et MÊME convention long/short (figée par test).
 * Fonction PURE.
 */
export function parseBybitLiqDaemon(entry: unknown): LiqFil | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as BybitLiqEntry;
  const qty = Number(e.v);
  const price = Number(e.p);
  const time = Number(e.T);
  if (!Number.isFinite(qty) || !Number.isFinite(price) || price <= 0) return null;
  if (e.S !== "Buy" && e.S !== "Sell") return null;
  return {
    t: Number.isFinite(time) ? time : Date.now(),
    venue: "bybit",
    side: e.S === "Sell" ? "long" : "short",
    price,
    qty,
    usd: qty * price,
  };
}

/**
 * Normalise la valeur KV `liq/symboles` en liste de symboles (majuscules, dédoublonnée).
 * Repli sur `SYMBOLES_DEFAUT` si la valeur n'est pas un tableau ou ne contient aucun
 * symbole valide. Fonction PURE.
 */
export function symbolesSurveilles(kvBrut: unknown): string[] {
  if (!Array.isArray(kvBrut)) return [...SYMBOLES_DEFAUT];
  const out = [
    ...new Set(
      kvBrut
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.trim().toUpperCase()),
    ),
  ];
  return out.length > 0 ? out : [...SYMBOLES_DEFAUT];
}

// ─────────────────────────── Lecture KV (pattern lireDefsKv de alerts.ts) ───────────────────────────

/**
 * Lit la liste des symboles surveillés depuis le KV (namespace « liq », clé
 * « symboles »). Tolérant : table absente (le front n'a jamais écrit) ou JSON corrompu
 * → repli sur le défaut. Même pattern que `lireDefsKv` (alerts.ts).
 */
export function lireSymbolesKv(): string[] {
  try {
    const ligne = getDb()
      .query("SELECT valeur FROM kv WHERE namespace = ? AND cle = ?")
      .get("liq", "symboles") as { valeur: string } | null;
    if (!ligne) return [...SYMBOLES_DEFAUT];
    return symbolesSurveilles(JSON.parse(ligne.valeur));
  } catch {
    return [...SYMBOLES_DEFAUT];
  }
}

// ─────────────────────────── Ingestion d'un message ───────────────────────────

/**
 * Traite un message WS brut : route par topic (`allLiquidation.<SYM>`), parse les
 * entrées valides et les insère (idempotent). Renvoie `true` s'il s'agissait d'un
 * message de DONNÉES (≠ ack de souscription) pour réarmer le backoff.
 */
function ingererMessage(data: string): boolean {
  let msg: BybitLiqMessage;
  try {
    msg = JSON.parse(data) as BybitLiqMessage;
  } catch {
    return false;
  }
  const topic = msg.topic;
  if (typeof topic !== "string" || !topic.startsWith(TOPIC_PREFIXE) || !Array.isArray(msg.data)) {
    return false; // ack de souscription / message hors sujet
  }
  const symbole = topic.slice(TOPIC_PREFIXE.length);
  const lot: LiqFil[] = [];
  for (const entry of msg.data) {
    const liq = parseBybitLiqDaemon(entry);
    if (liq) lot.push(liq);
  }
  if (lot.length > 0) {
    try {
      insererLiquidations(symbole, lot);
    } catch (err) {
      console.error("[axiomd] insertion liquidations échouée :", err);
    }
  }
  return true;
}

// ─────────────────────────── Boucle WS reconnectante (pattern marketFeed.ts) ───────────────────────────

/** Staleness large : les liquidations sont sparses par nature (cf. front liquidations.ts). */
const DELAI_STALE_MS = 10 * 60_000;
const DELAI_STABLE_RESET_MS = 10_000;
const BACKOFF_MAX_MS = 30_000;
const PERIODE_WATCHDOG_MS = 15_000;

/**
 * Ouvre une WebSocket reconnectante (backoff exponentiel 1s→30s + watchdog de
 * staleness). `onOpen` envoie la souscription à l'ouverture ; `onMessage` renvoie `true`
 * pour un message de DONNÉES (réarme le backoff). Renvoie une fonction d'arrêt. Copie
 * ADAPTÉE de marketFeed.ts (sans healthStore, avec `onOpen`).
 */
function connecterBoucleWs(
  url: string,
  onOpen: (ws: WebSocket) => void,
  onMessage: (data: string) => boolean | void,
): () => void {
  let ws: WebSocket | null = null;
  let fermeParUtilisateur = false;
  let essai = 0;
  let dernierMessageTs = 0;
  let minuteurReconnexion: ReturnType<typeof setTimeout> | null = null;
  let minuteurStable: ReturnType<typeof setTimeout> | null = null;
  let minuteurWatchdog: ReturnType<typeof setInterval> | null = null;

  const nettoyerStable = (): void => {
    if (minuteurStable) {
      clearTimeout(minuteurStable);
      minuteurStable = null;
    }
  };
  const nettoyerWatchdog = (): void => {
    if (minuteurWatchdog) {
      clearInterval(minuteurWatchdog);
      minuteurWatchdog = null;
    }
  };

  const armerWatchdog = (): void => {
    nettoyerWatchdog();
    minuteurWatchdog = setInterval(() => {
      if (Date.now() - dernierMessageTs <= DELAI_STALE_MS) return;
      // Connexion « zombie » (aucun message depuis DELAI_STALE_MS) : on la ferme de
      // force ; `onclose` (fermeParUtilisateur=false) relance la reconnexion.
      try {
        ws?.close();
      } catch {
        /* fermeture best-effort */
      }
    }, Math.min(DELAI_STALE_MS, PERIODE_WATCHDOG_MS));
  };

  const connecter = (): void => {
    const socket = new WebSocket(url);
    ws = socket;

    socket.onopen = (): void => {
      dernierMessageTs = Date.now();
      onOpen(socket);
      // Backoff : AUCUN reset ici (anti-flap). Reset programmé après une connexion
      // maintenue DELAI_STABLE_RESET_MS (couvre « connecté mais silencieux »).
      nettoyerStable();
      minuteurStable = setTimeout(() => {
        essai = 0;
      }, DELAI_STABLE_RESET_MS);
      armerWatchdog();
    };

    socket.onmessage = (ev: MessageEvent): void => {
      dernierMessageTs = Date.now(); // tout message = activité watchdog
      const estDonnee = onMessage(ev.data as string) === true;
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
      nettoyerStable();
      nettoyerWatchdog();
      if (fermeParUtilisateur) return;
      const delai = Math.min(BACKOFF_MAX_MS, 1_000 * 2 ** essai);
      essai += 1;
      minuteurReconnexion = setTimeout(connecter, delai);
    };
  };

  connecter();

  return () => {
    fermeParUtilisateur = true;
    if (minuteurReconnexion) clearTimeout(minuteurReconnexion);
    nettoyerStable();
    nettoyerWatchdog();
    try {
      ws?.close();
    } catch {
      /* best-effort */
    }
  };
}

// ─────────────────────────── Feed ───────────────────────────

/** Handle d'un feed de liquidations : mise à jour du jeu de symboles + arrêt. */
export interface FeedLiquidations {
  /** Ajuste le jeu de symboles surveillés (re-souscrit si l'ensemble change). */
  setSymboles: (symboles: readonly string[]) => void;
  /** Ferme la WS et libère les ressources. */
  arreter: () => void;
}

/**
 * Crée un feed de liquidations Bybit pour un jeu de symboles évolutif. Ne connecte RIEN
 * tant qu'aucun symbole n'est fourni (`setSymboles([])` garde le feed inerte). Un
 * changement d'ensemble reconnecte la WS (re-souscription à l'ouverture).
 */
export function creerFeedLiquidations(): FeedLiquidations {
  let symbolesActuels: string[] = [];
  let stopWs: (() => void) | null = null;

  const reconnecter = (): void => {
    stopWs?.();
    stopWs = null;
    if (symbolesActuels.length === 0) return; // aucun symbole → feed inerte
    const args = symbolesActuels.map((s) => `${TOPIC_PREFIXE}${s}`);
    stopWs = connecterBoucleWs(
      WS_URL,
      (ws) => ws.send(JSON.stringify({ op: "subscribe", args })),
      ingererMessage,
    );
  };

  const setSymboles = (symboles: readonly string[]): void => {
    const nouveaux = [...new Set(symboles)].sort();
    if (nouveaux.join(",") === symbolesActuels.join(",")) return; // ensemble inchangé
    symbolesActuels = nouveaux;
    reconnecter();
  };

  return {
    setSymboles,
    arreter: () => {
      stopWs?.();
      stopWs = null;
      symbolesActuels = [];
    },
  };
}

// ─────────────────────────── Boucle de vie ───────────────────────────

/**
 * Démarre la boucle d'ingestion des liquidations : crée le feed Bybit, poll le KV
 * `liq/symboles` toutes les 60 s pour rafraîchir le jeu de symboles, et purge
 * quotidiennement (rétention 30 j). Renvoie une fonction d'arrêt. À appeler UNE fois
 * depuis index.ts. Ingestion à FROID uniquement (jamais sur le chemin chaud du renderer).
 */
export function demarrerBoucleLiquidations(): () => void {
  const feed = creerFeedLiquidations();

  const rafraichir = (): void => {
    try {
      feed.setSymboles(lireSymbolesKv());
    } catch (err) {
      console.error("[axiomd] rafraîchissement des symboles liquidations échoué :", err);
    }
  };
  rafraichir();
  const minuteurKv = setInterval(rafraichir, PERIODE_POLL_KV_MS);

  const purger = (): void => {
    try {
      purgerLiquidations(Date.now() - RETENTION_MS);
    } catch (err) {
      console.error("[axiomd] purge des liquidations échouée :", err);
    }
  };
  purger(); // purge au démarrage puis quotidiennement
  const minuteurPurge = setInterval(purger, PERIODE_PURGE_MS);

  return () => {
    clearInterval(minuteurKv);
    clearInterval(minuteurPurge);
    feed.arreter();
  };
}
