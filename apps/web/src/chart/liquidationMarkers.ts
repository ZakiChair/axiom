/**
 * Marqueurs LIQUIDATIONS sur le chart — pose des pastilles au timestamp/prix de chaque
 * liquidation forcée du perpétuel (flux `allLiquidation` Bybit), pour VOIR les cascades
 * de liquidation dans leur contexte de prix (les mèches de liquidation).
 *
 * MODÈLE : calqué sur `chart/tradeMarkers.ts` (overlay custom `registerOverlay`,
 * contrôleur singleton, rejeu via `getActiveChart()`, cycle « efface puis recrée »,
 * couleurs de thème résolues au dessin). Ne touche PAS ChartInstance (god-file).
 *
 * DEUX différences vs tradeMarkers :
 *   1. Source LIVE (WebSocket) et non un store rejouable → le contrôleur GÈRE l'abonnement :
 *      il n'ouvre le flux que quand la bascule est ON (économe), et le referme/rouvre au
 *      changement de symbole. Le buffer n'accumule que du LIVE (pas d'historique de liq).
 *   2. Rendu = pastille dimensionnée par NOTIONNEL (grosses liquidations = gros points),
 *      couleur par côté (long liquidé = --down, short liquidé = --up).
 *
 * Limitation assumée (comme la fenêtre LIQ) : flux throttlé ~1/s/symbole = échantillon ;
 * les marqueurs n'apparaissent que sur le bord LIVE (aucune liquidation historique).
 *
 * Fonctions PURES (tri/élagage/tier) exportées et testées ; couplage KLineChart non testé.
 */
import { registerOverlay } from "klinecharts";
import type { OverlayCreate, OverlayFigure } from "klinecharts";
import { createStore } from "zustand/vanilla";
import type { Commande } from "../commands/registry";
import { getActiveChart } from "./drawing";
import { marketStore } from "../store/market";
import { themeStore } from "../store/theme";
import { subscribeLiquidations, type Liquidation } from "../data/liquidations";
import type { Unsubscribe } from "@axiom/types";
import { lireTokenCanvas } from "../lib/canvasTokens";
import { formatUsd } from "../lib/format";

const LIQ_MARKER = "liqMarker";
const LIQ_GROUP = "axiomLiq";

/** Fenêtre temporelle des marqueurs conservés (bord live) et cap défensif. */
const FENETRE_MS = 30 * 60_000;
const MAX_MARQUEURS = 150;
/** Notionnel minimal ($) au-delà duquel une liquidation est étiquetée (grosses seulement). */
const SEUIL_LABEL = 1_000_000;

// ─────────────────────────── Fonctions PURES (testées) ───────────────────────────

/** Rayon (px) d'une pastille selon le notionnel — paliers heuristiques. PURE. */
export function tierRayon(notionalUsd: number): number {
  if (!Number.isFinite(notionalUsd)) return 3;
  if (notionalUsd >= 5_000_000) return 11;
  if (notionalUsd >= 1_000_000) return 8;
  if (notionalUsd >= 250_000) return 6;
  if (notionalUsd >= 50_000) return 4;
  return 3;
}

/** Couleur SÉMANTIQUE d'une liquidation : long liquidé = down, short liquidé = up. PURE. */
export function couleurLiquidation(side: Liquidation["side"]): "up" | "down" {
  return side === "long" ? "down" : "up";
}

/**
 * Cale un horodatage de liquidation sur la bougie qui le CONTIENT : renvoie le plus grand
 * temps de bougie ≤ t (ou la 1re bougie si t est avant). PURE.
 *
 * POURQUOI : une liquidation est LIVE (t ≈ maintenant). Placée à son heure exacte, elle
 * tombe APRÈS la dernière bougie (zone d'offset à droite) sur les TF élevés (1d…) → les
 * marqueurs s'empilent hors des bougies, au bord droit. En calant sur la bougie
 * contenante, le marqueur atterrit TOUJOURS sur une bougie : il s'étale en intraday et se
 * regroupe sur la bougie courante en 1d. `candleTimes` est trié ascendant.
 */
export function snapToCandleTime(candleTimes: number[], t: number): number {
  const n = candleTimes.length;
  if (n === 0) return t;
  const first = candleTimes[0] as number;
  const last = candleTimes[n - 1] as number;
  if (t <= first) return first;
  if (t >= last) return last;
  // Recherche dichotomique du plus grand temps ≤ t.
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((candleTimes[mid] as number) <= t) lo = mid;
    else hi = mid - 1;
  }
  return candleTimes[lo] as number;
}

/**
 * Élague un buffer de liquidations : ne garde que celles dans [maintenant − fenetre, maintenant],
 * triées ANTICHRONO, bornées aux `max` plus récentes. PURE (base du rendu du bord live).
 */
export function elaguerLiquidations(
  liqs: Liquidation[],
  maintenant: number,
  fenetreMs: number,
  max: number,
): Liquidation[] {
  return liqs
    .filter((l) => l.time >= maintenant - fenetreMs && l.time <= maintenant)
    .sort((a, b) => b.time - a.time)
    .slice(0, max);
}

// ─────────────────────────── Bascule (store vanilla local) ───────────────────────────

export interface LiqMarksState {
  actif: boolean;
  basculer: () => void;
}

export const liqMarksStore = createStore<LiqMarksState>((set, get) => ({
  actif: false,
  basculer: () => set({ actif: !get().actif }),
}));

// ─────────────────────────── Rendu KLineChart (non testé) ───────────────────────────

interface DonneesLiq {
  rayon: number;
  couleur: string; // déjà résolue (hex/rgb du thème courant)
  label: string; // "" sauf grosses liquidations
}

let overlayRegistered = false;
function ensureOverlayRegistered(): void {
  if (overlayRegistered) return;
  overlayRegistered = true;
  registerOverlay({
    name: LIQ_MARKER,
    totalStep: 1,
    lock: true,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ overlay, coordinates }) => {
      const c = coordinates[0];
      if (c === undefined) return [];
      const d = overlay.extendData as DonneesLiq | undefined;
      if (d === undefined) return [];
      const figures: OverlayFigure[] = [
        {
          type: "circle",
          ignoreEvent: true,
          attrs: { x: c.x, y: c.y, r: d.rayon },
          // Pastille semi-transparente (remplissage) + contour net pour la lisibilité.
          styles: { style: "fill", color: d.couleur },
        },
      ];
      if (d.label !== "") {
        figures.push({
          type: "text",
          ignoreEvent: true,
          attrs: { x: c.x + d.rayon + 3, y: c.y, text: d.label, align: "left", baseline: "middle" },
          styles: { color: d.couleur, size: 10 },
        });
      }
      return figures;
    },
  });
}

// ─────────────────────────── Contrôleur singleton ───────────────────────────

const overlaysSuivis = new Map<{ removeOverlay(f: { id: string }): void }, string[]>();
let buffer: Liquidation[] = [];
let abonnement: Unsubscribe | null = null;
let symboleAbonne: string | null = null;

/** Retire les overlays de toutes les instances suivies (tolère une instance détruite). */
function retirerOverlays(): void {
  for (const [chart, ids] of overlaysSuivis) {
    for (const id of ids) {
      try {
        chart.removeOverlay({ id });
      } catch {
        break;
      }
    }
  }
  overlaysSuivis.clear();
}

function redraw(): void {
  retirerOverlays();
  if (!liqMarksStore.getState().actif) return;
  const chart = getActiveChart();
  if (chart === null) return;
  const candles = marketStore.getState().candles;
  if (candles.length === 0) return;
  const candleTimes = candles.map((c) => c.time);

  const palette = {
    up: lireTokenCanvas("--up", "#34d399"),
    down: lireTokenCanvas("--down", "#f87171"),
  };
  const marqueurs = elaguerLiquidations(buffer, Date.now(), FENETRE_MS, MAX_MARQUEURS);
  const ids: string[] = [];
  for (const l of marqueurs) {
    const extend: DonneesLiq = {
      rayon: tierRayon(l.notionalUsd),
      couleur: palette[couleurLiquidation(l.side)],
      label: l.notionalUsd >= SEUIL_LABEL ? formatUsd(l.notionalUsd) : "",
    };
    const overlay: OverlayCreate = {
      name: LIQ_MARKER,
      groupId: LIQ_GROUP,
      lock: true,
      // Caler sur la bougie contenante : le marqueur tombe TOUJOURS sur une bougie
      // (jamais dans la zone d'offset à droite), correct sur tous les timeframes.
      points: [{ timestamp: snapToCandleTime(candleTimes, l.time), value: l.price }],
      extendData: extend,
    };
    const id = chart.createOverlay(overlay);
    if (typeof id === "string") ids.push(id);
  }
  if (ids.length > 0) overlaysSuivis.set(chart, ids);
}

/**
 * Aligne l'abonnement WS sur l'état (bascule + symbole courant). N'ouvre le flux QUE si
 * la bascule est ON ; le referme/rouvre + vide le buffer au changement de symbole.
 */
function sync(): void {
  const actif = liqMarksStore.getState().actif;
  const symbol = marketStore.getState().symbol;

  if (!actif) {
    if (abonnement) {
      abonnement();
      abonnement = null;
    }
    symboleAbonne = null;
    buffer = [];
    redraw();
    return;
  }
  if (symboleAbonne !== symbol) {
    if (abonnement) abonnement();
    buffer = [];
    symboleAbonne = symbol;
    abonnement = subscribeLiquidations(symbol, (l) => {
      buffer.push(l);
      buffer = elaguerLiquidations(buffer, Date.now(), FENETRE_MS, MAX_MARQUEURS);
      redraw();
    });
    redraw();
  }
}

let controllerStarted = false;
export function demarrerLiquidationMarkers(): void {
  if (controllerStarted) return;
  controllerStarted = true;
  ensureOverlayRegistered();

  // Symbole/focus/axe prêt : réaligne l'abonnement et redessine.
  let prevSymbol = marketStore.getState().symbol;
  let prevChart = getActiveChart();
  let prevReady = marketStore.getState().candles.length > 0;
  marketStore.subscribe(() => {
    const chart = getActiveChart();
    const { symbol, candles } = marketStore.getState();
    const ready = candles.length > 0;
    if (symbol !== prevSymbol || chart !== prevChart || ready !== prevReady) {
      prevSymbol = symbol;
      prevChart = chart;
      prevReady = ready;
      sync();
    }
  });

  // Bascule ON/OFF : ouvre/ferme le flux.
  let prevActif = liqMarksStore.getState().actif;
  liqMarksStore.subscribe((s) => {
    if (s.actif !== prevActif) {
      prevActif = s.actif;
      sync();
    }
  });

  // Thème : repeindre aux nouvelles couleurs.
  let prevTheme = themeStore.getState().theme;
  themeStore.subscribe((s) => {
    if (s.theme !== prevTheme) {
      prevTheme = s.theme;
      redraw();
    }
  });
}

// ─────────────────────────── Commande de palette ───────────────────────────

export const commandes: Commande[] = [
  {
    id: "action:liqmarks",
    mnemonique: "LIQMARK",
    libelle: "Liquidations (chart) — activer / désactiver",
    categorie: "action",
    motsCles: ["liquidations", "liqmark", "chart", "cascade", "forceorder", "mèches", "wicks", "perp"],
    apercu: "Épingle les liquidations perp Bybit (bord live) sur le graphe",
    action: () => liqMarksStore.getState().basculer(),
  },
];

demarrerLiquidationMarkers();
