/**
 * Fenêtre « NETLIQ » — Liquidité nette de la Fed : WALCL − TGA − RRP sur ~2 ans
 * (séries FRED quotidiennes/hebdo forward-fillées, cf. data/netliq.ts). Niveau de
 * réserves nettes du système : sa PENTE est le signal (impulsion/retrait de liquidité).
 *
 * Présentation PURE (patron CbpremWindow) : l'état de données vit dans `netliqStore`
 * (vanilla) ; seul le survol est local à React. Tracé canvas en CSS px sous
 * `setTransform(dpr,…)`, ResizeObserver pour la réactivité, couleurs par tokens lus AU
 * DESSIN (thème courant). La géométrie (paddings, projection index→x, valeur→y) est
 * PARTAGÉE entre le dessin et le hit-testing du survol — mêmes littéraux de part et
 * d'autre (leçon HEATMAP) : sans ça le trait du curseur ne coïnciderait pas avec le point.
 *
 * DIVERGENCE assumée vs CBPREM (dont le premium oscille autour de 0) : la liquidité nette
 * est un NIVEAU élevé (~5 800 Md$) qui varie de quelques centaines. Le domaine vertical
 * est donc calé sur les EXTRÊMES de la série (jamais forcé à contenir 0, sinon la courbe
 * s'écrase en haut du cadre) et il n'y a pas de remplissage bicolore up/down : juste une
 * courbe accent et deux repères min/max 2 ans en pointillés. Le teinté up/down ne concerne
 * QUE le badge de delta 4 semaines.
 */
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { netliqStore } from "../store/netliq";
import type { PointNetliq } from "../data/netliq";
import { lireTokenCanvas, rgbaTokenCanvas } from "../lib/canvasTokens";
import { formatDateCourte, formatEntier, VALEUR_ABSENTE } from "../lib/format";
import {
  Badge,
  Chargement,
  EnTeteFenetre,
  ErreurBloc,
  Fraicheur,
  InfobulleGraphe,
  NoteSource,
  Vide,
  type TonBadge,
} from "./ui";

// ─────────────────────────── Formatage Md$ (milliards de dollars) ───────────────────────────

/** Niveau en milliards de dollars : « 5 814 Md$ » (groupement fr-FR, cf. formatEntier). */
function formatMd(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return VALEUR_ABSENTE;
  return `${formatEntier(v)} Md$`;
}

/** Variation en Md$ avec signe explicite (+ / − U+2212), convention monétaire du repo. */
function formatMdSigne(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return VALEUR_ABSENTE;
  const signe = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${signe}${formatEntier(Math.abs(v))} Md$`;
}

/** Ton du badge « delta 4 semaines » : up si liquidité en hausse, down si baisse, neutre sinon. */
function tonDelta(delta: number | null): TonBadge {
  if (delta === null || !Number.isFinite(delta) || delta === 0) return "neutre";
  return delta > 0 ? "up" : "down";
}

// ─────────────────────────── Géométrie de tracé (partagée dessin / survol) ───────────────────────────

/** Marges intérieures du canvas (px CSS). Droite élargie : étiquettes min/max des repères. */
const PAD_L = 12;
const PAD_R = 56;
const PAD_T = 14;
const PAD_B = 20;
/** Nombre cible d'étiquettes X (sous-échantillonnage temporel). */
const CIBLE_LABELS_X = 6;

interface Geometrie {
  left: number;
  right: number;
  top: number;
  bottom: number;
  plotW: number;
  plotH: number;
}

/** Cadre de tracé en px CSS — LES MÊMES littéraux de padding servent au dessin ET au survol. */
function geometrie(w: number, h: number): Geometrie {
  const left = PAD_L;
  const top = PAD_T;
  const right = w - PAD_R;
  const bottom = h - PAD_B;
  return { left, top, right, bottom, plotW: right - left, plotH: bottom - top };
}

/** Abscisse du point d'indice `i` (espacement régulier ; point unique centré). */
function xAt(g: Geometrie, i: number, n: number): number {
  return n <= 1 ? g.left + g.plotW / 2 : g.left + (i * g.plotW) / (n - 1);
}

/** Indice du point le plus proche d'une abscisse `mx` (px CSS), borné à [0, n-1]. */
function indexDepuisX(g: Geometrie, mx: number, n: number): number {
  if (n <= 1) return 0;
  const step = g.plotW / (n - 1);
  const i = Math.round((mx - g.left) / step);
  return Math.max(0, Math.min(n - 1, i));
}

interface DomaineY {
  /** Bornes du cadre (extrêmes de la série + marge de respiration). */
  vMin: number;
  vMax: number;
  /** Extrêmes RÉELS de la série (repères min/max 2 ans, sans la marge). */
  minData: number;
  maxData: number;
}

/**
 * Domaine vertical calé sur les EXTRÊMES de la série (NIVEAU élevé, jamais forcé à
 * contenir 0), plus une marge de respiration de 12 %. `minData`/`maxData` sont les
 * extrêmes bruts (positions des deux repères pointillés).
 */
function domaineY(serie: readonly PointNetliq[]): DomaineY {
  let minData = Infinity;
  let maxData = -Infinity;
  for (const p of serie) {
    if (p.netliq < minData) minData = p.netliq;
    if (p.netliq > maxData) maxData = p.netliq;
  }
  const marge = (maxData - minData) * 0.12 || 1;
  return { vMin: minData - marge, vMax: maxData + marge, minData, maxData };
}

/** Ordonnée d'une valeur de liquidité. */
function yAt(g: Geometrie, v: number, dom: DomaineY): number {
  return g.bottom - ((v - dom.vMin) / (dom.vMax - dom.vMin)) * g.plotH;
}

// ─────────────────────────── Dessin ───────────────────────────

function dessiner(canvas: HTMLCanvasElement, serie: readonly PointNetliq[]): void {
  const ctx = canvas.getContext("2d");
  if (ctx === null) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const n = serie.length;
  if (n === 0) return;

  // Tokens lus au dessin (suit le thème courant).
  const dim = lireTokenCanvas("--text-dim", "#94a3b8");
  const accent = lireTokenCanvas("--accent", "#38bdf8");

  const g = geometrie(w, h);
  const dom = domaineY(serie);

  ctx.font = "9px ui-sans-serif, system-ui, sans-serif";

  // Aire discrète sous la courbe jusqu'au plancher du cadre (accent très léger).
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(xAt(g, 0, n), g.bottom);
  serie.forEach((p, i) => ctx.lineTo(xAt(g, i, n), yAt(g, p.netliq, dom)));
  ctx.lineTo(xAt(g, n - 1, n), g.bottom);
  ctx.closePath();
  ctx.fillStyle = rgbaTokenCanvas("--accent", 0.1, "#38bdf8");
  ctx.fill();
  ctx.restore();

  // Repères min/max 2 ans : lignes pointillées discrètes + étiquettes à droite.
  const repere = (valeur: number, prefixe: string, dessous: boolean): void => {
    const y = yAt(g, valeur, dom);
    ctx.save();
    ctx.strokeStyle = dim;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(g.left, y);
    ctx.lineTo(g.right, y);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = dim;
    ctx.textAlign = "left";
    ctx.textBaseline = dessous ? "top" : "bottom";
    ctx.fillText(`${prefixe} ${formatEntier(valeur)}`, g.right + 3, dessous ? y + 2 : y - 2);
  };
  repere(dom.maxData, "max", false);
  repere(dom.minData, "min", true);

  // Courbe de liquidité nette.
  ctx.beginPath();
  serie.forEach((p, i) => {
    const x = xAt(g, i, n);
    const y = yAt(g, p.netliq, dom);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // Étiquettes X : dates sous-échantillonnées (~CIBLE_LABELS_X points régulièrement espacés).
  ctx.fillStyle = dim;
  ctx.textBaseline = "top";
  const pas = Math.max(1, Math.ceil(n / CIBLE_LABELS_X));
  for (let i = 0; i < n; i += pas) {
    const p = serie[i];
    if (p === undefined) continue;
    const x = xAt(g, i, n);
    ctx.textAlign = i === 0 ? "left" : "center";
    ctx.fillText(formatDateCourte(Date.parse(p.date)), x, g.bottom + 5);
  }
}

// ─────────────────────────── Composant ───────────────────────────

interface Survol {
  xPix: number;
  largeur: number;
  point: PointNetliq;
}

export function NetliqWindow() {
  const enCours = useStore(netliqStore, (s) => s.enCours);
  const serie = useStore(netliqStore, (s) => s.serie);
  const stats = useStore(netliqStore, (s) => s.stats);
  const erreur = useStore(netliqStore, (s) => s.erreur);
  const majTs = useStore(netliqStore, (s) => s.majTs);

  const [survol, setSurvol] = useState<Survol | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Run auto au PREMIER open (FloatingWindow ne monte l'enfant que si ouvert). La garde
  // `majTs === null` (aucun run terminé) + `!enCours` + pas d'erreur évite un double run —
  // StrictMode-safe : `run()` pose `enCours:true` de façon synchrone avant son premier await,
  // donc le second montage voit `enCours` vrai et n'entre pas.
  useEffect(() => {
    const s = netliqStore.getState();
    if (!s.enCours && s.majTs === null && s.erreur === null) void s.run();
  }, []);

  // Dessin — redessine sur nouvelle série et au redimensionnement.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || serie.length === 0) return;
    const redraw = (): void => dessiner(canvas, serie);
    redraw();
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [serie]);

  // Survol : indice le plus proche → trait + infobulle (mêmes paddings que le dessin).
  const onMove = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    if (serie.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const g = geometrie(rect.width, rect.height);
    const mx = e.clientX - rect.left;
    if (mx < g.left || mx > g.right) {
      setSurvol(null);
      return;
    }
    const idx = indexDepuisX(g, mx, serie.length);
    const point = serie[idx];
    if (point === undefined) {
      setSurvol(null);
      return;
    }
    setSurvol({ xPix: xAt(g, idx, serie.length), largeur: rect.width, point });
  };

  const onLeave = (): void => setSurvol(null);

  const rafraichir = (): void => {
    void netliqStore.getState().run(true);
  };

  const courant = stats?.courant ?? null;
  const delta4s = stats?.delta4s ?? null;

  return (
    <>
      <EnTeteFenetre
        mnemo="NETLIQ"
        titre="Liquidité nette Fed"
        sousTitre="WALCL − TGA − RRP · réserves nettes du système sur 2 ans"
        actions={
          <button
            type="button"
            onClick={rafraichir}
            disabled={enCours}
            className="rounded border border-border bg-bg px-2 py-1 text-[11px] text-text-dim transition hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            ↻ Rafraîchir
          </button>
        }
      />

      {/* Bandeau de synthèse : liquidité courante (Md$), delta 4 semaines teinté. */}
      <div className="flex shrink-0 items-center gap-4 border-b border-border px-4 py-2 text-[11px]">
        <span className="flex items-center gap-1.5">
          <span className="text-text-dim">Liquidité nette</span>
          <Badge ton="accent">{formatMd(courant)}</Badge>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-text-dim">Δ 4 sem</span>
          <Badge ton={tonDelta(delta4s)}>{formatMdSigne(delta4s)}</Badge>
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-4 py-4">
        {erreur !== null && serie.length === 0 ? (
          <ErreurBloc>{erreur}</ErreurBloc>
        ) : enCours && serie.length === 0 ? (
          <Chargement libelle="Collecte des séries FRED (WALCL / TGA / RRP)…" />
        ) : serie.length === 0 ? (
          <Vide>Aucune série de liquidité exploitable. Réessayez avec Rafraîchir.</Vide>
        ) : (
          <div className="relative min-h-0 flex-1">
            {/* Refresh non destructif : une courbe valide n'est jamais remplacée par un bloc
                d'erreur ; en cas d'échec du retry, seul un bandeau discret le signale. */}
            {erreur !== null && (
              <div className="pointer-events-none absolute inset-x-0 top-0 z-20 rounded border border-down/40 bg-surface/90 px-2 py-1 text-[10px] text-down">
                {erreur}
              </div>
            )}
            <canvas
              ref={canvasRef}
              onMouseMove={onMove}
              onMouseLeave={onLeave}
              className="h-full w-full"
            />
            {survol && (
              <InfobulleGraphe
                xPix={survol.xPix}
                largeurGraphe={survol.largeur}
                titre={formatDateCourte(Date.parse(survol.point.date))}
                lignes={[
                  {
                    label: "Liquidité nette",
                    valeur: formatMd(survol.point.netliq),
                    couleur: lireTokenCanvas("--accent", "#38bdf8"),
                  },
                ]}
              />
            )}
          </div>
        )}

        <div className="mt-3 flex items-center justify-between">
          <NoteSource>FRED · WALCL − TGA − RRP · quotidien</NoteSource>
          <Fraicheur loading={enCours} majTs={majTs} />
        </div>
      </div>
    </>
  );
}
