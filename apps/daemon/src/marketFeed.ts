/**
 * marketFeed.ts — flux de marché PROPRE au daemon (Binance), pour évaluer les
 * alertes pendant que l'onglet du front est fermé.
 *
 * INVARIANT (BUILD-CONTRACT) : ceci NE touche PAS au chemin chaud du renderer.
 * Les WebSockets de marché du FRONT restent directs vers les exchanges ; ce flux-ci
 * est une connexion INDÉPENDANTE, ouverte par le daemon UNIQUEMENT pour les symboles
 * ayant une alerte binance active. Aucun rendu, aucun partage avec le front.
 *
 * Pour chaque symbole surveillé, UN flux Binance combiné :
 *   - `<sym>@miniTicker` → dernier prix (conditions `prix-croise`) ;
 *   - `<sym>@kline_1m`   → bougies 1 min CLÔTURÉES (conditions variation/indicateur),
 *     en fenêtre glissante de 500 bougies max (backfill REST au démarrage).
 *
 * Sources NON binance (kraken/coinbase/twelvedata/mexc) : NON couvertes en v1 — le
 * daemon n'évalue les alertes onglet fermé que pour `source === "binance"`. Les
 * autres restent évaluées par le runtime du front lorsqu'il est ouvert (cf. mission).
 *
 * La reconnexion réutilise le PATTERN de apps/web/src/data/wsLoop.ts (backoff
 * exponentiel plafonné + watchdog de staleness), recopié ici et ADAPTÉ : le daemon
 * n'a pas de `healthStore`, donc aucune remontée d'état — juste des logs.
 */
import type { Candle } from "@axiom/types";

const REST_KLINES_URL = "https://api.binance.com/api/v3/klines";
const WS_STREAM_BASE = "wss://stream.binance.com:9443/stream?streams=";

/** Taille de la fenêtre glissante de bougies par symbole. */
export const FENETRE_BOUGIES = 500;

// ─────────────────────────── Mapping des payloads Binance ───────────────────────────
// (copie annotée du strict nécessaire depuis apps/web/src/data/binance.ts ;
//  le daemon ne dépend pas du front → on ne partage pas ce code.)

/** Tuple brut de /api/v3/klines (ordre figé par l'API Binance). */
type BinanceRestKline = [number, string, string, string, string, string, number, string, number, string, string, string];

/** Bougie du flux WS @kline (champs utiles). */
interface BinanceWsKline {
  t: number; // open time (ms)
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
  n: number; // nombre de trades
  x: boolean; // true => bougie clôturée
  q: string; // quote volume
  V: string; // taker buy base volume
}

/** REST → Candle (closed = closeTime déjà passé). */
function restKlineToCandle(k: BinanceRestKline): Candle {
  const volume = Number(k[5]);
  const buyVolume = Number(k[9]);
  return {
    time: k[0],
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume,
    quoteVolume: Number(k[7]),
    buyVolume,
    sellVolume: volume - buyVolume,
    trades: k[8],
    closed: k[6] < Date.now(),
  };
}

/** WS → Candle (closed = k.x). */
function wsKlineToCandle(k: BinanceWsKline): Candle {
  const volume = Number(k.v);
  const buyVolume = Number(k.V);
  return {
    time: k.t,
    open: Number(k.o),
    high: Number(k.h),
    low: Number(k.l),
    close: Number(k.c),
    volume,
    quoteVolume: Number(k.q),
    buyVolume,
    sellVolume: volume - buyVolume,
    trades: k.n,
    closed: k.x,
  };
}

// ─────────────────────────── Fenêtre glissante ───────────────────────────

/**
 * Insère/remplace une bougie dans une fenêtre triée par temps, bornée à
 * `FENETRE_BOUGIES`. Même temps d'ouverture → remplacement ; temps strictement
 * plus grand → ajout en fin ; hors ordre (plus ancien) → ignoré. Fonction PURE (testée).
 */
export function ajouterBougie(fenetre: Candle[], c: Candle): void {
  const dernier = fenetre[fenetre.length - 1];
  if (dernier && dernier.time === c.time) {
    fenetre[fenetre.length - 1] = c;
  } else if (!dernier || c.time > dernier.time) {
    fenetre.push(c);
  } else {
    return; // bougie hors ordre (antérieure) : ignorée
  }
  if (fenetre.length > FENETRE_BOUGIES) fenetre.splice(0, fenetre.length - FENETRE_BOUGIES);
}

/** Construit l'URL du flux combiné (miniTicker + kline_1m) pour un jeu de symboles. */
export function construireUrlFlux(symboles: readonly string[]): string | null {
  if (symboles.length === 0) return null;
  const streams = symboles
    .map((s) => `${s.toLowerCase()}@miniTicker/${s.toLowerCase()}@kline_1m`)
    .join("/");
  return WS_STREAM_BASE + streams;
}

// ─────────────────────────── Boucle WS reconnectante (pattern wsLoop.ts) ───────────────────────────

const DELAI_STALE_MS = 60_000;
const DELAI_STABLE_RESET_MS = 10_000;
const BACKOFF_MAX_MS = 30_000;
const PERIODE_WATCHDOG_MS = 15_000;

/**
 * Ouvre une WebSocket reconnectante (backoff exponentiel 1s→30s + watchdog de
 * staleness). `onMessage` renvoie `true` si c'était un message de DONNÉES (réarme le
 * backoff). Renvoie une fonction d'arrêt. Copie ADAPTÉE de wsLoop.ts (sans healthStore).
 */
function connecterBoucleWs(url: string, onMessage: (data: string) => boolean | void): () => void {
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

/** Callbacks d'un feed : un tick de prix, une bougie 1 min clôturée. */
export interface OptionsFeed {
  /** Nouveau prix (miniTicker) : `prixPrecedent` = dernier prix vu (pour `les-deux`). */
  onPrix: (symbol: string, prix: number, prixPrecedent: number | undefined) => void;
  /** Bougie 1 min clôturée : `candles` = fenêtre glissante (clôturées, ordre croissant). */
  onBougieClose: (symbol: string, candles: Candle[]) => void;
}

/** Handle d'un feed : mise à jour du jeu de symboles + arrêt. */
export interface Feed {
  /** Ajuste le jeu de symboles surveillés (reconnecte la WS si l'ensemble change). */
  setSymboles: (symboles: readonly string[]) => void;
  /** Ferme la WS et libère les ressources. */
  arreter: () => void;
}

/** État interne par symbole. */
interface EtatSymbole {
  candles: Candle[];
  dernierPrix?: number;
}

/** Backfill REST des 500 dernières bougies 1 min (clôturées uniquement). */
async function backfill(symbol: string): Promise<Candle[]> {
  const params = new URLSearchParams({
    symbol: symbol.toUpperCase(),
    interval: "1m",
    limit: String(FENETRE_BOUGIES),
  });
  const res = await fetch(`${REST_KLINES_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`Binance REST ${res.status} ${res.statusText}`);
  const brut = (await res.json()) as BinanceRestKline[];
  return brut.map(restKlineToCandle).filter((c) => c.closed === true);
}

/**
 * Crée un feed Binance pour un jeu de symboles évolutif. Ne connecte RIEN tant
 * qu'aucun symbole n'est fourni (`setSymboles([])` garde le feed inerte).
 */
export function creerFeed(o: OptionsFeed): Feed {
  const etats = new Map<string, EtatSymbole>();
  let symbolesActuels: string[] = [];
  let stopWs: (() => void) | null = null;

  const dispatch = (data: string): boolean => {
    let msg: { stream?: string; data?: unknown };
    try {
      msg = JSON.parse(data) as { stream?: string; data?: unknown };
    } catch {
      return false;
    }
    const d = msg.data as Record<string, unknown> | undefined;
    if (!d || typeof d !== "object") return false;

    if (d.e === "24hrMiniTicker") {
      const symbol = String(d.s ?? "");
      const prix = Number(d.c);
      const etat = etats.get(symbol);
      if (!etat || !Number.isFinite(prix)) return true;
      const precedent = etat.dernierPrix;
      etat.dernierPrix = prix;
      o.onPrix(symbol, prix, precedent);
      return true;
    }

    if (d.e === "kline") {
      const k = d.k as (BinanceWsKline & { s?: string }) | undefined;
      const symbol = String(d.s ?? "");
      const etat = etats.get(symbol);
      if (!etat || !k || k.x !== true) return true; // seules les bougies CLÔTURÉES comptent
      ajouterBougie(etat.candles, wsKlineToCandle(k));
      o.onBougieClose(symbol, [...etat.candles]);
      return true;
    }
    return true; // autre message combiné (ack) = activité
  };

  const reconnecter = (): void => {
    stopWs?.();
    stopWs = null;
    const url = construireUrlFlux(symbolesActuels);
    if (!url) return; // aucun symbole → feed inerte
    stopWs = connecterBoucleWs(url, dispatch);
  };

  const setSymboles = (symboles: readonly string[]): void => {
    const nouveaux = [...new Set(symboles)].sort();
    if (nouveaux.join(",") === symbolesActuels.join(",")) return; // ensemble inchangé
    const avant = new Set(symbolesActuels);
    symbolesActuels = nouveaux;
    // Purge des symboles retirés, création des nouveaux états.
    for (const s of [...etats.keys()]) if (!nouveaux.includes(s)) etats.delete(s);
    for (const s of nouveaux) if (!etats.has(s)) etats.set(s, { candles: [] });
    // Backfill REST des symboles NOUVELLEMENT ajoutés (best-effort).
    for (const s of nouveaux) {
      if (avant.has(s)) continue;
      backfill(s)
        .then((bougies) => {
          const etat = etats.get(s);
          if (etat) etat.candles = bougies; // le symbole peut avoir été retiré entre-temps
        })
        .catch((err) => console.error(`[axiomd] backfill ${s} échoué :`, err));
    }
    reconnecter();
  };

  return {
    setSymboles,
    arreter: () => {
      stopWs?.();
      stopWs = null;
      etats.clear();
      symbolesActuels = [];
    },
  };
}
