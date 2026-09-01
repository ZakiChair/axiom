import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import {
  BTC_GENESIS_MS,
  JOUR_MS,
  intervallesBtcPowerLaw,
  percentileBtcPowerLaw,
  prixQuantileBtcPowerLaw,
  prixTendanceBtcPowerLaw,
  type ModeleBtcPowerLaw,
} from "../data/btcPowerLaw";
import type { PointMetrique } from "../data/onchain/coinmetrics";
import { lireTokenCanvas, POLICE_CANVAS, rgbaTokenCanvas } from "../lib/canvasTokens";
import { formatDateComplete, formatDec, formatEntier, formatUsd, VALEUR_ABSENTE } from "../lib/format";
import { btcPowerLawStore } from "../store/btcPowerLaw";
import { themeStore } from "../store/theme";
import {
  Badge,
  BoutonRafraichir,
  Chargement,
  EnTeteFenetre,
  ErreurBloc,
  Fraicheur,
  InfobulleGraphe,
  NoteSource,
  SegmenteCompact,
  TuileStat,
  Vide,
} from "./ui";

const PAD_L = 58;
const PAD_R = 14;
const PAD_T = 34;
const PAD_B = 24;
const PAS_MODELE_JOURS = 14;
const HORIZON_MAX = 4;

type Horizon = 0 | 1 | 2 | 4;

const HORIZONS: ReadonlyArray<{ id: Horizon; label: string }> = [
  { id: 0, label: "Actuel" },
  { id: 1, label: "+1 an" },
  { id: 2, label: "+2 ans" },
  { id: 4, label: "+4 ans" },
];

interface Geometrie {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

interface Domaine {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

interface PointModele {
  time: number;
  tendance: number;
  q5: number;
  q10: number;
  q25: number;
  q75: number;
  q90: number;
  q95: number;
}

interface Survol {
  time: number;
  xPix: number;
  largeur: number;
}

function geometrie(width: number, height: number): Geometrie {
  return {
    left: PAD_L,
    right: width - PAD_R,
    top: PAD_T,
    bottom: height - PAD_B,
    width: width - PAD_L - PAD_R,
    height: height - PAD_T - PAD_B,
  };
}

function ajouterAnneesUtc(time: number, annees: Horizon | typeof HORIZON_MAX): number {
  const date = new Date(time);
  date.setUTCFullYear(date.getUTCFullYear() + annees);
  return date.getTime();
}

function logJours(time: number): number {
  return Math.log10((time - BTC_GENESIS_MS) / JOUR_MS);
}

function xAt(g: Geometrie, domaine: Domaine, time: number): number {
  return g.left + ((logJours(time) - domaine.xMin) / (domaine.xMax - domaine.xMin)) * g.width;
}

function yAt(g: Geometrie, domaine: Domaine, prix: number): number {
  return g.bottom - ((Math.log10(prix) - domaine.yMin) / (domaine.yMax - domaine.yMin)) * g.height;
}

function timeAt(g: Geometrie, domaine: Domaine, x: number): number {
  const ratio = Math.max(0, Math.min(1, (x - g.left) / g.width));
  return BTC_GENESIS_MS + 10 ** (domaine.xMin + ratio * (domaine.xMax - domaine.xMin)) * JOUR_MS;
}

function pointsValides(points: readonly PointMetrique[]): PointMetrique[] {
  return points
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value) && point.value > 0 && point.time > BTC_GENESIS_MS)
    .sort((a, b) => a.time - b.time);
}

function construireCourbe(modele: ModeleBtcPowerLaw, finMs: number): PointModele[] {
  const points: PointModele[] = [];
  const pas = PAS_MODELE_JOURS * JOUR_MS;
  for (let time = modele.debutMs; time <= finMs; time += pas) {
    points.push({
      time,
      tendance: prixTendanceBtcPowerLaw(modele, time),
      q5: prixQuantileBtcPowerLaw(modele, time, 5),
      q10: prixQuantileBtcPowerLaw(modele, time, 10),
      q25: prixQuantileBtcPowerLaw(modele, time, 25),
      q75: prixQuantileBtcPowerLaw(modele, time, 75),
      q90: prixQuantileBtcPowerLaw(modele, time, 90),
      q95: prixQuantileBtcPowerLaw(modele, time, 95),
    });
  }
  const dernier = points[points.length - 1];
  if (dernier === undefined || dernier.time < finMs) {
    points.push({
      time: finMs,
      tendance: prixTendanceBtcPowerLaw(modele, finMs),
      q5: prixQuantileBtcPowerLaw(modele, finMs, 5),
      q10: prixQuantileBtcPowerLaw(modele, finMs, 10),
      q25: prixQuantileBtcPowerLaw(modele, finMs, 25),
      q75: prixQuantileBtcPowerLaw(modele, finMs, 75),
      q90: prixQuantileBtcPowerLaw(modele, finMs, 90),
      q95: prixQuantileBtcPowerLaw(modele, finMs, 95),
    });
  }
  return points;
}

function domaineDuGraphe(prix: readonly PointMetrique[], courbe: readonly PointModele[]): Domaine {
  const premierModele = courbe[0];
  const dernierModele = courbe[courbe.length - 1];
  if (premierModele === undefined || dernierModele === undefined) {
    return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
  }
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const point of prix) {
    const y = Math.log10(point.value);
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  for (const point of courbe) {
    const bas = Math.log10(point.q5);
    const haut = Math.log10(point.q95);
    if (bas < yMin) yMin = bas;
    if (haut > yMax) yMax = haut;
  }
  const marge = (yMax - yMin) * 0.05 || 0.1;
  return {
    xMin: logJours(premierModele.time),
    xMax: logJours(dernierModele.time),
    yMin: yMin - marge,
    yMax: yMax + marge,
  };
}

function dessinerBande(
  ctx: CanvasRenderingContext2D,
  g: Geometrie,
  domaine: Domaine,
  courbe: readonly PointModele[],
  bas: (point: PointModele) => number,
  haut: (point: PointModele) => number,
  alpha: number,
): void {
  if (courbe.length === 0) return;
  ctx.beginPath();
  courbe.forEach((point, index) => {
    const x = xAt(g, domaine, point.time);
    const y = yAt(g, domaine, haut(point));
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  for (let index = courbe.length - 1; index >= 0; index -= 1) {
    const point = courbe[index];
    if (point !== undefined) ctx.lineTo(xAt(g, domaine, point.time), yAt(g, domaine, bas(point)));
  }
  ctx.closePath();
  ctx.fillStyle = rgbaTokenCanvas("--accent", alpha, "#38bdf8");
  ctx.fill();
}

function dessinerLigne(
  ctx: CanvasRenderingContext2D,
  g: Geometrie,
  domaine: Domaine,
  points: readonly { time: number }[],
  valeur: (point: { time: number }) => number,
  couleur: string,
  largeur: number,
  pointille = false,
): void {
  ctx.save();
  ctx.strokeStyle = couleur;
  ctx.lineWidth = largeur;
  if (pointille) ctx.setLineDash([4, 4]);
  ctx.beginPath();
  let trace = false;
  for (const point of points) {
    const prix = valeur(point);
    if (!(prix > 0) || !Number.isFinite(prix)) continue;
    const x = xAt(g, domaine, point.time);
    const y = yAt(g, domaine, prix);
    if (!trace) {
      ctx.moveTo(x, y);
      trace = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  if (trace) ctx.stroke();
  ctx.restore();
}

function dessiner(
  canvas: HTMLCanvasElement,
  prix: readonly PointMetrique[],
  modele: ModeleBtcPowerLaw,
  courbe: readonly PointModele[],
  cibleMs: number,
): void {
  const ctx = canvas.getContext("2d");
  if (ctx === null) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0 || prix.length === 0 || courbe.length === 0) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const g = geometrie(width, height);
  const domaine = domaineDuGraphe(prix, courbe);
  const grille = lireTokenCanvas("--grid", "#1f2937");
  const dim = lireTokenCanvas("--text-dim", "#94a3b8");
  const texte = lireTokenCanvas("--text", "#e5e7eb");
  const accent = lireTokenCanvas("--accent", "#38bdf8");
  const warn = lireTokenCanvas("--warn", "#f59e0b");

  ctx.font = POLICE_CANVAS;
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  for (let exposant = Math.ceil(domaine.yMin); exposant <= Math.floor(domaine.yMax); exposant += 1) {
    const prixTick = 10 ** exposant;
    const y = yAt(g, domaine, prixTick);
    ctx.strokeStyle = grille;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(g.left, y);
    ctx.lineTo(g.right, y);
    ctx.stroke();
    ctx.fillStyle = dim;
    ctx.fillText(formatUsd(prixTick), g.left - 5, y);
  }

  const debutAnnee = new Date(modele.debutMs).getUTCFullYear();
  const finAnnee = new Date(courbe[courbe.length - 1]!.time).getUTCFullYear();
  const pasAnnees = width < 680 ? 4 : 2;
  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  for (let annee = Math.ceil(debutAnnee / pasAnnees) * pasAnnees; annee <= finAnnee; annee += pasAnnees) {
    const time = Date.UTC(annee, 0, 1);
    if (time < modele.debutMs) continue;
    const x = xAt(g, domaine, time);
    ctx.strokeStyle = grille;
    ctx.beginPath();
    ctx.moveTo(x, g.top);
    ctx.lineTo(x, g.bottom);
    ctx.stroke();
    ctx.fillStyle = dim;
    ctx.fillText(String(annee), x, g.bottom + 5);
  }

  const xProjection = xAt(g, domaine, modele.finMs);
  ctx.fillStyle = rgbaTokenCanvas("--warn", 0.035, "#f59e0b");
  ctx.fillRect(xProjection, g.top, Math.max(0, g.right - xProjection), g.height);
  ctx.fillStyle = dim;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("extrapolation", Math.min(xProjection + 5, g.right - 72), g.top + 4);

  dessinerBande(ctx, g, domaine, courbe, (point) => point.q5, (point) => point.q95, 0.06);
  dessinerBande(ctx, g, domaine, courbe, (point) => point.q10, (point) => point.q90, 0.08);
  dessinerBande(ctx, g, domaine, courbe, (point) => point.q25, (point) => point.q75, 0.12);
  dessinerLigne(ctx, g, domaine, courbe, (point) => (point as PointModele).q5, dim, 0.8, true);
  dessinerLigne(ctx, g, domaine, courbe, (point) => (point as PointModele).q95, dim, 0.8, true);
  dessinerLigne(ctx, g, domaine, courbe, (point) => (point as PointModele).tendance, accent, 1.6);
  dessinerLigne(ctx, g, domaine, prix, (point) => (point as PointMetrique).value, texte, 1.2);

  const xCible = xAt(g, domaine, cibleMs);
  const yCible = yAt(g, domaine, prixTendanceBtcPowerLaw(modele, cibleMs));
  ctx.save();
  ctx.strokeStyle = warn;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(xCible, g.top);
  ctx.lineTo(xCible, g.bottom);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = warn;
  ctx.beginPath();
  ctx.arc(xCible, yCible, 3, 0, Math.PI * 2);
  ctx.fill();
}

function pointProche(points: readonly PointMetrique[], time: number): PointMetrique | null {
  if (points.length === 0) return null;
  let bas = 0;
  let haut = points.length - 1;
  while (bas < haut) {
    const milieu = Math.floor((bas + haut) / 2);
    const point = points[milieu];
    if (point !== undefined && point.time < time) bas = milieu + 1;
    else haut = milieu;
  }
  const apres = points[bas];
  const avant = bas > 0 ? points[bas - 1] : undefined;
  if (apres === undefined) return avant ?? null;
  if (avant === undefined) return apres;
  return Math.abs(avant.time - time) <= Math.abs(apres.time - time) ? avant : apres;
}

export function BtcPowerLawWindow() {
  const enCours = useStore(btcPowerLawStore, (state) => state.enCours);
  const points = useStore(btcPowerLawStore, (state) => state.points);
  const modele = useStore(btcPowerLawStore, (state) => state.modele);
  const erreur = useStore(btcPowerLawStore, (state) => state.erreur);
  const majTs = useStore(btcPowerLawStore, (state) => state.majTs);
  const perime = useStore(btcPowerLawStore, (state) => state.perime);
  const theme = useStore(themeStore, (state) => state.theme);
  const [horizon, setHorizon] = useState<Horizon>(0);
  const [survol, setSurvol] = useState<Survol | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const state = btcPowerLawStore.getState();
    if (!state.enCours && state.modele === null && state.erreur === null) void state.run();
  }, []);

  const prix = useMemo(() => pointsValides(points), [points]);
  const finProjection = modele === null ? null : ajouterAnneesUtc(modele.finMs, HORIZON_MAX);
  const courbe = useMemo(
    () => modele === null || finProjection === null ? [] : construireCourbe(modele, finProjection),
    [finProjection, modele],
  );
  const cibleMs = modele === null ? null : ajouterAnneesUtc(modele.finMs, horizon);
  const intervalles = useMemo(
    () => modele === null || cibleMs === null ? [] : intervallesBtcPowerLaw(modele, cibleMs),
    [cibleMs, modele],
  );
  const tendanceCible = modele === null || cibleMs === null
    ? Number.NaN
    : prixTendanceBtcPowerLaw(modele, cibleMs);
  const dernier = prix[prix.length - 1];
  const percentileCourant = modele === null || dernier === undefined
    ? Number.NaN
    : percentileBtcPowerLaw(modele, dernier.time, dernier.value);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || modele === null || cibleMs === null || prix.length === 0 || courbe.length === 0) return;
    const redraw = (): void => dessiner(canvas, prix, modele, courbe, cibleMs);
    redraw();
    const observer = new ResizeObserver(redraw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [cibleMs, courbe, modele, prix, theme]);

  const onMove = (event: React.MouseEvent<HTMLCanvasElement>): void => {
    if (modele === null || courbe.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const g = geometrie(rect.width, rect.height);
    const mouseX = event.clientX - rect.left;
    if (mouseX < g.left || mouseX > g.right) {
      setSurvol(null);
      return;
    }
    const domaine = domaineDuGraphe(prix, courbe);
    setSurvol({ time: timeAt(g, domaine, mouseX), xPix: mouseX, largeur: rect.width });
  };

  const pointSurvole = survol === null || modele === null || survol.time > modele.finMs + JOUR_MS
    ? null
    : pointProche(prix, survol.time);
  const intervallesSurvol = survol === null || modele === null
    ? []
    : intervallesBtcPowerLaw(modele, survol.time);

  return (
    <>
      <EnTeteFenetre
        mnemo="BPL"
        titre="Bitcoin Power Law"
        sousTitre="Régression log-log · bandes de fréquence historique"
        actions={<BoutonRafraichir onClick={() => void btcPowerLawStore.getState().run(true)} disabled={enCours} />}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        {erreur !== null && modele === null ? (
          <ErreurBloc>{erreur}</ErreurBloc>
        ) : enCours && modele === null ? (
          <Chargement libelle="Ajustement sur l’historique quotidien BTC…" />
        ) : modele === null || dernier === undefined ? (
          <Vide>Aucun historique exploitable. Réessayez avec Rafraîchir.</Vide>
        ) : (
          <>
            {erreur !== null && (
              <div className="rounded border border-down/40 bg-surface px-2 py-1 text-[10px] text-down">
                {erreur}
              </div>
            )}

            <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
              <TuileStat label="Dernier prix daily" valeur={formatUsd(dernier.value)} pied={formatDateComplete(dernier.time)} />
              <TuileStat label="Tendance OLS actuelle" valeur={formatUsd(prixTendanceBtcPowerLaw(modele, dernier.time))} />
              <TuileStat
                label="Percentile historique"
                valeur={Number.isFinite(percentileCourant) ? `p${formatEntier(percentileCourant)}` : VALEUR_ABSENTE}
                pied={`${formatEntier(modele.n)} observations`}
              />
              <TuileStat
                label="Ajustement log-log"
                valeur={`β ${formatDec(modele.pente, 3)}`}
                pied={`R² ${formatDec(modele.r2, 3)}`}
              />
            </div>

            <div className="shrink-0 rounded-md border border-border bg-bg p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] font-medium text-text">Intervalles au {formatDateComplete(cibleMs ?? modele.finMs)}</div>
                  <div className="text-[10px] text-text-dim">
                    Tendance mécanique {formatUsd(tendanceCible)} · quantiles des résidus historiques
                  </div>
                </div>
                <SegmenteCompact options={HORIZONS} actif={horizon} onChange={setHorizon} ariaLabel="Horizon des intervalles" />
              </div>
              <div className="overflow-hidden rounded border border-border text-[11px]">
                <div className="grid grid-cols-[1fr_1.5fr_0.8fr] bg-surface px-2 py-1 text-[10px] uppercase tracking-wide text-text-dim">
                  <span>Présence hist.</span>
                  <span>Intervalle de prix</span>
                  <span className="text-right">Quantiles</span>
                </div>
                {intervalles.map((intervalle) => (
                  <div key={intervalle.couverture} className="grid grid-cols-[1fr_1.5fr_0.8fr] border-t border-border px-2 py-1.5 tabular-nums">
                    <span>{intervalle.couverture} %</span>
                    <span>{formatUsd(intervalle.bas)} – {formatUsd(intervalle.haut)}</span>
                    <span className="text-right text-text-dim">Q{intervalle.quantileBas}–Q{intervalle.quantileHaut}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative min-h-[230px] flex-1 rounded-md border border-border bg-bg">
              <div className="pointer-events-none absolute left-2 top-1 z-10 flex flex-wrap gap-x-3 text-[9px] text-text-dim">
                <span><span className="text-text">━</span> prix BTC</span>
                <span><span className="text-accent">━</span> tendance OLS</span>
                <span>bandes 50 / 80 / 90 %</span>
              </div>
              <canvas
                ref={canvasRef}
                onMouseMove={onMove}
                onMouseLeave={() => setSurvol(null)}
                className="h-full w-full"
              />
              {survol !== null && modele !== null && (
                <InfobulleGraphe
                  xPix={survol.xPix}
                  largeurGraphe={survol.largeur}
                  titre={formatDateComplete(survol.time)}
                  lignes={[
                    { label: "BTC", valeur: pointSurvole === null ? VALEUR_ABSENTE : formatUsd(pointSurvole.value) },
                    { label: "Tendance", valeur: formatUsd(prixTendanceBtcPowerLaw(modele, survol.time)), couleur: lireTokenCanvas("--accent", "#38bdf8") },
                    ...intervallesSurvol.map((intervalle) => ({
                      label: `${intervalle.couverture} % hist.`,
                      valeur: `${formatUsd(intervalle.bas)} – ${formatUsd(intervalle.haut)}`,
                    })),
                  ]}
                />
              )}
            </div>

            <div className="flex shrink-0 items-start justify-between gap-3">
              <NoteSource>
                Coin Metrics · PriceUSD daily depuis 2010. Les bandes mesurent la fréquence historique des résidus autour du modèle ;
                elles ne sont ni des probabilités prédictives ni des intervalles de confiance. Toute valeur future est une extrapolation.
              </NoteSource>
              <div className="flex shrink-0 items-center gap-2 text-[10px] text-text-dim">
                {perime && <Badge ton="warn">cache périmé</Badge>}
                <Fraicheur loading={enCours} majTs={majTs} cadence="1 j" cadenceMs={24 * 60 * 60 * 1000} />
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
