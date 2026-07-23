/**
 * Fenêtre « EXPY » — Journal de trades & expectancy. Saisie manuelle d'un trade
 * (entrée, stop initial, taille, sortie optionnelle) ; tout est ramené en R (multiple
 * de risque) par le modèle PUR de `data/expy.ts`. Le store `expyStore` gère le cycle de
 * vie et la persistance (localStorage `axiom:expy:v1`) + import/export JSON.
 *
 * Présentation : en-tête à quatre badges de synthèse (expectancy R teintée, win rate,
 * profit factor, N — agrégats sur les trades FERMÉS uniquement, cf. conventions data/expy),
 * formulaire d'ajout repliable (symbole prérempli du chart), tableau des trades (fermés +
 * ouverts) et deux canvas analytiques (équité cumulée en R + histogramme des R).
 *
 * Les canvas suivent le patron NETLIQ/CBPREM : dessin en px CSS sous `setTransform(dpr,…)`,
 * ResizeObserver pour la réactivité, couleurs lues par tokens AU DESSIN (thème courant).
 * Pas de survol/infobulle en v1 (décision contrôleur) — donc pas de géométrie partagée
 * dessin/hit-test.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { expyStore } from "../store/expy";
import {
  statsExpy,
  equityR,
  histogrammeR,
  rMultiple,
  BUCKETS_R,
  type TradeJournal,
} from "../data/expy";
import { marketStore } from "../store/market";
import { navigateTo } from "../lib/navigation";
import { pousserToast } from "../store/toasts";
import { lireTokenCanvas, rgbaTokenCanvas } from "../lib/canvasTokens";
import { formatDec } from "../lib/format";
import { Badge, EnTeteFenetre, Segmente, Vide, type TonBadge } from "./ui";

// ─────────────────────────── Formatage ───────────────────────────

/** Multiple de risque « +1.35 R » (typographie du repo : formatDec porte le signe moins). */
function fmtR(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${formatDec(v, 2)} R`;
}

/** Win rate en pourcentage entier ; `statsExpy.winRate` est une FRACTION (0..1). */
function fmtWinRate(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)} %`;
}

/** Ton du badge expectancy : up si ≥ 0, down si < 0, neutre si indéfini. */
function tonExpectancy(v: number | null): TonBadge {
  if (v === null || !Number.isFinite(v)) return "neutre";
  return v >= 0 ? "up" : "down";
}

/** Couleur (token thème) d'un R : up positif, down négatif, dim nul/absent. */
function couleurR(r: number | null): string {
  if (r === null || !Number.isFinite(r) || r === 0) return "var(--text-dim)";
  return r > 0 ? "var(--up)" : "var(--down)";
}

/** Prix courant du chart (dernière clôture du buffer marché), ou undefined. */
function prixMarcheActif(): number | undefined {
  const c = marketStore.getState().candles.at(-1);
  return c ? c.close : undefined;
}

// ─────────────────────────── Dessin équité ───────────────────────────

/** Marges intérieures des canvas (px CSS). */
const PAD_L = 34;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 18;

/** Prépare le contexte (DPR, dimensions, clear) ; renvoie {ctx, w, h} ou null si taille nulle. */
function preparerCanvas(
  canvas: HTMLCanvasElement,
): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return null;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

/** Message centré discret quand un canvas n'a pas de données à tracer. */
function dessinerVide(ctx: CanvasRenderingContext2D, w: number, h: number, texte: string): void {
  ctx.fillStyle = lireTokenCanvas("--text-dim", "#94a3b8");
  ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(texte, w / 2, h / 2);
}

/** Équité cumulée en R : ligne accent + ligne de zéro pointillée (référence). */
function dessinerEquity(canvas: HTMLCanvasElement, points: readonly { ts: number; cumR: number }[]): void {
  const p = preparerCanvas(canvas);
  if (p === null) return;
  const { ctx, w, h } = p;
  const n = points.length;
  if (n === 0) {
    dessinerVide(ctx, w, h, "Aucun trade fermé");
    return;
  }

  const dim = lireTokenCanvas("--text-dim", "#94a3b8");
  const accent = lireTokenCanvas("--accent", "#38bdf8");

  const left = PAD_L;
  const right = w - PAD_R;
  const top = PAD_T;
  const bottom = h - PAD_B;
  const plotW = right - left;
  const plotH = bottom - top;

  // Domaine vertical : extrêmes du cumul ÉLARGIS pour toujours contenir 0 (référence).
  let vMin = 0;
  let vMax = 0;
  for (const pt of points) {
    if (pt.cumR < vMin) vMin = pt.cumR;
    if (pt.cumR > vMax) vMax = pt.cumR;
  }
  const marge = (vMax - vMin) * 0.1 || 1;
  vMin -= marge;
  vMax += marge;

  const xAt = (i: number): number => (n <= 1 ? left + plotW / 2 : left + (i * plotW) / (n - 1));
  const yAt = (v: number): number => bottom - ((v - vMin) / (vMax - vMin)) * plotH;

  ctx.font = "9px ui-sans-serif, system-ui, sans-serif";

  // Ligne de zéro pointillée + étiquette « 0 » à gauche.
  const yZero = yAt(0);
  ctx.save();
  ctx.strokeStyle = dim;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(left, yZero);
  ctx.lineTo(right, yZero);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = dim;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText("0", left - 4, yZero);

  // Étiquette du R cumulé final (haut ou bas selon signe) à gauche.
  const dernier = points[n - 1];
  if (dernier !== undefined) {
    ctx.textBaseline = "middle";
    ctx.fillText(formatDec(dernier.cumR, 1), left - 4, yAt(dernier.cumR));
  }

  // Courbe d'équité.
  ctx.beginPath();
  points.forEach((pt, i) => {
    const x = xAt(i);
    const y = yAt(pt.cumR);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

// ─────────────────────────── Dessin histogramme ───────────────────────────

/**
 * Ton d'un bucket d'histogramme selon le signe de sa borne basse : le bucket extrême
 * bas (« < −3 ») est down, l'extrême haut (« > 5 ») up, les internes suivent BUCKETS_R
 * (borne basse ≥ 0 → up). Le tableau `histogrammeR` a BUCKETS_R.length + 1 entrées.
 */
function tonBucket(j: number, total: number): "up" | "down" {
  if (j === 0) return "down";
  if (j === total - 1) return "up";
  const borneBasse = BUCKETS_R[j - 1];
  return borneBasse !== undefined && borneBasse >= 0 ? "up" : "down";
}

/** Histogramme des R : barres teintées par signe + effectif + étiquettes de bucket (9px). */
function dessinerHisto(canvas: HTMLCanvasElement, buckets: readonly { label: string; n: number }[]): void {
  const p = preparerCanvas(canvas);
  if (p === null) return;
  const { ctx, w, h } = p;
  const total = buckets.length;
  let maxN = 0;
  for (const b of buckets) if (b.n > maxN) maxN = b.n;
  if (total === 0 || maxN === 0) {
    dessinerVide(ctx, w, h, "Aucun trade fermé");
    return;
  }

  const dim = lireTokenCanvas("--text-dim", "#94a3b8");
  const left = 8;
  const right = w - 8;
  const top = PAD_T;
  const bottom = h - 24; // marge basse : étiquettes de bucket
  const plotW = right - left;
  const plotH = bottom - top;
  const larg = plotW / total;

  ctx.font = "9px ui-sans-serif, system-ui, sans-serif";
  ctx.textBaseline = "alphabetic";

  buckets.forEach((b, j) => {
    const x = left + j * larg;
    const hb = (b.n / maxN) * plotH;
    const ton = tonBucket(j, total);
    const nomToken = ton === "up" ? "--up" : "--down";
    const repli = ton === "up" ? "#2dc08e" : "#f92855";
    // Barre teintée par signe (avec un léger espace inter-barre).
    ctx.fillStyle = rgbaTokenCanvas(nomToken, b.n > 0 ? 0.65 : 0.15, repli);
    ctx.fillRect(x + 1, bottom - hb, Math.max(1, larg - 2), hb);
    // Effectif au-dessus de la barre (si non nul).
    if (b.n > 0) {
      ctx.fillStyle = lireTokenCanvas("--text", "#e5e7eb");
      ctx.textAlign = "center";
      ctx.fillText(String(b.n), x + larg / 2, bottom - hb - 3);
    }
    // Étiquette du bucket sous l'axe.
    ctx.fillStyle = dim;
    ctx.textAlign = "center";
    ctx.fillText(b.label, x + larg / 2, bottom + 12);
  });
}

// ─────────────────────────── Composant ───────────────────────────

/** État du formulaire d'ajout (champs texte + direction). */
interface FormEtat {
  symbol: string;
  direction: "long" | "short";
  entree: string;
  stop: string;
  taille: string;
  sortie: string;
  tags: string;
  note: string;
}

const FORM_VIDE: FormEtat = {
  symbol: "",
  direction: "long",
  entree: "",
  stop: "",
  taille: "",
  sortie: "",
  tags: "",
  note: "",
};

export function ExpyWindow() {
  const trades = useStore(expyStore, (s) => s.trades);
  const activeSymbol = useStore(marketStore, (s) => s.symbol);

  const [formOuvert, setFormOuvert] = useState(false);
  const [form, setForm] = useState<FormEtat>(FORM_VIDE);
  const [erreurForm, setErreurForm] = useState<string | null>(null);
  const [closing, setClosing] = useState<{ id: string; prix: string } | null>(null);
  // Suppression armée (pattern PortfolioWindow / SettingsPanel.restaurer).
  const [confirmSuppr, setConfirmSuppr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const equityRef = useRef<HTMLCanvasElement | null>(null);
  const histoRef = useRef<HTMLCanvasElement | null>(null);

  const stats = useMemo(() => statsExpy(trades), [trades]);
  const equity = useMemo(() => equityR(trades), [trades]);
  const histo = useMemo(() => histogrammeR(trades), [trades]);

  // Tri d'affichage : fermeTs desc puis ouvertTs desc. Les trades OUVERTS (fermeTs null)
  // remontent en tête (activité la plus récente) — fermeTs null traité comme +Infinity.
  const tri = useMemo(
    () =>
      [...trades].sort((a, b) => {
        const fa = a.fermeTs ?? Infinity;
        const fb = b.fermeTs ?? Infinity;
        if (fb !== fa) return fb - fa;
        return b.ouvertTs - a.ouvertTs;
      }),
    [trades],
  );

  const aFermes = stats.n > 0;

  // Dessin équité — redessine sur nouvelle série et au redimensionnement.
  useEffect(() => {
    const canvas = equityRef.current;
    if (canvas === null || !aFermes) return;
    const redraw = (): void => dessinerEquity(canvas, equity);
    redraw();
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [equity, aFermes]);

  // Dessin histogramme.
  useEffect(() => {
    const canvas = histoRef.current;
    if (canvas === null || !aFermes) return;
    const redraw = (): void => dessinerHisto(canvas, histo);
    redraw();
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [histo, aFermes]);

  /** Ouvre / ferme le formulaire ; à l'ouverture, préremplit le symbole du chart si vide. */
  const basculerForm = (): void => {
    // Effets HORS de l'updater d'état (updater pur → StrictMode-safe).
    if (!formOuvert) {
      setForm((f) => (f.symbol.trim() ? f : { ...f, symbol: activeSymbol }));
      setErreurForm(null);
    }
    setFormOuvert((ouvert) => !ouvert);
  };

  const submitAdd = (): void => {
    const symbol = form.symbol.trim();
    const entree = Number(form.entree);
    const stop = Number(form.stop);
    const taille = Number(form.taille);
    if (!symbol) {
      setErreurForm("Symbole requis.");
      return;
    }
    if (![entree, stop, taille].every((v) => Number.isFinite(v) && v > 0)) {
      setErreurForm("Entrée, stop et taille (> 0) requis.");
      return;
    }
    if (entree === stop) {
      setErreurForm("Le stop doit différer de l'entrée.");
      return;
    }
    // Sortie optionnelle : si fournie, le trade est enregistré déjà FERMÉ (fermeTs = maintenant).
    let sortie: number | null = null;
    let fermeTs: number | null = null;
    if (form.sortie.trim()) {
      const s = Number(form.sortie);
      if (!Number.isFinite(s) || s <= 0) {
        setErreurForm("Sortie invalide (> 0).");
        return;
      }
      sortie = s;
      fermeTs = Date.now();
    }
    const tags = form.tags
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    expyStore.getState().ajouter({
      symbol,
      direction: form.direction,
      entree,
      stopInitial: stop,
      taille,
      sortie,
      ouvertTs: Date.now(),
      fermeTs,
      note: form.note.trim() || undefined,
      tags,
    });
    setForm(FORM_VIDE);
    setErreurForm(null);
    setFormOuvert(false);
  };

  /** Ouvre l'éditeur de clôture : sortie préremplie au dernier prix du chart si même symbole. */
  const demanderCloture = (t: TradeJournal): void => {
    const px = t.symbol === activeSymbol ? prixMarcheActif() : undefined;
    setClosing({ id: t.id, prix: px !== undefined ? String(px) : "" });
  };

  const confirmerCloture = (t: TradeJournal): void => {
    const sortie = Number(closing?.prix);
    if (!Number.isFinite(sortie) || sortie <= 0) return;
    expyStore.getState().cloturer(t.id, sortie, Date.now());
    setClosing(null);
  };

  /** Export du journal (Blob JSON téléchargé `axiom-journal.json`). */
  const exporter = (): void => {
    const json = expyStore.getState().exporter();
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "axiom-journal.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  /** Lit le fichier importé et fusionne dans le store (retour {ajoutes, ignores} → toast). */
  const onFichier = (file: File | undefined): void => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const txt = typeof reader.result === "string" ? reader.result : "";
      const { ajoutes, ignores } = expyStore.getState().importer(txt);
      pousserToast(`Import : ${ajoutes} ajouté(s), ${ignores} ignoré(s)`);
    };
    reader.readAsText(file);
    // Reset pour permettre de re-sélectionner le même fichier.
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <>
      {/* Input fichier hors flux (déclenché programmatiquement). */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => onFichier(e.target.files?.[0])}
      />

      <EnTeteFenetre
        mnemo="EXPY"
        titre="Journal de trades"
        sousTitre="Expectancy en R · saisie manuelle"
        actions={
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={basculerForm}
              aria-pressed={formOuvert}
              className={`rounded border px-2 py-1 text-[11px] transition ${
                formOuvert
                  ? "border-accent/60 bg-accent/10 text-accent"
                  : "border-border bg-bg text-text-dim hover:text-text"
              }`}
            >
              + Trade
            </button>
            <button
              type="button"
              onClick={exporter}
              disabled={trades.length === 0}
              title="Exporter le journal en JSON"
              className="rounded border border-border bg-bg px-2 py-1 text-[11px] text-text-dim transition hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
            >
              Export
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Importer un journal JSON (fusion par id)"
              className="rounded border border-border bg-bg px-2 py-1 text-[11px] text-text-dim transition hover:text-text"
            >
              Import
            </button>
          </div>
        }
      />

      {/* Bandeau de synthèse : expectancy R teintée, win rate, profit factor, N (trades fermés). */}
      <div className="flex shrink-0 items-center gap-4 border-b border-border px-4 py-2 text-[11px]">
        <span className="flex items-center gap-1.5">
          <span className="text-text-dim">Expectancy</span>
          <Badge ton={tonExpectancy(stats.expectancy)}>{fmtR(stats.expectancy)}</Badge>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-text-dim">Win rate</span>
          <Badge ton="neutre">{fmtWinRate(stats.winRate)}</Badge>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-text-dim">Profit factor</span>
          <Badge ton="neutre">{formatDec(stats.profitFactor, 2)}</Badge>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-text-dim">N</span>
          <Badge ton="neutre">{stats.n}</Badge>
        </span>
      </div>

      {/* Formulaire d'ajout repliable. */}
      {formOuvert && (
        <div className="shrink-0 border-b border-border bg-bg px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              value={form.symbol}
              onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value.toUpperCase() }))}
              placeholder="Symbole"
              spellCheck={false}
              className="w-24 rounded border border-border bg-bg px-1.5 py-1 text-[11px] text-text outline-none focus:border-text-dim"
            />
            <div className="w-28">
              <Segmente
                options={[
                  { id: "long", label: "Long" },
                  { id: "short", label: "Short" },
                ] as const}
                actif={form.direction}
                onChange={(d) => setForm((f) => ({ ...f, direction: d }))}
              />
            </div>
            <input
              value={form.entree}
              onChange={(e) => setForm((f) => ({ ...f, entree: e.target.value }))}
              placeholder="Entrée"
              inputMode="decimal"
              className="w-20 rounded border border-border bg-bg px-1.5 py-1 text-[11px] tabular-nums text-text outline-none focus:border-text-dim"
            />
            <input
              value={form.stop}
              onChange={(e) => setForm((f) => ({ ...f, stop: e.target.value }))}
              placeholder="Stop"
              inputMode="decimal"
              className="w-20 rounded border border-border bg-bg px-1.5 py-1 text-[11px] tabular-nums text-text outline-none focus:border-text-dim"
            />
            <input
              value={form.taille}
              onChange={(e) => setForm((f) => ({ ...f, taille: e.target.value }))}
              placeholder="Taille"
              inputMode="decimal"
              className="w-16 rounded border border-border bg-bg px-1.5 py-1 text-[11px] tabular-nums text-text outline-none focus:border-text-dim"
            />
            <input
              value={form.sortie}
              onChange={(e) => setForm((f) => ({ ...f, sortie: e.target.value }))}
              placeholder="Sortie (opt.)"
              inputMode="decimal"
              className="w-24 rounded border border-border bg-bg px-1.5 py-1 text-[11px] tabular-nums text-text outline-none focus:border-text-dim"
            />
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <input
              value={form.tags}
              onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
              placeholder="Tags (séparés par virgules)"
              className="w-48 rounded border border-border bg-bg px-1.5 py-1 text-[11px] text-text outline-none focus:border-text-dim"
            />
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
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {/* Canvas analytiques (uniquement si au moins un trade fermé). */}
        {aFermes && (
          <div className="mb-3 space-y-3">
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-text-dim">Équité (R cumulé)</div>
              <div className="h-40 rounded-md border border-border bg-bg">
                <canvas ref={equityRef} className="h-full w-full" />
              </div>
            </div>
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-text-dim">Distribution des R</div>
              <div className="h-36 rounded-md border border-border bg-bg">
                <canvas ref={histoRef} className="h-full w-full" />
              </div>
            </div>
          </div>
        )}

        {/* Tableau des trades. */}
        <section>
          <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-text-dim">
            <span>Trades</span>
            <span>{trades.length}</span>
          </div>
          {trades.length === 0 ? (
            <Vide>Aucun trade. Ajoutez-en un avec « + Trade ».</Vide>
          ) : (
            <div className="space-y-1">
              {tri.map((t) => {
                const r = rMultiple(t);
                const ouvert = t.fermeTs === null;
                return (
                  <div key={t.id} className="rounded-md border border-border bg-bg px-2.5 py-2 text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => navigateTo({ symbol: t.symbol, exchange: "binance", source: "expy" })}
                        className="flex min-w-0 items-center gap-1.5 text-left"
                        title="Voir sur le chart"
                      >
                        <span className="font-medium text-text">{t.symbol}</span>
                        <span
                          className={`rounded px-1 text-[9px] font-semibold uppercase ${
                            t.direction === "long" ? "text-up" : "text-down"
                          }`}
                        >
                          {t.direction}
                        </span>
                        {ouvert && <Badge ton="warn">ouvert</Badge>}
                      </button>
                      <span
                        className="shrink-0 tabular-nums font-medium"
                        style={{ color: couleurR(r) }}
                      >
                        {r === null ? "—" : formatDec(r, 2)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-text-dim">
                      <span className="tabular-nums" title={t.note}>
                        {t.taille} @ {t.entree} · stop {t.stopInitial}
                        {t.sortie !== null && ` → ${t.sortie}`}
                        {t.tags.length > 0 && ` · ${t.tags.join(", ")}`}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {ouvert && closing?.id !== t.id && (
                          <button
                            type="button"
                            onClick={() => demanderCloture(t)}
                            className="rounded border border-border px-1.5 py-0.5 text-[10px] transition hover:text-accent"
                          >
                            Clôturer
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            // 1er clic : arme la confirmation ; 2e clic : supprime.
                            if (confirmSuppr !== t.id) {
                              setConfirmSuppr(t.id);
                              return;
                            }
                            setConfirmSuppr(null);
                            expyStore.getState().supprimer(t.id);
                          }}
                          onBlur={() => setConfirmSuppr((c) => (c === t.id ? null : c))}
                          aria-label={
                            confirmSuppr === t.id
                              ? `Confirmer la suppression du trade ${t.symbol}`
                              : `Supprimer le trade ${t.symbol}`
                          }
                          className={
                            confirmSuppr === t.id
                              ? "text-[10px] font-semibold uppercase text-down"
                              : "text-text-dim transition hover:text-down"
                          }
                        >
                          {confirmSuppr === t.id ? "confirmer ?" : "✕"}
                        </button>
                      </span>
                    </div>
                    {/* Éditeur de clôture inline (prix chart prérempli si même symbole). */}
                    {closing?.id === t.id && (
                      <div className="mt-2 flex items-center gap-1.5 border-t border-border pt-2">
                        <label className="text-[10px] text-text-dim">Prix sortie</label>
                        <input
                          autoFocus
                          value={closing.prix}
                          onChange={(e) => setClosing({ id: t.id, prix: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") confirmerCloture(t);
                            if (e.key === "Escape") setClosing(null);
                          }}
                          inputMode="decimal"
                          className="w-24 rounded border border-border bg-bg px-1.5 py-0.5 text-[11px] tabular-nums text-text outline-none focus:border-text-dim"
                        />
                        <button
                          type="button"
                          onClick={() => confirmerCloture(t)}
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
                );
              })}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
