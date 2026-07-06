/**
 * Overlay VPFR (Volume Profile à Plage Fixe) — profil de volume sur une plage
 * temporelle définie par l'utilisateur (2 points), pattern fibonacci.ts.
 *
 * Rendu : cadre discret de la plage, barres horizontales buy/sell ancrées au bord
 * droit (longueur ∝ volume), ligne POC (accent), bornes VA en pointillés + labels.
 *
 * Accès aux données : l'overlay a besoin des bougies ET de l'échelle prix→pixel du
 * chart qui l'héberge. Le chart est passé par `extendData` à la création
 * (createTrackedOverlay dans drawing.ts) — par overlay, donc sûr en multi-chart.
 * L'échelle passe par `convertToPixel` (exacte aussi en échelle log/%), pas par
 * interpolation entre les 2 points cliqués (dégénérée si tracé quasi horizontal).
 */
import { registerOverlay } from "klinecharts";
import type {
  OverlayCreateFiguresCallbackParams,
  OverlayFigure,
} from "klinecharts";
import type { Candle } from "@axiom/types";
import { computeVolumeProfile } from "./volumeProfile";

export const VPFR_NAME = "volumeRange";

/** Nombre de bins de prix du profil (plage fixe → plus grossier que le VPVR). */
const BIN_COUNT = 24;

// ───────────────────────────── Helpers purs ─────────────────────────────

/**
 * Mappe la plage [t1, t2] (bornes dans n'importe quel ordre) vers des indices de
 * bougies inclusifs. Convention open-time : un instant entre deux opens appartient
 * à la bougie ouverte avant lui (dernier index dont l'open <= t) ; la borne basse
 * est clampée à 0 si elle précède la première bougie. null si la plage est
 * entièrement hors données (avant le premier open ou après le dernier).
 */
export function rangeIndices(
  times: readonly number[],
  t1: number,
  t2: number
): { from: number; to: number } | null {
  const n = times.length;
  const first = times[0];
  const last = times[n - 1];
  if (first === undefined || last === undefined) return null;

  const lo = Math.min(t1, t2);
  const hi = Math.max(t1, t2);
  if (hi < first || lo > last) return null;

  return { from: lastIndexLE(times, lo), to: lastIndexLE(times, hi) };
}

/** Dernier index i tel que times[i] <= t (0 si aucun — appelant garant hi >= first). */
function lastIndexLE(times: readonly number[], t: number): number {
  let res = 0;
  let left = 0;
  let right = times.length - 1;
  while (left <= right) {
    const mid = (left + right) >> 1;
    const tm = times[mid];
    if (tm === undefined) break;
    if (tm <= t) {
      res = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  return res;
}

// ───────────────────────────── Couleurs thémées ─────────────────────────────

function cssVar(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v.length > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

// ───────────────────────────── Accès chart (extendData) ─────────────────────

/** Vue minimale du chart KLineChart dont l'overlay a besoin. */
interface VpfrChart {
  getDataList: () => unknown[];
  convertToPixel: (
    points: { value: number },
    finder: { paneId: string }
  ) => unknown;
}

function isVpfrChart(x: unknown): x is VpfrChart {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as VpfrChart).getDataList === "function" &&
    typeof (x as VpfrChart).convertToPixel === "function"
  );
}

/** y (pane prix, relatif) d'un prix via l'échelle réelle du chart. */
function pixelY(chart: VpfrChart, price: number): number | null {
  const res = chart.convertToPixel({ value: price }, { paneId: "candle_pane" });
  const coord = Array.isArray(res) ? res[0] : res;
  const y = (coord as { y?: unknown } | null | undefined)?.y;
  return typeof y === "number" && Number.isFinite(y) ? y : null;
}

// ───────────────────────────── Rendu ─────────────────────────────

function buildFigures(params: OverlayCreateFiguresCallbackParams): OverlayFigure[] {
  const { coordinates, overlay, precision } = params;
  const p0 = overlay.points[0];
  const p1 = overlay.points[1];
  const c0 = coordinates[0];
  const c1 = coordinates[1];
  if (
    p0?.timestamp === undefined ||
    p1?.timestamp === undefined ||
    c0 === undefined ||
    c1 === undefined
  ) {
    return [];
  }
  if (!isVpfrChart(overlay.extendData)) return [];
  const chart = overlay.extendData;

  const dataList = chart.getDataList() as ReadonlyArray<Record<string, unknown>>;
  if (dataList.length === 0) return [];
  const times: number[] = [];
  for (const d of dataList) {
    if (typeof d.timestamp === "number") times.push(d.timestamp);
  }

  const range = rangeIndices(times, p0.timestamp, p1.timestamp);
  if (range === null) return [];

  const candles: Candle[] = [];
  for (let i = range.from; i <= range.to; i++) {
    const raw = dataList[i];
    if (raw === undefined) continue;
    if (
      typeof raw.timestamp === "number" &&
      typeof raw.open === "number" &&
      typeof raw.high === "number" &&
      typeof raw.low === "number" &&
      typeof raw.close === "number"
    ) {
      candles.push({
        time: raw.timestamp,
        open: raw.open,
        high: raw.high,
        low: raw.low,
        close: raw.close,
        volume: typeof raw.volume === "number" ? raw.volume : 0,
        ...(typeof raw.buyVolume === "number" ? { buyVolume: raw.buyVolume } : {}),
        ...(typeof raw.sellVolume === "number" ? { sellVolume: raw.sellVolume } : {}),
      });
    }
  }
  if (candles.length === 0) return [];

  const vp = computeVolumeProfile(candles, 0, candles.length, BIN_COUNT);
  if (vp === null) return [];

  const yTop0 = pixelY(chart, vp.priceMax);
  const yBot0 = pixelY(chart, vp.priceMin);
  const yVAH = pixelY(chart, vp.vaHigh);
  const yVAL = pixelY(chart, vp.vaLow);
  if (yTop0 === null || yBot0 === null || yVAH === null || yVAL === null) return [];

  const startX = Math.min(c0.x, c1.x);
  const endX = Math.max(c0.x, c1.x);
  const maxBarW = Math.min(endX - startX, 300);
  if (maxBarW <= 0) return [];

  const up = cssVar("--up", "#2dc08e");
  const down = cssVar("--down", "#f92855");
  const accent = cssVar("--accent", "#38bdf8");
  const textDim = cssVar("--text-dim", "#9ca3af");
  const pricePrecision = Number.isFinite(precision.price) ? precision.price : 2;

  const figures: OverlayFigure[] = [];

  // 1) Cadre discret de la plage (fond + bordures gauche/droite pointillées).
  figures.push({
    type: "polygon",
    ignoreEvent: [],
    attrs: {
      coordinates: [
        { x: startX, y: yTop0 },
        { x: endX, y: yTop0 },
        { x: endX, y: yBot0 },
        { x: startX, y: yBot0 },
      ],
    },
    styles: { style: "fill", color: "rgba(148,163,184,0.03)" },
  });
  for (const x of [startX, endX]) {
    figures.push({
      type: "line",
      ignoreEvent: [],
      attrs: { coordinates: [{ x, y: yTop0 }, { x, y: yBot0 }] },
      styles: { style: "dashed", size: 1, color: textDim, dashedValue: [4, 4] },
    });
  }

  // 2) Barres horizontales buy/sell ancrées au bord droit de la plage.
  for (let b = 0; b < vp.bins.length; b++) {
    const bin = vp.bins[b];
    if (bin === undefined || bin.volume <= 0) continue;
    const yT = pixelY(chart, bin.priceHigh);
    const yB = pixelY(chart, bin.priceLow);
    if (yT === null || yB === null) continue;

    const total = (bin.volume / vp.maxVol) * maxBarW;
    const buyW = total * (bin.buyVol / bin.volume);
    const sellW = total - buyW;

    // sell (extérieur) puis buy (intérieur), empilés depuis le bord droit.
    figures.push({
      type: "polygon",
      ignoreEvent: [],
      attrs: {
        coordinates: [
          { x: endX - sellW, y: yT },
          { x: endX, y: yT },
          { x: endX, y: yB },
          { x: endX - sellW, y: yB },
        ],
      },
      styles: { style: "fill", color: down },
    });
    figures.push({
      type: "polygon",
      ignoreEvent: [],
      attrs: {
        coordinates: [
          { x: endX - total, y: yT },
          { x: endX - sellW, y: yT },
          { x: endX - sellW, y: yB },
          { x: endX - total, y: yB },
        ],
      },
      styles: { style: "fill", color: up },
    });
  }

  // 3) Ligne POC (au centre du bin de volume max, sur toute la plage).
  const poc = vp.bins[vp.pocIndex];
  if (poc !== undefined) {
    const yPoc = pixelY(chart, (poc.priceLow + poc.priceHigh) / 2);
    if (yPoc !== null) {
      figures.push({
        type: "line",
        ignoreEvent: [],
        attrs: { coordinates: [{ x: startX, y: yPoc }, { x: endX, y: yPoc }] },
        styles: { style: "solid", size: 2, color: accent },
      });
    }
  }

  // 4) Bornes Value Area : 2 lignes pointillées + labels prix à droite.
  for (const [price, y, label, baseline] of [
    [vp.vaHigh, yVAH, "VAH", "bottom"],
    [vp.vaLow, yVAL, "VAL", "top"],
  ] as const) {
    figures.push({
      type: "line",
      ignoreEvent: [],
      attrs: { coordinates: [{ x: startX, y }, { x: endX, y }] },
      styles: { style: "dashed", size: 1, color: textDim, dashedValue: [2, 3] },
    });
    figures.push({
      type: "text",
      ignoreEvent: true,
      attrs: {
        x: endX + 4,
        y,
        text: `${label} ${price.toFixed(pricePrecision)}`,
        baseline,
        align: "left",
      },
      styles: { color: textDim, size: 9 },
    });
  }

  return figures;
}

// ───────────────────────────── Enregistrement ─────────────────────────────

let registered = false;

/** Enregistre l'overlay VPFR (idempotent). */
export function registerVpfrOverlay(): void {
  if (registered) return;
  registered = true;

  registerOverlay({
    name: VPFR_NAME,
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: buildFigures,
  });
}

// Auto-enregistrement à l'import (comme fibonacci.ts).
registerVpfrOverlay();
