/**
 * Heatmap de liquidité du carnet (BOOK) — logique PURE d'accumulation et de grille.
 *
 * POURQUOI ce module (et pas un simple overlay live) : le carnet d'ordres (`OrderBook`)
 * ne donne que l'INSTANT présent — les murs de liquidité qui apparaissent puis se
 * retirent avant exécution (style Bookmap) ne se voient qu'en conservant une TRACE dans
 * le temps. On échantillonne donc le carnet en COLONNES (≈1/seconde), on les accumule
 * dans un FIFO borné, et on projette la fenêtre visible en grille temps × prix au rendu.
 *
 * MODÈLE : le buffer FIFO + rev bump suit `liqEventsStore`/`bornerEvenements`
 * (chart/liquidationMarkers.ts) — colonnes brutes conservées, grille reconstruite à la
 * demande. L'intensité log (mêmes propriétés que `intensiteLog` de liquidationHeat.ts)
 * relève les petits ordres face aux murs massifs.
 *
 * Toutes les fonctions d'accumulation/grille ci-dessus sont PURES (aucun accès DOM/
 * store/chart) et testées (depthHeat.test.ts). Le store de bascule + contrôleur de
 * souscription (ci-dessous, co-localisés — modèle `liquidationMarkers.ts`) exposent
 * `depthHeatStore`/`lireColonnes`/`demarrerDepthHeat` ; le buffer de colonnes vit en
 * variable MODULE (jamais dans le store Zustand, cf. invariant `store/orderflow.ts:6-8`).
 * Le contrôleur canvas (Task 4) consomme ces exports mais n'est pas dans ce module.
 */
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import type { Unsubscribe } from "@axiom/types";
import { agregerNiveaux, pasArrondi, souscrireDepth, type NiveauAgrege, type OrderBook } from "../data/depth";
import { marketStore } from "../store/market";

/** Nombre de niveaux agrégés conservés PAR CÔTÉ (bid/ask) dans chaque colonne. Convention
 *  reprise de `pasArrondi` (vise ~20 niveaux couvrant ~1 % autour du mid) et de
 *  `DomWindow.tsx` (LADDER_ROWS=20, seul appelant existant d'agregerNiveaux). Réserve :
 *  ajustable si la plage visible typique de la heatmap dépasse cette bande de ~1 %. */
export const LIMITE_NIVEAUX = 20;

/** Une colonne = un instant échantillonné du carnet (niveaux déjà agrégés par pas de prix). */
export interface ColonneDepth {
  t: number;
  pas: number;
  bids: NiveauAgrege[];
  asks: NiveauAgrege[];
}

/** Taille du FIFO de colonnes ≈ 30 min à raison de 1 colonne/seconde. */
export const MAX_COLONNES = 1800;
/** Cadence d'échantillonnage visée (informatif — le contrôleur décide quand appeler). */
export const INTERVALLE_COLONNE_MS = 1000;

/** Meilleur bid / meilleur ask d'un carnet (clé max des bids, clé min des asks). PURE. */
function meilleurs(livre: OrderBook): { bestBid: number; bestAsk: number } | null {
  let bestBid = -Infinity;
  for (const prix of livre.bids.keys()) if (prix > bestBid) bestBid = prix;
  let bestAsk = Infinity;
  for (const prix of livre.asks.keys()) if (prix < bestAsk) bestAsk = prix;
  if (bestBid === -Infinity || bestAsk === Infinity) return null;
  return { bestBid, bestAsk };
}

/**
 * Échantillonne une colonne du carnet à `nowMs` : pas dérivé du mid (`pasArrondi`), bids/asks
 * agrégés par ce pas (`agregerNiveaux`, bornés à `LIMITE_NIVEAUX` par côté). Carnet sans
 * best bid/ask (vide) → mid 0 → `pasArrondi(0)` replie sur 1, colonnes bid/ask vides
 * (agregerNiveaux sur des Maps vides renvoie `[]`). PURE.
 */
export function echantillonnerColonne(livre: OrderBook, nowMs: number): ColonneDepth {
  const best = meilleurs(livre);
  const mid = best === null ? 0 : (best.bestBid + best.bestAsk) / 2;
  const pas = pasArrondi(mid);
  const bids = agregerNiveaux([...livre.bids.entries()], pas, "bid", LIMITE_NIVEAUX);
  const asks = agregerNiveaux([...livre.asks.entries()], pas, "ask", LIMITE_NIVEAUX);
  return { t: nowMs, pas, bids, asks };
}

/** Ajoute une colonne au buffer FIFO, borné à `max` (défaut `MAX_COLONNES`) : au-delà, les
 *  plus anciennes sont écartées (modèle `bornerEvenements`). PURE. */
export function ajouterColonne(colonnes: ColonneDepth[], c: ColonneDepth, max: number = MAX_COLONNES): ColonneDepth[] {
  const next = [...colonnes, c];
  return next.length <= max ? next : next.slice(next.length - max);
}

/** Résultat de la projection en grille : cellules aplaties (colonne-major), nombre de
 *  colonnes couvertes et quantité max (pilote la normalisation de l'intensité). */
export interface GrilleDepth {
  cellules: Float32Array;
  nCols: number;
  qtyMax: number;
}

/**
 * Construit la grille temps × prix sur la plage visible [deMs, aMs) × [prixMin, prixMax],
 * découpée en `nLignes` lignes de prix égales. Colonnes hors plage temporelle exclues ;
 * pour chaque colonne retenue, chaque niveau bid/ask dont le prix tombe dans une ligne
 * cumule sa quantité dans la cellule `[colonne][ligne]` (indexée colonne-major :
 * `col * nLignes + ligne`). `qtyMax` = plus grande valeur de cellule (0 si la grille est
 * vide). PURE.
 */
export function grilleDepuisColonnes(
  colonnes: ColonneDepth[],
  deMs: number,
  aMs: number,
  prixMin: number,
  prixMax: number,
  nLignes: number,
): GrilleDepth {
  const visibles = colonnes.filter((c) => c.t >= deMs && c.t < aMs);
  const nCols = visibles.length;
  const cellules = new Float32Array(Math.max(0, nCols * nLignes));
  let qtyMax = 0;
  if (nCols === 0 || nLignes <= 0 || !(prixMax > prixMin)) return { cellules, nCols, qtyMax };

  const hauteur = (prixMax - prixMin) / nLignes;
  const ajouter = (niveaux: NiveauAgrege[], col: number): void => {
    for (const n of niveaux) {
      if (n.prix < prixMin || n.prix >= prixMax) continue;
      const ligne = Math.min(nLignes - 1, Math.floor((n.prix - prixMin) / hauteur));
      const idx = col * nLignes + ligne;
      const v = (cellules[idx] ?? 0) + n.qte;
      cellules[idx] = v;
      if (v > qtyMax) qtyMax = v;
    }
  };

  visibles.forEach((c, col) => {
    ajouter(c.bids, col);
    ajouter(c.asks, col);
  });

  return { cellules, nCols, qtyMax };
}

/**
 * Intensité log-normalisée ∈ [0,1] : `log1p(qty) / log1p(qtyMax)`, clampée. Même contrat
 * que `intensiteLog` de liquidationHeat.ts — la log relève les petits ordres face aux
 * murs massifs. Renvoie 0 si `qtyMax <= 0`. PURE.
 */
export function intensiteLogDepth(qty: number, qtyMax: number): number {
  if (!(qtyMax > 0)) return 0;
  const t = Math.log1p(Math.max(0, qty)) / Math.log1p(qtyMax);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

// ─────────────────────────── Bascule (store vanilla local) ───────────────────────────

/** État du store de bascule : PAS de données tick ici (invariant `store/orderflow.ts:6-8`)
 *  — seuls `actif` et `rev` (compteur de révision, bumpé au plus 1×/s par l'échantillonnage,
 *  ou immédiatement lors d'un (ré)abonnement/reset). Le buffer de colonnes vit à part,
 *  en variable module (cf. `lireColonnes`). */
export interface DepthHeatState {
  actif: boolean;
  rev: number;
  basculer: () => void;
}

export const depthHeatStore: StoreApi<DepthHeatState> = createStore<DepthHeatState>((set, get) => ({
  actif: false,
  rev: 0,
  basculer: () => set({ actif: !get().actif }),
}));

// ─────────────────────────── Contrôleur de souscription (données uniquement) ───────────────────────────

/** Buffer FIFO des colonnes échantillonnées du symbole abonné (hors store, cf. tête de fichier). */
let colonnes: ColonneDepth[] = [];
/** Dernier carnet reçu du symbole abonné (référence mutée par `souscrireDepth`, cf. data/depth.ts). */
let dernierLivre: OrderBook | null = null;
let abonnement: Unsubscribe | null = null;
let symboleAbonne: string | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;

/** Lit le buffer de colonnes courant (accès au buffer module, hors store). */
export function lireColonnes(): ColonneDepth[] {
  return colonnes;
}

/**
 * Décide l'action de (ré)abonnement à effectuer selon l'état actif/symbole courant vs
 * le symbole actuellement abonné : `desabonner` (actif=false, était abonné) implique un
 * reset du buffer ; `souscrire` (1re activation OU changement de symbole en cours
 * d'activation) implique aussi un reset du buffer (désabonnement de l'ancien symbole
 * d'abord, si présent). PURE — ne fait aucun effet, c'est `sync()` qui les exécute.
 */
export function decisionAbonnement(
  actif: boolean,
  symbol: string,
  symboleAbonne: string | null,
): { action: "rien" } | { action: "desabonner" } | { action: "souscrire"; symbol: string } {
  if (!actif) return symboleAbonne === null ? { action: "rien" } : { action: "desabonner" };
  if (symboleAbonne !== symbol) return { action: "souscrire", symbol };
  return { action: "rien" };
}

/** Bump la révision (buffer inchangé) — les consommateurs comparent `rev`. */
function publier(): void {
  depthHeatStore.setState((s) => ({ rev: s.rev + 1 }));
}

/** Échantillonne le carnet courant (si déjà reçu) et l'ajoute au FIFO borné ; bump `rev`. */
function echantillonner(): void {
  if (dernierLivre === null) return; // aucun carnet reçu encore sur cette souscription
  colonnes = ajouterColonne(colonnes, echantillonnerColonne(dernierLivre, Date.now()));
  publier();
}

function demarrerEchantillonnage(): void {
  if (intervalId !== null) return; // déjà en cours (changement de symbole sans coupure du timer)
  intervalId = setInterval(echantillonner, INTERVALLE_COLONNE_MS);
}

function arreterEchantillonnage(): void {
  if (intervalId === null) return;
  clearInterval(intervalId);
  intervalId = null;
}

/** Aligne l'abonnement WS sur l'état (bascule + symbole), cf. `decisionAbonnement`. */
function sync(): void {
  const { actif } = depthHeatStore.getState();
  const { symbol } = marketStore.getState();
  const decision = decisionAbonnement(actif, symbol, symboleAbonne);

  if (decision.action === "rien") return;

  if (decision.action === "desabonner") {
    abonnement?.();
    abonnement = null;
    arreterEchantillonnage();
    symboleAbonne = null;
    dernierLivre = null;
    colonnes = [];
    publier();
    return;
  }

  // "souscrire" : 1re activation ou changement de symbole en cours d'activation — on
  // désabonne l'ancien symbole s'il y en avait un, puis on repart sur un buffer vide.
  abonnement?.();
  symboleAbonne = decision.symbol;
  dernierLivre = null;
  colonnes = [];
  abonnement = souscrireDepth(decision.symbol, (livre) => {
    dernierLivre = livre;
  });
  demarrerEchantillonnage();
  publier();
}

let controllerStarted = false;

/**
 * Démarre le contrôleur (idempotent). S'abonne à `marketStore` (symbole) et à
 * `depthHeatStore` (actif) pour réaligner l'abonnement WS + l'échantillonnage via `sync()`.
 * Appelé par le contrôleur canvas (Task 4) au montage — cf. modèle `demarrerTradeMarkers`.
 */
export function demarrerDepthHeat(): void {
  if (controllerStarted) return;
  controllerStarted = true;

  let prevSymbol = marketStore.getState().symbol;
  marketStore.subscribe(() => {
    const { symbol } = marketStore.getState();
    if (symbol !== prevSymbol) {
      prevSymbol = symbol;
      sync();
    }
  });

  let prevActif = depthHeatStore.getState().actif;
  depthHeatStore.subscribe((s) => {
    if (s.actif !== prevActif) {
      prevActif = s.actif;
      sync();
    }
  });
}
