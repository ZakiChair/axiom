/**
 * Section « Risque » — canvas de la courbe de P&L rétro-projeté (composition actuelle, 90 j).
 *
 * Rendu PUR sur canvas 2D (patron canvas du repo), non unit-testé. Redessine au changement
 * de thème et au resize.
 */
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { formatUsd } from "../../lib/format";
import { lireTokenCanvas } from "../../lib/canvasTokens";
import { themeStore } from "../../store/theme";

/** Marges partagées du canvas P&L (curseur/tracé cohérents). */
const PNL_PAD_L = 40;
const PNL_PAD_R = 8;

/** Dessine la courbe de P&L rétro-projeté (ligne + zéro pointillé, patron canvas repo). */
function dessinerCourbePnl(canvas: HTMLCanvasElement, points: { t: number; equity: number }[]): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (points.length < 2) return;

  const dim = lireTokenCanvas("--text-dim", "#94a3b8");
  const border = lireTokenCanvas("--border", "#334155");
  const up = lireTokenCanvas("--up", "#22c55e");
  const down = lireTokenCanvas("--down", "#ef4444");
  const police = lireTokenCanvas("--font-display", "monospace");
  ctx.font = `10px ${police}`;

  const top = 8;
  const bottom = 16;
  const plotW = Math.max(1, w - PNL_PAD_L - PNL_PAD_R);
  const plotH = Math.max(1, h - top - bottom);

  const eqs = points.map((p) => p.equity);
  let yMin = Math.min(...eqs, 0);
  let yMax = Math.max(...eqs, 0);
  const span = yMax - yMin || 1;
  const pad = span * 0.1;
  yMin -= pad;
  yMax += pad;
  const yFull = yMax - yMin || 1;
  const n = points.length;
  const xOf = (i: number): number => PNL_PAD_L + (plotW * i) / (n - 1);
  const yOf = (v: number): number => top + plotH - ((v - yMin) / yFull) * plotH;

  // Graduations Y (min / 0 / max) + libellés $.
  ctx.strokeStyle = border;
  ctx.fillStyle = dim;
  for (const v of [yMin + pad, 0, yMax - pad]) {
    const y = yOf(v);
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.moveTo(PNL_PAD_L, y);
    ctx.lineTo(PNL_PAD_L + plotW, y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillText(formatUsd(v), 2, y + 3);
  }

  // Ligne zéro pointillée (base = prix d'entrée théorique).
  ctx.save();
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = dim;
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.moveTo(PNL_PAD_L, yOf(0));
  ctx.lineTo(PNL_PAD_L + plotW, yOf(0));
  ctx.stroke();
  ctx.restore();

  // Courbe de P&L (teinte selon le signe du dernier point).
  ctx.strokeStyle = eqs[n - 1]! >= 0 ? up : down;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = xOf(i);
    const y = yOf(p.equity);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

/** Canvas P&L de la composition actuelle (90 j) — rendu PUR, non unit-testé (pattern repo). */
export function CourbePnl({ points }: { points: { t: number; equity: number }[] }): JSX.Element {
  const theme = useStore(themeStore, (s) => s.theme); // redessine au changement de thème
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const redraw = (): void => dessinerCourbePnl(canvas, points);
    redraw();
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [points, theme]);
  return <canvas ref={ref} className="h-[140px] w-full" aria-hidden="true" />;
}
