/**
 * CourbeTaux — courbe des taux réelle (canvas), N séries superposées (US, zone euro,
 * Japon, Canada, Australie…). X = maturité convertie en années via `anneesDeMaturite`
 * (`courbeTaux.util.ts`, testée séparément — cf. `pointsDeCourbe`), Y = taux en %.
 * Composant de rendu PUR, NON unit-testé (pattern `Sparkline`/`SeasonalityWindow` :
 * les canvas React sont vérifiés manuellement). Couleur PAR SÉRIE via les tokens
 * `--serie-1…6` (`lireTokenCanvas`) — jamais de couleur en dur ; légende générée
 * depuis les libellés des séries non vides.
 */
import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { themeStore } from "../store/theme";
import { lireTokenCanvas } from "../lib/canvasTokens";
import { type Domaine, indicesVisibles, pixelVersValeur, valeurVersPixel } from "../lib/domaineAxe";
import { useDomaineZoom } from "../hooks/useDomaineZoom";
import { formatPourcentage, VALEUR_ABSENTE } from "../lib/format";
import { InfobulleGraphe, Vide } from "./ui";

/** Un point de la courbe, déjà projeté en années par l'appelant (`MacroRatesWindow`). */
export interface PointCourbe {
  maturite: string;
  anneesTri: number;
  taux: number;
}

/** Une série nommée de la courbe (un pays / une zone). */
export interface SerieCourbe {
  /** Libellé de légende (« US », « Zone euro », « Japon »…). */
  label: string;
  /** Points déjà projetés en années (cf. `pointsDeCourbe`). */
  points: PointCourbe[];
  /** Index 1…6 du token de couleur `--serie-N` (palette réinterprétée par thème). */
  couleurTokenIndex: number;
}

// Replis des tokens --serie-1…6 (valeurs du thème par défaut, cf. index.css) — même
// pattern que les replis unitaires passés à `lireTokenCanvas` ailleurs.
const REPLIS_SERIE: readonly string[] = [
  "#38bdf8",
  "#a78bfa",
  "#f59e0b",
  "#f472b6",
  "#22d3ee",
  "#60a5fa",
];

/** Couleur résolue d'une série : token `--serie-N` du thème courant, repli par défaut. */
function couleurSerie(index: number): string {
  const repli = REPLIS_SERIE[index - 1] ?? REPLIS_SERIE[0]!;
  return lireTokenCanvas(`--serie-${index}`, repli);
}

/** Marges horizontales du plot — partagées avec le curseur de survol (même conversion
 * pixel↔maturité que xOf, sinon le trait/tooltip survolé dérive de la courbe tracée). */
const RATE_PAD_L = 34;
const RATE_PAD_R = 8;

function dessinerCourbe(canvas: HTMLCanvasElement, series: SerieCourbe[], domaine: Domaine): void {
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
  const police = lireTokenCanvas("--font-display", "monospace");
  ctx.font = `10px ${police}`;

  const tous = series.flatMap((s) => s.points);
  // Cas < 2 points géré par le composant (état <Vide/> standard), sans texte canvas.
  if (tous.length < 2) return;

  const left = RATE_PAD_L;
  const right = RATE_PAD_R;
  const top = 16;
  const bottom = 18;
  const plotW = Math.max(1, w - left - right);
  const plotH = Math.max(1, h - top - bottom);

  // Sous-ensemble visible dans le domaine (fenêtre de zoom), PAR SÉRIE — triée par anneesTri
  // (contrat indicesVisibles). L'échelle Y ne porte QUE sur ces points visibles, comme les
  // autres graphes du kit (BacktestWindow, VolWindow, OMON, TermStructureWindow…).
  const seriesVisibles = series.map((s) => {
    const tries = [...s.points].sort((a, b) => a.anneesTri - b.anneesTri);
    const { debut, fin } = indicesVisibles(tries, (p) => p.anneesTri, domaine);
    return { ...s, visibles: tries.slice(debut, fin + 1) };
  });
  const ysVisibles = seriesVisibles.flatMap((s) => s.visibles.map((p) => p.taux));
  const yMin = ysVisibles.length > 0 ? Math.min(...ysVisibles) : 0;
  const yMax = ysVisibles.length > 0 ? Math.max(...ysVisibles) : 1;
  const ySpan = yMax - yMin || 1;
  const yPad = ySpan * 0.15 || 0.1;
  const yLow = yMin - yPad;
  const yHigh = yMax + yPad;
  const yFullSpan = yHigh - yLow || 1;

  const xOf = (annees: number): number => left + valeurVersPixel(domaine, annees, plotW);
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
  for (const s of seriesVisibles) tracer(s.visibles, couleurSerie(s.couleurTokenIndex));

  // Étiquettes de maturité en abscisse (points VISIBLES seulement — cohérent avec le zoom),
  // dédupliquées, espacées pour éviter le chevauchement.
  ctx.fillStyle = dim;
  ctx.textAlign = "center";
  const parLabel = new Map<string, number>();
  for (const s of seriesVisibles) for (const p of s.visibles) {
    if (p.anneesTri < domaine.min || p.anneesTri > domaine.max) continue; // labels : domaine strict (les points-tampons servent au tracé, pas à l'axe)
    parLabel.set(p.maturite, p.anneesTri);
  }
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

  // Légende générée : une pastille par série non vide, positionnée au fil de l'eau.
  let legendeX = left;
  for (const s of series) {
    if (s.points.length === 0) continue;
    const texte = `● ${s.label}`;
    ctx.fillStyle = couleurSerie(s.couleurTokenIndex);
    ctx.fillText(texte, legendeX, 10);
    legendeX += ctx.measureText(texte).width + 10;
  }
}

export function CourbeTaux({ series }: { series: SerieCourbe[] }): JSX.Element {
  const theme = useStore(themeStore, (s) => s.theme); // redessine au changement de thème (cf. MarketMapWindow)

  // Bornes de l'axe X (maturités, en années) = min/max de anneesTri sur toutes les séries.
  const bornes = useMemo<Domaine | null>(() => {
    const tous = series.flatMap((s) => s.points);
    if (tous.length === 0) return null;
    let min = Math.min(...tous.map((p) => p.anneesTri));
    let max = Math.max(...tous.map((p) => p.anneesTri));
    if (max === min) max = min + 1;
    return { min, max };
  }, [series]);
  // Curseur (survol) : maturité la plus proche (union des points de toutes les séries).
  // Déclaré avant useDomaineZoom : son setter est référencé par l'onGeste qui vide le
  // survol après un zoom/pan/double-clic (sinon le trait reste figé sur l'ancien point).
  const [survol, setSurvol] = useState<{ xPix: number; largeur: number; maturite: string } | null>(null);
  const { refCanvas, domaine } = useDomaineZoom(bornes, () => setSurvol(null));
  const onSurvol = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (domaine === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const plotW = Math.max(1, rect.width - RATE_PAD_L - RATE_PAD_R);
    const cible = pixelVersValeur(domaine, e.clientX - rect.left - RATE_PAD_L, plotW);
    let point: PointCourbe | null = null;
    let ecart = Number.POSITIVE_INFINITY;
    for (const s of series) {
      for (const p of s.points) {
        const d = Math.abs(p.anneesTri - cible);
        if (d < ecart) {
          ecart = d;
          point = p;
        }
      }
    }
    if (point === null) return;
    setSurvol({
      xPix: RATE_PAD_L + valeurVersPixel(domaine, point.anneesTri, plotW),
      largeur: rect.width,
      maturite: point.maturite,
    });
  };

  useEffect(() => {
    const canvas = refCanvas.current;
    if (!canvas || !domaine) return;
    const redraw = (): void => dessinerCourbe(canvas, series, domaine);
    redraw();
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [series, theme, domaine]);

  // Moins de 2 points : état « indisponible » standard (cf. Vide) plutôt qu'un texte canvas.
  const nbPoints = series.reduce((n, s) => n + s.points.length, 0);
  if (nbPoints < 2) return <Vide>Courbe indisponible (pas assez de points).</Vide>;
  return (
    <div className="relative">
      <canvas
        ref={refCanvas}
        className="h-[180px] w-full"
        aria-hidden="true"
        onMouseMove={onSurvol}
        onMouseLeave={() => setSurvol(null)}
      />
      {survol && (
        <InfobulleGraphe
          xPix={survol.xPix}
          largeurGraphe={survol.largeur}
          titre={survol.maturite}
          lignes={series
            .filter((s) => s.points.length > 0)
            .map((s) => {
              const p = s.points.find((pt) => pt.maturite === survol.maturite);
              return {
                label: s.label,
                valeur: p ? formatPourcentage(p.taux) : VALEUR_ABSENTE,
                couleur: couleurSerie(s.couleurTokenIndex),
              };
            })}
        />
      )}
    </div>
  );
}
