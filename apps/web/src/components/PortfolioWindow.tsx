/**
 * Panneau « Portefeuille » — dockable à droite, NON MODAL (pattern DerivativesWindow).
 *
 * Positions saisies à la main (long/short) valorisées en LIVE : le PnL latent et
 * l'exposition sont recalculés à chaque tick des WS existants (subscribeTickers) et écrits
 * IMPÉRATIVEMENT dans le DOM via des refs — AUCUN re-render React sur tick (cf.
 * BUILD-CONTRACT). Le composant ne se re-rend qu'au changement de LISTE de positions.
 *
 * Fonctions : tableau des positions ouvertes (PnL live coloré via tokens --up/--down),
 * formulaire d'ajout compact, clôture au prix du marché en 1 clic (préremplit le prix de
 * sortie), et une section « Clos » repliée avec des stats simples (win rate, PnL cumulé,
 * meilleure/pire). À la clôture, une note de POST-MORTEM préremplie est proposée (lien
 * portfolio → notes). PAS d'attribution multi-facteurs (anti-objectif).
 *
 * Valorisation : subscribeTickers route par source (watchlist / inférence), donc un
 * symbole d'un exchange non inféré peut rester à « — » — dégradation gracieuse assumée.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { marketStore } from "../store/market";
import { subscribeTickers, type TickerUpdate } from "../data/ticker";
import {
  portfolioStore,
  portfolioUiStore,
  pnlLatentPosition,
  pnlLatentTotal,
  pnlRealisePosition,
  calculerExposition,
  statsClotures,
  type Position,
  type Direction,
} from "../store/portfolio";
import {
  parsePortfolioCsv,
  ligneCsvVersNouvelle,
  telechargerPortfolioCsv,
  type ResultatParseCsvPortfolio,
} from "../store/portfolioCsv";
import { notesUiStore } from "../store/notes";
import { formatPrice, formatUsd, formatPct, formatDec } from "../lib/format";
import { EnTeteFenetre, Vide } from "./ui";
import { binanceAdapter } from "../data/binance";
import { mapPool } from "../data/screenerRun";
import { lireTokenCanvas } from "../lib/canvasTokens";
import { themeStore } from "../store/theme";
import {
  serieRendementsPortefeuille,
  risquePortefeuille,
  contributionsRisque,
  betasVsRef,
  stressGrid,
  equityHistorique,
  type SerieActif,
  type PoidsPosition,
} from "../data/portRisque";
import type { Candle } from "@axiom/types";

/** Cellules DOM d'une ligne, mises à jour impérativement (hors render-loop). */
interface RowCells {
  prix: HTMLElement | null;
  pnl: HTMLElement | null;
  pct: HTMLElement | null;
}

/** Écrit un montant signé + coloré (tokens --up/--down) dans une cellule DOM. */
function writeMoney(el: HTMLElement, n: number | undefined): void {
  if (n === undefined || !Number.isFinite(n)) {
    el.textContent = "—";
    el.style.color = "";
    return;
  }
  const plus = n > 0 ? "+" : ""; // le moins est déjà porté par formatUsd
  el.textContent = `${plus}${formatUsd(n)}`;
  el.style.color = n > 0 ? "var(--up)" : n < 0 ? "var(--down)" : "";
}

/** Écrit un pourcentage signé + coloré dans une cellule DOM. */
function writePct(el: HTMLElement, pct: number | undefined): void {
  el.textContent = formatPct(pct);
  el.style.color =
    pct === undefined || !Number.isFinite(pct) ? "" : pct > 0 ? "var(--up)" : pct < 0 ? "var(--down)" : "";
}

/** Enregistre/retire une cellule DOM dans la map (callback de ref). */
function registerCell(map: Map<string, RowCells>, id: string, field: keyof RowCells, el: HTMLElement | null): void {
  const cells = map.get(id) ?? { prix: null, pnl: null, pct: null };
  cells[field] = el;
  if (cells.prix === null && cells.pnl === null && cells.pct === null) map.delete(id);
  else map.set(id, cells);
}

/** Prix courant de l'actif actif (dernière clôture du buffer marché), ou undefined. */
function prixMarcheActif(): number | undefined {
  const c = marketStore.getState().candles.at(-1);
  return c ? c.close : undefined;
}

// ── Section « Risque » : collecte klines + calculs ───────────────────────────

/** Référence de bêta (marché) : chocs de stress exprimés en variation BTC. */
const RISQUE_SYMBOLE_REF = "BTCUSDT";
/** ~91 bougies 1 j ⇒ ~90 rendements log (au-delà du seuil 30 j de risquePortefeuille). */
const RISQUE_KLINE_LIMIT = 91;
/** Concurrence du pool de collecte (décision contrôleur). */
const RISQUE_CONCURRENCY = 4;
/** TTL du cache mémoire de klines par symbole (1 h). */
const RISQUE_TTL_MS = 3_600_000;

/** Cache mémoire module des klines 1 j par symbole (partagé entre montages). */
const cacheKlines: Record<string, { ts: number; klines: Candle[] }> = {};

/** Rendements log 1 j depuis des klines (t = openTime de la bougie d'arrivée). PURE. */
function klinesVersRendements(klines: readonly Candle[]): { t: number; r: number }[] {
  const out: { t: number; r: number }[] = [];
  for (let i = 1; i < klines.length; i++) {
    const p0 = klines[i - 1]!.close;
    const p1 = klines[i]!.close;
    if (p0 > 0 && p1 > 0) out.push({ t: klines[i]!.time, r: Math.log(p1 / p0) });
  }
  return out;
}

/** Clôtures indexées par openTime (pour equityHistorique). PURE. */
function klinesVersClotures(klines: readonly Candle[]): { t: number; close: number }[] {
  return klines.map((k) => ({ t: k.time, close: k.close }));
}

/**
 * Collecte les klines 1 j des `symboles` via binanceAdapter (pool concurrence 4). Cache
 * mémoire TTL 1 h ; `force` court-circuite le TTL (bouton Rafraîchir). Les symboles en
 * échec (TradFi/non-Binance/erreur REST) sont EXCLUS de la Map résultat (dégradation).
 */
async function collecterKlines(
  symboles: readonly string[],
  force: boolean,
): Promise<Map<string, Candle[]>> {
  const now = Date.now();
  const out = new Map<string, Candle[]>();
  await mapPool([...symboles], RISQUE_CONCURRENCY, async (s) => {
    const c = cacheKlines[s];
    if (!force && c && now - c.ts < RISQUE_TTL_MS) {
      out.set(s, c.klines);
      return;
    }
    try {
      const klines = await binanceAdapter.fetchKlines(s, "1d", { limit: RISQUE_KLINE_LIMIT });
      if (klines.length > 0) {
        cacheKlines[s] = { ts: Date.now(), klines };
        out.set(s, klines);
      }
    } catch {
      // Symbole exclu du calcul de risque (compté « hors calcul » côté rendu).
    }
  });
  return out;
}

/** Marges partagées du canvas P&L (curseur/tracé cohérents). */
const PNL_PAD_L = 40;
const PNL_PAD_R = 8;

/** Dessine la courbe de P&L rétro-projeté (ligne + zéro pointillé, patron canvas repo). */
function dessinerCourbePnl(canvas: HTMLCanvasElement, points: { t: number; equity: number }[]): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (points.length < 2) return;

  const dim = lireTokenCanvas("--text-dim", "#94a3b8");
  const border = lireTokenCanvas("--border", "#334155");
  const up = lireTokenCanvas("--up", "#22c55e");
  const down = lireTokenCanvas("--down", "#ef4444");
  const police = lireTokenCanvas("--font-display", "monospace");
  ctx.font = `10px ${police}`;

  const top = 8;
  const bottom = 16;
  const plotW = Math.max(1, w - PNL_PAD_L - PNL_PAD_R);
  const plotH = Math.max(1, h - top - bottom);

  const eqs = points.map((p) => p.equity);
  let yMin = Math.min(...eqs, 0);
  let yMax = Math.max(...eqs, 0);
  const span = yMax - yMin || 1;
  const pad = span * 0.1;
  yMin -= pad;
  yMax += pad;
  const yFull = yMax - yMin || 1;
  const n = points.length;
  const xOf = (i: number): number => PNL_PAD_L + (plotW * i) / (n - 1);
  const yOf = (v: number): number => top + plotH - ((v - yMin) / yFull) * plotH;

  // Graduations Y (min / 0 / max) + libellés $.
  ctx.strokeStyle = border;
  ctx.fillStyle = dim;
  for (const v of [yMin + pad, 0, yMax - pad]) {
    const y = yOf(v);
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.moveTo(PNL_PAD_L, y);
    ctx.lineTo(PNL_PAD_L + plotW, y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillText(formatUsd(v), 2, y + 3);
  }

  // Ligne zéro pointillée (base = prix d'entrée théorique).
  ctx.save();
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = dim;
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.moveTo(PNL_PAD_L, yOf(0));
  ctx.lineTo(PNL_PAD_L + plotW, yOf(0));
  ctx.stroke();
  ctx.restore();

  // Courbe de P&L (teinte selon le signe du dernier point).
  ctx.strokeStyle = eqs[n - 1]! >= 0 ? up : down;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = xOf(i);
    const y = yOf(p.equity);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

/** Canvas P&L de la composition actuelle (90 j) — rendu PUR, non unit-testé (pattern repo). */
function CourbePnl({ points }: { points: { t: number; equity: number }[] }): JSX.Element {
  const theme = useStore(themeStore, (s) => s.theme); // redessine au changement de thème
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const redraw = (): void => dessinerCourbePnl(canvas, points);
    redraw();
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [points, theme]);
  return <canvas ref={ref} className="h-[140px] w-full" aria-hidden="true" />;
}

export function PortfolioWindow() {
  const open = useStore(portfolioUiStore, (s) => s.open);
  const positions = useStore(portfolioStore, (s) => s.positions);
  const activeSymbol = useStore(marketStore, (s) => s.symbol);
  const activeExchange = useStore(marketStore, (s) => s.exchange);

  const openPositions = useMemo(() => positions.filter((p) => p.statut === "ouvert"), [positions]);
  const closedPositions = useMemo(
    () => positions.filter((p) => p.statut === "clos").sort((a, b) => (b.dateSortie ?? 0) - (a.dateSortie ?? 0)),
    [positions]
  );
  const openSymbolsKey = useMemo(
    () => Array.from(new Set(openPositions.map((p) => p.symbole))).sort().join(","),
    [openPositions]
  );
  const stats = useMemo(() => statsClotures(positions), [positions]);

  // Ref « toujours à jour » des positions ouvertes : évite une closure périmée quand une
  // 2ᵉ position est ajoutée sur un symbole DÉJÀ souscrit (le SET de symboles ne change pas).
  const openRef = useRef<Position[]>(openPositions);
  openRef.current = openPositions;

  const latest = useRef(new Map<string, number>());
  const cells = useRef(new Map<string, RowCells>());
  const totalPnlRef = useRef<HTMLSpanElement>(null);
  const expoBruteRef = useRef<HTMLSpanElement>(null);
  const expoNetteRef = useRef<HTMLSpanElement>(null);

  // État d'ajout / clôture / proposition de post-mortem / import CSV (basse fréquence, React admis).
  const [form, setForm] = useState({ symbole: "", direction: "long" as Direction, taille: "", prixEntree: "", fraisPct: "", note: "" });
  const [erreurForm, setErreurForm] = useState<string | null>(null);
  const [closing, setClosing] = useState<{ id: string; prix: string } | null>(null);
  // Suppression armée (pattern SettingsPanel.restaurer) : id de la position à confirmer.
  const [confirmSuppr, setConfirmSuppr] = useState<string | null>(null);
  const [pmPrompt, setPmPrompt] = useState<{ position: Position; prixSortie: number } | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  /** Dry-run import CSV (null = panneau masqué). */
  const [importDryRun, setImportDryRun] = useState<ResultatParseCsvPortfolio | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Section « Risque » : repliée par défaut, collecte LAZY au dépliage (+ Rafraîchir).
  const [showRisk, setShowRisk] = useState(false);
  const [risque, setRisque] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; klines: Map<string, Candle[]>; refDispo: boolean; prix: Record<string, number> }
  >({ status: "idle" });
  /** Garde anti-course : une collecte lente ne doit pas écraser un Rafraîchir plus récent. */
  const risqueRunId = useRef(0);

  /** Collecte les klines des positions ouvertes (+ BTCUSDT réf.) et arme l'état « Risque ». */
  const collecterRisque = useCallback(async (force: boolean) => {
    const ouvertes = openRef.current;
    if (ouvertes.length === 0) return;
    const runId = ++risqueRunId.current;
    setRisque({ status: "loading" });
    // Prix courants : MÊME source que les PnL latents (WS tickers, latest.current) ?? prix d'entrée.
    const prix: Record<string, number> = {};
    for (const p of ouvertes) prix[p.symbole] = latest.current.get(p.symbole) ?? p.prixEntree;
    const symboles = Array.from(new Set([...ouvertes.map((p) => p.symbole), RISQUE_SYMBOLE_REF]));
    try {
      const klines = await collecterKlines(symboles, force);
      if (runId !== risqueRunId.current) return;
      setRisque({ status: "ready", klines, refDispo: klines.has(RISQUE_SYMBOLE_REF), prix });
    } catch (e) {
      if (runId !== risqueRunId.current) return;
      setRisque({ status: "error", message: e instanceof Error ? e.message : "collecte échouée" });
    }
  }, []);

  // Déclenche la collecte au 1er dépliage de la section (lazy). Rafraîchir force ensuite.
  useEffect(() => {
    if (open && showRisk && risque.status === "idle" && openPositions.length > 0) {
      void collecterRisque(false);
    }
  }, [open, showRisk, risque.status, openPositions.length, collecterRisque]);

  /**
   * Vue de risque dérivée : UN tableau de poids canonique (unique par symbole, w signé =
   * Σ signe·taille·prixCourant) alimente TOUTES les fonctions pures ⇒ badges $, contributions
   * et stress cohérents par construction. Symboles sans klines = exclus (comptés « hors calcul »).
   */
  const vueRisque = useMemo(() => {
    if (risque.status !== "ready") return null;
    const { klines, refDispo, prix } = risque;

    // Agrégats par symbole : notionnel signé (poids) + taille nette & coût (pour l'equity).
    const parSym = new Map<string, { notion: number; netTaille: number; cout: number }>();
    for (const p of openPositions) {
      const signe = p.direction === "long" ? 1 : -1;
      const px = prix[p.symbole] ?? p.prixEntree;
      const cur = parSym.get(p.symbole) ?? { notion: 0, netTaille: 0, cout: 0 };
      cur.notion += signe * p.taille * px;
      cur.netTaille += signe * p.taille;
      cur.cout += signe * p.taille * p.prixEntree;
      parSym.set(p.symbole, cur);
    }

    const inclus = [...parSym.keys()].filter((s) => klines.has(s));
    const horsCalcul = openPositions.filter((p) => !klines.has(p.symbole)).length;
    if (inclus.length === 0) return { vide: true as const, horsCalcul };

    const series: SerieActif[] = inclus.map((s) => ({
      symbol: s,
      rendements: klinesVersRendements(klines.get(s)!),
    }));
    const poids: PoidsPosition[] = inclus.map((s) => ({ symbol: s, poids: parSym.get(s)!.notion }));
    const sommeAbs = poids.reduce((a, p) => a + Math.abs(p.poids), 0);

    const risqueP = risquePortefeuille(serieRendementsPortefeuille(series, poids));
    const ctrs = new Map(contributionsRisque(series, poids).map((c) => [c.symbol, c.ctr]));

    const refSerie: SerieActif | null = refDispo
      ? { symbol: RISQUE_SYMBOLE_REF, rendements: klinesVersRendements(klines.get(RISQUE_SYMBOLE_REF)!) }
      : null;
    const betaMap = new Map<string, number | null>(
      (refSerie ? betasVsRef(series, refSerie) : series.map((s) => ({ symbol: s.symbol, beta: null }))).map(
        (b) => [b.symbol, b.beta],
      ),
    );
    const stress = stressGrid(poids, betaMap);

    // Equity rétro-projeté : clôtures + tailles NETTES agrégées (drop des symboles net-plats).
    const closes = new Map<string, { t: number; close: number }[]>();
    const tailles = new Map<string, { taille: number; entree: number; signe: 1 | -1 }>();
    for (const s of inclus) {
      closes.set(s, klinesVersClotures(klines.get(s)!));
      const agg = parSym.get(s)!;
      if (Math.abs(agg.netTaille) < 1e-12) continue;
      const signe: 1 | -1 = agg.netTaille > 0 ? 1 : -1;
      tailles.set(s, { taille: Math.abs(agg.netTaille), entree: agg.cout / agg.netTaille, signe });
    }
    const equity = equityHistorique(closes, tailles);

    const lignes = inclus.map((s) => ({
      symbol: s,
      poidsPct: sommeAbs > 0 ? (parSym.get(s)!.notion / sommeAbs) * 100 : 0,
      beta: betaMap.get(s) ?? null,
      ctrPct: (ctrs.get(s) ?? 0) * 100,
    }));

    return { vide: false as const, horsCalcul, sommeAbs, risqueP, lignes, stress, equity };
  }, [risque, openPositions]);

  /** Repeint toutes les lignes ouvertes + les totaux depuis les derniers prix connus. */
  const repaintAll = useCallback(() => {
    const prix = Object.fromEntries(latest.current);
    for (const p of openRef.current) {
      const row = cells.current.get(p.id);
      if (!row) continue;
      const px = latest.current.get(p.symbole);
      if (row.prix) row.prix.textContent = px !== undefined ? formatPrice(px) : "—";
      const pnl = px !== undefined ? pnlLatentPosition(p, px) : null;
      if (row.pnl) writeMoney(row.pnl, pnl?.net);
      if (row.pct) writePct(row.pct, pnl?.pct);
    }
    if (totalPnlRef.current) writeMoney(totalPnlRef.current, pnlLatentTotal(openRef.current, prix));
    const expo = calculerExposition(openRef.current, prix);
    if (expoBruteRef.current) expoBruteRef.current.textContent = formatUsd(expo.brute);
    if (expoNetteRef.current) writeMoney(expoNetteRef.current, expo.nette);
  }, []);

  // Souscription ticker LIVE des symboles ouverts (uniquement fenêtre ouverte, comme DES).
  useEffect(() => {
    if (!open) return;
    const symbols = openSymbolsKey ? openSymbolsKey.split(",") : [];
    if (symbols.length === 0) return;
    const onTick = (u: TickerUpdate) => {
      latest.current.set(u.symbol, u.price);
      repaintAll();
    };
    return subscribeTickers(symbols, onTick);
  }, [open, openSymbolsKey, repaintAll]);

  // Repeint après tout re-render de structure (nouvelle ligne, clôture) et à l'ouverture :
  // évite le flash « — » d'une cellule fraîchement montée. useLayoutEffect => refs attachées.
  useLayoutEffect(() => {
    if (open) repaintAll();
  }, [open, positions, repaintAll]);

  // Préremplit le formulaire à l'ouverture (symbole actif + prix marché) si vide.
  useEffect(() => {
    if (!open) return;
    setForm((f) => {
      if (f.symbole) return f;
      const px = prixMarcheActif();
      return { ...f, symbole: activeSymbol, prixEntree: px !== undefined ? String(px) : "" };
    });
  }, [open, activeSymbol]);

  const submitAdd = () => {
    const taille = Number(form.taille);
    const prixEntree = Number(form.prixEntree);
    if (!form.symbole.trim() || !Number.isFinite(taille) || taille <= 0 || !Number.isFinite(prixEntree) || prixEntree <= 0) {
      setErreurForm("Symbole, taille et prix d'entrée (> 0) requis.");
      return;
    }
    setErreurForm(null);
    const fraisNum = form.fraisPct.trim() ? Number(form.fraisPct) : undefined;
    portfolioStore.getState().ajouter({
      symbole: form.symbole.trim(),
      source: activeExchange,
      direction: form.direction,
      taille,
      prixEntree,
      fraisPct: fraisNum !== undefined && Number.isFinite(fraisNum) ? fraisNum : undefined,
      note: form.note.trim() || undefined,
    });
    setForm({ symbole: "", direction: "long", taille: "", prixEntree: "", fraisPct: "", note: "" });
  };

  /** Ouvre l'éditeur de clôture en préremplissant le prix marché (ou le prix d'entrée). */
  const demanderCloture = (p: Position) => {
    const px = latest.current.get(p.symbole) ?? p.prixEntree;
    setClosing({ id: p.id, prix: String(px) });
  };

  const confirmerCloture = (p: Position) => {
    const prixSortie = Number(closing?.prix);
    if (!Number.isFinite(prixSortie) || prixSortie <= 0) return;
    portfolioStore.getState().cloturer(p.id, prixSortie);
    setClosing(null);
    setPmPrompt({ position: p, prixSortie }); // propose un post-mortem (opt-in)
  };

  /** Ouvre le panneau Notes avec un brouillon de post-mortem prérempli. */
  const redigerPostMortem = () => {
    if (!pmPrompt) return;
    const { position: p, prixSortie } = pmPrompt;
    const pnl = pnlRealisePosition({ ...p, statut: "clos", prixSortie });
    const netTxt = pnl ? `${pnl.net > 0 ? "+" : ""}${formatUsd(pnl.net)} (${pnl.pct.toFixed(2)}%)` : "—";
    const texte =
      `Post-mortem ${p.symbole} ${p.direction} — entrée ${p.prixEntree}, sortie ${prixSortie}, PnL net ${netTxt}.\n\n` +
      `Ce qui a marché :\n\nÀ améliorer :`;
    notesUiStore.getState().proposerNote({
      symbole: p.symbole,
      source: p.source,
      prix: prixSortie,
      texte,
      tags: ["post-mortem"],
    });
    setPmPrompt(null);
  };

  /** Change le symbole du graphe (et restaure la source d'origine de la position). */
  const voirSurChart = (p: Position) => {
    marketStore.getState().setExchange(p.source);
    marketStore.getState().setSymbol(p.symbole);
  };

  /** Ouvre le sélecteur de fichier CSV (import dry-run). */
  const declencherImportCsv = () => {
    fileInputRef.current?.click();
  };

  /** Lit le fichier, parse en dry-run (aucune mutation store tant que non confirmé). */
  const onFichierCsv = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const texte = typeof reader.result === "string" ? reader.result : "";
      setImportDryRun(parsePortfolioCsv(texte));
    };
    reader.readAsText(file);
    // Reset pour permettre de re-sélectionner le même fichier.
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  /** Confirme le dry-run : ajoute chaque ligne valide (source défaut = exchange actif). */
  const confirmerImportCsv = () => {
    if (!importDryRun || importDryRun.ok.length === 0) {
      setImportDryRun(null);
      return;
    }
    const ajouter = portfolioStore.getState().ajouter;
    for (const l of importDryRun.ok) {
      ajouter(ligneCsvVersNouvelle(l, activeExchange));
    }
    setImportDryRun(null);
  };

  return (
    <>
      {/* Input fichier hors flux (déclenché programmatiquement) */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => onFichierCsv(e.target.files?.[0])}
      />

      {/* En-tête standard, sans croix de fermeture : celle-ci est fournie par le chrome FloatingWindow */}
      <EnTeteFenetre mnemo="PORT" titre="Portefeuille" sousTitre="Positions manuelles · PnL live" />

      {/* Barre import / export CSV */}
      <div className="flex shrink-0 items-center justify-end gap-1.5 border-b border-border px-4 py-1.5">
        <button
          type="button"
          onClick={declencherImportCsv}
          className="rounded border border-border bg-surface px-2 py-0.5 text-[10px] text-text-dim transition hover:text-accent"
          title="Importer des positions depuis un CSV (dry-run)"
        >
          Import CSV
        </button>
        <button
          type="button"
          onClick={() => telechargerPortfolioCsv(positions)}
          disabled={positions.length === 0}
          className="rounded border border-border bg-surface px-2 py-0.5 text-[10px] text-text-dim transition hover:text-accent disabled:opacity-40"
          title="Exporter les positions en CSV"
        >
          Export CSV
        </button>
      </div>

      {/* Totaux (maj impérative sur tick) */}
      <div className="grid shrink-0 grid-cols-3 gap-2 border-b border-border px-4 py-3 text-center">
        <div className="rounded-md border border-border bg-bg px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-text-dim">PnL latent</div>
          <span ref={totalPnlRef} className="tabular-nums text-sm font-medium text-text">—</span>
        </div>
        <div className="rounded-md border border-border bg-bg px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-text-dim">Expo brute</div>
          <span ref={expoBruteRef} className="tabular-nums text-sm font-medium text-text">—</span>
        </div>
        <div className="rounded-md border border-border bg-bg px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-text-dim">Expo nette</div>
          <span ref={expoNetteRef} className="tabular-nums text-sm font-medium text-text">—</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {/* Dry-run import CSV : validation avant écriture store */}
        {importDryRun && (
          <div className="mb-3 rounded-md border border-accent/50 bg-bg px-3 py-2 text-[11px] text-text">
            <div className="mb-1.5 font-medium">
              Import CSV — dry-run
            </div>
            <div className="mb-1.5 flex gap-3 text-[10px] text-text-dim">
              <span>
                Valides :{" "}
                <span className="tabular-nums text-up">{importDryRun.ok.length}</span>
              </span>
              <span>
                Erreurs :{" "}
                <span
                  className={`tabular-nums ${
                    importDryRun.erreurs.length > 0 ? "text-down" : ""
                  }`}
                >
                  {importDryRun.erreurs.length}
                </span>
              </span>
            </div>
            {importDryRun.ok.length > 0 && (
              <div className="mb-1.5 max-h-24 overflow-y-auto rounded border border-border bg-surface/40 px-2 py-1 text-[10px] text-text-dim">
                {importDryRun.ok.slice(0, 12).map((l, i) => (
                  <div key={`${l.symbole}-${i}`} className="tabular-nums">
                    {l.symbole} {l.direction} {l.taille} @ {l.prixEntree}
                    {l.source ? ` · ${l.source}` : " · (exchange actif)"}
                  </div>
                ))}
                {importDryRun.ok.length > 12 && (
                  <div>… +{importDryRun.ok.length - 12} autres</div>
                )}
              </div>
            )}
            {importDryRun.erreurs.length > 0 && (
              <div className="mb-1.5 max-h-20 overflow-y-auto rounded border border-down/40 bg-surface/40 px-2 py-1 text-[10px] text-down">
                {importDryRun.erreurs.slice(0, 8).map((e, i) => (
                  <div key={`${e.ligne}-${i}`}>
                    L{e.ligne}: {e.message}
                  </div>
                ))}
                {importDryRun.erreurs.length > 8 && (
                  <div>… +{importDryRun.erreurs.length - 8} autres</div>
                )}
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={confirmerImportCsv}
                disabled={importDryRun.ok.length === 0}
                className="rounded border border-border bg-surface px-2 py-1 text-[10px] transition hover:text-accent disabled:opacity-40"
              >
                Importer {importDryRun.ok.length > 0 ? `(${importDryRun.ok.length})` : ""}
              </button>
              <button
                type="button"
                onClick={() => setImportDryRun(null)}
                className="rounded px-2 py-1 text-[10px] text-text-dim transition hover:text-text"
              >
                Annuler
              </button>
            </div>
          </div>
        )}

        {/* Proposition de post-mortem après clôture */}
        {pmPrompt && (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-md border border-accent/50 bg-bg px-3 py-2 text-[11px] text-text">
            <span>Position clôturée. Rédiger une note de post-mortem ?</span>
            <span className="flex shrink-0 gap-1.5">
              <button
                type="button"
                onClick={redigerPostMortem}
                className="rounded border border-border bg-surface px-2 py-1 text-[10px] transition hover:text-accent"
              >
                Rédiger
              </button>
              <button
                type="button"
                onClick={() => setPmPrompt(null)}
                aria-label="Ignorer le post-mortem"
                className="rounded px-1 text-text-dim transition hover:text-text"
              >
                ✕
              </button>
            </span>
          </div>
        )}

        {/* Positions ouvertes */}
        <section>
          <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-text-dim">
            <span>Ouvertes</span>
            <span>{openPositions.length}</span>
          </div>
          {openPositions.length === 0 ? (
            <Vide>Aucune position ouverte. Ajoutez-en une ci-dessous.</Vide>
          ) : (
            <div className="space-y-1">
              {openPositions.map((p) => (
                <div key={p.id} className="rounded-md border border-border bg-bg px-2.5 py-2 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => voirSurChart(p)}
                      className="flex min-w-0 items-center gap-1.5 text-left"
                      title="Voir sur le chart"
                    >
                      <span className="font-medium text-text">{p.symbole}</span>
                      <span
                        className={`rounded px-1 text-[9px] font-semibold uppercase ${
                          p.direction === "long" ? "text-up" : "text-down"
                        }`}
                      >
                        {p.direction}
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-2">
                      <span ref={(el) => registerCell(cells.current, p.id, "pnl", el)} className="tabular-nums font-medium">—</span>
                      <span ref={(el) => registerCell(cells.current, p.id, "pct", el)} className="tabular-nums text-[10px]">—</span>
                    </div>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-text-dim">
                    <span className="tabular-nums">
                      {p.taille} @ {formatPrice(p.prixEntree)}
                      {p.fraisPct !== undefined ? ` · ${p.fraisPct}%` : ""}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums text-text-dim">
                        mkt <span ref={(el) => registerCell(cells.current, p.id, "prix", el)} className="text-text">—</span>
                      </span>
                      {closing?.id !== p.id && (
                        <button
                          type="button"
                          onClick={() => demanderCloture(p)}
                          className="rounded border border-border px-1.5 py-0.5 text-[10px] transition hover:text-accent"
                        >
                          Clôturer
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          // 1er clic : arme la confirmation ; 2e clic : supprime (pattern SettingsPanel.restaurer).
                          if (confirmSuppr !== p.id) {
                            setConfirmSuppr(p.id);
                            return;
                          }
                          setConfirmSuppr(null);
                          portfolioStore.getState().supprimer(p.id);
                        }}
                        onBlur={() => setConfirmSuppr((c) => (c === p.id ? null : c))}
                        aria-label={
                          confirmSuppr === p.id
                            ? `Confirmer la suppression de ${p.symbole}`
                            : `Supprimer ${p.symbole}`
                        }
                        className={
                          confirmSuppr === p.id
                            ? "text-[10px] font-semibold uppercase text-down"
                            : "text-text-dim transition hover:text-down"
                        }
                      >
                        {confirmSuppr === p.id ? "confirmer ?" : "✕"}
                      </button>
                    </span>
                  </div>
                  {/* Éditeur de clôture inline (prix marché prérempli) */}
                  {closing?.id === p.id && (
                    <div className="mt-2 flex items-center gap-1.5 border-t border-border pt-2">
                      <label className="text-[10px] text-text-dim">Prix sortie</label>
                      <input
                        autoFocus
                        value={closing.prix}
                        onChange={(e) => setClosing({ id: p.id, prix: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") confirmerCloture(p);
                          if (e.key === "Escape") setClosing(null);
                        }}
                        inputMode="decimal"
                        className="w-24 rounded border border-border bg-bg px-1.5 py-0.5 text-[11px] tabular-nums text-text outline-none focus:border-text-dim"
                      />
                      <button
                        type="button"
                        onClick={() => confirmerCloture(p)}
                        className="rounded border border-border bg-surface px-2 py-0.5 text-[10px] transition hover:text-accent"
                      >
                        OK
                      </button>
                      <button
                        type="button"
                        onClick={() => setClosing(null)}
                        className="rounded px-1 text-[10px] text-text-dim transition hover:text-text"
                      >
                        Annuler
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Formulaire d'ajout compact */}
        <section className="mt-3 rounded-md border border-border bg-bg p-2.5">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-text-dim">Nouvelle position</div>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              value={form.symbole}
              onChange={(e) => setForm((f) => ({ ...f, symbole: e.target.value.toUpperCase() }))}
              placeholder="Symbole"
              spellCheck={false}
              className="w-24 rounded border border-border bg-bg px-1.5 py-1 text-[11px] text-text outline-none focus:border-text-dim"
            />
            <div className="flex overflow-hidden rounded border border-border">
              {(["long", "short"] as Direction[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, direction: d }))}
                  className={`px-2 py-1 text-[10px] font-semibold uppercase transition ${
                    form.direction === d
                      ? `bg-surface ${d === "long" ? "text-up" : "text-down"}`
                      : "text-text-dim hover:text-text"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
            <input
              value={form.taille}
              onChange={(e) => setForm((f) => ({ ...f, taille: e.target.value }))}
              placeholder="Taille"
              inputMode="decimal"
              className="w-16 rounded border border-border bg-bg px-1.5 py-1 text-[11px] tabular-nums text-text outline-none focus:border-text-dim"
            />
            <input
              value={form.prixEntree}
              onChange={(e) => setForm((f) => ({ ...f, prixEntree: e.target.value }))}
              placeholder="Prix"
              inputMode="decimal"
              className="w-20 rounded border border-border bg-bg px-1.5 py-1 text-[11px] tabular-nums text-text outline-none focus:border-text-dim"
            />
            <input
              value={form.fraisPct}
              onChange={(e) => setForm((f) => ({ ...f, fraisPct: e.target.value }))}
              placeholder="Frais %"
              inputMode="decimal"
              className="w-16 rounded border border-border bg-bg px-1.5 py-1 text-[11px] tabular-nums text-text outline-none focus:border-text-dim"
            />
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <input
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitAdd();
              }}
              placeholder="Note (optionnel)"
              className="min-w-0 flex-1 rounded border border-border bg-bg px-1.5 py-1 text-[11px] text-text outline-none focus:border-text-dim"
            />
            <button
              type="button"
              onClick={submitAdd}
              className="shrink-0 rounded border border-border bg-surface px-3 py-1 text-[11px] text-text transition hover:text-accent"
            >
              Ajouter
            </button>
          </div>
          {erreurForm !== null && <p className="mt-1.5 text-[10px] text-down">{erreurForm}</p>}
        </section>

        {/* Section « Clos » repliée + stats */}
        <section className="mt-3">
          <button
            type="button"
            onClick={() => setShowClosed((v) => !v)}
            aria-expanded={showClosed}
            className="flex w-full items-center justify-between rounded-md border border-border bg-bg px-3 py-2 text-[11px] text-text-dim transition hover:text-text"
          >
            <span className="uppercase tracking-wider">Clos ({stats.nombre})</span>
            <span className="flex items-center gap-3 tabular-nums">
              <span>
                Win {stats.nombre > 0 ? `${stats.winRate.toFixed(0)}%` : "—"}
              </span>
              <span className={stats.pnlCumule > 0 ? "text-up" : stats.pnlCumule < 0 ? "text-down" : undefined}>
                {stats.nombre > 0 ? `${stats.pnlCumule > 0 ? "+" : ""}${formatUsd(stats.pnlCumule)}` : "—"}
              </span>
              <span>{showClosed ? "▾" : "▸"}</span>
            </span>
          </button>
          {showClosed && (
            <div className="mt-1 space-y-1">
              {stats.nombre > 0 && (
                <div className="flex justify-between rounded-md border border-border bg-bg px-3 py-1.5 text-[10px] text-text-dim">
                  <span>Meilleure <span className="tabular-nums text-up">{formatUsd(stats.meilleure ?? undefined)}</span></span>
                  <span>Pire <span className="tabular-nums text-down">{formatUsd(stats.pire ?? undefined)}</span></span>
                </div>
              )}
              {closedPositions.length === 0 ? (
                <Vide>Aucune position clôturée.</Vide>
              ) : (
                closedPositions.map((p) => {
                  const pnl = pnlRealisePosition(p);
                  return (
                    <div key={p.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-bg px-2.5 py-1.5 text-[11px]">
                      <button type="button" onClick={() => voirSurChart(p)} className="flex items-center gap-1.5 text-left" title="Voir sur le chart">
                        <span className="font-medium text-text">{p.symbole}</span>
                        <span className={`text-[9px] font-semibold uppercase ${p.direction === "long" ? "text-up" : "text-down"}`}>
                          {p.direction}
                        </span>
                      </button>
                      <span className="flex items-center gap-2 text-[10px] text-text-dim">
                        <span className="tabular-nums">{formatPrice(p.prixEntree)} → {formatPrice(p.prixSortie ?? 0)}</span>
                        <span
                          className={`tabular-nums font-medium ${
                            pnl && pnl.net > 0 ? "text-up" : pnl && pnl.net < 0 ? "text-down" : ""
                          }`}
                        >
                          {pnl ? `${pnl.net > 0 ? "+" : ""}${formatUsd(pnl.net)}` : "—"}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            // 1er clic : arme la confirmation ; 2e clic : supprime (pattern SettingsPanel.restaurer).
                            // Position close = historique irrécupérable → confirmation obligatoire.
                            if (confirmSuppr !== p.id) {
                              setConfirmSuppr(p.id);
                              return;
                            }
                            setConfirmSuppr(null);
                            portfolioStore.getState().supprimer(p.id);
                          }}
                          onBlur={() => setConfirmSuppr((c) => (c === p.id ? null : c))}
                          aria-label={
                            confirmSuppr === p.id
                              ? `Confirmer la suppression de ${p.symbole}`
                              : `Supprimer ${p.symbole}`
                          }
                          className={
                            confirmSuppr === p.id
                              ? "text-[10px] font-semibold uppercase text-down"
                              : "text-text-dim transition hover:text-down"
                          }
                        >
                          {confirmSuppr === p.id ? "confirmer ?" : "✕"}
                        </button>
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </section>

        {/* Section « Risque » — repliée par défaut, collecte lazy au dépliage (masquée si 0 position ouverte) */}
        {openPositions.length > 0 && (
          <section className="mt-3">
            <button
              type="button"
              onClick={() => setShowRisk((v) => !v)}
              aria-expanded={showRisk}
              className="flex w-full items-center justify-between rounded-md border border-border bg-bg px-3 py-2 text-[11px] text-text-dim transition hover:text-text"
            >
              <span className="uppercase tracking-wider">Risque (VaR · β · stress)</span>
              <span>{showRisk ? "▾" : "▸"}</span>
            </button>
            {showRisk && (
              <div className="mt-1 space-y-2">
                <div className="flex items-center justify-between text-[10px] text-text-dim">
                  <span>Composition actuelle · 90 j Binance</span>
                  <button
                    type="button"
                    onClick={() => void collecterRisque(true)}
                    disabled={risque.status === "loading"}
                    className="rounded border border-border bg-surface px-2 py-0.5 text-[10px] transition hover:text-accent disabled:opacity-40"
                  >
                    {risque.status === "loading" ? "Collecte…" : "Rafraîchir"}
                  </button>
                </div>

                {risque.status === "loading" && <Vide>Collecte des klines 1 j…</Vide>}
                {risque.status === "error" && <Vide>Collecte échouée : {risque.message}</Vide>}
                {vueRisque?.vide && (
                  <Vide>
                    Aucun symbole exploitable (périmètre crypto-Binance).
                    {vueRisque.horsCalcul > 0 ? ` ${vueRisque.horsCalcul} position(s) hors calcul.` : ""}
                  </Vide>
                )}

                {vueRisque && !vueRisque.vide && (
                  <>
                    {vueRisque.horsCalcul > 0 && (
                      <p className="text-[10px] text-text-dim">
                        {vueRisque.horsCalcul} position(s) hors calcul de risque (hors périmètre crypto-Binance).
                      </p>
                    )}

                    {/* Badges VaR / CVaR 1 j */}
                    {vueRisque.risqueP === null ? (
                      <Vide>Historique insuffisant (&lt; 30 j communs).</Vide>
                    ) : (
                      <div className="grid grid-cols-3 gap-2 text-center">
                        {(
                          [
                            ["VaR 95% · 1j", vueRisque.risqueP.var95Pct],
                            ["VaR 99% · 1j", vueRisque.risqueP.var99Pct],
                            ["CVaR 95%", vueRisque.risqueP.cvar95Pct],
                          ] as const
                        ).map(([label, pct]) => (
                          <div key={label} className="rounded-md border border-border bg-bg px-2 py-1.5">
                            <div className="text-[9px] uppercase tracking-wider text-text-dim">{label}</div>
                            <div className="tabular-nums text-sm font-medium text-down">
                              {pct >= 0 ? "−" : "+"}{formatUsd(Math.abs(pct) * vueRisque.sommeAbs)}
                            </div>
                            <div className="tabular-nums text-[10px] text-text-dim">
                              {formatPct(pct * 100, 2, { signe: false })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Tableau des contributions au risque */}
                    <div className="rounded-md border border-border bg-bg px-2.5 py-2">
                      <div className="mb-1.5 grid grid-cols-[1fr_auto_auto_auto] gap-2 text-[9px] uppercase tracking-wider text-text-dim">
                        <span>Symbole</span>
                        <span className="text-right">Poids</span>
                        <span className="text-right">β BTC</span>
                        <span className="text-right">Contrib.</span>
                      </div>
                      {vueRisque.lignes.map((l) => (
                        <div
                          key={l.symbol}
                          className="grid grid-cols-[1fr_auto_auto_auto] gap-2 py-0.5 text-[11px] tabular-nums"
                        >
                          <span className="font-medium text-text">{l.symbol}</span>
                          <span className="text-right text-text-dim">
                            {formatPct(l.poidsPct, 1, { signe: false })}
                          </span>
                          <span className="text-right text-text-dim">{formatDec(l.beta, 2)}</span>
                          <span
                            className={`text-right ${
                              l.ctrPct > 0 ? "text-up" : l.ctrPct < 0 ? "text-down" : "text-text-dim"
                            }`}
                          >
                            {formatPct(l.ctrPct, 1)}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Grille de stress (choc BTC → impact linéaire en β) */}
                    <div className="grid grid-cols-2 gap-2">
                      {vueRisque.stress.map((c) => (
                        <div key={c.chocPct} className="rounded-md border border-border bg-bg px-2 py-1.5">
                          <div className="text-[9px] uppercase tracking-wider text-text-dim">
                            Choc BTC {c.chocPct > 0 ? "+" : ""}
                            {c.chocPct}%
                          </div>
                          <div
                            className={`tabular-nums text-sm font-medium ${
                              c.impactUsd > 0 ? "text-up" : c.impactUsd < 0 ? "text-down" : "text-text"
                            }`}
                          >
                            {c.impactUsd > 0 ? "+" : ""}
                            {formatUsd(c.impactUsd)}
                          </div>
                          {c.couvertUsd < vueRisque.sommeAbs && (
                            <div className="text-[9px] text-text-dim">
                              couvre {((c.couvertUsd / vueRisque.sommeAbs) * 100).toFixed(0)}% du notionnel
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Courbe de P&L de la composition actuelle (90 j) */}
                    {vueRisque.equity.length >= 2 && (
                      <div className="rounded-md border border-border bg-bg px-2 py-2">
                        <div className="mb-1 text-[10px] uppercase tracking-wider text-text-dim">
                          P&amp;L de la composition actuelle (90 j)
                        </div>
                        <CourbePnl points={vueRisque.equity} />
                      </div>
                    )}

                    {/* Note d'honnêteté : 3 approximations assumées */}
                    <p className="text-[9px] leading-relaxed text-text-dim">
                      Approximations : composition ACTUELLE rétro-projetée (constante dans le temps) ;
                      stress LINÉAIRE en β vs BTC ; périmètre crypto-Binance uniquement. La VaR en %
                      est exprimée sur le notionnel BRUT (Σ|positions|).
                    </p>
                  </>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </>
  );
}
