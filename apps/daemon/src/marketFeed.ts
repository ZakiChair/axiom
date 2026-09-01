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
 * Funding (lot D3) : poll REST `fapi/v1/premiumIndex` (tous symboles, 1 requête) pour
 * injecter `fundingRate` (fraction) dans le contexte des conditions `funding-extreme`.
 * Hors WS (funding ne change que toutes les ~8 h) — cadence gérée par alerts.ts.
 *
 * Sources NON binance (kraken/coinbase/twelvedata/mexc) : NON couvertes en v1 — le
 * daemon n'évalue les alertes onglet fermé que pour `source === "binance"`. Les
 * autres restent évaluées par le runtime du front lorsqu'il est ouvert (cf. mission).
 *
 * La reconnexion passe par la boucle PARTAGÉE du daemon (wsLoop.ts : backoff
 * exponentiel plafonné + watchdog de staleness), héritée du pattern de
 * apps/web/src/data/wsLoop.ts sans healthStore (aucune remontée d'état).
 */
import type { Candle } from "@axiom/types";
import { connecterBoucleWs } from "./wsLoop";

const REST_KLINES_URL = "https://api.binance.com/api/v3/klines";
/** Snapshot funding USDⓈ-M (tous symboles si `symbol` absent). */
export const PREMIUM_INDEX_URL = "https://fapi.binance.com/fapi/v1/premiumIndex";
/** Historique funding (fenêtre z-score, par symbole). */
export const FUNDING_RATE_HIST_URL = "https://fapi.binance.com/fapi/v1/fundingRate";
const WS_STREAM_BASE = "wss://stream.binance.com:9443/stream?streams=";

/** Fenêtre glissante pour z-score funding (même ordre de grandeur que le runtime front). */
export const FENETRE_Z_FUNDING = 30;

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

// ─────────────────────────── Funding (premiumIndex + z) ───────────────────────────

/**
 * Parse la réponse `fapi/v1/premiumIndex` (objet unique OU tableau tous symboles)
 * en table `symbole → lastFundingRate` (FRACTION, ex. 0.0001 = 0.01 %).
 * Entrées invalides ignorées. Fonction PURE (testée).
 */
export function parserPremiumIndex(raw: unknown): Map<string, number> {
  const map = new Map<string, number>();
  const items: unknown[] = Array.isArray(raw)
    ? raw
    : raw !== null && typeof raw === "object"
      ? [raw]
      : [];
  for (const entry of items) {
    if (entry === null || typeof entry !== "object") continue;
    const e = entry as { symbol?: unknown; lastFundingRate?: unknown };
    if (typeof e.symbol !== "string" || e.symbol.length === 0) continue;
    const rate = Number(e.lastFundingRate);
    if (!Number.isFinite(rate)) continue;
    map.set(e.symbol.toUpperCase(), rate);
  }
  return map;
}

/**
 * Parse l'historique `fapi/v1/fundingRate` en série de rates (ordre chrono croissant).
 * Fonction PURE (testée).
 */
export function parserHistoriqueFunding(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const rate = Number((entry as { fundingRate?: unknown }).fundingRate);
    if (Number.isFinite(rate)) out.push(rate);
  }
  return out;
}

/**
 * Z-score du dernier point d'une série (fenêtre glissante bornée).
 * `undefined` si série trop courte (< 2) ou écart-type nul géré → z = 0.
 * Fonction PURE (testée).
 */
export function zScoreFunding(series: readonly number[], fenetre = FENETRE_Z_FUNDING): number | undefined {
  if (series.length < 2) return undefined;
  const win = series.slice(-fenetre);
  if (win.length < 2) return undefined;
  const mean = win.reduce((a, b) => a + b, 0) / win.length;
  const variance = win.reduce((a, b) => a + (b - mean) ** 2, 0) / win.length;
  const sd = Math.sqrt(variance);
  const last = win[win.length - 1];
  if (last === undefined) return undefined;
  return sd === 0 ? 0 : (last - mean) / sd;
}

/**
 * Snapshot REST de TOUS les funding rates USDⓈ-M (1 requête weight ~10).
 * Renvoie une Map symbole → rate (fraction). Lève en cas d'HTTP non-OK.
 */
export async function chargerFundingRates(): Promise<Map<string, number>> {
  const res = await fetch(PREMIUM_INDEX_URL);
  if (!res.ok) throw new Error(`Binance premiumIndex ${res.status} ${res.statusText}`);
  return parserPremiumIndex(await res.json());
}

/**
 * Historique funding d'un symbole (jusqu'à `limit` points, défaut = fenêtre z).
 * Best-effort côté appelant : renvoie [] si échec HTTP / JSON.
 */
export async function chargerHistoriqueFunding(
  symbol: string,
  limit = FENETRE_Z_FUNDING,
): Promise<number[]> {
  const params = new URLSearchParams({
    symbol: symbol.toUpperCase(),
    limit: String(Math.min(1000, Math.max(1, limit))),
  });
  const res = await fetch(`${FUNDING_RATE_HIST_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`Binance fundingRate ${res.status} ${res.statusText}`);
  return parserHistoriqueFunding(await res.json());
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
    stopWs = connecterBoucleWs({ url, onMessage: dispatch });
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
