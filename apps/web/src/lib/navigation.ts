/**
 * Bus de navigation panneau → chart (Lot C2 / G7).
 *
 * Une seule API `navigateTo(intent)` pour EQS, NEWS, ECO, BRIEF, MAP… : applique
 * symbole / source / TF au `marketStore` (slot maître), met le focus chart, et pose
 * optionnellement un marqueur vertical (pattern ecoMarkers / tradeMarkers) au
 * `markTime` fourni, avec scroll KLineChart vers cet horodatage.
 *
 * Les helpers d'intention (`markTimeValide`, `etiquetteMarqueur`, `champsMarche`)
 * sont PURES et testées ; le couplage KLineChart reste dans le contrôleur non testé
 * (comme ecoMarkers).
 */
import { registerOverlay } from "klinecharts";
import type { OverlayCreate } from "klinecharts";
import type { ExchangeId, Timeframe } from "@axiom/types";
import { createStore } from "zustand/vanilla";
import { getActiveChart, setFocusChart } from "../chart/drawing";
import { chartLayoutStore } from "../store/chart-layout";
import { marketStore } from "../store/market";
import { lireTokenCanvas } from "./canvasTokens";

// ─────────────────────────── Contrat public ───────────────────────────

/**
 * Intention de navigation émise par un panneau (EQS, NEWS, ECO, BRIEF, MAP…).
 * Tous les champs hors `source` sont optionnels : on n'applique que ce qui est fourni.
 */
export interface NavIntent {
  symbol?: string;
  exchange?: ExchangeId;
  timeframe?: Timeframe;
  /** ms epoch pour marqueur vertical optionnel + scroll chart. */
  markTime?: number;
  /** Provenance courte : « eqs » | « news » | « eco » | « brief » | « map » | … */
  source: string;
  /** Libellé court du marqueur (sinon dérivé de `source`). */
  markLabel?: string;
}

/** Champs marché extraits d'une intention (sous-ensemble applicable au store). */
export interface ChampsMarche {
  symbol?: string;
  exchange?: ExchangeId;
  timeframe?: Timeframe;
}

// ─────────────────────────── Helpers PURES (testés) ───────────────────────────

/** Un markTime est plaçable s'il est un nombre fini strictement positif. */
export function markTimeValide(t: number | undefined | null): t is number {
  return t !== undefined && t !== null && Number.isFinite(t) && t > 0;
}

/** Tronque un label à `n` caractères (… si coupé). PURE. */
export function tronquerLabel(s: string, n = 18): string {
  const t = s.trim();
  if (t.length === 0) return "";
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/**
 * Libellé du marqueur vertical : `markLabel` prioritaire, sinon mnémonique de `source`.
 * PURE.
 */
export function etiquetteMarqueur(intent: Pick<NavIntent, "source" | "markLabel">): string {
  const custom = intent.markLabel !== undefined ? tronquerLabel(intent.markLabel) : "";
  if (custom.length > 0) return custom;
  const src = intent.source.trim().toLowerCase();
  switch (src) {
    case "eqs":
    case "screener":
      return "EQS";
    case "news":
      return "NEWS";
    case "eco":
      return "ECO";
    case "brief":
      return "BRIEF";
    case "map":
      return "MAP";
    default:
      return tronquerLabel(intent.source.toUpperCase(), 8) || "NAV";
  }
}

/**
 * Extrait les champs marché non-vides d'une intention (ignore markTime / source).
 * PURE — ne touche aucun store.
 */
export function champsMarche(intent: NavIntent): ChampsMarche {
  const out: ChampsMarche = {};
  if (intent.symbol !== undefined && intent.symbol.trim().length > 0) {
    out.symbol = intent.symbol.trim();
  }
  if (intent.exchange !== undefined) out.exchange = intent.exchange;
  if (intent.timeframe !== undefined) out.timeframe = intent.timeframe;
  return out;
}

// ─────────────────────────── Store marqueur de navigation ───────────────────────────

/** État éphémère du marqueur posé par la dernière navigation (non persisté). */
export interface NavMarkState {
  /** Horodatage ms du marqueur, ou null si aucun. */
  time: number | null;
  /** Libellé affiché sur le chart. */
  label: string;
  /** Source d'origine (eqs, news…). */
  source: string;
  setMark: (time: number, label: string, source: string) => void;
  clear: () => void;
}

export const navMarkStore = createStore<NavMarkState>((set) => ({
  time: null,
  label: "",
  source: "",
  setMark: (time, label, source) => set({ time, label, source }),
  clear: () => set({ time: null, label: "", source: "" }),
}));

// ─────────────────────────── Overlay vertical (pattern ecoMarkers) ───────────────────────────

const NAV_MARKER = "navMarker";
const NAV_GROUP = "axiomNav";

interface NavMarkerExtend {
  label: string;
}

let overlayRegistered = false;

/** Enregistre l'overlay custom « navMarker » (idempotent). */
function ensureOverlayRegistered(): void {
  if (overlayRegistered) return;
  overlayRegistered = true;
  registerOverlay({
    name: NAV_MARKER,
    totalStep: 1,
    lock: true,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ overlay, coordinates, bounding }) => {
      const c = coordinates[0];
      if (c === undefined) return [];
      const ext = overlay.extendData as NavMarkerExtend | undefined;
      const color = lireTokenCanvas("--accent", "#38bdf8");
      const label = ext?.label ?? "";
      return [
        {
          type: "line",
          ignoreEvent: true,
          attrs: { coordinates: [{ x: c.x, y: 0 }, { x: c.x, y: bounding.height }] },
          styles: { style: "dashed", size: 1, color, dashedValue: [4, 3] },
        },
        {
          type: "text",
          ignoreEvent: true,
          attrs: { x: c.x + 3, y: 2, text: label, align: "left", baseline: "top" },
          // Fond transparent obligatoire : sans lui la figure hérite du fond de texte
          // d'overlay (l'accent du thème depuis applyChartTheme, #1677FF avant lui) et
          // l'étiquette se retrouve écrite dans la couleur de son propre fond.
          // Verrou : chart/overlayTextStyles.test.ts.
          styles: { color, size: 10, backgroundColor: "transparent" },
        },
      ];
    },
  });
}

/** Dernière instance sur laquelle on a dessiné (détecte la recréation symbole/TF). */
let boundChart: ReturnType<typeof getActiveChart> = null;
/** Scroll en attente tant que l'axe temps n'est pas prêt. */
let pendingScroll: number | null = null;

/**
 * (Re)pose le marqueur de navigation sur l'instance focus. Efface d'abord les anciens,
 * puis recrée si un markTime est actif et que des bougies sont présentes.
 */
function redrawNavMarker(): void {
  const chart = getActiveChart();
  // Grille multi-chart : le focus a pu changer depuis le dernier tracé. Sans ce retrait
  // sur l'ANCIEN porteur, l'overlay resterait à demeure sur le slot d'origine (pattern
  // `retirerMarqueursSuivis` de chart/tradeMarkers ; try/catch pour l'instance disposée).
  if (boundChart !== null && boundChart !== chart) {
    try {
      boundChart.removeOverlay({ name: NAV_MARKER });
    } catch {
      // Instance détruite (dispose) — silencieux.
    }
  }
  boundChart = chart;
  if (chart === null) return;

  chart.removeOverlay({ name: NAV_MARKER });

  const { time, label } = navMarkStore.getState();
  if (time === null) return;
  if (marketStore.getState().candles.length === 0) return;

  const extend: NavMarkerExtend = { label };
  const overlay: OverlayCreate = {
    name: NAV_MARKER,
    groupId: NAV_GROUP,
    lock: true,
    points: [{ timestamp: time, value: 0 }],
    extendData: extend,
  };
  chart.createOverlay(overlay);

  // Scroll différé (après changement de symbole, le chart est recréé + backfill).
  if (pendingScroll !== null) {
    const ts = pendingScroll;
    pendingScroll = null;
    try {
      chart.scrollToTimestamp(ts, 250);
    } catch {
      // Instance en cours de dispose / API indispo — silencieux.
    }
  }
}

let controllerStarted = false;

/**
 * Démarre le contrôleur de marqueurs nav (idempotent). Abonnements de REJEU :
 * changement d'instance chart (symbole/TF) et de markTime.
 */
export function demarrerNavMarkers(): void {
  if (controllerStarted) return;
  controllerStarted = true;
  ensureOverlayRegistered();

  marketStore.subscribe(() => {
    const chart = getActiveChart();
    const ready = marketStore.getState().candles.length > 0;
    // Rejeu si instance changée OU axe temps devient prêt (backfill post-nav).
    if ((chart !== null && chart !== boundChart) || (ready && pendingScroll !== null)) {
      redrawNavMarker();
    }
  });

  let prevTime = navMarkStore.getState().time;
  navMarkStore.subscribe((s) => {
    if (s.time !== prevTime) {
      prevTime = s.time;
      redrawNavMarker();
    }
  });
}

// ─────────────────────────── API publique à effets ───────────────────────────

/**
 * Applique une intention de navigation au chart maître.
 * Ordre : exchange → symbole → TF (comme `appliquerNavigation` palette) ;
 * focus slot 0 ; marqueur vertical + scroll si `markTime` valide.
 */
export function navigateTo(intent: NavIntent): void {
  demarrerNavMarkers();

  const champs = champsMarche(intent);
  const m = marketStore.getState();
  if (champs.exchange !== undefined) m.setExchange(champs.exchange);
  if (champs.symbol !== undefined) m.setSymbol(champs.symbol);
  if (champs.timeframe !== undefined) m.setTimeframe(champs.timeframe);

  // Focus chart maître (slot 0) — panneau → chart visible.
  chartLayoutStore.getState().setFocus(0);
  setFocusChart(0);

  if (markTimeValide(intent.markTime)) {
    const label = etiquetteMarqueur(intent);
    pendingScroll = intent.markTime;
    navMarkStore.getState().setMark(intent.markTime, label, intent.source);
    // Tentative immédiate (no-op si bougies absentes — le subscribe rejouera).
    redrawNavMarker();
  } else {
    // Navigation pure symbole/TF : retire l'ancien marqueur pour éviter la confusion.
    pendingScroll = null;
    navMarkStore.getState().clear();
    redrawNavMarker();
  }
}
