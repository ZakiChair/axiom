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
import { useEffect, useMemo, useRef, useState } from "react";
import { createStore } from "zustand/vanilla";
import { windowManagerStore, mirrorOpenState } from "../store/windowManager";
import { squarify, type Rect, type Tuile } from "../lib/treemap";
import { lireTokenCanvas, POLICE_CANVAS } from "../lib/canvasTokens";
import {
  chargerDetailEmetteur,
  chargerEmetteurs,
  chargerHistoriqueAgrege,
  chargerHistoriqueChaine,
  type DetailEmetteur,
  type EmetteurStablecoin,
  type PointSupply,
} from "../data/macro/stablecoinsDetail";
import {
  agregerHistoriqueEmetteur,
  bornes,
  calculerDominance,
  deltaPct,
  ecartPegBps,
  etatPeg,
  impressionNette,
  pointLePlusProche,
  repartitionChaines,
  resumePegs,
  serieImpressionQuotidienne,
  SUPPLY_MIN_USD,
  tronquerSerie,
  type EtatPeg,
  type PartChaine,
  type PartDominance,
} from "./stablecoinsWindow.util";
import {
  formatUsd,
  formatPct,
  formatPourcentage,
  formatDateCourte,
  formatDateComplete,
  VALEUR_ABSENTE,
} from "../lib/format";
import {
  EnTeteFenetre,
  Onglets,
  Metric,
  Badge,
  Chargement,
  ErreurBloc,
  NoteSource,
  BTN_SECONDAIRE,
  BarrePeriodes,
  InfobulleGraphe,
  PERIODES_STANDARD,
  type TonBadge,
} from "./ui";
import { TableTriable, type ColonneTable } from "./TableTriable";
import {
  indicesVisibles,
  valeurVersPixel,
  pixelVersValeur,
  domainePourPreset,
  type Domaine,
} from "../lib/domaineAxe";
import { useDomaineZoom } from "../hooks/useDomaineZoom";

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
      ctx.font = POLICE_CANVAS;
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
  onVoirPegs,
}: {
  emetteurs: EmetteurStablecoin[];
  historique: PointSupply[];
  onSelect: (id: string) => void;
  onVoirPegs: () => void;
}) {
  const totalUsd = emetteurs.reduce((s, e) => s + e.mcapUsd, 0);
  const dominance = calculerDominance(emetteurs, 12);
  const d24h = impressionNette(historique, 1);
  const d7j = impressionNette(historique, 7);
  const d30j = impressionNette(historique, 30);
  const partUsdt = dominance.find((p) => p.symbole === "USDT")?.partPct ?? null;

  return (
    <div className="flex flex-col gap-3">
      {(() => {
        const pegs = resumePegs(emetteurs);
        if (pegs.alertes.length === 0) {
          return <p className="text-[11px] text-text-dim">Pegs : {pegs.stables} stables</p>;
        }
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            {pegs.alertes.map((a) => (
              <button key={a.symbole} type="button" onClick={onVoirPegs} title="Voir l'onglet Pegs">
                <Badge ton={a.etat === "depeg" ? "down" : "warn"}>
                  {a.etat} {a.symbole} {a.bps >= 0 ? "+" : "−"}
                  {Math.abs(Math.round(a.bps))} bps
                </Badge>
              </button>
            ))}
          </div>
        );
      })()}
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
  const colonnes: ColonneTable<EmetteurStablecoin>[] = [
    {
      id: "emetteur",
      label: "Émetteur",
      triable: false,
      rendu: (e) => <span className="font-medium text-text">{e.symbole}</span>,
    },
    {
      id: "supply",
      label: "Supply",
      align: "right",
      triable: false,
      rendu: (e) => formatUsd(e.mcapUsd),
    },
    {
      id: "part",
      label: "Part",
      align: "right",
      triable: false,
      rendu: (e) => (
        <span className="text-text-dim">
          {total > 0 ? formatPourcentage((e.mcapUsd / total) * 100, 1) : VALEUR_ABSENTE}
        </span>
      ),
    },
    {
      id: "delta7j",
      label: "Δ 7 j",
      align: "right",
      triable: false,
      rendu: (e) => {
        const d7 = deltaPct(e.mcapUsd, e.mcap7jUsd);
        return <span style={{ color: couleurDelta(d7) }}>{formatPct(d7)}</span>;
      },
    },
    {
      id: "prix",
      label: "Prix",
      align: "right",
      triable: false,
      rendu: (e) => (e.prix === null ? VALEUR_ABSENTE : e.prix.toFixed(4)),
    },
    {
      id: "mecanisme",
      label: "Mécanisme",
      triable: false,
      rendu: (e) => <span className="text-text-dim">{e.pegMechanism || VALEUR_ABSENTE}</span>,
    },
  ];
  return <TableTriable colonnes={colonnes} lignes={tries} cle={(e) => e.id} surClicLigne={(e) => onSelect(e.id)} />;
}

// ─────────────────────────── Onglet Impression ───────────────────────────

// IDs DefiLlama (cf. GET /stablecoins?includePrices=true) des 2 plus gros émetteurs —
// utilisés pour la part USDT/USDC affichée par le curseur du chart Impression.
const ID_USDT = "1";
const ID_USDC = "2";

/**
 * Chart combiné : ligne de supply agrégée (moitié haute) + barres de mint/burn net
 * quotidien (moitié basse, zéro au centre). Impératif, tokens lus au dessin.
 * `domaine` fixe la fenêtre visible sur l'axe X (zoom/pan/préréglage).
 */
function dessinerImpression(canvas: HTMLCanvasElement, serie: PointSupply[], domaine: Domaine): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const cssW = canvas.clientWidth || 400;
  const cssH = canvas.clientHeight || 220;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const { debut, fin } = indicesVisibles(serie, (p) => p.time, domaine);
  const visibles = serie.slice(debut, fin + 1);
  if (visibles.length < 2) return;

  const cUp = lireTokenCanvas("--up", "#22c55e");
  const cDown = lireTokenCanvas("--down", "#ef4444");
  const cAccent = lireTokenCanvas("--accent", "#3b82f6");
  const cGrid = lireTokenCanvas("--border", "#374151");
  const cTextDim = lireTokenCanvas("--text-dim", "#9ca3af");

  const x = (t: number) => valeurVersPixel(domaine, t, cssW);

  // Marge basse réservée aux repères de dates (sinon les barres du bas les recouvrent).
  const padB = 14;
  const plotH = Math.max(1, cssH - padB);

  // Moitié haute : ligne de supply.
  const hLigne = plotH * 0.55;
  const bSupply = bornes(visibles.map((p) => p.totalUsd));
  if (bSupply) {
    const y = (v: number) =>
      hLigne - ((v - bSupply.min) / Math.max(1e-9, bSupply.max - bSupply.min)) * (hLigne - 8) - 4;
    ctx.strokeStyle = cGrid;
    ctx.strokeRect(0.5, 0.5, cssW - 1, hLigne - 1);
    ctx.beginPath();
    for (let i = 0; i < visibles.length; i++) {
      const p = visibles[i]!;
      if (i === 0) ctx.moveTo(x(p.time), y(p.totalUsd));
      else ctx.lineTo(x(p.time), y(p.totalUsd));
    }
    ctx.strokeStyle = cAccent;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  // Moitié basse : barres Δ quotidien (mint vert, burn rouge), zéro au centre.
  const deltas = serieImpressionQuotidienne(visibles);
  const bDelta = bornes(deltas.map((d) => Math.abs(d.delta)));
  if (bDelta && bDelta.max > 0) {
    const y0 = hLigne + (plotH - hLigne) / 2;
    const demiH = (plotH - hLigne) / 2 - 4;
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

  // Repères de dates (début / milieu / fin du domaine) — sans eux, impossible de
  // savoir à quel jour correspond une barre de mint/burn.
  ctx.fillStyle = cTextDim;
  ctx.font = POLICE_CANVAS;
  const yLabel = cssH - 3;
  ctx.fillText(formatDateCourte(domaine.min), 2, yLabel);
  if (visibles.length > 2) {
    const milieu = (domaine.min + domaine.max) / 2;
    const texteMilieu = formatDateCourte(milieu);
    ctx.fillText(texteMilieu, x(milieu) - ctx.measureText(texteMilieu).width / 2, yLabel);
  }
  const texteFin = formatDateCourte(domaine.max);
  ctx.fillText(texteFin, cssW - 2 - ctx.measureText(texteFin).width, yLabel);
}

/** Infos du point survolé par le curseur du chart Impression (tooltip). */
interface Survol {
  xPix: number;
  largeur: number;
  point: PointSupply;
  delta: number | null;
  partUsdt: number | null;
  partUsdc: number | null;
}

function VueImpression({
  emetteurs,
  historique,
}: {
  emetteurs: EmetteurStablecoin[];
  historique: PointSupply[];
}) {
  const bornesAxe = useMemo<Domaine | null>(
    () =>
      historique.length >= 2
        ? { min: historique[0]!.time, max: historique[historique.length - 1]!.time }
        : null,
    [historique],
  );
  const [presetId, setPresetId] = useState<string | null>("90j");
  // Déclaré avant useDomaineZoom : son setter est référencé par l'onGeste qui vide le
  // survol après un zoom/pan/double-clic (sinon le trait reste figé sur l'ancien point).
  const [survol, setSurvol] = useState<Survol | null>(null);
  const { refCanvas, domaine, setDomaine } = useDomaineZoom(bornesAxe, () => {
    setPresetId(null);
    setSurvol(null);
  });

  // (Ré)applique le préréglage actif quand les bornes arrivent ou changent — le hook
  // vient de réinitialiser le domaine au tout, on le resserre sur le preset courant.
  useEffect(() => {
    if (bornesAxe === null || presetId === null) return;
    const jours = PERIODES_STANDARD.find((p) => p.id === presetId)?.jours ?? null;
    setDomaine(domainePourPreset(bornesAxe, jours));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bornesAxe?.min, bornesAxe?.max]);

  useEffect(() => {
    const canvas = refCanvas.current;
    if (canvas && domaine !== null) dessinerImpression(canvas, historique, domaine);
  }, [historique, domaine]);

  const deltas = useMemo(() => serieImpressionQuotidienne(historique), [historique]);

  // Historiques USDT/USDC (indépendants de la période affichée) pour la part du curseur.
  // Passe par /stablecoin/{id} (chargerDetailEmetteur, déjà utilisé par le drill-down) et
  // PAS par /stablecoincharts/all?stablecoin={id} : ce dernier renvoie un en-tête
  // Access-Control-Allow-Origin dupliqué (« *, * ») que les navigateurs rejettent — bug
  // côté DefiLlama constaté seulement avec la query string, invisible en curl.
  const [histUsdt, setHistUsdt] = useState<PointSupply[] | null>(null);
  const [histUsdc, setHistUsdc] = useState<PointSupply[] | null>(null);
  useEffect(() => {
    let ignore = false;
    const ctrl = new AbortController();
    chargerDetailEmetteur(ID_USDT, ctrl.signal)
      .then((d) => {
        if (!ignore) setHistUsdt(agregerHistoriqueEmetteur(d));
      })
      .catch(() => {});
    chargerDetailEmetteur(ID_USDC, ctrl.signal)
      .then((d) => {
        if (!ignore) setHistUsdc(agregerHistoriqueEmetteur(d));
      })
      .catch(() => {});
    return () => {
      ignore = true;
      ctrl.abort();
    };
  }, []);

  const onSurvol = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (domaine === null || historique.length < 2) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const t = pixelVersValeur(domaine, e.clientX - rect.left, rect.width);
    const point = pointLePlusProche(historique, t);
    if (!point) return;
    const ptUsdt = histUsdt && pointLePlusProche(histUsdt, point.time);
    const ptUsdc = histUsdc && pointLePlusProche(histUsdc, point.time);
    setSurvol({
      xPix: valeurVersPixel(domaine, point.time, rect.width),
      largeur: rect.width,
      point,
      delta: deltas.find((d) => d.time === point.time)?.delta ?? null,
      partUsdt: ptUsdt && point.totalUsd > 0 ? (ptUsdt.totalUsd / point.totalUsd) * 100 : null,
      partUsdc: ptUsdc && point.totalUsd > 0 ? (ptUsdc.totalUsd / point.totalUsd) * 100 : null,
    });
  };

  // Top mints / burns 7 j par émetteur (Δ absolu USD, pas %) — qui imprime, qui brûle.
  const avecDelta = emetteurs
    .filter((e) => e.mcap7jUsd !== null)
    .map((e) => ({ e, dUsd: e.mcapUsd - (e.mcap7jUsd ?? 0) }))
    .sort((a, b) => b.dUsd - a.dUsd);
  const mints = avecDelta.filter((x) => x.dUsd > 0).slice(0, 5);
  const burns = avecDelta.filter((x) => x.dUsd < 0).slice(-5).reverse();

  return (
    <div className="flex flex-col gap-3">
      <BarrePeriodes
        actif={presetId}
        onChange={(p) => {
          setPresetId(p.id);
          setSurvol(null);
          if (bornesAxe) setDomaine(domainePourPreset(bornesAxe, p.jours));
        }}
      />
      <div className="relative">
        <canvas
          ref={refCanvas}
          className="h-56 w-full rounded-md border border-border"
          onMouseMove={onSurvol}
          onMouseLeave={() => setSurvol(null)}
        />
        {survol && (
          <InfobulleGraphe
            xPix={survol.xPix}
            largeurGraphe={survol.largeur}
            titre={formatDateComplete(survol.point.time)}
            lignes={[
              { label: "Supply", valeur: formatUsd(survol.point.totalUsd) },
              { label: "Δ jour", valeur: fmtDeltaUsd(survol.delta), couleur: couleurDelta(survol.delta) },
              { label: "USDT", valeur: formatPourcentage(survol.partUsdt) },
              { label: "USDC", valeur: formatPourcentage(survol.partUsdc) },
            ]}
          />
        )}
      </div>
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
    if (canvas === null || serie === null) return;
    const serieTronquee = tronquerSerie(serie, 365);
    if (serieTronquee.length < 2) {
      // Série trop courte : on efface l'ancien tracé (sinon le graphe du précédent reste).
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }
    dessinerImpression(canvas, serieTronquee, {
      min: serieTronquee[0]!.time,
      max: serieTronquee[serieTronquee.length - 1]!.time,
    });
  }, [serie]);

  const partMax = parts[0]?.partPct ?? 100;
  const colonnesChaines: ColonneTable<PartChaine>[] = [
    {
      id: "chaine",
      label: "Chaîne",
      triable: false,
      rendu: (p) => (
        <span className={`font-medium ${chaineSel === p.chaine ? "text-accent" : "text-text"}`}>{p.chaine}</span>
      ),
    },
    {
      id: "supply",
      label: "Supply",
      align: "right",
      triable: false,
      rendu: (p) => formatUsd(p.totalUsd),
    },
    {
      id: "part",
      label: "Part",
      align: "right",
      triable: false,
      rendu: (p) => <span className="text-text-dim">{formatPourcentage(p.partPct, 1)}</span>,
    },
    {
      id: "barre",
      label: "",
      triable: false,
      rendu: (p) => (
        // Barre de part relative — largeur en % de la part max (lisible même quand
        // Ethereum/Tron écrasent la queue). `bg-accent` + `opacity-60` et non `bg-accent/60` :
        // les tokens thème sont des var() bruts, le modificateur d'opacité slash n'est pas
        // généré par Tailwind.
        <div
          className="h-1.5 rounded-sm bg-accent opacity-60"
          style={{ width: `${Math.max(2, (p.partPct / partMax) * 100)}%` }}
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <TableTriable
        colonnes={colonnesChaines}
        lignes={parts.slice(0, 15)}
        cle={(p) => p.chaine}
        surClicLigne={(p) => setChaineSel(p.chaine)}
      />
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
  // Filtre de matérialité ≥ $10M : sans lui, la liste est noyée de tokens morts
  // (supply de quelques $, prix ~0, −10000 bps) sans aucun intérêt analytique.
  const usd = emetteurs
    .filter((e) => e.mcapUsd >= SUPPLY_MIN_USD)
    .map((e) => ({ e, bps: ecartPegBps(e) }))
    .filter((x): x is { e: EmetteurStablecoin; bps: number } => x.bps !== null)
    .sort((a, b) => Math.abs(b.bps) - Math.abs(a.bps));
  // Pegs non-USD : listés à part, prix brut sans bps (limite DefiLlama documentée au spec).
  const autres = emetteurs.filter((e) => e.pegType !== "peggedUSD").slice(0, 10);

  const colonnesPegs: ColonneTable<{ e: EmetteurStablecoin; bps: number }>[] = [
    {
      id: "emetteur",
      label: "Émetteur",
      triable: false,
      rendu: ({ e }) => <span className="font-medium text-text">{e.symbole}</span>,
    },
    {
      id: "prix",
      label: "Prix",
      align: "right",
      triable: false,
      rendu: ({ e }) => (e.prix === null ? VALEUR_ABSENTE : e.prix.toFixed(4)),
    },
    {
      id: "ecart",
      label: "Écart",
      align: "right",
      triable: false,
      // Tout écart non nul est teinté "down" (un écart de peg n'est jamais « bon » ) ;
      // -0 || null garde le neutre à zéro exact.
      rendu: ({ bps }) => (
        <span style={{ color: couleurDelta(-Math.abs(bps) || null) }}>
          {bps >= 0 ? "+" : "−"}
          {Math.abs(bps).toFixed(1)} bps
        </span>
      ),
    },
    {
      id: "supply",
      label: "Supply",
      align: "right",
      triable: false,
      rendu: ({ e }) => formatUsd(e.mcapUsd),
    },
    {
      id: "etat",
      label: "État",
      triable: false,
      rendu: ({ bps }) => {
        const etat = etatPeg(bps);
        return <Badge ton={TON_PEG[etat]}>{LIBELLE_PEG[etat]}</Badge>;
      },
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <TableTriable
        colonnes={colonnesPegs}
        lignes={usd.slice(0, 30)}
        cle={({ e }) => e.id}
        surClicLigne={({ e }) => onSelect(e.id)}
      />
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
        Émetteurs ≥ $10M de supply uniquement.
      </NoteSource>
    </div>
  );
}

// ─────────────────────────── Drill-down émetteur ───────────────────────────

function VueEmetteur({ id, onRetour }: { id: string; onRetour: () => void }) {
  const [detail, setDetail] = useState<DetailEmetteur | null>(null);
  const [statut, setStatut] = useState<"loading" | "ready" | "error">("loading");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    let ignore = false;
    setStatut("loading");
    void chargerDetailEmetteur(id, ctrl.signal)
      .then((d) => {
        if (ignore) return;
        setDetail(d);
        setStatut("ready");
      })
      .catch(() => {
        if (!ignore) setStatut("error");
      });
    return () => {
      ignore = true;
      ctrl.abort();
    };
  }, [id]);

  const historique = detail !== null ? agregerHistoriqueEmetteur(detail) : [];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const serieTronquee = tronquerSerie(historique, 365);
    if (serieTronquee.length < 2) {
      // Série trop courte : on efface l'ancien tracé (sinon le graphe du précédent reste).
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }
    dessinerImpression(canvas, serieTronquee, {
      min: serieTronquee[0]!.time,
      max: serieTronquee[serieTronquee.length - 1]!.time,
    });
    // historique est dérivé de detail — detail suffit comme dépendance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);

  // Répartition par chaîne au DERNIER point de chaque série.
  const chaines =
    detail === null
      ? []
      : Object.entries(detail.historiqueParChaine)
          .map(([chaine, serie]) => ({ chaine, usd: serie[serie.length - 1]?.totalUsd ?? 0 }))
          .sort((a, b) => b.usd - a.usd);
  const totalChaines = chaines.reduce((s, c) => s + c.usd, 0);
  const d7 = impressionNette(historique, 7);
  const d30 = impressionNette(historique, 30);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <button type="button" className={BTN_SECONDAIRE} onClick={onRetour}>
          ← Retour
        </button>
        {detail !== null && (
          <span className="text-[11px] text-text-dim">
            {detail.nom} · {detail.pegMechanism || VALEUR_ABSENTE}
          </span>
        )}
      </div>
      {statut === "loading" && <Chargement />}
      {statut === "error" && <ErreurBloc>Détail indisponible pour cet émetteur.</ErreurBloc>}
      {statut === "ready" && detail !== null && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Metric
              label="Supply"
              value={formatUsd(historique[historique.length - 1]?.totalUsd ?? null)}
            />
            <Metric
              label="Prix"
              value={detail.prix === null ? VALEUR_ABSENTE : detail.prix.toFixed(4)}
            />
            <Metric label="Δ 7 j" value={fmtDeltaUsd(d7)} couleur={couleurDelta(d7)} />
            <Metric label="Δ 30 j" value={fmtDeltaUsd(d30)} couleur={couleurDelta(d30)} />
          </div>
          <p className="text-[11px] text-text-dim">Historique 1 a — {detail.symbole}</p>
          <canvas ref={canvasRef} className="h-48 w-full rounded-md border border-border" />
          <div className="rounded-md border border-border bg-bg px-3 py-2">
            <p className="mb-1 text-[11px] text-text-dim">Répartition par chaîne</p>
            {chaines.slice(0, 10).map((c) => (
              <div key={c.chaine} className="flex justify-between text-[11px]">
                <span className="text-text">{c.chaine}</span>
                <span className="tabular-nums">
                  {formatUsd(c.usd)}{" "}
                  <span className="text-text-dim">
                    (
                    {totalChaines > 0
                      ? formatPourcentage((c.usd / totalChaines) * 100, 1)
                      : VALEUR_ABSENTE}
                    )
                  </span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
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
  }, []);

  return (
    <>
      <EnTeteFenetre mnemo="STBL" titre="Stablecoins" sousTitre="Supply, impression, dominance, pegs · DefiLlama" />
      <Onglets
        options={ONGLETS}
        actif={onglet}
        onChange={(id) => {
          setEmetteurSelId(null); // changer d'onglet referme la fiche émetteur
          setOnglet(id);
        }}
      />
      <div className="px-4 py-3">
        {statut === "loading" && <Chargement />}
        {statut === "error" && <ErreurBloc>Impossible de charger les données DefiLlama.</ErreurBloc>}
        {statut === "ready" && emetteurs !== null && historique !== null && (
          emetteurSelId !== null ? (
            <VueEmetteur id={emetteurSelId} onRetour={() => setEmetteurSelId(null)} />
          ) : (
            <>
              {onglet === "vue" && (
                <VueEnsemble
                  emetteurs={emetteurs}
                  historique={historique}
                  onSelect={setEmetteurSelId}
                  onVoirPegs={() => {
                    setEmetteurSelId(null);
                    setOnglet("pegs");
                  }}
                />
              )}
              {onglet === "impression" && (
                <VueImpression emetteurs={emetteurs} historique={historique} />
              )}
              {onglet === "chaines" && <VueChaines emetteurs={emetteurs} />}
              {onglet === "pegs" && <VuePegs emetteurs={emetteurs} onSelect={setEmetteurSelId} />}
            </>
          )
        )}
      </div>
    </>
  );
}
