/**
 * Bulles de prints BALEINES (WHALE) sur le chart — épingle les gros trades AGRESSIFS
 * directement sur les bougies, en bulles proportionnelles au notionnel, vert/rouge
 * selon le côté agresseur.
 *
 * POURQUOI ce module : un « print » de plusieurs centaines de milliers de dollars qui
 * frappe le carnet est un évènement de flux ; POSÉ sur la bougie où il a eu lieu, il
 * raconte QUI a pris l'initiative (achat/vente agressif) et à QUEL prix. On dessine donc
 * un cercle plein (rayon ∝ √notionnel, borné) coloré --up/--down, + une étiquette du
 * montant (formatUsd) pour les prints VRAIMENT énormes (≥ 5× le seuil) — le reste du
 * temps le rayon seul suffit et l'écran reste lisible.
 *
 * MODÈLE : calqué sur `chart/tradeMarkers.ts` (même overlay custom `registerOverlay`,
 * même contrôleur SINGLETON qui pose ses overlays via `getActiveChart()`, même cycle
 * « efface par id suivi puis recrée », mêmes abonnements filtrés `prev*`). Différence
 * ASSUMÉE avec tradeMarkers : la source n'est pas un store d'évènements mais un FLUX
 * TICK (trades spot + perp), consommé façon `OrderflowController.ensureTrades` —
 * accumulation dans un BUFFER hors React (jamais de tick dans un store Zustand, cf.
 * BUILD-CONTRACT), redraw THROTTLÉ (~2 Hz : les overlays KLineChart sont plus coûteux
 * qu'un canvas).
 *
 * Convention de CÔTÉ : `Trade.side` = agresseur (taker), tel que produit par
 * `aggTradeToTrade` (data/binance.ts) — on ne l'inverse JAMAIS.
 *
 * La PROJECTION des trades en prints, l'échelle de rayon et le nettoyage des overlays
 * sont des fonctions PURES exportées et testées (whaleBubbles.test.ts) ; le couplage
 * KLineChart reste dans le contrôleur non testé (comme tradeMarkers / ecoMarkers).
 */
import { registerOverlay } from "klinecharts";
import type { OverlayCreate, OverlayFigure } from "klinecharts";
import type { Trade, Unsubscribe } from "@axiom/types";
import { createStore } from "zustand/vanilla";
import { getActiveChart } from "./drawing";
import { getAdapter } from "../data/adapters";
import { subscribePerpAggTrades } from "../data/binanceFutures";
import { marketStore } from "../store/market";
import { orderflowStore } from "../store/orderflow";
import { themeStore } from "../store/theme";
import { formatUsd } from "../lib/format";
import { rgbaTokenCanvas } from "../lib/canvasTokens";
import type { Commande } from "../commands/registry";

/** Cap défensif du buffer de prints : au-delà, on garde les PLUS RÉCENTS (FIFO). */
export const WHALE_MAX_PRINTS = 500;

/** Rayon min/max (px) d'une bulle — borne l'échelle √notionnel (lisibilité + perf). */
const R_MIN = 4;
const R_MAX = 18;

/** Un print baleine projeté (donnée pure, indépendante de KLineChart). */
export interface WhalePrint {
  /** Horodatage du trade (ms epoch) — ancre en X. */
  time: number;
  /** Prix du trade (> 0) — ancre en Y. */
  price: number;
  /** Notionnel en devise de cotation = price × qty (absent du type Trade, calculé ici). */
  notionnel: number;
  /** Côté AGRESSEUR (taker) — jamais inversé (cf. aggTradeToTrade). */
  side: "buy" | "sell";
}

// ─────────────────────────── Fonctions PURES (testées) ───────────────────────────

/**
 * Projette un trade en print baleine SI son notionnel (price × qty) atteint le seuil,
 * sinon `null` (trade trop petit, filtré en amont du buffer). Le côté agresseur est
 * conservé tel quel. PURE.
 */
export function versWhalePrint(t: Trade, seuil: number): WhalePrint | null {
  const notionnel = t.price * t.qty;
  if (notionnel < seuil) return null;
  return { time: t.time, price: t.price, notionnel, side: t.side };
}

/**
 * Ajoute un print au buffer en le bornant à `max` (FIFO : évince les plus anciens).
 * Renvoie un NOUVEAU tableau (ne mute pas l'entrée). PURE.
 */
export function ajouterPrint(
  buffer: WhalePrint[],
  p: WhalePrint,
  max = WHALE_MAX_PRINTS,
): WhalePrint[] {
  const suite = [...buffer, p];
  return suite.length > max ? suite.slice(suite.length - max) : suite;
}

/**
 * Rayon (px) d'une bulle : proportionnel à √(notionnel/seuil) — l'AIRE croît donc
 * linéairement avec le notionnel (perception visuelle correcte), bornée [R_MIN, R_MAX].
 * Au seuil exact → R_MIN ; ×4 le notionnel → ×2 le rayon. PURE.
 */
export function rayonBulle(notionnel: number, seuil: number): number {
  const r = R_MIN * Math.sqrt(notionnel / seuil);
  return Math.max(R_MIN, Math.min(R_MAX, r));
}

/**
 * Étiquette du montant (formatUsd) pour les prints VRAIMENT énormes (≥ 5× le seuil),
 * sinon `null` (le rayon seul suffit — on n'encombre pas l'écran de texte). PURE.
 */
export function labelPourPrint(p: WhalePrint, seuil: number): string | null {
  return p.notionnel >= 5 * seuil ? formatUsd(p.notionnel) : null;
}

/**
 * Surface MINIMALE d'une instance de chart pour le retrait des bulles (structurel :
 * l'instance KLineChart la satisfait). Isolée pour tester la logique de nettoyage
 * multi-instances sans dépendre de klinecharts.
 */
export interface CibleOverlays {
  removeOverlay(filtre: { id: string }): void;
}

/**
 * Retire les bulles de TOUTES les instances suivies (chacune par ses ids) puis vide le
 * registre. Une instance DÉTRUITE (dispose) peut faire lever `removeOverlay` : on isole
 * chaque instance (try/catch) pour qu'une instance morte n'empêche pas de nettoyer les
 * autres. PURE (n'accède à aucun état de module) → testable avec un chart factice.
 * Identique à `retirerMarqueursSuivis` (tradeMarkers.ts).
 */
export function retirerBullesSuivies<C extends CibleOverlays>(suivis: Map<C, string[]>): void {
  for (const [chart, ids] of suivis) {
    for (const id of ids) {
      try {
        chart.removeOverlay({ id });
      } catch {
        break; // instance détruite : inutile d'insister sur ses autres ids.
      }
    }
  }
  suivis.clear();
}

// ─────────────────────────── Bascule (store vanilla local) ───────────────────────────

export interface WhaleBubblesState {
  /** Bulles baleines affichées sur le chart ? */
  actif: boolean;
  /** Bascule l'affichage (et, par ricochet, l'abonnement au flux trades). */
  basculer: () => void;
}

/** État on/off local au module — VANILLA, éphémère (NON persisté), cf. tradeMarkers. */
export const whaleBubblesStore = createStore<WhaleBubblesState>((set, get) => ({
  actif: false,
  basculer: () => set({ actif: !get().actif }),
}));

// ─────────────────────────── Rendu KLineChart (non testé) ───────────────────────────

/** Nom de l'overlay custom + groupe (permet un removeOverlay ciblé, cf. tradeMarkers). */
const WHALE_BUBBLE = "whaleBubble";
const WHALE_GROUP = "axiomWhale";

/** Cap défensif du NOMBRE de bulles posées : au-delà, on garde les plus récentes. */
const MAX_BULLES = 200;

/** Alpha du remplissage des bulles (semi-transparent : les bougies restent lisibles dessous). */
const ALPHA_BULLE = 0.35;

/** Throttle du redraw (ms) : les overlays KLineChart sont coûteux, ~2 Hz suffit. */
const THROTTLE_MS = 500;

/** Données portées par chaque overlay (résolues au redraw, lues dans createPointFigures). */
interface DonneesBulle {
  /** Rayon en px (déjà borné, via rayonBulle). */
  rayon: number;
  /** Couleur de remplissage déjà RÉSOLUE (rgba du thème courant, lue au redraw). */
  couleur: string;
  /** Étiquette du montant (très gros prints) ou null (rayon seul). */
  label: string | null;
}

let overlayRegistered = false;

/** Enregistre l'overlay custom « whaleBubble » (idempotent, effet global klinecharts). */
function ensureOverlayRegistered(): void {
  if (overlayRegistered) return;
  overlayRegistered = true;
  registerOverlay({
    name: WHALE_BUBBLE,
    totalStep: 1, // un seul point (timestamp/prix), toujours créé avec points fournis
    lock: true, // informatif : ne répond à aucun évènement souris
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ overlay, coordinates }) => {
      const c = coordinates[0];
      if (c === undefined) return [];
      const d = overlay.extendData as DonneesBulle | undefined;
      if (d === undefined) return [];
      const figures: OverlayFigure[] = [
        {
          type: "circle",
          ignoreEvent: true,
          attrs: { x: c.x, y: c.y, r: d.rayon },
          styles: { style: "fill", color: d.couleur },
        },
      ];
      if (d.label !== null) {
        figures.push({
          type: "text",
          ignoreEvent: true,
          attrs: { x: c.x + d.rayon + 4, y: c.y, text: d.label, align: "left", baseline: "middle" },
          styles: { color: d.couleur, size: 10 },
        });
      }
      return figures;
    },
  });
}

// ─────────────────────────── Contrôleur singleton ───────────────────────────

/** Buffer FIFO de prints, HORS React (aucun tick dans un store Zustand, cf. BUILD-CONTRACT). */
let buffer: WhalePrint[] = [];

/**
 * Instances de chart portant ACTUELLEMENT des bulles, avec leurs ids (cf. tradeMarkers :
 * le focus peut changer entre deux dessins, on doit nettoyer TOUTES les instances suivies).
 */
const overlaysSuivis = new Map<CibleOverlays, string[]>();

/** Désabonnements des flux trades (spot + perp), null tant qu'inactif. */
let unsubSpot: Unsubscribe | null = null;
let unsubPerp: Unsubscribe | null = null;

/** Minuteur du redraw throttlé (null = aucun redraw en attente). */
let redrawTimer: ReturnType<typeof setTimeout> | null = null;

/** Coalesce les redraws : au plus un toutes les THROTTLE_MS (les overlays sont coûteux). */
function planifierRedraw(): void {
  if (redrawTimer !== null) return;
  redrawTimer = setTimeout(() => {
    redrawTimer = null;
    redraw();
  }, THROTTLE_MS);
}

/**
 * (Re)pose les bulles. Efface d'abord les anciennes sur TOUTES les instances suivies (le
 * focus a pu changer), puis recrée sur l'instance FOCUS si la bascule est active ET que
 * l'axe temps est prêt. On ne pose que les prints dans la plage temporelle des bougies
 * chargées, cap aux MAX_BULLES plus récents. Couleurs (thème) et rayon/label (seuil)
 * résolus ICI puis portés par extendData.
 */
function redraw(): void {
  retirerBullesSuivies(overlaysSuivis);

  if (!whaleBubblesStore.getState().actif) return;
  const chart = getActiveChart();
  if (chart === null) return;
  const { candles } = marketStore.getState();
  if (candles.length === 0) return; // axe temps pas encore prêt

  const seuil = orderflowStore.getState().whaleNotionalMin;
  // Borne basse = open time de la plus ancienne bougie chargée : un print antérieur à
  // l'historique affiché n'a pas de bougie support (il serait posé hors du graphe).
  const tMin = candles[0]?.time ?? 0;

  // Couleurs résolues AU DESSIN (thème-aware) : remplissage semi-transparent up/down.
  const couleurAchat = rgbaTokenCanvas("--up", ALPHA_BULLE, "#34d399");
  const couleurVente = rgbaTokenCanvas("--down", ALPHA_BULLE, "#f87171");

  // Prints dans la plage, cap aux plus récents (le buffer est déjà chronologique).
  const aPoser = buffer.filter((p) => p.time >= tMin).slice(-MAX_BULLES);

  const idsPoses: string[] = [];
  for (const p of aPoser) {
    const extend: DonneesBulle = {
      rayon: rayonBulle(p.notionnel, seuil),
      couleur: p.side === "buy" ? couleurAchat : couleurVente,
      label: labelPourPrint(p, seuil),
    };
    const overlay: OverlayCreate = {
      name: WHALE_BUBBLE,
      groupId: WHALE_GROUP,
      lock: true,
      points: [{ timestamp: p.time, value: p.price }],
      extendData: extend,
    };
    const id = chart.createOverlay(overlay);
    if (typeof id === "string") idsPoses.push(id);
  }
  if (idsPoses.length > 0) overlaysSuivis.set(chart, idsPoses);
}

/** Chaque trade agressif ≥ seuil rejoint le buffer FIFO ; redraw throttlé (jamais sur tick). */
function onTrade(t: Trade): void {
  const p = versWhalePrint(t, orderflowStore.getState().whaleNotionalMin);
  if (p === null) return;
  buffer = ajouterPrint(buffer, p);
  planifierRedraw();
}

/** Ferme les flux trades ouverts (idempotent). */
function desabonnerTrades(): void {
  if (unsubSpot) {
    unsubSpot();
    unsubSpot = null;
  }
  if (unsubPerp) {
    unsubPerp();
    unsubPerp = null;
  }
}

/**
 * Abonne les flux trades du symbole COURANT façon `OrderflowController.ensureTrades` :
 * spot (adaptateur de la source active) + perp (fstream, Binance-only). Referme d'abord
 * d'éventuels flux précédents (réabonnement au changement de symbole).
 */
function abonnerTrades(): void {
  desabonnerTrades();
  const { exchange, symbol } = marketStore.getState();
  unsubSpot = getAdapter(exchange).subscribeTrades(symbol, onTrade);
  // Couche perp uniquement sur Binance (flux fstream) — même convention agresseur.
  if (exchange === "binance") {
    unsubPerp = subscribePerpAggTrades(symbol, onTrade);
  }
}

/**
 * Réconcilie l'abonnement au flux avec la bascule : on n'ouvre PAS de WebSocket tant que
 * la feature est OFF (l'historique des bulles démarre à l'activation). À l'extinction, on
 * ferme les flux et on vide le buffer.
 */
function syncTrades(): void {
  const actif = whaleBubblesStore.getState().actif;
  if (actif && unsubSpot === null) {
    abonnerTrades();
  } else if (!actif && unsubSpot !== null) {
    desabonnerTrades();
    buffer = [];
  }
}

let controllerStarted = false;

/**
 * Démarre le contrôleur (idempotent). Enregistre l'overlay et pose les abonnements aux
 * STORES (inertes : aucun flux WS tant que la bascule est OFF). Appelé à l'import (l'intégrateur
 * importe `commandes` → effet de bord) : les abonnements vivent toute la session.
 */
export function demarrerWhaleBubbles(): void {
  if (controllerStarted) return;
  controllerStarted = true;
  ensureOverlayRegistered();

  // marketStore : changement d'INSTANCE focus, de SYMBOLE/SOURCE, ou axe temps prêt.
  // marketStore émet aussi sur tick : on filtre pour ne réagir qu'à ces éléments.
  let prevChart = getActiveChart();
  let prevSymbol = marketStore.getState().symbol;
  let prevExchange = marketStore.getState().exchange;
  let prevReady = marketStore.getState().candles.length > 0;
  marketStore.subscribe(() => {
    const chart = getActiveChart();
    const { symbol, exchange, candles } = marketStore.getState();
    const ready = candles.length > 0;
    const changementSymbole = symbol !== prevSymbol || exchange !== prevExchange;
    if (chart !== prevChart || changementSymbole || ready !== prevReady) {
      prevChart = chart;
      prevSymbol = symbol;
      prevExchange = exchange;
      prevReady = ready;
      if (changementSymbole) {
        // Nouveau symbole : les prints du précédent ne sont plus pertinents → reset + réabo.
        buffer = [];
        if (whaleBubblesStore.getState().actif) abonnerTrades();
      }
      redraw();
    }
  });

  // Bascule d'affichage : (dés)abonne le flux trades PUIS redessine immédiatement.
  let prevActif = whaleBubblesStore.getState().actif;
  whaleBubblesStore.subscribe((s) => {
    if (s.actif !== prevActif) {
      prevActif = s.actif;
      syncTrades();
      redraw();
    }
  });

  // Seuil notionnel : re-filtrage a posteriori NON requis (le seuil s'applique aux NOUVEAUX
  // prints admis dans le buffer). On redessine tout de même pour recalculer rayons/labels
  // des prints déjà bufferisés à la nouvelle échelle — sans purger le buffer.
  let prevSeuil = orderflowStore.getState().whaleNotionalMin;
  orderflowStore.subscribe((s) => {
    if (s.whaleNotionalMin !== prevSeuil) {
      prevSeuil = s.whaleNotionalMin;
      redraw();
    }
  });

  // Thème : les couleurs sont résolues au dessin (rgbaTokenCanvas) → redraw pour repeindre.
  let prevTheme = themeStore.getState().theme;
  themeStore.subscribe((s) => {
    if (s.theme !== prevTheme) {
      prevTheme = s.theme;
      redraw();
    }
  });
}

// ─────────────────────────── Commande de palette (enregistrée par l'intégrateur) ───────────────────────────

/** Commande à greffer dans la palette (via `enregistrerCommandes`), cf. tradeMarkers. */
export const commandes: Commande[] = [
  {
    id: "action:whale-bubbles",
    mnemonique: "WHALE",
    libelle: "Bulles de prints baleines — activer / désactiver",
    categorie: "action",
    motsCles: ["whale", "baleines", "prints", "bulles", "trades", "notionnel", "agressif"],
    apercu: "Épingle les gros trades agressifs sur le chart, en bulles proportionnelles au notionnel",
    action: () => whaleBubblesStore.getState().basculer(),
  },
];

// Auto-démarrage à l'import (l'intégrateur importe `commandes` → déclenche cet effet).
demarrerWhaleBubbles();
