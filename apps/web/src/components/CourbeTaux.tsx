/**
 * CourbeTaux — courbe des taux réelle (canvas), US (accent) superposée à la zone euro
 * (couleur secondaire). X = maturité convertie en années via `anneesDeMaturite`
 * (`courbeTaux.util.ts`, testée séparément), Y = taux en %. Composant de rendu PUR,
 * NON unit-testé (pattern `Sparkline`/`SeasonalityWindow` : les canvas React sont
 * vérifiés manuellement). Couleurs via `lireTokenCanvas` — jamais de couleur en dur.
 */
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { themeStore } from "../store/theme";
import { lireTokenCanvas } from "../lib/canvasTokens";
import { Vide } from "./ui";

/** Un point de la courbe, déjà projeté en années par l'appelant (`MacroRatesWindow`). */
export interface PointCourbe {
  maturite: string;
  anneesTri: number;
  taux: number;
}

function dessinerCourbe(canvas: HTMLCanvasElement, us: PointCourbe[], euro: PointCourbe[]): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const dim = lireTokenCanvas("--text-dim", "#94a3b8");
  const border = lireTokenCanvas("--border", "#334155");
  const accent = lireTokenCanvas("--accent", "#38bdf8");
  // Série secondaire (zone euro) : token de série dédié, pas le token sémantique --up.
  const secondaire = lireTokenCanvas("--serie-2", "#a78bfa");
  ctx.font = "10px var(--font-display, monospace)";

  const tous = [...us, ...euro];
  // Cas < 2 points géré par le composant (état <Vide/> standard), sans texte canvas.
  if (tous.length < 2) return;

  const left = 34;
  const right = 8;
  const top = 16;
  const bottom = 18;
  const plotW = Math.max(1, w - left - right);
  const plotH = Math.max(1, h - top - bottom);

  const xs = tous.map((p) => p.anneesTri);
  const ys = tous.map((p) => p.taux);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;
  const yPad = ySpan * 0.15 || 0.1;
  const yLow = yMin - yPad;
  const yHigh = yMax + yPad;
  const yFullSpan = yHigh - yLow || 1;

  const xOf = (annees: number): number => left + ((annees - xMin) / xSpan) * plotW;
  const yOf = (taux: number): number => top + plotH - ((taux - yLow) / yFullSpan) * plotH;

  // Grille horizontale (taux) + graduations Y.
  ctx.strokeStyle = border;
  ctx.fillStyle = dim;
  const nGrid = 4;
  for (let i = 0; i <= nGrid; i++) {
    const taux = yLow + (yFullSpan * i) / nGrid;
    const y = yOf(taux);
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left + plotW, y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillText(`${taux.toFixed(1)}%`, 2, y + 3);
  }

  const tracer = (points: PointCourbe[], couleur: string): void => {
    if (points.length === 0) return;
    const tries = [...points].sort((a, b) => a.anneesTri - b.anneesTri);
    ctx.beginPath();
    tries.forEach((p, i) => {
      const x = xOf(p.anneesTri);
      const y = yOf(p.taux);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = couleur;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.fillStyle = couleur;
    for (const p of tries) {
      ctx.beginPath();
      ctx.arc(xOf(p.anneesTri), yOf(p.taux), 2, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  tracer(us, accent);
  tracer(euro, secondaire);

  // Étiquettes de maturité en abscisse (dédupliquées, espacées pour éviter le chevauchement).
  ctx.fillStyle = dim;
  ctx.textAlign = "center";
  const parLabel = new Map<string, number>();
  for (const p of tous) parLabel.set(p.maturite, p.anneesTri);
  let dernierX = -Infinity;
  [...parLabel.entries()]
    .sort((a, b) => a[1] - b[1])
    .forEach(([label, annees]) => {
      const x = xOf(annees);
      if (x - dernierX < 24) return;
      dernierX = x;
      ctx.fillText(label, x, h - 4);
    });
  ctx.textAlign = "left";

  // Légende.
  ctx.fillStyle = accent;
  ctx.fillText("● US", left, 10);
  if (euro.length > 0) {
    ctx.fillStyle = secondaire;
    ctx.fillText("● Zone euro", left + 36, 10);
  }
}

export function CourbeTaux({ us, euro }: { us: PointCourbe[]; euro: PointCourbe[] }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = useStore(themeStore, (s) => s.theme); // redessine au changement de thème (cf. MarketMapWindow)

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const redraw = (): void => dessinerCourbe(canvas, us, euro);
    redraw();
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [us, euro, theme]);

  // Moins de 2 points : état « indisponible » standard (cf. Vide) plutôt qu'un texte canvas.
  if (us.length + euro.length < 2) return <Vide>Courbe indisponible (pas assez de points).</Vide>;
  return <canvas ref={ref} className="h-[180px] w-full" aria-hidden="true" />;
}
