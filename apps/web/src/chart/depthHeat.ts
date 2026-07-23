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
import { ActionType, DomPosition } from "klinecharts";
import type { Chart } from "klinecharts";
import type { ExchangeId, Unsubscribe } from "@axiom/types";
import { agregerNiveaux, pasArrondi, souscrireDepth, type NiveauAgrege, type OrderBook } from "../data/depth";
import { marketStore } from "../store/market";
import { themeStore } from "../store/theme";
import { lireTokenCanvas } from "../lib/canvasTokens";
import { couleurRampeArrets, estFondClair, rampePourTheme } from "./liquidationHeat";
import type { Commande } from "../commands/registry";

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
 * Décide l'action de (ré)abonnement à effectuer selon l'état actif/exchange/symbole courant
 * vs le symbole actuellement abonné : `desabonner` (souscription non désirée mais était
 * abonné) implique un reset du buffer ; `souscrire` (1re activation OU changement de symbole
 * en cours d'activation) implique aussi un reset du buffer (désabonnement de l'ancien symbole
 * d'abord, si présent). PURE — ne fait aucun effet, c'est `sync()` qui les exécute.
 *
 * POURQUOI la garde exchange : `souscrireDepth` est BINANCE-ONLY (le flux carnet WS n'existe
 * que pour Binance, cf. `data/depth.ts`). Même philosophie que la garde `isBinance` de
 * `DomWindow.tsx` : sur un autre exchange, la heatmap reste BASCULABLE (`actif` peut valoir
 * `true`) mais AUCUNE souscription n'est ouverte et le buffer reste vide — on traite alors
 * l'état exactement comme inactif (désabonner l'ancien symbole Binance s'il subsiste après un
 * passage binance→autre, sinon rien).
 */
export function decisionAbonnement(
  actif: boolean,
  exchange: ExchangeId,
  symbol: string,
  symboleAbonne: string | null,
): { action: "rien" } | { action: "desabonner" } | { action: "souscrire"; symbol: string } {
  const peutSouscrire = actif && exchange === "binance";
  if (!peutSouscrire) return symboleAbonne === null ? { action: "rien" } : { action: "desabonner" };
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
  const { exchange, symbol } = marketStore.getState();
  const decision = decisionAbonnement(actif, exchange, symbol, symboleAbonne);

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
 * Appelé à l'IMPORT du module (cf. auto-démarrage en bas de fichier, modèle
 * `demarrerTradeMarkers`) : idempotent, donc sans risque si le contrôleur canvas (Task 4)
 * le rappelle aussi à son montage.
 */
export function demarrerDepthHeat(): void {
  if (controllerStarted) return;
  controllerStarted = true;

  // On suit AUSSI l'exchange (pas seulement le symbole) : `setExchange` conserve le symbole,
  // donc sans cette garde un basculement binance→autre (ou l'inverse) ne re-syncrait jamais
  // et laisserait l'abonnement Binance vivant (ou ne le démarrerait jamais). Cf. la garde
  // exchange de `decisionAbonnement` et `DomWindow.tsx` (qui réagit à `exchange` dans ses deps).
  let prevSymbol = marketStore.getState().symbol;
  let prevExchange = marketStore.getState().exchange;
  marketStore.subscribe(() => {
    const { symbol, exchange } = marketStore.getState();
    if (symbol !== prevSymbol || exchange !== prevExchange) {
      prevSymbol = symbol;
      prevExchange = exchange;
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

// ─────────────────────────── Commande de palette (enregistrée par l'intégrateur) ───────────────────────────

/** Commande à greffer dans la palette (via `enregistrerCommandes`), cf. modèle `tradeMarkers.ts`. */
export const commandes: Commande[] = [
  {
    id: "action:depth-heat",
    mnemonique: "BOOK",
    libelle: "Heatmap de liquidité du carnet (chart) — activer / désactiver",
    categorie: "action",
    motsCles: ["book", "carnet", "orderbook", "liquidite", "depth", "heatmap", "bookmap", "chart"],
    apercu: "Superpose la trace temps × prix de la liquidité du carnet d'ordres (style Bookmap)",
    action: () => depthHeatStore.getState().basculer(),
  },
];

// Auto-démarrage à l'import (l'intégrateur importe `commandes` → déclenche cet effet, cf.
// modèle `tradeMarkers.ts` : sans cet appel, la commande basculerait un store que personne
// n'écoute côté données — aucune souscription ne serait jamais ouverte).
demarrerDepthHeat();

// ─────────────────────────── Contrôleur canvas (non testé — couplage KLineChart) ───────────────────────────

/** Pane prix (id par défaut KLineChart). */
const CANDLE_PANE_ID = "candle_pane";
/** Seuil de LISSAGE (px), MODÈLE `SEUIL_LISSAGE_PX` de liquidationHeat.ts : sous cette largeur
 *  de colonne (zoom large — beaucoup de colonnes/s tassées), le rendu cellule à cellule est
 *  remplacé par un offscreen basse résolution (1 cellule = 1 pixel) upscalé — 1 seul drawImage
 *  au lieu de milliers de fillRect. Au-dessus (zoom serré), les rects précis restent. */
const SEUIL_LISSAGE_PX = 6;
/** Hauteur cible d'une ligne de prix (px) : la résolution verticale de la grille suit la hauteur
 *  du pane divisée par ce pas, plafonnée à `NB_LIGNES_MAX` (borne le coût nCols×nLignes du grid). */
const HAUTEUR_LIGNE_PX = 2;
const NB_LIGNES_MAX = 320;
/** Alpha des cellules = `ALPHA_MIN + ALPHA_SPAN × intensité` (MODÈLE liquidationHeat.ts) : plage
 *  [0.15, 0.55] pour matérialiser les murs sans masquer le prix dessous. */
const ALPHA_MIN = 0.15;
const ALPHA_SPAN = 0.4;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Contrôleur canvas de la HEATMAP de liquidité du carnet (BOOK). Peint une grille temps × prix
 * (intensité log de la taille des ordres limites, rampe theme-aware) superposée au pane prix,
 * style Bookmap. Même mécanique éprouvée que `LiquidationHeatController` / `VolumeProfileController` :
 * rAF + dirty flag, `subscribeAction` du viewport, `convertToPixel`/`convertFromPixel`,
 * ResizeObserver, clip du pane, DPR. Aucun re-render React.
 *
 * MODÈLE `LiquidationHeatController`, mais DÉPOUILLÉ des couches propres aux liquidations
 * (niveaux estimés, mode dominance, flash de bande, tooltip/survol, atténuation footprint,
 * séparation long/short) : la source est une seule grille de quantités (`grilleDepuisColonnes`
 * sur `lireColonnes()`), sans hit-test — d'où pas de cache `grilleObsolete` (le rendu ne se
 * déclenche que sur un vrai changement : viewport, rev ≤1/s, resize, thème).
 *
 * Placement X : chaque colonne est ancrée à la bougie contenant/la plus proche de son horodatage
 * via `convertToPixel({timestamp})` (précision ≤ 1 bougie). PAS étalée uniformément sur le pane :
 * le buffer ne couvre que le temps écoulé depuis l'activation de BOOK, donc un étalement uniforme
 * collerait quelques secondes de murs sur toute la fenêtre visible et désalignerait la liquidité du prix.
 */
export class DepthHeatController {
  private readonly chart: Chart;
  private readonly container: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  private running = false;
  private raf = 0;
  /** Redessine seulement si dirty : évite un recalcul complet à 60 fps au repos. */
  private dirty = true;
  private resizeObserver: ResizeObserver | null = null;
  private unsubStore: (() => void) | null = null;
  private unsubMarket: (() => void) | null = null;
  private unsubTheme: (() => void) | null = null;
  /**
   * Petit canvas DÉTACHÉ du rendu lissé (1 cellule de la grille = 1 pixel), membres RÉUTILISÉS
   * entre frames : créés paresseusement, redimensionnés seulement quand les dimensions de la
   * grille visible changent (cf. `dessinerLisse`) — évite une allocation par frame.
   */
  private offscreen: HTMLCanvasElement | null = null;
  private offscreenCtx: CanvasRenderingContext2D | null = null;
  private imageData: ImageData | null = null;

  private readonly markDirty = (): void => {
    this.dirty = true;
  };

  /** Scroll/zoom/plage visible : invalider ET repeindre immédiatement (pas d'attente de frame). */
  private readonly onViewport = (): void => {
    this.dirty = true;
    this.render();
  };

  constructor(chart: Chart, container: HTMLElement, canvas: HTMLCanvasElement) {
    this.chart = chart;
    this.container = container;
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Contexte 2D du canvas heatmap-carnet indisponible");
    this.ctx = ctx;
  }

  /** Pilote l'activation (câblé sur `depthHeatStore.actif` par ChartInstance). */
  setEnabled(enabled: boolean): void {
    if (enabled === this.running) return;
    if (enabled) this.start();
    else this.stop();
  }

  dispose(): void {
    this.stop();
  }

  private start(): void {
    this.running = true;
    this.dirty = true;
    this.canvas.style.display = "block";
    this.subscribeActions();
    // Rev bump de depthHeatStore (nouvelle colonne échantillonnée ≤1/s) ET bascule `actif` :
    // repeindre. La bascule OFF passe par setEnabled (stop) ; ce simple repaint suffit pour ON.
    this.unsubStore = depthHeatStore.subscribe(this.markDirty);
    // Nouvelle bougie / backfill décale l'axe temps → recalcul (mêmes signaux que liq).
    this.unsubMarket = marketStore.subscribe(this.markDirty);
    // Changement de thème : la rampe est lue AU DESSIN → repeindre pour adopter les couleurs.
    this.unsubTheme = themeStore.subscribe(this.markDirty);
    // Redimensionnement du conteneur (resize fenêtre, toggle sidebar…) : aucun scroll/zoom/tick
    // ne le signale autrement, d'où l'observer dédié.
    this.resizeObserver = new ResizeObserver(this.markDirty);
    this.resizeObserver.observe(this.container);
    this.loop();
  }

  private stop(): void {
    this.running = false;
    this.canvas.style.display = "none";
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.unsubscribeActions();
    this.unsubStore?.();
    this.unsubStore = null;
    this.unsubMarket?.();
    this.unsubMarket = null;
    this.unsubTheme?.();
    this.unsubTheme = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.imageData = null;
    this.clearCanvas();
  }

  private subscribeActions(): void {
    this.chart.subscribeAction(ActionType.OnScroll, this.onViewport);
    this.chart.subscribeAction(ActionType.OnZoom, this.onViewport);
    this.chart.subscribeAction(ActionType.OnVisibleRangeChange, this.onViewport);
  }

  private unsubscribeActions(): void {
    this.chart.unsubscribeAction(ActionType.OnScroll, this.onViewport);
    this.chart.unsubscribeAction(ActionType.OnZoom, this.onViewport);
    this.chart.unsubscribeAction(ActionType.OnVisibleRangeChange, this.onViewport);
  }

  private readonly loop = (): void => {
    if (this.dirty) this.render();
    this.raf = requestAnimationFrame(this.loop);
  };

  /** Horodatage colonne → x absolu du pane prix (`undefined` si non convertible). */
  private toPxX(timestamp: number): number | undefined {
    const r = this.chart.convertToPixel({ timestamp }, { paneId: CANDLE_PANE_ID, absolute: true });
    const x = (Array.isArray(r) ? r[0] : r)?.x;
    return typeof x === "number" && Number.isFinite(x) ? x : undefined;
  }

  /** Pixel y absolu → prix (`undefined` si non convertible). */
  private fromPxValue(y: number): number | undefined {
    const r = this.chart.convertFromPixel([{ y }], { paneId: CANDLE_PANE_ID, absolute: true });
    const v = (Array.isArray(r) ? r[0] : r)?.value;
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  }

  /** Pixel x absolu → horodatage (extrapolé dans le futur au bord droit par KLineChart). */
  private fromPxTimestamp(x: number): number | undefined {
    const r = this.chart.convertFromPixel([{ x }], { paneId: CANDLE_PANE_ID, absolute: true });
    const t = (Array.isArray(r) ? r[0] : r)?.timestamp;
    return typeof t === "number" && Number.isFinite(t) ? t : undefined;
  }

  private clearCanvas(): void {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, this.container.clientWidth, this.container.clientHeight);
  }

  private render(): void {
    if (!this.running) return;
    this.dirty = false; // consommé : la prochaine frame ne refait rien tant que rien ne change.
    const ctx = this.ctx;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssW = this.container.clientWidth;
    const cssH = this.container.clientHeight;
    const bw = Math.round(cssW * dpr);
    const bh = Math.round(cssH * dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
      this.canvas.style.width = `${cssW}px`;
      this.canvas.style.height = `${cssH}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const main = this.chart.getSize(CANDLE_PANE_ID, DomPosition.Main);
    if (!main) return;
    const { left, top, width, height } = main;

    // Fenêtre visible PRIX (lue AUX pixels top/bas du pane) et TEMPS (aux pixels gauche/droite) :
    // grille temps×prix bornée à ce que l'utilisateur voit. Chart non prêt (bornes non
    // convertibles ou dégénérées) → on ne peint rien plutôt que de nourrir la grille de garbage.
    const prixMax = this.fromPxValue(top);
    const prixMin = this.fromPxValue(top + height);
    const deMs = this.fromPxTimestamp(left);
    const aMs = this.fromPxTimestamp(left + width);
    if (prixMax === undefined || prixMin === undefined || deMs === undefined || aMs === undefined) return;
    if (!(prixMax > prixMin) || !(aMs > deMs)) return;

    const colonnes = lireColonnes();
    const nLignes = clamp(Math.round(height / HAUTEUR_LIGNE_PX), 1, NB_LIGNES_MAX);
    const grille = grilleDepuisColonnes(colonnes, deMs, aMs, prixMin, prixMax, nLignes);
    if (grille.nCols === 0 || !(grille.qtyMax > 0)) return; // buffer vide ou hors fenêtre

    // Colonnes retenues par la grille (MÊME prédicat que grilleDepuisColonnes, même ordre) :
    // grille.colonne i ↔ visibles[i], dont l'horodatage réel donne l'ancrage X.
    const visibles = colonnes.filter((c) => c.t >= deMs && c.t < aMs);
    const x0 = this.toPxX(visibles[0]!.t);
    const xN = this.toPxX(visibles[grille.nCols - 1]!.t);
    if (x0 === undefined || xN === undefined) return;
    // Largeur d'une colonne = espacement moyen entre colonnes (l'échantillonnage est ~1/s
    // uniforme) ; repli sur SEUIL_LISSAGE_PX pour une colonne unique.
    const colW = grille.nCols > 1 ? Math.max(1, (xN - x0) / (grille.nCols - 1)) : SEUIL_LISSAGE_PX;

    const rampe = rampePourTheme(themeStore.getState().theme, estFondClair(lireTokenCanvas("--bg", "")));

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    // Colonnes FINES (< SEUIL_LISSAGE_PX, zoom large) : offscreen upscalé (1 drawImage) ;
    // colonnes LARGES (zoom serré) : rects précis, lecture cellule à cellule. Repli sur les
    // rects si le lissé ne peut pas se dessiner (contexte offscreen indisponible…).
    if (colW >= SEUIL_LISSAGE_PX || !this.dessinerLisse(grille, nLignes, x0, xN, colW, top, height, rampe)) {
      this.dessinerRects(grille, visibles, nLignes, colW, top, height, rampe);
    }
    ctx.restore();
  }

  /**
   * Rendu CELLULE À CELLULE (colonnes larges ≥ SEUIL_LISSAGE_PX) : un fillRect par cellule non
   * vide, rampe theme-aware d'intensité log. Chaque colonne est ancrée à son horodatage réel
   * (`visibles[i].t`), centrée sur x, largeur `colW`. Axe Y : ligne 0 = prix bas (y grand),
   * projection linéaire de la fenêtre visible lue aux pixels top/bas (exact sur axe linéaire,
   * approx sur axe log — même simplification que le chemin lissé).
   */
  private dessinerRects(
    grille: GrilleDepth,
    visibles: ColonneDepth[],
    nLignes: number,
    colW: number,
    top: number,
    height: number,
    rampe: ReadonlyArray<readonly [number, number, number]>,
  ): void {
    const ctx = this.ctx;
    const { cellules, nCols, qtyMax } = grille;
    for (let i = 0; i < nCols; i++) {
      const xc = this.toPxX(visibles[i]!.t);
      if (xc === undefined) continue;
      const x = Math.round(xc - colW / 2);
      const w = Math.max(1, Math.round(colW));
      for (let l = 0; l < nLignes; l++) {
        const qty = cellules[i * nLignes + l] ?? 0;
        if (qty <= 0) continue;
        const t = intensiteLogDepth(qty, qtyMax);
        if (t <= 0) continue;
        const yBot = top + height * (1 - l / nLignes);
        const yTop = top + height * (1 - (l + 1) / nLignes);
        const y0 = Math.round(yTop);
        const y1 = Math.round(yBot);
        const [r, g, b] = couleurRampeArrets(t, rampe);
        ctx.fillStyle = `rgba(${r},${g},${b},${(ALPHA_MIN + ALPHA_SPAN * t).toFixed(3)})`;
        ctx.fillRect(x, y0, w, Math.max(1, y1 - y0));
      }
    }
  }

  /**
   * Rendu LISSÉ (colonnes fines < SEUIL_LISSAGE_PX) : petit canvas détaché (nCols × nLignes,
   * 1 cellule = 1 pixel), couleur PLEINE de la rampe, intensité log encodée dans le canal ALPHA,
   * puis upscalé en UN drawImage interpolé vers le rect englobant [x0..xN] × [top..top+height].
   *
   * AXE Y INVERSÉ : le prix croît vers le HAUT à l'écran (ligne nLignes-1 = prix max = haut du
   * pane) alors que la ligne 0 de l'image est en haut → ligne image = nLignes-1 - ligne grille.
   *
   * Renvoie `false` si impossible (contexte 2D offscreen indisponible) : l'appelant se replie
   * sur les rects.
   */
  private dessinerLisse(
    grille: GrilleDepth,
    nLignes: number,
    x0: number,
    xN: number,
    colW: number,
    top: number,
    height: number,
    rampe: ReadonlyArray<readonly [number, number, number]>,
  ): boolean {
    const { cellules, nCols, qtyMax } = grille;
    if (this.offscreen === null) {
      this.offscreen = document.createElement("canvas");
      this.offscreenCtx = this.offscreen.getContext("2d");
    }
    const off = this.offscreen;
    const offCtx = this.offscreenCtx;
    if (offCtx === null) return false;
    if (off.width !== nCols || off.height !== nLignes) {
      off.width = nCols;
      off.height = nLignes;
    }
    let img = this.imageData;
    if (img === null || img.width !== nCols || img.height !== nLignes) {
      img = offCtx.createImageData(nCols, nLignes);
      this.imageData = img;
    }
    const px = img.data;
    px.fill(0); // les cellules vides restent transparentes sans clearRect préalable
    for (let i = 0; i < nCols; i++) {
      for (let l = 0; l < nLignes; l++) {
        const qty = cellules[i * nLignes + l] ?? 0;
        if (qty <= 0) continue;
        const t = intensiteLogDepth(qty, qtyMax);
        if (t <= 0) continue;
        const [r, g, b] = couleurRampeArrets(t, rampe);
        const ligneImg = nLignes - 1 - l; // axe Y inversé (cf. docstring)
        const o = (ligneImg * nCols + i) * 4;
        px[o] = r;
        px[o + 1] = g;
        px[o + 2] = b;
        px[o + 3] = Math.round((ALPHA_MIN + ALPHA_SPAN * t) * 255);
      }
    }
    offCtx.putImageData(img, 0, 0);

    // Upscale INTERPOLÉ vers le pane : un seul drawImage. Rect englobant = bords des colonnes
    // extrêmes (centres ± demi-colonne). L'état du contexte (imageSmoothing) est restauré par le
    // ctx.restore() du clip de l'appelant.
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(off, x0 - colW / 2, top, Math.max(1, xN - x0 + colW), height);
    return true;
  }
}
