import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { Candle, ExchangeId } from "@axiom/types";
import type { Commande } from "../commands/registry";
import { getAdapter } from "../data/adapters";
import { bucketReturns, monthlyMatrix, type SeasonCell, type SeasonMode, type MonthCell } from "../lib/seasonality";
import { formatPourcentage } from "../lib/format";
import { lireTokenCanvas } from "../lib/canvasTokens";
import { marketStore } from "../store/market";
import { mirrorOpenState, windowManagerStore } from "../store/windowManager";
import { Chargement, EnTeteFenetre, ErreurBloc, Onglets, Vide } from "./ui";

export interface SeasonalityUiState {
  open: boolean;
  openSeasonality: () => void;
  closeSeasonality: () => void;
  toggleSeasonality: () => void;
}

export const seasonalityUiStore = createStore<SeasonalityUiState>(() => ({
  open: false,
  openSeasonality: () => windowManagerStore.getState().openWindow("seasonality"),
  closeSeasonality: () => windowManagerStore.getState().closeWindow("seasonality"),
  toggleSeasonality: () => windowManagerStore.getState().toggleWindow("seasonality"),
}));

mirrorOpenState("seasonality", seasonalityUiStore);

export const commandes: Commande[] = [
  {
    id: "panneau:seasonality",
    mnemonique: "SEAG",
    libelle: "Saisonnalité",
    categorie: "panneau",
    motsCles: ["saisonnalité", "seasonality", "heatmap", "mensuel", "seag"],
    apercu: "Ouvre / ferme la heatmap de saisonnalité du symbole courant",
    action: () => seasonalityUiStore.getState().toggleSeasonality(),
  },
];

type Onglet = "monthly" | "weekday" | "hourly";
type Statut = "idle" | "loading" | "ready" | "error";

const ONGLETS: ReadonlyArray<{ id: Onglet; label: string }> = [
  { id: "monthly", label: "Mensuel" },
  { id: "weekday", label: "Jour de semaine" },
  { id: "hourly", label: "Heure" },
];

/** Rendement en pourcentage « niveau » (ratio 0-1 → « x.x % »), 1 décimale. */
function fmtPct(ratio: number): string {
  return formatPourcentage(ratio * 100, 1);
}

function mixColor(neg: string, pos: string, value: number, scale: number): string {
  const src = value >= 0 ? pos : neg;
  const alpha = Math.min(0.9, Math.max(0.18, Math.abs(value) / Math.max(scale, 0.0001)));
  return `${src}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
}

async function fetchHistory(
  exchange: ExchangeId,
  symbol: string,
  mode: Onglet,
  signal: AbortSignal,
): Promise<Candle[]> {
  const adapter = getAdapter(exchange);
  if (mode === "hourly") {
    const pages: Candle[] = [];
    let endTime: number | undefined;
    for (let i = 0; i < 3; i++) {
      if (signal.aborted) return pages;
      const batch = await adapter.fetchKlines(symbol, "1h", { limit: 1000, endTime });
      if (batch.length === 0) break;
      pages.unshift(...batch);
      endTime = batch[0] === undefined ? undefined : batch[0].time - 1;
      if (batch.length < 1000) break;
    }
    return pages;
  }

  const pages: Candle[] = [];
  let endTime: number | undefined;
  while (pages.length < 10_000) {
    if (signal.aborted) return pages;
    const batch = await adapter.fetchKlines(symbol, "1d", { limit: 1000, endTime });
    if (batch.length === 0) break;
    pages.unshift(...batch);
    endTime = batch[0] === undefined ? undefined : batch[0].time - 1;
    if (batch.length < 1000) break;
  }
  return pages.slice(-10_000);
}

function drawMonthly(canvas: HTMLCanvasElement, cells: MonthCell[], hover: (text: string) => void): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const text = lireTokenCanvas("--text", "#e5e7eb");
  const dim = lireTokenCanvas("--text-dim", "#94a3b8");
  const up = lireTokenCanvas("--up", "#2dc08e");
  const down = lireTokenCanvas("--down", "#f92855");
  const border = lireTokenCanvas("--border", "#334155");
  const years = [...new Set(cells.map((c) => c.year))].sort((a, b) => a - b);
  const scale = percentile(cells.map((c) => Math.abs(c.ret)).sort((a, b) => a - b), 0.9) || 0.1;
  const left = 42;
  const top = 24;
  const cellW = Math.max(34, (w - left - 8) / 12);
  const cellH = Math.max(22, (h - top - 26) / Math.max(1, years.length));
  const byKey = new Map(cells.map((c) => [`${c.year}-${c.month}`, c]));

  ctx.font = "11px var(--font-display, monospace)";
  ctx.fillStyle = dim;
  for (let m = 0; m < 12; m++) ctx.fillText(String(m + 1).padStart(2, "0"), left + m * cellW + 7, 14);
  years.forEach((year, yIdx) => ctx.fillText(String(year), 4, top + yIdx * cellH + 15));

  const hit: Array<{ x: number; y: number; w: number; h: number; text: string }> = [];
  years.forEach((year, yIdx) => {
    for (let m = 0; m < 12; m++) {
      const x = left + m * cellW;
      const y = top + yIdx * cellH;
      const cell = byKey.get(`${year}-${m}`);
      ctx.strokeStyle = border;
      ctx.strokeRect(x, y, cellW - 2, cellH - 2);
      if (!cell) continue;
      ctx.fillStyle = mixColor(down, up, cell.ret, scale);
      ctx.fillRect(x + 1, y + 1, cellW - 4, cellH - 4);
      if (cellW > 42) {
        ctx.fillStyle = text;
        ctx.fillText(fmtPct(cell.ret), x + 5, y + Math.min(16, cellH - 5));
      }
      hit.push({ x, y, w: cellW, h: cellH, text: `${year}-${String(m + 1).padStart(2, "0")} · ${fmtPct(cell.ret)}` });
    }
  });
  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    hover(hit.find((cell) => x >= cell.x && x <= cell.x + cell.w && y >= cell.y && y <= cell.y + cell.h)?.text ?? "");
  };
}

function drawBuckets(canvas: HTMLCanvasElement, cells: SeasonCell[], mode: SeasonMode, hover: (text: string) => void): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const text = lireTokenCanvas("--text", "#e5e7eb");
  const dim = lireTokenCanvas("--text-dim", "#94a3b8");
  const up = lireTokenCanvas("--up", "#2dc08e");
  const down = lireTokenCanvas("--down", "#f92855");
  const border = lireTokenCanvas("--border", "#334155");
  const labels = mode === "weekday" ? ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"] : Array.from({ length: 24 }, (_v, i) => `${i}h`);
  const scale = percentile(cells.map((c) => Math.abs(c.mean)).sort((a, b) => a - b), 0.9) || 0.02;
  const byBucket = new Map(cells.map((c) => [c.bucket, c]));
  const left = 16;
  const top = 42;
  const cellW = (w - left * 2) / labels.length;
  const cellH = Math.min(110, h - 88);
  const hit: Array<{ x: number; y: number; w: number; h: number; text: string }> = [];

  ctx.font = "11px var(--font-display, monospace)";
  labels.forEach((label, bucket) => {
    const x = left + bucket * cellW;
    const cell = byBucket.get(bucket);
    ctx.fillStyle = dim;
    ctx.fillText(label, x + 4, 22);
    ctx.strokeStyle = border;
    ctx.strokeRect(x, top, cellW - 2, cellH);
    if (!cell) return;
    ctx.fillStyle = mixColor(down, up, cell.mean, scale);
    ctx.fillRect(x + 1, top + 1, cellW - 4, cellH - 2);
    if (cellW > 34) {
      ctx.fillStyle = text;
      ctx.fillText(fmtPct(cell.mean), x + 5, top + 24);
      ctx.fillStyle = dim;
      ctx.fillText(`${Math.round(cell.winRate * 100)}% · n=${cell.n}`, x + 5, top + 44);
    }
    hit.push({
      x,
      y: top,
      w: cellW,
      h: cellH,
      text: `${label} · moy ${fmtPct(cell.mean)} · med ${fmtPct(cell.median)} · win ${Math.round(cell.winRate * 100)} % · n=${cell.n}`,
    });
  });
  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    hover(hit.find((cell) => x >= cell.x && x <= cell.x + cell.w && y >= cell.y && y <= cell.y + cell.h)?.text ?? "");
  };
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const pos = (sortedAsc.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sortedAsc[lo] ?? 0;
  const b = sortedAsc[hi] ?? a;
  return a + (b - a) * (pos - lo);
}

export function SeasonalityWindow() {
  const open = useStore(seasonalityUiStore, (s) => s.open);
  const exchange = useStore(marketStore, (s) => s.exchange);
  const symbolGlobal = useStore(marketStore, (s) => s.symbol);
  const groupColor = useStore(windowManagerStore, (s) => s.windows["seasonality"]?.groupColor ?? null);
  const symbolGroupe = useStore(windowManagerStore, (s) => (groupColor ? s.groupSymbols[groupColor] : undefined));
  const symbol = symbolGroupe ?? symbolGlobal;
  const [onglet, setOnglet] = useState<Onglet>("monthly");
  const [statut, setStatut] = useState<Statut>("idle");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [hover, setHover] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    setStatut("loading");
    setHover("");
    void fetchHistory(exchange, symbol, onglet, ctrl.signal)
      .then((next) => {
        if (ctrl.signal.aborted) return;
        setCandles(next);
        setStatut("ready");
      })
      .catch((err) => {
        if (!ctrl.signal.aborted) {
          console.error("[AXIOM] saisonnalité indisponible", err);
          setStatut("error");
        }
      });
    return () => ctrl.abort();
  }, [open, onglet, symbol, exchange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || statut !== "ready") return;
    const redraw = (): void => {
      if (onglet === "monthly") drawMonthly(canvas, monthlyMatrix(candles), setHover);
      else drawBuckets(canvas, bucketReturns(candles, onglet), onglet, setHover);
    };
    redraw();
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [candles, onglet, statut]);

  return (
    <>
      <EnTeteFenetre
        mnemo="SEAG"
        titre="Saisonnalité"
        sousTitre={`${symbol} · UTC · rendements simples`}
        actions={
          <div className="max-w-[260px] truncate text-right text-[11px] text-text-dim">
            {hover || "Survoler une cellule"}
          </div>
        }
      />

      <Onglets options={ONGLETS} actif={onglet} onChange={setOnglet} />

      <div className="relative min-h-0 flex-1 p-3">
        {statut === "loading" && <Chargement />}
        {statut === "error" && <ErreurBloc>Saisonnalité indisponible pour ce symbole.</ErreurBloc>}
        {statut === "ready" && candles.length < 2 && <Vide>Historique insuffisant.</Vide>}
        <canvas ref={canvasRef} className={statut === "ready" && candles.length >= 2 ? "h-full min-h-[360px] w-full" : "hidden"} />
      </div>
    </>
  );
}
