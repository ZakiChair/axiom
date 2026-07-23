/**
 * Flux carnet d'ordres (order book) Binance spot — DOM / depth chart.
 *
 * Procédure officielle « How to manage a local order book correctly » (Binance spot) :
 *   1. Ouvrir le flux WS `@depth@100ms` et BUFFERISER les diffs.
 *   2. Récupérer un snapshot REST `/api/v3/depth?limit=1000` (→ `lastUpdateId`).
 *   3. Rejeter tout diff dont `u <= lastUpdateId` (déjà couvert par le snapshot).
 *   4. Le 1er diff exploitable doit vérifier `U <= lastUpdateId+1 <= u`. Si `U` dépasse
 *      `lastUpdateId+1`, le snapshot est trop vieux → re-fetch (on garde le buffer, qui
 *      reste contigu sur une même connexion).
 *   5. Contiguïté du flux : `U` de chaque diff == `u` du précédent + 1 (sinon trou → resync).
 *   6. Quantité ABSOLUE par niveau ; `qty == 0` supprime le niveau.
 *
 * La logique de COUTURE (`coudre`) et d'application live (`appliquerDiffLive`) est
 * PURE et testée (depth.test.ts) — c'est là que se jouent les cas gap/obsolète.
 * L'agrégation par pas de prix (`agregerNiveaux`, `pasArrondi`) et la profondeur
 * cumulée (`profondeurCumulee`) sont également pures et testées.
 *
 * Cycle de vie WS (backoff, watchdog, santé « binance:depth ») délégué à connectWsLoop.
 * Budget : UNE connexion depth. Binance uniquement (mono-source assumé).
 */
import type { Unsubscribe } from "@axiom/types";
import { connectWsLoop } from "./wsLoop";

// ─────────────────────────── Types ───────────────────────────

/** Niveau de prix brut : [prix, quantité]. */
export type Niveau = [number, number];

/** Snapshot REST du carnet (quantités absolues). */
export interface OrderBookSnapshot {
  lastUpdateId: number;
  bids: readonly Niveau[];
  asks: readonly Niveau[];
}

/** Diff WS `@depth` normalisé (U = 1er update id, u = dernier update id de l'event). */
export interface DepthDiff {
  U: number;
  u: number;
  bids: readonly Niveau[];
  asks: readonly Niveau[];
}

/** Carnet local reconstitué : Maps prix→quantité (O(1) à la mise à jour). */
export interface OrderBook {
  lastUpdateId: number;
  bids: Map<number, number>;
  asks: Map<number, number>;
}

/** Résultat de la couture snapshot ↔ diffs bufferisés. */
export type CoutureResult =
  | { statut: "ok"; livre: OrderBook }
  | { statut: "snapshot-obsolete" } // snapshot trop vieux vs buffer → re-fetch (garder buffer)
  | { statut: "trou" } // rupture de contiguïté du buffer → tout recommencer
  | { statut: "attente" }; // aucun diff bufferisé encore

/** Résultat de l'application d'un diff live sur un carnet déjà couturé. */
export type LiveResult = "ok" | "obsolete" | "trou";

// ─────────────────────────── Reconstitution du carnet (pur) ───────────────────────────

/** Construit un carnet à partir d'un snapshot (ignore les quantités nulles). PURE. */
export function construireLivre(snapshot: OrderBookSnapshot): OrderBook {
  const bids = new Map<number, number>();
  const asks = new Map<number, number>();
  for (const [prix, qte] of snapshot.bids) if (qte > 0) bids.set(prix, qte);
  for (const [prix, qte] of snapshot.asks) if (qte > 0) asks.set(prix, qte);
  return { lastUpdateId: snapshot.lastUpdateId, bids, asks };
}

/** Applique les niveaux d'un diff (quantité absolue ; 0 => suppression). Mute le carnet. */
function appliquerNiveaux(livre: OrderBook, diff: DepthDiff): void {
  for (const [prix, qte] of diff.bids) {
    if (qte === 0) livre.bids.delete(prix);
    else livre.bids.set(prix, qte);
  }
  for (const [prix, qte] of diff.asks) {
    if (qte === 0) livre.asks.delete(prix);
    else livre.asks.set(prix, qte);
  }
}

/**
 * Couture initiale : reconstitue le carnet à partir du snapshot + des diffs bufferisés,
 * en appliquant les étapes 3→5 de la procédure officielle. Fonction PURE.
 */
export function coudre(snapshot: OrderBookSnapshot, diffs: readonly DepthDiff[]): CoutureResult {
  if (diffs.length === 0) return { statut: "attente" };

  const livre = construireLivre(snapshot);
  let dernierId = snapshot.lastUpdateId;
  let demarre = false;

  for (const diff of diffs) {
    // Étape 3 : diff entièrement couvert par le snapshot → rejeté.
    if (diff.u <= snapshot.lastUpdateId) continue;
    if (!demarre) {
      // Étape 4 : le 1er diff exploitable doit vérifier U <= lastUpdateId+1. Sinon le
      // snapshot est trop vieux vs le buffer → re-fetch (le buffer, contigu, est gardé).
      if (diff.U > dernierId + 1) return { statut: "snapshot-obsolete" };
      demarre = true;
    } else if (diff.U !== dernierId + 1) {
      // Étape 5 : rupture de contiguïté du flux (event manqué dans le buffer) → resync propre.
      return { statut: "trou" };
    }
    appliquerNiveaux(livre, diff);
    dernierId = diff.u;
  }

  // Cas dégénéré : tous les diffs étaient obsolètes → le carnet reste le snapshot,
  // en attente des prochains events live (dernierId = lastUpdateId). C'est un "ok".
  livre.lastUpdateId = dernierId;
  return { statut: "ok", livre };
}

/**
 * Applique un diff live sur un carnet déjà couturé (mode continu). Fonction PURE
 * (mute le carnet en place). Renvoie "trou" si un ou plusieurs events ont été manqués.
 */
export function appliquerDiffLive(livre: OrderBook, diff: DepthDiff): LiveResult {
  if (diff.u <= livre.lastUpdateId) return "obsolete"; // déjà appliqué
  if (diff.U > livre.lastUpdateId + 1) return "trou"; // event(s) manqué(s) → resync
  appliquerNiveaux(livre, diff);
  livre.lastUpdateId = diff.u;
  return "ok";
}

/**
 * Meilleur bid (clé max des bids), meilleur ask (clé min des asks) et mid d'un carnet.
 * Renvoie `null` si un côté est vide (aucun best des deux → mid indéfini). Fonction PURE.
 * Forme partagée par le DOM (`DomWindow`) et la heatmap de liquidité (`depthHeat`).
 */
export function meilleursNiveaux(livre: OrderBook): { bestBid: number; bestAsk: number; mid: number } | null {
  let bestBid = -Infinity;
  for (const prix of livre.bids.keys()) if (prix > bestBid) bestBid = prix;
  let bestAsk = Infinity;
  for (const prix of livre.asks.keys()) if (prix < bestAsk) bestAsk = prix;
  if (!Number.isFinite(bestBid) || !Number.isFinite(bestAsk)) return null;
  return { bestBid, bestAsk, mid: (bestBid + bestAsk) / 2 };
}

// ─────────────────────────── Agrégation par pas de prix (pur) ───────────────────────────

/**
 * Pas de prix « rond » (1 / 2 / 5 × 10ⁿ) adapté à la magnitude du prix : vise ~0,05 %
 * du prix, soit ~20 niveaux couvrant ~1 % autour du mid. Multiplié ensuite par le
 * facteur choisi dans l'UI. Fonction PURE.
 */
export function pasArrondi(prix: number): number {
  if (!Number.isFinite(prix) || prix <= 0) return 1;
  const brut = prix / 2000;
  const exp = Math.floor(Math.log10(brut));
  const base = Math.pow(10, exp);
  const mantisse = brut / base; // ∈ [1, 10)
  const arrondi = mantisse < 1.5 ? 1 : mantisse < 3.5 ? 2 : mantisse < 7.5 ? 5 : 10;
  return arrondi * base;
}

/** Niveau agrégé (seau de prix). */
export interface NiveauAgrege {
  prix: number;
  qte: number;
}

/**
 * Agrège des niveaux bruts en seaux de largeur `pas`, triés du mid vers l'extérieur
 * (bids décroissants, asks croissants) et bornés à `limite`. Bids arrondis vers le BAS,
 * asks vers le HAUT (les seaux restent de part et d'autre du mid). Fonction PURE.
 */
export function agregerNiveaux(
  niveaux: readonly Niveau[],
  pas: number,
  cote: "bid" | "ask",
  limite: number,
): NiveauAgrege[] {
  if (!(pas > 0)) return [];
  // Clé par INDICE entier de seau (évite le bruit flottant qui scinderait les seaux).
  const seaux = new Map<number, number>();
  for (const [prix, qte] of niveaux) {
    if (qte <= 0) continue;
    const idx = cote === "bid" ? Math.floor(prix / pas) : Math.ceil(prix / pas);
    seaux.set(idx, (seaux.get(idx) ?? 0) + qte);
  }
  const arr = [...seaux.entries()].map(([idx, qte]) => ({ prix: idx * pas, qte }));
  arr.sort((a, b) => (cote === "bid" ? b.prix - a.prix : a.prix - b.prix));
  return arr.slice(0, limite);
}

/** Médiane d'une série (pour la détection des murs de liquidité). Fonction PURE. */
export function mediane(valeurs: readonly number[]): number {
  if (valeurs.length === 0) return 0;
  const tri = [...valeurs].sort((a, b) => a - b);
  const mid = Math.floor(tri.length / 2);
  if (tri.length % 2 === 0) return ((tri[mid - 1] ?? 0) + (tri[mid] ?? 0)) / 2;
  return tri[mid] ?? 0;
}

/** Point de profondeur cumulée. */
export interface PointProfondeur {
  prix: number;
  cumul: number;
}

/**
 * Profondeur cumulée d'un côté : trie du mid vers l'extérieur (bids décroissants,
 * asks croissants) puis cumule les quantités. Fonction PURE.
 */
export function profondeurCumulee(niveaux: readonly Niveau[], cote: "bid" | "ask"): PointProfondeur[] {
  const tri = niveaux
    .filter(([, qte]) => qte > 0)
    .sort((a, b) => (cote === "bid" ? b[0] - a[0] : a[0] - b[0]));
  const points: PointProfondeur[] = [];
  let cumul = 0;
  for (const [prix, qte] of tri) {
    cumul += qte;
    points.push({ prix, cumul });
  }
  return points;
}

// ─────────────────────────── Accès réseau ───────────────────────────

const REST_DEPTH_URL = "https://api.binance.com/api/v3/depth";
const WS_DEPTH_BASE = "wss://stream.binance.com:9443/ws";
/** Limite du snapshot REST (poids API = 10 ; suffisant pour un DOM near-the-mid). */
const SNAPSHOT_LIMIT = 1000;
/** Délai entre deux tentatives de snapshot (obsolète / trou / échec réseau). */
const RETRY_SNAPSHOT_MS = 500;
/** Garde-fou anti-fuite : buffer de diffs plafonné pendant une (re)synchro qui traîne. */
const MAX_BUFFER = 2000;

/** Réponse brute du snapshot REST (niveaux textuels). */
interface RawSnapshot {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}

/** Diff WS brut (`e:"depthUpdate"`). */
interface RawDiff {
  e: string;
  U: number;
  u: number;
  b: [string, string][];
  a: [string, string][];
}

/** Convertit des niveaux textuels ([prix, qté] en string) en tuples numériques. */
function parseNiveaux(raw: readonly [string, string][]): Niveau[] {
  return raw.map(([p, q]) => [Number(p), Number(q)] as Niveau);
}

/** Récupère un snapshot REST du carnet (limit=1000). Lève sur erreur HTTP. */
export async function recupererSnapshotDepth(symbol: string): Promise<OrderBookSnapshot> {
  const url = `${REST_DEPTH_URL}?symbol=${symbol.toUpperCase()}&limit=${SNAPSHOT_LIMIT}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance depth ${res.status} ${res.statusText}`);
  const data = (await res.json()) as RawSnapshot;
  return {
    lastUpdateId: data.lastUpdateId,
    bids: parseNiveaux(data.bids),
    asks: parseNiveaux(data.asks),
  };
}

/**
 * Ouvre UNE connexion carnet live pour un symbole (Binance spot). `onLivre` est appelé
 * à chaque mise à jour appliquée (~10/s) avec le carnet À JOUR (même instance mutée) —
 * l'appelant stocke la référence et repeint en rAF throttlé (aucun re-render React).
 *
 * La procédure officielle est (re)démarrée à CHAQUE (ré)ouverture du WS (onOpen) et à
 * chaque trou détecté en live. Un compteur de génération invalide les snapshots périmés
 * par une reconnexion/resync survenue entre-temps. UNE connexion WS par appel — la
 * mutualisation par symbole est assurée en amont par `creerMultiplexeurDepth`.
 */
function ouvrirConnexionDepth(symbol: string, onLivre: (livre: OrderBook) => void): Unsubscribe {
  const url = `${WS_DEPTH_BASE}/${symbol.toLowerCase()}@depth@100ms`;
  let generation = 0;
  let phase: "sync" | "live" = "sync";
  let livre: OrderBook | null = null;
  let buffer: DepthDiff[] = [];
  let annule = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const clearRetry = (): void => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const planifierRetry = (gen: number): void => {
    clearRetry();
    retryTimer = setTimeout(() => {
      if (!annule && gen === generation) void chargerSnapshot(gen);
    }, RETRY_SNAPSHOT_MS);
  };

  const chargerSnapshot = async (gen: number): Promise<void> => {
    let snap: OrderBookSnapshot;
    try {
      snap = await recupererSnapshotDepth(symbol);
    } catch (err) {
      if (annule || gen !== generation) return;
      console.error("[AXIOM] snapshot depth Binance échoué", err);
      planifierRetry(gen);
      return;
    }
    if (annule || gen !== generation) return; // périmé (reconnexion/resync entre-temps)

    const res = coudre(snap, buffer);
    switch (res.statut) {
      case "ok":
        livre = res.livre;
        buffer = [];
        phase = "live";
        onLivre(livre);
        break;
      case "trou":
        buffer = []; // rupture snapshot↔buffer : on repart proprement
        planifierRetry(gen);
        break;
      case "snapshot-obsolete": // étape 3 : re-fetch, on garde le buffer qui se remplit
      case "attente":
        planifierRetry(gen);
        break;
    }
  };

  const demarrerSync = (): void => {
    generation += 1;
    phase = "sync";
    livre = null;
    buffer = [];
    clearRetry();
    void chargerSnapshot(generation);
  };

  const unsub = connectWsLoop({
    url,
    source: "binance:depth",
    // (Re)démarre la procédure à CHAQUE (ré)ouverture : phase sync + snapshot frais.
    onOpen: () => demarrerSync(),
    onMessage: (data) => {
      let msg: RawDiff;
      try {
        msg = JSON.parse(data) as RawDiff;
      } catch (err) {
        console.error("[AXIOM] message depth Binance illisible", err);
        return false;
      }
      if (msg.e !== "depthUpdate") return false;
      const diff: DepthDiff = { U: msg.U, u: msg.u, bids: parseNiveaux(msg.b), asks: parseNiveaux(msg.a) };

      if (phase === "sync" || livre === null) {
        buffer.push(diff);
        // Garde-fou : une (re)synchro qui traîne ne doit pas gonfler le buffer sans fin.
        if (buffer.length > MAX_BUFFER) demarrerSync();
        return true;
      }

      const r = appliquerDiffLive(livre, diff);
      if (r === "trou") {
        demarrerSync(); // event(s) manqué(s) → resync complet sur la même connexion
        return true;
      }
      if (r === "ok") onLivre(livre);
      return true; // message de données (réarme le backoff)
    },
  });

  return () => {
    annule = true;
    clearRetry();
    unsub();
  };
}

// ─────────────────────────── Mutualisation de la connexion (ref-counting, pur) ───────────────────────────

/** Ouvreur d'une connexion depth réelle (injecté → testable sans WS). */
export type OuvreurDepth = (symbol: string, diffuser: (livre: OrderBook) => void) => Unsubscribe;

/** Façade du multiplexeur : `souscrire` partage la connexion par symbole (signature de `souscrireDepth`). */
export interface MultiplexeurDepth {
  souscrire: (symbol: string, onLivre: (livre: OrderBook) => void) => Unsubscribe;
}

/**
 * Multiplexeur de connexions depth (ref-counting par symbole). POURQUOI : le budget projet
 * est « UNE connexion depth » ; plusieurs consommateurs (DOM, heatmap BOOK…) du MÊME symbole
 * doivent donc partager la même connexion WS. Le 1er abonné d'un symbole déclenche `ouvrir` ;
 * les suivants s'ajoutent au fan-out sans rouvrir ; la connexion se ferme au DERNIER
 * désabonnement. Le `diffuser` passé à `ouvrir` relaie chaque carnet à jour vers tous les
 * abonnés courants (copie du Set : un désabonnement pendant la diffusion est toléré).
 *
 * Fonction USINE PURE (aucun WS) : en injectant un `ouvrir` factice, tout le comptage
 * (ouvrir/fermer, fan-out, idempotence) se teste en Node. En production, `ouvrir` est
 * `ouvrirConnexionDepth` (la vraie connexion). PURE.
 */
export function creerMultiplexeurDepth(ouvrir: OuvreurDepth): MultiplexeurDepth {
  interface Entree {
    abonnes: Set<(livre: OrderBook) => void>;
    /** Dernier carnet diffusé sur cette connexion (caché pour le réplay aux abonnés tardifs). */
    dernier: OrderBook | null;
    fermer: Unsubscribe;
  }
  const parSymbole = new Map<string, Entree>();

  const souscrire = (symbol: string, onLivre: (livre: OrderBook) => void): Unsubscribe => {
    let entree = parSymbole.get(symbol);
    if (entree === undefined) {
      // Créée AVANT le diffuseur pour que celui-ci puisse cacher `dernier` dans l'entrée.
      const nouvelle: Entree = { abonnes: new Set(), dernier: null, fermer: () => {} };
      // Le diffuseur capture l'entrée : il mémorise le dernier carnet PUIS le relaie ; itération
      // sur une COPIE du Set pour tolérer un désabonnement déclenché depuis un callback pendant
      // la diffusion.
      nouvelle.fermer = ouvrir(symbol, (livre) => {
        nouvelle.dernier = livre;
        for (const cb of [...nouvelle.abonnes]) cb(livre);
      });
      entree = nouvelle;
      parSymbole.set(symbol, entree);
    }
    entree.abonnes.add(onLivre);
    // Abonné tardif d'une connexion déjà vivante : lui REJOUER synchronement le dernier carnet
    // (sinon il n'aurait rien avant le prochain diff — ~100 ms BTC, plusieurs s sur illiquide).
    // Réplay CIBLÉ (onLivre seul, pas le fan-out) → n'impacte pas les abonnés déjà présents. Le
    // 1er abonné d'une connexion neuve a `dernier === null` → aucun réplay.
    if (entree.dernier !== null) onLivre(entree.dernier);

    let annule = false;
    return () => {
      if (annule) return; // idempotent : un double appel ne décrémente qu'une fois
      annule = true;
      const e = parSymbole.get(symbol);
      if (e === undefined) return;
      e.abonnes.delete(onLivre);
      if (e.abonnes.size === 0) {
        parSymbole.delete(symbol);
        e.fermer(); // dernier abonné parti → on ferme la connexion
      }
    };
  };

  return { souscrire };
}

/** Multiplexeur module (singleton) adossé à la vraie connexion Binance. */
const multiplexeurDepth = creerMultiplexeurDepth(ouvrirConnexionDepth);

/**
 * Souscrit au carnet d'ordres live d'un symbole (Binance spot). N abonnés au même symbole
 * PARTAGENT une connexion (cf. `creerMultiplexeurDepth`), fermée au dernier désabonnement.
 * Signature INCHANGÉE : `onLivre` reçoit le carnet à jour (même instance mutée), l'appelant
 * repeint en rAF throttlé.
 */
export function souscrireDepth(symbol: string, onLivre: (livre: OrderBook) => void): Unsubscribe {
  return multiplexeurDepth.souscrire(symbol, onLivre);
}
