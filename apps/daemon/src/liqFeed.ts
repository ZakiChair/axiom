/**
 * liqFeed.ts — ingestion CONTINUE des liquidations perp MULTI-EXCHANGE, PROPRE au daemon.
 *
 * INVARIANT (BUILD-CONTRACT) : ceci NE touche PAS au chemin chaud du renderer.
 * Les WebSockets de marché du FRONT restent DIRECTES vers les exchanges ; ces flux-ci
 * sont des connexions INDÉPENDANTES, ouvertes par le daemon UNIQUEMENT pour accumuler à
 * FROID l'historique des liquidations (table `liquidations`, cf. liquidations.ts).
 * Aucun rendu, aucun partage avec le front — celui-ci reste 100 % direct.
 *
 * DEUX connexions WS indépendantes (même machinerie `connecterBoucleWs`) :
 *  - BYBIT `wss://stream.bybit.com/v5/public/linear` : souscription `allLiquidation.<SYM>`
 *    PAR symbole surveillé ; un changement d'ensemble re-souscrit (reconnexion).
 *  - OKX `wss://ws.okx.com:8443/ws/v5/public` : souscription GLOBALE
 *    `{channel:"liquidation-orders", instType:"SWAP"}` (toutes les SWAP) → on FILTRE par
 *    instId côté client (map instId→symbole). La souscription ne change pas avec le jeu de
 *    symboles (seul le filtre change) → la WS reste ouverte tant qu'au moins un symbole est
 *    mappable. `sz` OKX est en CONTRATS → qty = sz × ctVal (fetch REST au démarrage +
 *    refresh 24 h, mémoïsé par instId).
 *
 * La liste des symboles = KV (namespace « liq », clé « symboles ») ∪ symboles des alertes
 * `liq-cascade` ACTIVES (KV « alerts »/« defs », cf. fusionnerSymbolesLiq), pollée toutes
 * les 60 s. Chaque message valide → parseur → `insererLiquidations`. Une purge quotidienne
 * borne la taille du .db (rétention 30 j).
 *
 * La reconnexion réutilise le PATTERN de marketFeed.ts (backoff exponentiel plafonné
 * 1s→30s + watchdog de staleness), recopié ici et ADAPTÉ : pas de healthStore (logs
 * seulement) et un `onOpen` pour envoyer la souscription à l'ouverture.
 *
 * Parseurs : COPIES ANNOTÉES de `parseBybitLiquidation` / `parseOkxLiquidation` du front
 * (apps/web/src/data/liquidations.ts). L'import cross-package apps/web↔apps/daemon est
 * INTERDIT → on recopie le strict nécessaire. Conventions figées par test :
 *   - Bybit : S="Sell" (taker vend) → LONG liquidé ; S="Buy" (taker rachète) → SHORT liquidé.
 *   - OKX   : posSide (long/short) PRIORITAIRE ; repli side (sell→long, buy→short liquidé).
 */
import type { AlertDef } from "@axiom/alerts";
import { lireDefsKv, symbolesLiqCascadeActifs } from "./alerts";
import { getDb } from "./db";
import { insererLiquidations, purgerLiquidations, type LiqFil } from "./liquidations";

const WS_URL = "wss://stream.bybit.com/v5/public/linear";
/** Préfixe de topic Bybit (souscription + routage des messages). */
const TOPIC_PREFIXE = "allLiquidation.";

/** Endpoint public OKX du canal de liquidations (SWAP, non authentifié). */
const OKX_WS_URL = "wss://ws.okx.com:8443/ws/v5/public";
/** REST OKX des instruments (source du `ctVal`, CORS `*`). */
const OKX_INSTRUMENTS_URL = "https://www.okx.com/api/v5/public/instruments";
/** Canal public OKX des liquidations. */
const OKX_CANAL_LIQ = "liquidation-orders";
/** Rafraîchissement périodique des ctVal OKX (rarement modifiés → 24 h). */
const PERIODE_REFRESH_CTVAL_MS = 24 * 3_600_000;

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

// ─────────────────────────── OKX — fonctions PURES (copies annotées, testées) ───────────────────────────

/**
 * Devises de cotation reconnues pour mapper un symbole concaténé vers un instId OKX.
 * COPIE ANNOTÉE compacte de `QUOTE_ASSETS` (apps/web/src/data/symbol.ts) — import
 * cross-package interdit. Restreinte aux cotations qui portent des perp SWAP OKX
 * (USDT/USDC/USD + BTC/ETH margin). Triée par longueur DÉCROISSANTE pour matcher le
 * suffixe le plus LONG d'abord (ex. "USDT" avant "USD").
 */
const COTATIONS_OKX: readonly string[] = ["USDT", "USDC", "USD", "BTC", "ETH"].sort(
  (a, b) => b.length - a.length,
);

/**
 * instId perp OKX d'un symbole concaténé (ex. "BTCUSDT" → "BTC-USDT-SWAP"), ou `null` si
 * la cotation est inconnue (symbole non mappable vers OKX). Fonction PURE.
 */
export function okxInstIdDaemon(symbole: string): string | null {
  const s = symbole.trim().toUpperCase();
  const quote = COTATIONS_OKX.find((q) => s.endsWith(q) && s.length > q.length);
  if (quote === undefined) return null;
  return `${s.slice(0, s.length - quote.length)}-${quote}-SWAP`;
}

/** Un détail `data[].details[]` du message liquidation-orders OKX (champs bruts). */
interface OkxLiqDetail {
  posSide?: unknown; // "long" | "short" | "net" (PRIORITAIRE sur side)
  side?: unknown; // "buy" | "sell" (repli si posSide net/absent)
  bkPx?: unknown; // prix de faillite/liquidation
  sz?: unknown; // taille EN CONTRATS
  ts?: unknown; // timestamp (ms)
}

/**
 * Côté de la POSITION liquidée depuis posSide/side OKX. posSide PRIORITAIRE (long/short) ;
 * sinon repli sur side (sell→long liquidé, buy→short, même convention que Bybit). `null`
 * si indéterminé. PURE (locale).
 */
function okxCoteLiquidee(posSide: unknown, side: unknown): "long" | "short" | null {
  if (posSide === "long") return "long";
  if (posSide === "short") return "short";
  if (side === "sell") return "long";
  if (side === "buy") return "short";
  return null;
}

/**
 * Parse un `details[]` de liquidation OKX en `LiqFil` (venue « okx »), ou `null` si
 * illisible. COPIE ANNOTÉE de `parseOkxLiquidation` du front. `sz` est en CONTRATS →
 * qty (base) = sz × ctVal ; usd = qty × bkPx. Gardes : sz/bkPx finis, bkPx > 0, ctVal > 0,
 * côté déterminé. Fonction PURE.
 */
export function parseOkxLiqDaemon(detail: unknown, ctVal: number): LiqFil | null {
  if (!detail || typeof detail !== "object") return null;
  if (!Number.isFinite(ctVal) || ctVal <= 0) return null;
  const d = detail as OkxLiqDetail;
  const sz = Number(d.sz);
  const price = Number(d.bkPx);
  const time = Number(d.ts);
  if (!Number.isFinite(sz) || !Number.isFinite(price) || price <= 0) return null;
  const side = okxCoteLiquidee(d.posSide, d.side);
  if (side === null) return null;
  const qty = sz * ctVal;
  return { t: Number.isFinite(time) ? time : Date.now(), venue: "okx", side, price, qty, usd: qty * price };
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

/**
 * Fusionne l'ensemble surveillé : symboles du KV `liq/symboles` (repli défaut inclus,
 * via `symbolesSurveilles`) ∪ symboles des alertes `liq-cascade` ACTIVES. Ainsi, créer
 * une alerte cascade sur un symbole hors liste déclenche son ingestion au prochain
 * poll du KV (≤60 s) — le tick daemon (alerts.ts) a alors des données à sommer.
 * Fonction PURE (testée).
 */
export function fusionnerSymbolesLiq(kvBrut: unknown, defs: readonly AlertDef[]): string[] {
  return [...new Set([...symbolesSurveilles(kvBrut), ...symbolesLiqCascadeActifs(defs)])].sort();
}

// ─────────────────────────── Lecture KV (pattern lireDefsKv de alerts.ts) ───────────────────────────

/**
 * Lit la valeur BRUTE du KV `liq/symboles` (JSON parsé, non normalisé). Tolérant :
 * table absente (le front n'a jamais écrit) ou JSON corrompu → `undefined` (le repli
 * défaut est appliqué par `symbolesSurveilles`). Même pattern que `lireDefsKv`.
 */
function lireKvLiqBrut(): unknown {
  try {
    const ligne = getDb()
      .query("SELECT valeur FROM kv WHERE namespace = ? AND cle = ?")
      .get("liq", "symboles") as { valeur: string } | null;
    if (!ligne) return undefined;
    return JSON.parse(ligne.valeur) as unknown;
  } catch {
    return undefined;
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

// ─────────────────────────── Feed OKX (2e connexion indépendante) ───────────────────────────

interface OkxLiqEntry {
  instId?: unknown;
  details?: unknown;
}
interface OkxLiqMessage {
  arg?: { channel?: unknown };
  data?: unknown;
}
interface OkxInstrument {
  instId?: unknown;
  ctVal?: unknown;
}
interface OkxInstrumentsResponse {
  code?: unknown;
  data?: unknown;
}

/**
 * Crée un feed de liquidations OKX pour un jeu de symboles évolutif. UNE WS globale
 * (`liquidation-orders`, instType SWAP) filtrée par instId côté client. Le jeu de symboles
 * ne pilote QUE le filtre (map instId→symbole) et les ctVal à charger — la souscription
 * reste globale, donc la WS n'est PAS reconnectée à chaque changement d'ensemble. Inerte
 * tant qu'aucun symbole mappable n'est fourni.
 */
export function creerFeedLiquidationsOkx(): FeedLiquidations {
  // Map instId → symbole surveillé (routage des messages vers la bonne clé de stockage).
  let mapInst = new Map<string, string>();
  const ctValParInst = new Map<string, number>();
  let stopWs: (() => void) | null = null;
  let cleEnsemble = ""; // clé du jeu de symboles courant (anti re-fetch inutile au poll)

  /** Fetch le ctVal d'un instId (best-effort ; log sur échec, on retentera au refresh). */
  const chargerCtVal = async (instId: string): Promise<void> => {
    const instFamily = instId.replace(/-SWAP$/, "");
    try {
      const params = new URLSearchParams({ instType: "SWAP", instFamily });
      const res = await fetch(`${OKX_INSTRUMENTS_URL}?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const json = (await res.json()) as OkxInstrumentsResponse;
      const liste = Array.isArray(json.data) ? (json.data as OkxInstrument[]) : [];
      const inst = liste.find((i) => i.instId === instId);
      const ctVal = Number(inst?.ctVal);
      if (!Number.isFinite(ctVal) || ctVal <= 0) throw new Error("ctVal illisible");
      ctValParInst.set(instId, ctVal);
    } catch (err) {
      console.error("[axiomd] ctVal OKX indisponible pour", instId, err);
    }
  };

  /** Charge les ctVal des instId surveillés (manquants seulement, ou TOUS si `forcer`). */
  const chargerTousCtVal = (forcer: boolean): void => {
    for (const instId of mapInst.keys()) {
      if (!forcer && ctValParInst.has(instId)) continue;
      void chargerCtVal(instId);
    }
  };

  // Refresh périodique des ctVal (24 h) — no-op tant que mapInst est vide.
  const minuteurCtVal = setInterval(() => chargerTousCtVal(true), PERIODE_REFRESH_CTVAL_MS);

  /** Traite un message OKX : filtre par instId surveillé, parse et insère sous le symbole. */
  const ingererMessageOkx = (data: string): boolean => {
    let msg: OkxLiqMessage;
    try {
      msg = JSON.parse(data) as OkxLiqMessage;
    } catch {
      return false;
    }
    if (msg.arg?.channel !== OKX_CANAL_LIQ || !Array.isArray(msg.data)) return false; // ack / hors sujet
    for (const entree of msg.data as OkxLiqEntry[]) {
      if (!entree || typeof entree.instId !== "string") continue;
      const symbole = mapInst.get(entree.instId);
      if (symbole === undefined) continue; // instrument non surveillé
      const ctVal = ctValParInst.get(entree.instId);
      if (ctVal === undefined || !Array.isArray(entree.details)) continue; // ctVal pas encore chargé → on saute (à froid, ça reviendra)
      const lot: LiqFil[] = [];
      for (const detail of entree.details) {
        const liq = parseOkxLiqDaemon(detail, ctVal);
        if (liq) lot.push(liq);
      }
      if (lot.length > 0) {
        try {
          insererLiquidations(symbole, lot);
        } catch (err) {
          console.error("[axiomd] insertion liquidations OKX échouée :", err);
        }
      }
    }
    return true; // message de données du canal (≠ ack de souscription)
  };

  const setSymboles = (symboles: readonly string[]): void => {
    const cle = [...new Set(symboles)].sort().join(",");
    if (cle === cleEnsemble) return; // ensemble inchangé → ni re-map ni re-fetch ctVal (anti-spam au poll)
    cleEnsemble = cle;
    const nouveau = new Map<string, string>();
    for (const sym of new Set(symboles)) {
      const instId = okxInstIdDaemon(sym);
      if (instId !== null) nouveau.set(instId, sym); // symboles non mappables → ignorés (Bybit seul)
    }
    mapInst = nouveau;
    if (mapInst.size === 0) {
      stopWs?.();
      stopWs = null;
      return;
    }
    chargerTousCtVal(false); // charge les ctVal manquants pour les nouveaux instId
    if (stopWs === null) {
      const sub = JSON.stringify({ op: "subscribe", args: [{ channel: OKX_CANAL_LIQ, instType: "SWAP" }] });
      stopWs = connecterBoucleWs(OKX_WS_URL, (ws) => ws.send(sub), ingererMessageOkx);
    }
  };

  return {
    setSymboles,
    arreter: () => {
      clearInterval(minuteurCtVal);
      stopWs?.();
      stopWs = null;
      mapInst = new Map();
      cleEnsemble = "";
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
  const feed = creerFeedLiquidations(); // Bybit
  const feedOkx = creerFeedLiquidationsOkx(); // OKX (2e connexion indépendante)

  const rafraichir = (): void => {
    try {
      // KV `liq/symboles` ∪ symboles des alertes liq-cascade actives (KV `alerts/defs`).
      const symboles = fusionnerSymbolesLiq(lireKvLiqBrut(), lireDefsKv(getDb()));
      feed.setSymboles(symboles);
      feedOkx.setSymboles(symboles);
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
    feedOkx.arreter();
  };
}
