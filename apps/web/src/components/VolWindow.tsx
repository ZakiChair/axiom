/**
 * VOL — fenêtre Volatilité : cône de RV (percentiles historiques par horizon) +
 * comparaison RV30 / DVOL Deribit (IV) sur 1 an + VRP (IV − RV) + z-score RV.
 *
 * Données : 730 bougies daily du symbole suivi (groupe-couleur sinon global) via
 * getAdapter ; IV = historique DVOL Deribit (BTC/ETH uniquement — pour les autres
 * symboles, cône seul + message). Moteurs purs dans lib/volCone.ts (Task 8).
 * Rendu impératif canvas (aucune donnée haute fréquence dans React).
 */
import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { Candle, ExchangeId } from "@axiom/types";
import type { Commande } from "../commands/registry";
import { getAdapter } from "../data/adapters";
import { fetchDvolHistory } from "../data/deribit";
import { lireTokenCanvas } from "../lib/canvasTokens";
import { formatDateComplete, formatDateCourte, formatDec, formatPourcentage, VALEUR_ABSENTE } from "../lib/format";
import { realizedVolSeries, volCone, zScore, type VolConeRow } from "../lib/volCone";
import { marketStore } from "../store/market";
import { mirrorOpenState, windowManagerStore } from "../store/windowManager";
import { BarrePeriodes, Chargement, EnTeteFenetre, ErreurBloc, InfobulleGraphe, Metric, PERIODES_STANDARD } from "./ui";
import {
  domainePourPreset,
  indicesVisibles,
  pixelVersValeur,
  valeurVersPixel,
  type Domaine,
} from "../lib/domaineAxe";
import { useDomaineZoom } from "../hooks/useDomaineZoom";

export interface VolUiState {
  open: boolean;
  openVol: () => void;
  closeVol: () => void;
  toggleVol: () => void;
}

export const volUiStore = createStore<VolUiState>(() => ({
  open: false,
  openVol: () => windowManagerStore.getState().openWindow("vol"),
  closeVol: () => windowManagerStore.getState().closeWindow("vol"),
  toggleVol: () => windowManagerStore.getState().toggleWindow("vol"),
}));

mirrorOpenState("vol", volUiStore);

export const commandes: Commande[] = [
  {
    id: "panneau:vol",
    mnemonique: "VOL",
    libelle: "Volatilité (cône RV, VRP)",
    categorie: "panneau",
    motsCles: ["volatilité", "volatility", "cône", "cone", "rv", "dvol", "vrp", "vol"],
    apercu: "Ouvre / ferme le cône de volatilité réalisée et la comparaison RV/DVOL",
    action: () => volUiStore.getState().toggleVol(),
  },
];

type Statut = "idle" | "loading" | "ready" | "error";

/** Fenêtre RV de référence pour la comparaison IV/RV (jours). */
const RV_WINDOW = 30;
/** Convention d'annualisation daily crypto 24/7. */
const PPA = 365;

/** Devise DVOL Deribit du symbole, ou null (Deribit ne cote que BTC/ETH). */
function deriveDvolCurrency(symbol: string): "BTC" | "ETH" | null {
  if (symbol.startsWith("BTC")) return "BTC";
  if (symbol.startsWith("ETH")) return "ETH";
  return null;
}

interface VolData {
  cone: VolConeRow[];
  /** RV30 daily (%), alignée sur les bougies (null tant que fenêtre incomplète). */
  rv30: (number | null)[];
  /** Timestamps des bougies (même index que rv30). */
  times: number[];
  /** Historique DVOL daily, ou null si IV indisponible. */
  dvol: { time: number; value: number }[] | null;
}

async function fetchVolData(exchange: ExchangeId, symbol: string, signal: AbortSignal): Promise<VolData> {
  const adapter = getAdapter(exchange);
  const devise = deriveDvolCurrency(symbol);
  const [candles, dvol] = await Promise.all([
    adapter.fetchKlines(symbol, "1d", { limit: 1000 }),
    devise === null
      ? Promise.resolve(null)
      : fetchDvolHistory(devise, 365).catch(() => null), // IV en dégradation gracieuse
  ]);
  if (signal.aborted) throw new Error("abandonné");
  const recentes = candles.slice(-730);
  const closes = recentes.map((c: Candle) => c.close);
  return {
    cone: volCone(closes),
    rv30: realizedVolSeries(closes, RV_WINDOW, PPA),
    times: recentes.map((c: Candle) => c.time),
    dvol,
  };
}

// ─────────────────────────── Rendu canvas ───────────────────────────

interface Tokens {
  text: string;
  dim: string;
  up: string;
  down: string;
  accent: string;
  border: string;
}

function lireTokens(): Tokens {
  return {
    text: lireTokenCanvas("--text", "#e5e7eb"),
    dim: lireTokenCanvas("--text-dim", "#94a3b8"),
    up: lireTokenCanvas("--up", "#2dc08e"),
    down: lireTokenCanvas("--down", "#f92855"),
    accent: lireTokenCanvas("--accent", "#38bdf8"),
    border: lireTokenCanvas("--border", "#334155"),
  };
}

/** Cône : X = horizons, bandes p5-p95 / p25-p75, ligne p50, points « current ». */
function drawCone(ctx: CanvasRenderingContext2D, rows: VolConeRow[], x0: number, y0: number, w: number, h: number, tk: Tokens): void {
  const fini = rows.filter((r) => Number.isFinite(r.p5) && Number.isFinite(r.p95));
  if (fini.length === 0) {
    ctx.fillStyle = tk.dim;
    ctx.fillText("Historique insuffisant pour le cône.", x0 + 8, y0 + 20);
    return;
  }
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const r of fini) {
    vMin = Math.min(vMin, r.p5, r.current ?? Infinity);
    vMax = Math.max(vMax, r.p95, r.current ?? -Infinity);
  }
  const marge = (vMax - vMin) * 0.08 || 1;
  vMin -= marge;
  vMax += marge;

  const left = x0 + 34;
  const bottom = y0 + h - 18;
  const plotW = w - 42;
  const plotH = h - 40;
  const xAt = (i: number): number => left + (fini.length === 1 ? plotW / 2 : (i * plotW) / (fini.length - 1));
  const yAt = (v: number): number => bottom - ((v - vMin) / (vMax - vMin)) * plotH;

  // Bandes de percentiles (p5-p95 puis p25-p75, du plus diffus au plus dense).
  const bande = (lo: (r: VolConeRow) => number, hi: (r: VolConeRow) => number, alpha: string): void => {
    ctx.beginPath();
    fini.forEach((r, i) => {
      const x = xAt(i);
      if (i === 0) ctx.moveTo(x, yAt(hi(r)));
      else ctx.lineTo(x, yAt(hi(r)));
    });
    for (let i = fini.length - 1; i >= 0; i--) {
      const r = fini[i];
      if (r !== undefined) ctx.lineTo(xAt(i), yAt(lo(r)));
    }
    ctx.closePath();
    ctx.fillStyle = tk.accent + alpha;
    ctx.fill();
  };
  bande((r) => r.p5, (r) => r.p95, "1f");
  bande((r) => r.p25, (r) => r.p75, "3a");

  // Médiane p50.
  ctx.beginPath();
  fini.forEach((r, i) => {
    const x = xAt(i);
    if (i === 0) ctx.moveTo(x, yAt(r.p50));
    else ctx.lineTo(x, yAt(r.p50));
  });
  ctx.strokeStyle = tk.dim;
  ctx.lineWidth = 1;
  ctx.stroke();

  // RV courante par horizon.
  ctx.fillStyle = tk.accent;
  fini.forEach((r, i) => {
    if (r.current === null) return;
    ctx.beginPath();
    ctx.arc(xAt(i), yAt(r.current), 3, 0, Math.PI * 2);
    ctx.fill();
  });

  // Axes : horizons en X, bornes % en Y.
  ctx.fillStyle = tk.dim;
  fini.forEach((r, i) => ctx.fillText(`${r.horizon}j`, xAt(i) - 8, bottom + 14));
  ctx.fillText(`${vMax.toFixed(0)} %`, x0, y0 + 12);
  ctx.fillText(`${vMin.toFixed(0)} %`, x0, bottom + 4);
}

/** RV30 en série {time, value}, nulls filtrés (window incomplète en tête d'historique). */
function serieRv(data: VolData): { time: number; value: number }[] {
  const rv: { time: number; value: number }[] = [];
  data.times.forEach((t, i) => {
    const v = data.rv30[i];
    if (v !== null && v !== undefined) rv.push({ time: t, value: v });
  });
  return rv;
}

/** Géométrie du panneau séries (moitié droite du canvas, quand IV disponible) — partagée
 *  entre `draw` (rendu) et le survol du composant hôte (conversion pixel↔temps identique). */
function panneauSeries(largeurCanvas: number): { x0: number; w: number } {
  return { x0: largeurCanvas / 2 + 4, w: largeurCanvas / 2 - 8 };
}

/** Séries RV30 et DVOL superposées sur le domaine visible (2 polylignes, échelle commune). */
function drawSeries(
  ctx: CanvasRenderingContext2D,
  data: VolData,
  x0: number,
  y0: number,
  w: number,
  h: number,
  tk: Tokens,
  domaine: Domaine,
): void {
  const rv = serieRv(data);
  const rvIdx = indicesVisibles(rv, (p) => p.time, domaine);
  const rvVis = rv.slice(rvIdx.debut, rvIdx.fin + 1);
  const dvolTous = data.dvol ?? [];
  const dvIdx = indicesVisibles(dvolTous, (p) => p.time, domaine);
  const dvolVis = dvolTous.slice(dvIdx.debut, dvIdx.fin + 1);
  const tout = [...rvVis, ...dvolVis];
  if (tout.length < 2) {
    ctx.fillStyle = tk.dim;
    ctx.fillText("Séries indisponibles.", x0 + 8, y0 + 20);
    return;
  }

  let vMin = Infinity;
  let vMax = -Infinity;
  for (const p of tout) {
    vMin = Math.min(vMin, p.value);
    vMax = Math.max(vMax, p.value);
  }
  const marge = (vMax - vMin) * 0.08 || 1;
  vMin -= marge;
  vMax += marge;

  const left = x0 + 34;
  const bottom = y0 + h - 18;
  const plotW = w - 42;
  const plotH = h - 40;
  const xAt = (t: number): number => left + valeurVersPixel(domaine, t, plotW);
  const yAt = (v: number): number => bottom - ((v - vMin) / (vMax - vMin)) * plotH;

  const ligne = (pts: { time: number; value: number }[], couleur: string): void => {
    if (pts.length < 2) return;
    ctx.beginPath();
    pts.forEach((p, i) => {
      if (i === 0) ctx.moveTo(xAt(p.time), yAt(p.value));
      else ctx.lineTo(xAt(p.time), yAt(p.value));
    });
    ctx.strokeStyle = couleur;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  };
  ligne(rvVis, tk.up);
  ligne(dvolVis, tk.accent);

  ctx.fillStyle = tk.dim;
  ctx.fillText(`${vMax.toFixed(0)} %`, x0, y0 + 12);
  ctx.fillText(`${vMin.toFixed(0)} %`, x0, bottom + 4);
  // Légende.
  ctx.fillStyle = tk.up;
  ctx.fillText(`RV${RV_WINDOW}`, left, y0 + 12);
  if (dvolVis.length > 0) {
    ctx.fillStyle = tk.accent;
    ctx.fillText("DVOL", left + 44, y0 + 12);
  }
  // Repères de dates (bornes du domaine visible).
  ctx.fillStyle = tk.dim;
  ctx.fillText(formatDateCourte(domaine.min), left, bottom + 14);
  const finTxt = formatDateCourte(domaine.max);
  ctx.fillText(finTxt, left + plotW - ctx.measureText(finTxt).width, bottom + 14);
}

function draw(canvas: HTMLCanvasElement, data: VolData, domaine: Domaine): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const tk = lireTokens();
  // Pile monospace unifiée pour les chiffres, cohérente avec les tabular-nums du DOM.
  ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";

  ctx.fillStyle = tk.dim;
  ctx.fillText("CÔNE RV (percentiles 5/25/50/75/95)", 8, 14);
  const avecIv = data.dvol !== null && data.dvol.length > 0;
  if (avecIv) {
    ctx.fillText(`RV${RV_WINDOW} vs DVOL — 1 an`, w / 2 + 8, 14);
    drawCone(ctx, data.cone, 0, 22, w / 2 - 8, h - 26, tk);
    ctx.strokeStyle = tk.border;
    ctx.beginPath();
    ctx.moveTo(w / 2, 8);
    ctx.lineTo(w / 2, h - 8);
    ctx.stroke();
    const sp = panneauSeries(w);
    drawSeries(ctx, data, sp.x0, 22, sp.w, h - 26, tk, domaine);
  } else {
    drawCone(ctx, data.cone, 0, 22, w - 8, h - 26, tk);
  }
}

// ─────────────────────────── Composant ───────────────────────────

/** Dernière valeur non nulle d'une série RV. */
function derniereRv(rv: (number | null)[]): number | null {
  for (let i = rv.length - 1; i >= 0; i--) {
    const v = rv[i];
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

/** Bornes temporelles de l'axe : union des temps RV30 (non nuls) et DVOL. */
function bornesDonnees(data: VolData): Domaine | null {
  const temps = [...serieRv(data).map((p) => p.time), ...(data.dvol ?? []).map((p) => p.time)];
  if (temps.length < 2) return null;
  let min = temps[0]!;
  let max = temps[0]!;
  for (const t of temps) {
    if (t < min) min = t;
    if (t > max) max = t;
  }
  return { min, max };
}

/** Point le plus proche de `t` dans une série {time, value} triée ; null si vide. */
function pointProche(pts: { time: number; value: number }[], t: number): { time: number; value: number } | null {
  if (pts.length === 0) return null;
  let meilleur = pts[0]!;
  for (const p of pts) if (Math.abs(p.time - t) < Math.abs(meilleur.time - t)) meilleur = p;
  return meilleur;
}

/** Infos du point survolé par le curseur du panneau séries (tooltip). */
interface Survol {
  xPix: number;
  largeur: number;
  t: number;
  rv: { time: number; value: number } | null;
  dvol: { time: number; value: number } | null;
}

export function VolWindow() {
  const open = useStore(volUiStore, (s) => s.open);
  const exchange = useStore(marketStore, (s) => s.exchange);
  const symbolGlobal = useStore(marketStore, (s) => s.symbol);
  const groupColor = useStore(windowManagerStore, (s) => s.windows["vol"]?.groupColor ?? null);
  const symbolGroupe = useStore(windowManagerStore, (s) => (groupColor ? s.groupSymbols[groupColor] : undefined));
  const symbol = symbolGroupe ?? symbolGlobal;
  const [statut, setStatut] = useState<Statut>("idle");
  const [data, setData] = useState<VolData | null>(null);

  const avecIv = data !== null && data.dvol !== null && data.dvol.length > 0;
  const bornes = useMemo<Domaine | null>(() => (data !== null ? bornesDonnees(data) : null), [data]);
  const [presetId, setPresetId] = useState<string | null>("1a");
  // Déclaré avant useDomaineZoom : son setter est référencé par l'onGeste qui vide le
  // survol après un zoom/pan/double-clic (sinon le trait reste figé sur l'ancien point).
  const [survol, setSurvol] = useState<Survol | null>(null);
  const { refCanvas, domaine, setDomaine } = useDomaineZoom(bornes, () => {
    setPresetId(null);
    setSurvol(null);
  });

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    setStatut("loading");
    void fetchVolData(exchange, symbol, ctrl.signal)
      .then((next) => {
        if (ctrl.signal.aborted) return;
        setData(next);
        setStatut("ready");
      })
      .catch((err) => {
        if (!ctrl.signal.aborted) {
          console.error("[AXIOM] volatilité indisponible", err);
          setStatut("error");
        }
      });
    return () => ctrl.abort();
  }, [open, symbol, exchange]);

  // (Ré)applique le préréglage actif quand les bornes arrivent ou changent — les données
  // VOL peuvent se recharger (changement de symbole) et le hook réinitialise le domaine
  // au tout ; on le resserre sur le preset courant.
  useEffect(() => {
    if (bornes === null || presetId === null) return;
    const jours = PERIODES_STANDARD.find((p) => p.id === presetId)?.jours ?? null;
    setDomaine(domainePourPreset(bornes, jours));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bornes?.min, bornes?.max]);

  useEffect(() => {
    const canvas = refCanvas.current;
    if (!canvas || statut !== "ready" || data === null) return;
    // Le cône n'est pas temporel : il doit rester rendu même si `domaine` n'est pas
    // encore disponible (données trop courtes pour une plage RV/DVOL exploitable).
    const domaineRendu = domaine ?? { min: 0, max: 1 };
    const redraw = (): void => draw(canvas, data, domaineRendu);
    redraw();
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [data, statut, domaine]);

  // Survol du panneau séries uniquement (moitié droite du canvas) — le cône n'est pas
  // temporel et ne réagit pas au curseur.
  const onSurvol = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    if (!avecIv || domaine === null || data === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const sp = panneauSeries(rect.width);
    const xLocal = e.clientX - rect.left;
    if (xLocal < sp.x0 || xLocal > sp.x0 + sp.w) {
      setSurvol(null);
      return;
    }
    const left = sp.x0 + 34;
    const plotW = sp.w - 42;
    const t = pixelVersValeur(domaine, xLocal - left, plotW);
    setSurvol({
      xPix: xLocal,
      largeur: rect.width,
      t,
      rv: pointProche(serieRv(data), t),
      dvol: pointProche(data.dvol ?? [], t),
    });
  };

  // Synthèse : RV30 · DVOL · VRP (IV − RV) · z-score RV30 — en tête du corps (H19 hiérarchie).
  let synthese: { rv: number | null; dvol: number | null; vrp: number | null; z: number | null } | null = null;
  let sansIv = false;
  if (statut === "ready" && data !== null) {
    const rvCourante = derniereRv(data.rv30);
    const dvolCourant = data.dvol !== null && data.dvol.length > 0 ? (data.dvol[data.dvol.length - 1]?.value ?? null) : null;
    sansIv = dvolCourant === null;
    const z = rvCourante !== null ? zScore(data.rv30.filter((v): v is number => v !== null), rvCourante) : null;
    synthese = {
      rv: rvCourante,
      dvol: dvolCourant,
      vrp: rvCourante !== null && dvolCourant !== null ? dvolCourant - rvCourante : null,
      z,
    };
  }

  return (
    <>
      <EnTeteFenetre
        mnemo="VOL"
        titre="Volatilité"
        sousTitre={`${symbol} · quotidien · annualisation √${PPA}`}
      />

      <div className="relative flex min-h-0 flex-1 flex-col p-3">
        {statut === "loading" && <Chargement />}
        {statut === "error" && <ErreurBloc>Volatilité indisponible pour ce symbole.</ErreurBloc>}
        {statut === "ready" && synthese !== null && (
          <div className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-4">
            <Metric label={`RV${RV_WINDOW}`} value={synthese.rv !== null ? formatPourcentage(synthese.rv, 1) : "—"} />
            <Metric label="DVOL" value={synthese.dvol !== null ? formatPourcentage(synthese.dvol, 1) : "—"} />
            <Metric
              label="VRP"
              value={synthese.vrp !== null ? `${formatDec(synthese.vrp, 1)} pts` : "—"}
              couleur={synthese.vrp !== null ? (synthese.vrp >= 0 ? "var(--up)" : "var(--down)") : undefined}
            />
            <Metric label="z-score RV" value={synthese.z !== null ? formatDec(synthese.z, 2) : "—"} />
          </div>
        )}
        {statut === "ready" && sansIv && (
          <p className="mb-2 text-[11px] text-text-dim">IV indisponible — Deribit ne cote que BTC/ETH. Cône RV seul.</p>
        )}
        {statut === "ready" && avecIv && (
          <BarrePeriodes
            actif={presetId}
            onChange={(p) => {
              setPresetId(p.id);
              setSurvol(null);
              if (bornes) setDomaine(domainePourPreset(bornes, p.jours));
            }}
          />
        )}
        <div className={statut === "ready" ? "relative min-h-0 w-full flex-1" : "hidden"}>
          <canvas
            ref={refCanvas}
            className="h-full w-full"
            onMouseMove={onSurvol}
            onMouseLeave={() => setSurvol(null)}
          />
          {survol && (
            <InfobulleGraphe
              xPix={survol.xPix}
              largeurGraphe={survol.largeur}
              titre={formatDateComplete(survol.t)}
              lignes={[
                {
                  label: `RV${RV_WINDOW}`,
                  valeur: survol.rv !== null ? formatPourcentage(survol.rv.value, 1) : VALEUR_ABSENTE,
                  couleur: lireTokenCanvas("--up", "#2dc08e"),
                },
                {
                  label: "DVOL",
                  valeur: survol.dvol !== null ? formatPourcentage(survol.dvol.value, 1) : VALEUR_ABSENTE,
                  couleur: lireTokenCanvas("--accent", "#38bdf8"),
                },
              ]}
            />
          )}
        </div>
      </div>
    </>
  );
}
