/**
 * VOL — fenêtre Volatilité : cône de RV (percentiles historiques par horizon) +
 * comparaison RV30 / DVOL Deribit (IV) sur 1 an + VRP (IV − RV) + z-score RV.
 *
 * Données : 730 bougies daily du symbole suivi (groupe-couleur sinon global) via
 * getAdapter ; IV = historique DVOL Deribit (BTC/ETH uniquement — pour les autres
 * symboles, cône seul + message). Moteurs purs dans lib/volCone.ts (Task 8).
 * Rendu impératif canvas (aucune donnée haute fréquence dans React).
 */
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { Candle, ExchangeId } from "@axiom/types";
import type { Commande } from "../commands/registry";
import { getAdapter } from "../data/adapters";
import { fetchDvolHistory } from "../data/deribit";
import { lireTokenCanvas } from "../lib/canvasTokens";
import { formatDec, formatPourcentage } from "../lib/format";
import { realizedVolSeries, volCone, zScore, type VolConeRow } from "../lib/volCone";
import { marketStore } from "../store/market";
import { mirrorOpenState, windowManagerStore } from "../store/windowManager";
import { Chargement, EnTeteFenetre, ErreurBloc, Metric } from "./ui";

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

/** Séries RV30 et DVOL superposées sur 1 an (2 polylignes, échelle commune). */
function drawSeries(
  ctx: CanvasRenderingContext2D,
  data: VolData,
  x0: number,
  y0: number,
  w: number,
  h: number,
  tk: Tokens,
): void {
  const depuis = Date.now() - 365 * 24 * 60 * 60 * 1000;
  const rv: { time: number; value: number }[] = [];
  data.times.forEach((t, i) => {
    const v = data.rv30[i];
    if (t >= depuis && v !== null && v !== undefined) rv.push({ time: t, value: v });
  });
  const dvol = (data.dvol ?? []).filter((p) => p.time >= depuis);
  const tout = [...rv, ...dvol];
  if (tout.length < 2) {
    ctx.fillStyle = tk.dim;
    ctx.fillText("Séries indisponibles.", x0 + 8, y0 + 20);
    return;
  }

  let tMin = Infinity;
  let tMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const p of tout) {
    tMin = Math.min(tMin, p.time);
    tMax = Math.max(tMax, p.time);
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
  const xAt = (t: number): number => left + ((t - tMin) / Math.max(1, tMax - tMin)) * plotW;
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
  ligne(rv, tk.up);
  ligne(dvol, tk.accent);

  ctx.fillStyle = tk.dim;
  ctx.fillText(`${vMax.toFixed(0)} %`, x0, y0 + 12);
  ctx.fillText(`${vMin.toFixed(0)} %`, x0, bottom + 4);
  // Légende.
  ctx.fillStyle = tk.up;
  ctx.fillText(`RV${RV_WINDOW}`, left, y0 + 12);
  if (dvol.length > 0) {
    ctx.fillStyle = tk.accent;
    ctx.fillText("DVOL", left + 44, y0 + 12);
  }
}

function draw(canvas: HTMLCanvasElement, data: VolData): void {
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
    drawSeries(ctx, data, w / 2 + 4, 22, w / 2 - 8, h - 26, tk);
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

export function VolWindow() {
  const open = useStore(volUiStore, (s) => s.open);
  const exchange = useStore(marketStore, (s) => s.exchange);
  const symbolGlobal = useStore(marketStore, (s) => s.symbol);
  const groupColor = useStore(windowManagerStore, (s) => s.windows["vol"]?.groupColor ?? null);
  const symbolGroupe = useStore(windowManagerStore, (s) => (groupColor ? s.groupSymbols[groupColor] : undefined));
  const symbol = symbolGroupe ?? symbolGlobal;
  const [statut, setStatut] = useState<Statut>("idle");
  const [data, setData] = useState<VolData | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || statut !== "ready" || data === null) return;
    const redraw = (): void => draw(canvas, data);
    redraw();
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [data, statut]);

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
        <canvas ref={canvasRef} className={statut === "ready" ? "min-h-0 w-full flex-1" : "hidden"} />
      </div>
    </>
  );
}
