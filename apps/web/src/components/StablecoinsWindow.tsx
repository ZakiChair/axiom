/**
 * Fenêtre « STBL » — analyse des stablecoins (DefiLlama, gratuit, sans clé). NON MODALE.
 *
 * Quatre onglets :
 *   Vue d'ensemble — supply totale + Δ (impression nette), dominance (treemap + table).
 *   Impression    — historique de supply agrégée + barres de mint/burn net quotidien.
 *   Chaînes       — répartition de la supply par blockchain, historique par chaîne.
 *   Pegs          — écarts vs 1,00 $ en bps avec badges (pegs USD uniquement, cf. util).
 *
 * Drill-down : clic sur un émetteur (table Vue d'ensemble, treemap ou Pegs) → fiche
 * émetteur (historique de supply agrégé + répartition par chaîne), bouton retour.
 *
 * Données : data/macro/stablecoinsDetail.ts (fetch direct + cache 5 min). Les calculs
 * vivent dans stablecoinsWindow.util.ts (purs, testés sans DOM).
 */
import { useEffect, useRef, useState } from "react";
import { createStore } from "zustand/vanilla";
import { windowManagerStore, mirrorOpenState } from "../store/windowManager";
import { squarify, type Rect, type Tuile } from "../lib/treemap";
import { lireTokenCanvas } from "../lib/canvasTokens";
import {
  chargerEmetteurs,
  chargerHistoriqueAgrege,
  chargerHistoriqueChaine,
  type EmetteurStablecoin,
  type PointSupply,
} from "../data/macro/stablecoinsDetail";
import {
  bornes,
  calculerDominance,
  deltaPct,
  ecartPegBps,
  etatPeg,
  impressionNette,
  repartitionChaines,
  serieImpressionQuotidienne,
  tronquerSerie,
  type EtatPeg,
  type PartDominance,
} from "./stablecoinsWindow.util";
import { formatUsd, formatPct, formatPourcentage, VALEUR_ABSENTE } from "../lib/format";
import {
  EnTeteFenetre,
  Onglets,
  Metric,
  Badge,
  Chargement,
  ErreurBloc,
  NoteSource,
  BTN_SECONDAIRE,
  type TonBadge,
} from "./ui";

// ─────────────────────────── Store UI (vanilla, éphémère, non persisté) ───────────────────────────

export interface StablecoinsUiState {
  open: boolean;
  openStablecoins: () => void;
  closeStablecoins: () => void;
  toggleStablecoins: () => void;
}

export const stablecoinsUiStore = createStore<StablecoinsUiState>(() => ({
  open: false,
  openStablecoins: () => windowManagerStore.getState().openWindow("stablecoins"),
  closeStablecoins: () => windowManagerStore.getState().closeWindow("stablecoins"),
  toggleStablecoins: () => windowManagerStore.getState().toggleWindow("stablecoins"),
}));

mirrorOpenState("stablecoins", stablecoinsUiStore);

// ─────────────────────────── Formatage local (pur) ───────────────────────────

/** Δ USD signé compact (« +$2.1B » / « −$340M ») — formatUsd gère le compact. */
function fmtDeltaUsd(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return VALEUR_ABSENTE;
  return `${v >= 0 ? "+" : "−"}${formatUsd(Math.abs(v))}`;
}

/** Couleur token pour un delta (up/down, undefined = neutre). */
function couleurDelta(v: number | null): string | undefined {
  if (v === null || v === 0) return undefined;
  return v > 0 ? "var(--up)" : "var(--down)";
}

// ─────────────────────────── Onglets ───────────────────────────

type Onglet = "vue" | "impression" | "chaines" | "pegs";
type Statut = "loading" | "ready" | "error";

const ONGLETS: ReadonlyArray<{ id: Onglet; label: string }> = [
  { id: "vue", label: "Vue d'ensemble" },
  { id: "impression", label: "Impression" },
  { id: "chaines", label: "Chaînes" },
  { id: "pegs", label: "Pegs" },
];

// ─────────────────────────── Treemap dominance (canvas, impératif) ───────────────────────────

/** Dessine la treemap de dominance. PURE vis-à-vis de React (canvas + données seulement). */
function dessinerTreemap(canvas: HTMLCanvasElement, parts: PartDominance[]): Tuile<PartDominance>[] {
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const cssW = canvas.clientWidth || 400;
  const cssH = canvas.clientHeight || 180;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const cAccent = lireTokenCanvas("--accent", "#3b82f6");
  const cBorder = lireTokenCanvas("--border", "#374151");
  const cText = lireTokenCanvas("--text", "#e5e7eb");

  const conteneur: Rect = { x: 0, y: 0, w: cssW, h: cssH };
  const tuiles = squarify(parts, (p) => p.mcapUsd, conteneur);
  const partMax = parts[0]?.partPct ?? 100;

  for (const t of tuiles) {
    const { x, y, w, h } = t.rect;
    // Teinte accent dont l'ALPHA suit la part (dominant opaque, queue discrète) —
    // même famille de teinte sur les 5 thèmes, pas de palette en dur.
    ctx.globalAlpha = 0.25 + 0.65 * (t.item.partPct / partMax);
    ctx.fillStyle = cAccent;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = cBorder;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    if (w > 46 && h > 26) {
      ctx.fillStyle = cText;
      ctx.font = "10px ui-sans-serif, system-ui";
      ctx.fillText(t.item.symbole, x + 5, y + 13, w - 10);
      ctx.fillText(`${t.item.partPct.toFixed(1)} %`, x + 5, y + 24, w - 10);
    }
  }
  return tuiles;
}

function TreemapDominance({
  parts,
  onSelect,
}: {
  parts: PartDominance[];
  onSelect: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tuilesRef = useRef<Tuile<PartDominance>[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) tuilesRef.current = dessinerTreemap(canvas, parts);
  }, [parts]);

  /** Hit-test au clic → drill-down (l'agrégat « Autres », id vide, est ignoré). */
  function surClic(ev: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const tuile = tuilesRef.current.find(
      (t) => px >= t.rect.x && px <= t.rect.x + t.rect.w && py >= t.rect.y && py <= t.rect.y + t.rect.h,
    );
    if (tuile && tuile.item.id !== "") onSelect(tuile.item.id);
  }

  return (
    <canvas
      ref={canvasRef}
      onClick={surClic}
      className="h-44 w-full cursor-pointer rounded-md border border-border"
    />
  );
}

// ─────────────────────────── Vue d'ensemble ───────────────────────────

function VueEnsemble({
  emetteurs,
  historique,
  onSelect,
}: {
  emetteurs: EmetteurStablecoin[];
  historique: PointSupply[];
  onSelect: (id: string) => void;
}) {
  const totalUsd = emetteurs.reduce((s, e) => s + e.mcapUsd, 0);
  const dominance = calculerDominance(emetteurs, 12);
  const d24h = impressionNette(historique, 1);
  const d7j = impressionNette(historique, 7);
  const d30j = impressionNette(historique, 30);
  const partUsdt = dominance.find((p) => p.symbole === "USDT")?.partPct ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <Metric label="Supply totale" value={formatUsd(totalUsd)} />
        <Metric label="Dominance USDT" value={formatPourcentage(partUsdt)} />
        <Metric label="Δ 24 h" value={fmtDeltaUsd(d24h)} couleur={couleurDelta(d24h)} />
        <Metric label="Δ 7 j" value={fmtDeltaUsd(d7j)} couleur={couleurDelta(d7j)} />
        <Metric label="Δ 30 j" value={fmtDeltaUsd(d30j)} couleur={couleurDelta(d30j)} />
      </div>
      <TreemapDominance parts={dominance} onSelect={onSelect} />
      <TableEmetteurs emetteurs={emetteurs} onSelect={onSelect} />
      <NoteSource>Données DefiLlama (stablecoins.llama.fi), rafraîchies ~5 min.</NoteSource>
    </div>
  );
}

/** Table des top émetteurs (mcap, part, Δ7 j, prix, mécanisme). Clic → drill-down. */
function TableEmetteurs({
  emetteurs,
  onSelect,
}: {
  emetteurs: EmetteurStablecoin[];
  onSelect: (id: string) => void;
}) {
  const total = emetteurs.reduce((s, e) => s + e.mcapUsd, 0);
  const tries = [...emetteurs].sort((a, b) => b.mcapUsd - a.mcapUsd).slice(0, 25);
  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="border-b border-border text-left text-text-dim">
          <th className="py-1 pr-2 font-normal">Émetteur</th>
          <th className="py-1 pr-2 text-right font-normal">Supply</th>
          <th className="py-1 pr-2 text-right font-normal">Part</th>
          <th className="py-1 pr-2 text-right font-normal">Δ 7 j</th>
          <th className="py-1 pr-2 text-right font-normal">Prix</th>
          <th className="py-1 font-normal">Mécanisme</th>
        </tr>
      </thead>
      <tbody>
        {tries.map((e) => {
          const d7 = deltaPct(e.mcapUsd, e.mcap7jUsd);
          return (
            <tr
              key={e.id}
              onClick={() => onSelect(e.id)}
              className="cursor-pointer border-b border-border/50 hover:bg-bg"
            >
              <td className="py-1 pr-2 font-medium text-text">{e.symbole}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{formatUsd(e.mcapUsd)}</td>
              <td className="py-1 pr-2 text-right tabular-nums text-text-dim">
                {total > 0 ? formatPourcentage((e.mcapUsd / total) * 100, 1) : VALEUR_ABSENTE}
              </td>
              <td className="py-1 pr-2 text-right tabular-nums" style={{ color: couleurDelta(d7) }}>
                {formatPct(d7)}
              </td>
              <td className="py-1 pr-2 text-right tabular-nums">
                {e.prix === null ? VALEUR_ABSENTE : e.prix.toFixed(4)}
              </td>
              <td className="py-1 text-text-dim">{e.pegMechanism || VALEUR_ABSENTE}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─────────────────────────── Onglet Impression ───────────────────────────

type Periode = 30 | 90 | 365 | null; // null = tout

const PERIODES: ReadonlyArray<{ id: string; jours: Periode; label: string }> = [
  { id: "30j", jours: 30, label: "30 j" },
  { id: "90j", jours: 90, label: "90 j" },
  { id: "1a", jours: 365, label: "1 a" },
  { id: "tout", jours: null, label: "Tout" },
];

/**
 * Chart combiné : ligne de supply agrégée (moitié haute) + barres de mint/burn net
 * quotidien (moitié basse, zéro au centre). Impératif, tokens lus au dessin.
 */
function dessinerImpression(canvas: HTMLCanvasElement, serie: PointSupply[]): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const cssW = canvas.clientWidth || 400;
  const cssH = canvas.clientHeight || 220;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  if (serie.length < 2) return;

  const cUp = lireTokenCanvas("--up", "#22c55e");
  const cDown = lireTokenCanvas("--down", "#ef4444");
  const cAccent = lireTokenCanvas("--accent", "#3b82f6");
  const cGrid = lireTokenCanvas("--border", "#374151");

  const t0 = serie[0]!.time;
  const t1 = serie[serie.length - 1]!.time;
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * cssW;

  // Moitié haute : ligne de supply.
  const hLigne = cssH * 0.55;
  const bSupply = bornes(serie.map((p) => p.totalUsd));
  if (bSupply) {
    const y = (v: number) =>
      hLigne - ((v - bSupply.min) / Math.max(1e-9, bSupply.max - bSupply.min)) * (hLigne - 8) - 4;
    ctx.strokeStyle = cGrid;
    ctx.strokeRect(0.5, 0.5, cssW - 1, hLigne - 1);
    ctx.beginPath();
    for (let i = 0; i < serie.length; i++) {
      const p = serie[i]!;
      if (i === 0) ctx.moveTo(x(p.time), y(p.totalUsd));
      else ctx.lineTo(x(p.time), y(p.totalUsd));
    }
    ctx.strokeStyle = cAccent;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  // Moitié basse : barres Δ quotidien (mint vert, burn rouge), zéro au centre.
  const deltas = serieImpressionQuotidienne(serie);
  const bDelta = bornes(deltas.map((d) => Math.abs(d.delta)));
  if (bDelta && bDelta.max > 0) {
    const y0 = hLigne + (cssH - hLigne) / 2;
    const demiH = (cssH - hLigne) / 2 - 4;
    ctx.strokeStyle = cGrid;
    ctx.beginPath();
    ctx.moveTo(0, y0 + 0.5);
    ctx.lineTo(cssW, y0 + 0.5);
    ctx.stroke();
    const larg = Math.max(1, (cssW / deltas.length) * 0.7);
    for (const d of deltas) {
      const h = (Math.abs(d.delta) / bDelta.max) * demiH;
      ctx.fillStyle = d.delta >= 0 ? cUp : cDown;
      ctx.fillRect(x(d.time) - larg / 2, d.delta >= 0 ? y0 - h : y0, larg, h);
    }
  }
}

function VueImpression({
  emetteurs,
  historique,
}: {
  emetteurs: EmetteurStablecoin[];
  historique: PointSupply[];
}) {
  const [periodeId, setPeriodeId] = useState("90j");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const periode = PERIODES.find((p) => p.id === periodeId) ?? PERIODES[1]!;
  const serie = tronquerSerie(historique, periode.jours);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) dessinerImpression(canvas, serie);
  }, [serie]);

  // Top mints / burns 7 j par émetteur (Δ absolu USD, pas %) — qui imprime, qui brûle.
  const avecDelta = emetteurs
    .filter((e) => e.mcap7jUsd !== null)
    .map((e) => ({ e, dUsd: e.mcapUsd - (e.mcap7jUsd ?? 0) }))
    .sort((a, b) => b.dUsd - a.dUsd);
  const mints = avecDelta.filter((x) => x.dUsd > 0).slice(0, 5);
  const burns = avecDelta.filter((x) => x.dUsd < 0).slice(-5).reverse();

  return (
    <div className="flex flex-col gap-3">
      <Onglets
        options={PERIODES.map((p) => ({ id: p.id, label: p.label }))}
        actif={periodeId}
        onChange={setPeriodeId}
      />
      <canvas ref={canvasRef} className="h-56 w-full rounded-md border border-border" />
      <div className="grid grid-cols-2 gap-3">
        <ListeDeltas titre="Top mints 7 j" lignes={mints} />
        <ListeDeltas titre="Top burns 7 j" lignes={burns} />
      </div>
      <NoteSource>
        Impression nette = Δ de supply circulante (mint − burn), points journaliers DefiLlama.
      </NoteSource>
    </div>
  );
}

function ListeDeltas({
  titre,
  lignes,
}: {
  titre: string;
  lignes: { e: EmetteurStablecoin; dUsd: number }[];
}) {
  return (
    <div className="rounded-md border border-border bg-bg px-3 py-2">
      <p className="mb-1 text-[11px] text-text-dim">{titre}</p>
      {lignes.length === 0 && <p className="text-[11px] text-text-dim">{VALEUR_ABSENTE}</p>}
      {lignes.map(({ e, dUsd }) => (
        <div key={e.id} className="flex justify-between text-[11px]">
          <span className="text-text">{e.symbole}</span>
          <span className="tabular-nums" style={{ color: couleurDelta(dUsd) }}>
            {fmtDeltaUsd(dUsd)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────── Onglet Chaînes ───────────────────────────

function VueChaines({ emetteurs }: { emetteurs: EmetteurStablecoin[] }) {
  const parts = repartitionChaines(emetteurs);
  const [chaineSel, setChaineSel] = useState<string | null>(null);
  const [serie, setSerie] = useState<PointSupply[] | null>(null);
  const [statut, setStatut] = useState<"idle" | "loading" | "error">("idle");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (chaineSel === null) return;
    const ctrl = new AbortController();
    let ignore = false;
    setStatut("loading");
    setSerie(null);
    void chargerHistoriqueChaine(chaineSel, ctrl.signal)
      .then((s) => {
        if (ignore) return;
        setSerie(s);
        setStatut("idle");
      })
      .catch(() => {
        if (!ignore) setStatut("error");
      });
    return () => {
      ignore = true;
      ctrl.abort();
    };
  }, [chaineSel]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && serie !== null) dessinerImpression(canvas, tronquerSerie(serie, 365));
  }, [serie]);

  const partMax = parts[0]?.partPct ?? 100;

  return (
    <div className="flex flex-col gap-3">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-border text-left text-text-dim">
            <th className="py-1 pr-2 font-normal">Chaîne</th>
            <th className="py-1 pr-2 text-right font-normal">Supply</th>
            <th className="py-1 pr-2 text-right font-normal">Part</th>
            <th className="w-1/3 py-1 font-normal" />
          </tr>
        </thead>
        <tbody>
          {parts.slice(0, 15).map((p) => (
            <tr
              key={p.chaine}
              onClick={() => setChaineSel(p.chaine)}
              className={`cursor-pointer border-b border-border/50 hover:bg-bg ${
                chaineSel === p.chaine ? "bg-bg" : ""
              }`}
            >
              <td className="py-1 pr-2 font-medium text-text">{p.chaine}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{formatUsd(p.totalUsd)}</td>
              <td className="py-1 pr-2 text-right tabular-nums text-text-dim">
                {formatPourcentage(p.partPct, 1)}
              </td>
              <td className="py-1">
                {/* Barre de part relative — largeur en % de la part max (lisible même
                    quand Ethereum/Tron écrasent la queue). */}
                <div
                  className="h-1.5 rounded-sm bg-accent/60"
                  style={{ width: `${Math.max(2, (p.partPct / partMax) * 100)}%` }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {chaineSel !== null && (
        <div className="flex flex-col gap-1">
          <p className="text-[11px] text-text-dim">Historique 1 a — {chaineSel}</p>
          {statut === "loading" && <Chargement />}
          {statut === "error" && <ErreurBloc>Historique indisponible pour {chaineSel}.</ErreurBloc>}
          <canvas
            ref={canvasRef}
            className={`h-48 w-full rounded-md border border-border ${serie === null ? "hidden" : ""}`}
          />
        </div>
      )}
      <NoteSource>Répartition courante par chaîne (tous émetteurs), DefiLlama.</NoteSource>
    </div>
  );
}

// ─────────────────────────── Onglet Pegs ───────────────────────────

const TON_PEG: Record<EtatPeg, TonBadge> = { stable: "up", tension: "accent", depeg: "down" };
const LIBELLE_PEG: Record<EtatPeg, string> = { stable: "Stable", tension: "Tension", depeg: "DEPEG" };

function VuePegs({
  emetteurs,
  onSelect,
}: {
  emetteurs: EmetteurStablecoin[];
  onSelect: (id: string) => void;
}) {
  // Pegs USD avec prix, triés par écart absolu décroissant (les problèmes d'abord).
  const usd = emetteurs
    .map((e) => ({ e, bps: ecartPegBps(e) }))
    .filter((x): x is { e: EmetteurStablecoin; bps: number } => x.bps !== null)
    .sort((a, b) => Math.abs(b.bps) - Math.abs(a.bps));
  // Pegs non-USD : listés à part, prix brut sans bps (limite DefiLlama documentée au spec).
  const autres = emetteurs.filter((e) => e.pegType !== "peggedUSD").slice(0, 10);

  return (
    <div className="flex flex-col gap-3">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-border text-left text-text-dim">
            <th className="py-1 pr-2 font-normal">Émetteur</th>
            <th className="py-1 pr-2 text-right font-normal">Prix</th>
            <th className="py-1 pr-2 text-right font-normal">Écart</th>
            <th className="py-1 pr-2 text-right font-normal">Supply</th>
            <th className="py-1 font-normal">État</th>
          </tr>
        </thead>
        <tbody>
          {usd.slice(0, 30).map(({ e, bps }) => {
            const etat = etatPeg(bps);
            return (
              <tr
                key={e.id}
                onClick={() => onSelect(e.id)}
                className="cursor-pointer border-b border-border/50 hover:bg-bg"
              >
                <td className="py-1 pr-2 font-medium text-text">{e.symbole}</td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {e.prix === null ? VALEUR_ABSENTE : e.prix.toFixed(4)}
                </td>
                {/* Tout écart non nul est teinté "down" (un écart de peg n'est jamais
                    « bon ») ; -0 || null garde le neutre à zéro exact. */}
                <td
                  className="py-1 pr-2 text-right tabular-nums"
                  style={{ color: couleurDelta(-Math.abs(bps) || null) }}
                >
                  {bps >= 0 ? "+" : "−"}
                  {Math.abs(bps).toFixed(1)} bps
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{formatUsd(e.mcapUsd)}</td>
                <td className="py-1">
                  <Badge ton={TON_PEG[etat]}>{LIBELLE_PEG[etat]}</Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {autres.length > 0 && (
        <div className="rounded-md border border-border bg-bg px-3 py-2">
          <p className="mb-1 text-[11px] text-text-dim">
            Pegs non-USD (prix USD brut — écart non calculé)
          </p>
          {autres.map((e) => (
            <div key={e.id} className="flex justify-between text-[11px]">
              <span className="text-text">
                {e.symbole}{" "}
                <span className="text-text-dim">({e.pegType.replace("pegged", "")})</span>
              </span>
              <span className="tabular-nums">
                {e.prix === null ? VALEUR_ABSENTE : e.prix.toFixed(4)}
              </span>
            </div>
          ))}
        </div>
      )}
      <NoteSource>
        Seuils : stable &lt; 25 bps · tension &lt; 100 bps · depeg ≥ 100 bps (écart absolu vs 1,00 $).
      </NoteSource>
    </div>
  );
}

// ─────────────────────────── Fenêtre ───────────────────────────

export function StablecoinsWindow() {
  const [onglet, setOnglet] = useState<Onglet>("vue");
  const [statut, setStatut] = useState<Statut>("loading");
  const [emetteurs, setEmetteurs] = useState<EmetteurStablecoin[] | null>(null);
  const [historique, setHistorique] = useState<PointSupply[] | null>(null);
  const [emetteurSelId, setEmetteurSelId] = useState<string | null>(null);
  const [essai, setEssai] = useState(0); // bouton « Réessayer »

  useEffect(() => {
    const ctrl = new AbortController();
    let ignore = false;
    setStatut("loading");
    void Promise.all([chargerEmetteurs(ctrl.signal), chargerHistoriqueAgrege(ctrl.signal)])
      .then(([liste, serie]) => {
        if (ignore) return;
        setEmetteurs(liste);
        setHistorique(serie);
        setStatut("ready");
      })
      .catch(() => {
        if (!ignore) setStatut("error");
      });
    return () => {
      ignore = true;
      ctrl.abort();
    };
  }, [essai]);

  return (
    <>
      <EnTeteFenetre titre="Stablecoins" sousTitre="Supply, impression, dominance, pegs · DefiLlama" />
      <Onglets
        options={ONGLETS}
        actif={onglet}
        onChange={(id) => {
          setEmetteurSelId(null); // changer d'onglet referme la fiche émetteur
          setOnglet(id);
        }}
      />
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {statut === "loading" && <Chargement />}
        {statut === "error" && (
          <ErreurBloc>
            Impossible de charger les données DefiLlama.{" "}
            <button type="button" className={BTN_SECONDAIRE} onClick={() => setEssai((n) => n + 1)}>
              Réessayer
            </button>
          </ErreurBloc>
        )}
        {statut === "ready" && emetteurs !== null && historique !== null && (
          <>
            {onglet === "vue" && (
              <VueEnsemble emetteurs={emetteurs} historique={historique} onSelect={setEmetteurSelId} />
            )}
            {onglet === "impression" && (
              <VueImpression emetteurs={emetteurs} historique={historique} />
            )}
            {onglet === "chaines" && <VueChaines emetteurs={emetteurs} />}
            {onglet === "pegs" && <VuePegs emetteurs={emetteurs} onSelect={setEmetteurSelId} />}
          </>
        )}
      </div>
    </>
  );
}
