/**
 * Marqueurs des trades d'un BACKTEST sur le graphe (lot C1) — le fil qui manquait entre
 * la fenêtre BT et le chart.
 *
 * Chaque trade du run est posé dans son contexte de prix : un triangle CREUX à l'entrée
 * (orienté par le sens), un segment jusqu'à la sortie, coloré par le signe du PnL, et
 * l'étiquette de résultat sur la sortie. Le contour, plutôt qu'un triangle plein,
 * distingue ces trades SIMULÉS des deux familles déjà présentes sur le chart : les
 * signaux de stratégie et les trades réels du portefeuille (revue § 6.3).
 *
 * Modèle repris de `chart/tradeMarkers.ts` : overlay custom `registerOverlay`, contrôleur
 * singleton qui rejoue via `getActiveChart()`, cycle « efface par ids puis recrée »,
 * couleurs de thème résolues AU MOMENT du dessin et portées par `extendData`.
 *
 * La projection et le SCOPE (un run ne s'affiche que sur son couple symbole/TF) sont des
 * fonctions pures testées dans `btMarkers.calc.ts`.
 */
import { registerOverlay } from "klinecharts";
import type { OverlayCreate, OverlayFigure } from "klinecharts";
import { createStore } from "zustand/vanilla";
import { getActiveChart } from "./drawing";
import { marketStore } from "../store/market";
import { backtestStore } from "../store/backtest";
import { themeStore } from "../store/theme";
import { lireTokenCanvas } from "../lib/canvasTokens";
import { projeterTradesBt, type MarqueurBt } from "./btMarkers.calc";
import { retirerMarqueursSuivis, type CibleMarqueurs } from "./tradeMarkers";

const BT_MARKER = "btTradeMarker";
const BT_GROUP = "axiomBtTrade";

/** Demi-taille du triangle (px) et décalage pour ne pas recouvrir la bougie. */
const T = 5;
const DECALAGE = 2;

export interface BtMarksState {
  /** Trades du dernier run affichés sur le chart ? */
  actif: boolean;
  basculer: () => void;
  definir: (v: boolean) => void;
}

/** Bascule locale — VANILLA, éphémère (non persistée) : elle suit un run, pas une préférence. */
export const btMarksStore = createStore<BtMarksState>((set, get) => ({
  actif: false,
  basculer: () => set({ actif: !get().actif }),
  definir: (v) => set({ actif: v }),
}));

/** Données portées par chaque overlay (lues dans createPointFigures). */
interface DonneesBt {
  sens: "long" | "short";
  /** Couleur déjà RÉSOLUE (hex/rgb du thème courant). */
  couleur: string;
  label: string;
}

/**
 * Figures d'un trade : triangle CREUX à l'entrée, segment entrée→sortie, étiquette de
 * résultat à droite de la sortie. Deux points de coordonnées (entrée, sortie).
 */
function figuresTrade(
  entree: { x: number; y: number },
  sortie: { x: number; y: number },
  d: DonneesBt
): OverlayFigure[] {
  const haut = d.sens === "long";
  const apex = haut ? entree.y + DECALAGE : entree.y - DECALAGE;
  const base = haut ? apex + 2 * T : apex - 2 * T;
  return [
    // Trajet du trade : c'est lui qui rend la durée et l'amplitude lisibles d'un coup d'œil.
    {
      type: "line",
      ignoreEvent: true,
      attrs: { coordinates: [entree, sortie] },
      styles: { style: "dashed", size: 1, color: d.couleur, dashedValue: [3, 3] },
    },
    // Entrée : triangle CREUX (stroke) — plein = signal de stratégie ou trade réel.
    {
      type: "polygon",
      ignoreEvent: true,
      attrs: {
        coordinates: [
          { x: entree.x, y: apex },
          { x: entree.x - T, y: base },
          { x: entree.x + T, y: base },
        ],
      },
      styles: { style: "stroke", borderColor: d.couleur, borderSize: 1.5 },
    },
    // Sortie : petit cercle creux, puis l'étiquette de résultat.
    {
      type: "circle",
      ignoreEvent: true,
      attrs: { x: sortie.x, y: sortie.y, r: 3 },
      styles: { style: "stroke", borderColor: d.couleur, borderSize: 1.5 },
    },
    {
      type: "text",
      ignoreEvent: true,
      attrs: { x: sortie.x + 6, y: sortie.y, text: d.label, align: "left", baseline: "middle" },
      // Fond transparent obligatoire (pastille d'overlay par défaut, cf. annotationsPrix.ts).
      styles: { color: d.couleur, size: 10, backgroundColor: "transparent" },
    },
  ];
}

let overlayRegistered = false;

function ensureOverlayRegistered(): void {
  if (overlayRegistered) return;
  overlayRegistered = true;
  registerOverlay({
    name: BT_MARKER,
    totalStep: 1, // créé avec ses points, jamais tracé à la souris
    lock: true,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ overlay, coordinates }) => {
      const entree = coordinates[0];
      const sortie = coordinates[1];
      const d = overlay.extendData as DonneesBt | undefined;
      if (entree === undefined || sortie === undefined || d === undefined) return [];
      return figuresTrade(entree, sortie, d);
    },
  });
}

/** Instances portant actuellement des marqueurs BT (cf. tradeMarkers : le focus peut changer). */
const overlaysSuivis = new Map<CibleMarqueurs, string[]>();

/** Marqueurs à poser pour l'état courant — exposé pour le compteur de troncature de la fenêtre BT. */
export function marqueursCourants(): MarqueurBt[] {
  const bt = backtestStore.getState();
  const { symbol, timeframe } = marketStore.getState();
  const trades = bt.resultat?.trades ?? [];
  // Le scope vient du BUILDER : c'est la config qui a produit le run affiché.
  return projeterTradesBt(trades, { symbole: bt.symbol, timeframe: bt.tf }, {
    symbole: symbol,
    timeframe,
  });
}

function redraw(): void {
  retirerMarqueursSuivis(overlaysSuivis);
  if (!btMarksStore.getState().actif) return;
  const chart = getActiveChart();
  if (chart === null) return;
  if (marketStore.getState().candles.length === 0) return; // axe temps pas prêt

  const couleurs = {
    gain: lireTokenCanvas("--up", "#34d399"),
    perte: lireTokenCanvas("--down", "#f87171"),
  };

  const idsPoses: string[] = [];
  for (const m of marqueursCourants()) {
    const extend: DonneesBt = {
      sens: m.sens,
      couleur: m.gagnant ? couleurs.gain : couleurs.perte,
      label: m.label,
    };
    const overlay: OverlayCreate = {
      name: BT_MARKER,
      groupId: BT_GROUP,
      lock: true,
      points: [
        { timestamp: m.tempsEntree, value: m.prixEntree },
        { timestamp: m.tempsSortie, value: m.prixSortie },
      ],
      extendData: extend,
    };
    const id = chart.createOverlay(overlay);
    if (typeof id === "string") idsPoses.push(id);
  }
  if (idsPoses.length > 0) overlaysSuivis.set(chart, idsPoses);
}

let controllerStarted = false;

/**
 * Démarre le contrôleur (idempotent). Rejoue sur changement de run, de bascule, de thème,
 * et sur changement de contexte marché (instance focus, symbole/TF affichés, axe prêt) —
 * jamais sur tick : la bascule reste inerte tant qu'elle est OFF.
 */
export function demarrerBtMarkers(): void {
  if (controllerStarted) return;
  controllerStarted = true;
  ensureOverlayRegistered();

  let prevChart = getActiveChart();
  let prevSymbol = marketStore.getState().symbol;
  let prevTf = marketStore.getState().timeframe;
  let prevReady = marketStore.getState().candles.length > 0;
  marketStore.subscribe(() => {
    const chart = getActiveChart();
    const { symbol, timeframe, candles } = marketStore.getState();
    const ready = candles.length > 0;
    if (chart !== prevChart || symbol !== prevSymbol || timeframe !== prevTf || ready !== prevReady) {
      prevChart = chart;
      prevSymbol = symbol;
      prevTf = timeframe;
      prevReady = ready;
      redraw();
    }
  });

  let prevResultat = backtestStore.getState().resultat;
  backtestStore.subscribe(() => {
    const r = backtestStore.getState().resultat;
    if (r !== prevResultat) {
      prevResultat = r;
      redraw();
    }
  });

  btMarksStore.subscribe(redraw);
  themeStore.subscribe(redraw);
}

// Auto-démarrage à l'import : `BacktestWindow` importe `btMarksStore`, ce qui déclenche
// cet effet — même patron que `tradeMarkers`. Les abonnements restent inertes tant que la
// bascule est OFF (early-return dans `redraw`).
demarrerBtMarkers();
