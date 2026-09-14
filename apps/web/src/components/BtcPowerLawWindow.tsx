import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import {
  BTC_GENESIS_MS,
  JOUR_MS,
  bornesLogPrixBtcPowerLaw,
  courbeBtcPowerLaw,
  intervallesBtcPowerLaw,
  logJoursBtc,
  percentileBtcPowerLaw,
  prixTendanceBtcPowerLaw,
  reperesAxeBtcPowerLaw,
  ticksPrixBtcPowerLaw,
  timeDepuisLogJours,
  type GranulariteAxeBtc,
  type ModeleBtcPowerLaw,
  type PointCourbeBtcPowerLaw,
} from "../data/btcPowerLaw";
import type { PointMetrique } from "../data/onchain/coinmetrics";
import { useDomaineZoom } from "../hooks/useDomaineZoom";
import { lireTokenCanvas, POLICE_CANVAS, rgbaTokenCanvas } from "../lib/canvasTokens";
import {
  clampDomaine,
  indicesVisibles,
  pixelVersValeur,
  valeurVersPixel,
  type Domaine,
} from "../lib/domaineAxe";
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
  Input,
  NoteSource,
  SegmenteCompact,
  TuileStat,
  Vide,
} from "./ui";

const PAD_L = 58;
const PAD_R = 14;
const PAD_T = 34;
const PAD_B = 24;

/** Projection maximale offerte par le sélecteur d'horizon et par le zoom arrière. */
export const HORIZON_MAX_ANNEES = 50;
/** Marge d'abscisse (log10 jours) laissée à droite de l'horizon lors du recadrage. */
const MARGE_CADRAGE_LOG = 0.01;
/** Résolution de la courbe du modèle : un point d'échantillonnage tous les N pixels. */
const PIXELS_PAR_POINT_COURBE = 2;

const HORIZONS: ReadonlyArray<{ id: number; label: string }> = [
  { id: 0, label: "Actuel" },
  { id: 1, label: "+1 an" },
  { id: 2, label: "+2 ans" },
  { id: 4, label: "+4 ans" },
  { id: 10, label: "+10 ans" },
  { id: 25, label: "+25 ans" },
  { id: 50, label: "+50 ans" },
];

interface Geometrie {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

interface BornesY {
  yMin: number;
  yMax: number;
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

function ajouterAnneesUtc(time: number, annees: number): number {
  const date = new Date(time);
  date.setUTCFullYear(date.getUTCFullYear() + annees);
  return date.getTime();
}

/** Horizon saisi librement, ramené à un entier d'années dans [0, HORIZON_MAX_ANNEES]. */
export function horizonValide(annees: number): number {
  if (!Number.isFinite(annees)) return 0;
  return Math.min(HORIZON_MAX_ANNEES, Math.max(0, Math.round(annees)));
}

/**
 * Libellé d'un repère d'axe X : « 2013 », « mars 13 » ou « 10/03/13 ». L'année figure aussi
 * au jour près — zoomé sur six semaines, « 10/03 » seul ne dirait pas de quelle année.
 * Fuseau UTC imposé : les repères sont calculés en UTC comme le reste du modèle.
 */
export function libelleAxe(time: number, granularite: GranulariteAxeBtc): string {
  if (granularite === "annee") return String(new Date(time).getUTCFullYear());
  const options: Intl.DateTimeFormatOptions = granularite === "mois"
    ? { month: "short", year: "2-digit" }
    : { day: "2-digit", month: "2-digit", year: "2-digit" };
  return new Date(time).toLocaleDateString("fr-FR", { ...options, timeZone: "UTC" });
}

function xAt(g: Geometrie, domaine: Domaine, time: number): number {
  return g.left + valeurVersPixel(domaine, logJoursBtc(time), g.width);
}

function yAt(g: Geometrie, bornes: BornesY, prix: number): number {
  return g.bottom - ((Math.log10(prix) - bornes.yMin) / (bornes.yMax - bornes.yMin)) * g.height;
}

function pointsValides(points: readonly PointMetrique[]): PointMetrique[] {
  return points
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value) && point.value > 0 && point.time > BTC_GENESIS_MS)
    .sort((a, b) => a.time - b.time);
}

function dessinerBande(
  ctx: CanvasRenderingContext2D,
  g: Geometrie,
  domaine: Domaine,
  bornes: BornesY,
  courbe: readonly PointCourbeBtcPowerLaw[],
  bas: (point: PointCourbeBtcPowerLaw) => number,
  haut: (point: PointCourbeBtcPowerLaw) => number,
  alpha: number,
): void {
  if (courbe.length === 0) return;
  ctx.beginPath();
  courbe.forEach((point, index) => {
    const x = xAt(g, domaine, point.time);
    const y = yAt(g, bornes, haut(point));
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  for (let index = courbe.length - 1; index >= 0; index -= 1) {
    const point = courbe[index];
    if (point !== undefined) ctx.lineTo(xAt(g, domaine, point.time), yAt(g, bornes, bas(point)));
  }
  ctx.closePath();
  ctx.fillStyle = rgbaTokenCanvas("--accent", alpha, "#38bdf8");
  ctx.fill();
}

function dessinerLigne<T extends { time: number }>(
  ctx: CanvasRenderingContext2D,
  g: Geometrie,
  domaine: Domaine,
  bornes: BornesY,
  points: readonly T[],
  valeur: (point: T) => number,
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
    const y = yAt(g, bornes, prix);
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

/**
 * Rendu impératif. `domaine` est la fenêtre visible en log10(jours) (zoom/pan/recadrage) :
 * la courbe du modèle est ré-échantillonnée dessus à chaque dessin et l'axe des prix
 * s'ajuste au seul contenu visible.
 */
function dessiner(
  canvas: HTMLCanvasElement,
  prix: readonly PointMetrique[],
  modele: ModeleBtcPowerLaw,
  domaine: Domaine,
  cibleMs: number,
): void {
  const ctx = canvas.getContext("2d");
  if (ctx === null) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const g = geometrie(width, height);
  if (g.width <= 0 || g.height <= 0) return;
  const courbe = courbeBtcPowerLaw(modele, domaine.min, domaine.max, Math.round(g.width / PIXELS_PAR_POINT_COURBE));
  const { debut, fin } = indicesVisibles(prix, (point) => logJoursBtc(point.time), domaine);
  const prixVisibles = prix.slice(debut, fin + 1);
  const bornes = bornesLogPrixBtcPowerLaw(prixVisibles, courbe);
  if (bornes === null) return;

  const grille = lireTokenCanvas("--grid", "#1f2937");
  const dim = lireTokenCanvas("--text-dim", "#94a3b8");
  const texte = lireTokenCanvas("--text", "#e5e7eb");
  const accent = lireTokenCanvas("--accent", "#38bdf8");
  const warn = lireTokenCanvas("--warn", "#f59e0b");

  ctx.font = POLICE_CANVAS;
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  for (const prixTick of ticksPrixBtcPowerLaw(bornes.yMin, bornes.yMax)) {
    const y = yAt(g, bornes, prixTick);
    ctx.strokeStyle = grille;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(g.left, y);
    ctx.lineTo(g.right, y);
    ctx.stroke();
    ctx.fillStyle = dim;
    ctx.fillText(formatUsd(prixTick), g.left - 5, y);
  }

  // Repères temporels filtrés par un écart pixel minimal : en log10(jours) ils se resserrent
  // vers la droite, donc aucun pas fixe ne convient sur toute la largeur.
  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  const axe = reperesAxeBtcPowerLaw(domaine.min, domaine.max);
  const reperes = axe.times.map((time) => ({ time, label: libelleAxe(time, axe.granularite) }));
  const largeurLabel = reperes.reduce((max, repere) => Math.max(max, ctx.measureText(repere.label).width), 0);
  const espaceMin = largeurLabel + (width < 680 ? 24 : 14);
  let dernierX = -Infinity;
  for (const repere of reperes) {
    const x = xAt(g, domaine, repere.time);
    if (!Number.isFinite(x) || x < g.left || x > g.right || x - dernierX < espaceMin) continue;
    dernierX = x;
    ctx.strokeStyle = grille;
    ctx.beginPath();
    ctx.moveTo(x, g.top);
    ctx.lineTo(x, g.bottom);
    ctx.stroke();
    ctx.fillStyle = dim;
    ctx.fillText(repere.label, x, g.bottom + 5);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(g.left, g.top, g.width, g.height);
  ctx.clip();

  const xProjection = Math.max(g.left, xAt(g, domaine, modele.finMs));
  if (xProjection < g.right) {
    ctx.fillStyle = rgbaTokenCanvas("--warn", 0.035, "#f59e0b");
    ctx.fillRect(xProjection, g.top, g.right - xProjection, g.height);
    ctx.fillStyle = dim;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("extrapolation", Math.min(xProjection + 5, g.right - 72), g.top + 4);
  }

  dessinerBande(ctx, g, domaine, bornes, courbe, (point) => point.q5, (point) => point.q95, 0.06);
  dessinerBande(ctx, g, domaine, bornes, courbe, (point) => point.q10, (point) => point.q90, 0.08);
  dessinerBande(ctx, g, domaine, bornes, courbe, (point) => point.q25, (point) => point.q75, 0.12);
  dessinerLigne(ctx, g, domaine, bornes, courbe, (point) => point.q5, dim, 0.8, true);
  dessinerLigne(ctx, g, domaine, bornes, courbe, (point) => point.q95, dim, 0.8, true);
  dessinerLigne(ctx, g, domaine, bornes, courbe, (point) => point.tendance, accent, 1.6);
  dessinerLigne(ctx, g, domaine, bornes, prixVisibles, (point) => point.value, texte, 1.2);

  const xCible = xAt(g, domaine, cibleMs);
  if (xCible >= g.left && xCible <= g.right) {
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
    ctx.arc(xCible, yAt(g, bornes, prixTendanceBtcPowerLaw(modele, cibleMs)), 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
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
  const [horizon, setHorizon] = useState(0);
  const [survol, setSurvol] = useState<Survol | null>(null);

  useEffect(() => {
    const state = btcPowerLawStore.getState();
    if (!state.enCours && state.modele === null && state.erreur === null) void state.run();
  }, []);

  const prix = useMemo(() => pointsValides(points), [points]);
  const cibleMs = modele === null ? null : ajouterAnneesUtc(modele.finMs, horizon);
  // Bornes de navigation : tout l'historique jusqu'à la projection maximale, quel que soit
  // l'horizon choisi — le zoom arrière atteint donc toujours +50 ans.
  const bornesX = useMemo<Domaine | null>(
    () =>
      modele === null
        ? null
        : {
            min: logJoursBtc(modele.debutMs),
            max: logJoursBtc(ajouterAnneesUtc(modele.finMs, HORIZON_MAX_ANNEES)),
          },
    [modele],
  );
  const { refCanvas, domaine, setDomaine } = useDomaineZoom(bornesX, () => setSurvol(null), {
    gauche: PAD_L,
    droite: PAD_R,
  });

  // Recadre la vue sur un horizon — comme les préréglages de période des autres fenêtres.
  // Appelé DIRECTEMENT par les contrôles et non via un effet sur `horizon` : re-cliquer le
  // preset déjà actif ne changerait pas l'état, et le bouton serait mort après un zoom.
  const recadrerSur = (annees: number): void => {
    setHorizon(annees);
    if (bornesX === null || modele === null) return;
    const cible = logJoursBtc(ajouterAnneesUtc(modele.finMs, annees));
    setDomaine(clampDomaine({ min: bornesX.min, max: cible + MARGE_CADRAGE_LOG }, bornesX));
  };

  // Arrivée (ou rafraîchissement) des données : le hook vient de rendre la vue complète,
  // on la resserre sur l'horizon courant. La navigation manuelle reste libre ensuite.
  useEffect(() => {
    if (bornesX === null || cibleMs === null) return;
    setDomaine(clampDomaine({ min: bornesX.min, max: logJoursBtc(cibleMs) + MARGE_CADRAGE_LOG }, bornesX));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bornesX?.min, bornesX?.max]);

  const intervalles = useMemo(
    () => (modele === null || cibleMs === null ? [] : intervallesBtcPowerLaw(modele, cibleMs)),
    [cibleMs, modele],
  );
  const tendanceCible = modele === null || cibleMs === null
    ? Number.NaN
    : prixTendanceBtcPowerLaw(modele, cibleMs);
  const dernier = prix[prix.length - 1];
  const percentileCourant = modele === null || dernier === undefined
    ? Number.NaN
    : percentileBtcPowerLaw(modele, dernier.time, dernier.value);

  // Le dessin courant vit dans une ref : le ResizeObserver est ainsi attaché une seule fois
  // au lieu d'être recréé à chaque cran de molette (observe() redessine à l'attache).
  const dessinRef = useRef<() => void>(() => {});
  dessinRef.current = (): void => {
    const canvas = refCanvas.current;
    if (canvas === null || modele === null || domaine === null || cibleMs === null) return;
    dessiner(canvas, prix, modele, domaine, cibleMs);
  };

  useEffect(() => {
    dessinRef.current();
  }, [cibleMs, domaine, modele, prix, theme]);

  const canvasMonte = domaine !== null && modele !== null;
  useEffect(() => {
    const canvas = refCanvas.current;
    if (canvas === null) return;
    const observer = new ResizeObserver(() => dessinRef.current());
    observer.observe(canvas);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasMonte]);

  const onMove = (event: React.MouseEvent<HTMLCanvasElement>): void => {
    if (modele === null || domaine === null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const g = geometrie(rect.width, rect.height);
    const mouseX = event.clientX - rect.left;
    if (mouseX < g.left || mouseX > g.right) {
      setSurvol(null);
      return;
    }
    setSurvol({
      time: timeDepuisLogJours(pixelVersValeur(domaine, mouseX - g.left, g.width)),
      xPix: mouseX,
      largeur: rect.width,
    });
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
                <div className="flex flex-wrap items-center gap-2">
                  <SegmenteCompact options={HORIZONS} actif={horizon} onChange={recadrerSur} ariaLabel="Horizon des intervalles" />
                  <label className="flex items-center gap-1 text-[10px] text-text-dim">
                    +
                    <Input
                      type="number"
                      min={0}
                      max={HORIZON_MAX_ANNEES}
                      step={1}
                      value={horizon}
                      onChange={(event) => recadrerSur(horizonValide(Number(event.target.value)))}
                      className="w-12 tabular-nums"
                      aria-label="Horizon personnalisé en années"
                      title={`Horizon libre, 0 à ${HORIZON_MAX_ANNEES} ans`}
                    />
                    ans
                  </label>
                </div>
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
                <span>molette : zoom · glisser : déplacer · double-clic : tout voir</span>
              </div>
              <canvas
                ref={refCanvas}
                onMouseMove={onMove}
                onMouseLeave={() => setSurvol(null)}
                className="h-full w-full cursor-grab active:cursor-grabbing"
              />
              {survol !== null && modele !== null && (
                <InfobulleGraphe
                  xPix={survol.xPix}
                  largeurGraphe={survol.largeur}
                  titre={formatDateComplete(pointSurvole?.time ?? survol.time)}
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
                elles ne sont ni des probabilités prédictives ni des intervalles de confiance. Toute valeur future est une extrapolation,
                d’autant plus spéculative que l’horizon est lointain : au-delà de quelques années elle suppose que le régime de croissance
                observé depuis 2010 se prolonge à l’identique.
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
