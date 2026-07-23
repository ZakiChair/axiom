/**
 * Fenêtre « CBPREM » — Premium Coinbase : gap % du spot Coinbase vs Binance sur
 * ~30 j (klines 1h), proxy de la demande institutionnelle US (cf. data/cbprem.ts).
 * Premium positif = Coinbase paie plus cher (demande US) ; négatif = décote.
 *
 * Présentation PURE (patron SqueezeWindow) : l'état de données vit dans `cbpremStore`
 * (vanilla) ; seul le survol est local à React. Le tracé suit le patron canvas des
 * fenêtres analytiques (CorrWindow/VolWindow) : dessin en CSS px sous `setTransform(dpr,…)`,
 * ResizeObserver pour la réactivité, couleurs par tokens lus AU DESSIN (thème courant). La
 * géométrie (paddings, projection index→x, valeur→y) est PARTAGÉE entre le dessin et le
 * hit-testing du survol — mêmes littéraux de part et d'autre (leçon HEATMAP) : sans ça le
 * trait du curseur ne coïnciderait pas avec le point tracé. L'enregistrement (registry /
 * commande palette) est hors périmètre ici — c'est la Task 4.
 */
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { cbpremStore } from "../store/cbprem";
import type { PointPremium } from "../data/cbprem";
import { lireTokenCanvas, rgbaTokenCanvas } from "../lib/canvasTokens";
import { formatDateCourte, formatDateHeure, formatDec, formatPct } from "../lib/format";
import {
  Badge,
  Chargement,
  EnTeteFenetre,
  ErreurBloc,
  Fraicheur,
  InfobulleGraphe,
  NoteSource,
  Segmente,
  Vide,
  type TonBadge,
} from "./ui";

// ─────────────────────────── Géométrie de tracé (partagée dessin / survol) ───────────────────────────

/** Marges intérieures du canvas (px CSS). Gauche : étiquettes % ; bas : dates. */
const PAD_L = 46;
const PAD_R = 12;
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
  vMin: number;
  vMax: number;
}

/**
 * Domaine vertical : bornes des premiums ÉLARGIES pour toujours contenir 0 (sinon la
 * ligne de zéro et les remplissages up/dessus / down/dessous seraient incohérents quand
 * toute la série partage un signe), puis une marge de respiration.
 */
function domaineY(serie: readonly PointPremium[]): DomaineY {
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const p of serie) {
    if (p.premiumPct < vMin) vMin = p.premiumPct;
    if (p.premiumPct > vMax) vMax = p.premiumPct;
  }
  vMin = Math.min(vMin, 0);
  vMax = Math.max(vMax, 0);
  const marge = (vMax - vMin) * 0.08 || 1;
  return { vMin: vMin - marge, vMax: vMax + marge };
}

/** Ordonnée d'une valeur de premium. */
function yAt(g: Geometrie, v: number, dom: DomaineY): number {
  return g.bottom - ((v - dom.vMin) / (dom.vMax - dom.vMin)) * g.plotH;
}

// ─────────────────────────── Dessin ───────────────────────────

function dessiner(canvas: HTMLCanvasElement, serie: readonly PointPremium[]): void {
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
  const yZero = yAt(g, 0, dom);

  ctx.font = "9px ui-sans-serif, system-ui, sans-serif";

  // Aire entre la courbe et la ligne de zéro (réutilisée par les deux clips).
  const tracerAire = (): void => {
    ctx.beginPath();
    ctx.moveTo(xAt(g, 0, n), yZero);
    serie.forEach((p, i) => ctx.lineTo(xAt(g, i, n), yAt(g, p.premiumPct, dom)));
    ctx.lineTo(xAt(g, n - 1, n), yZero);
    ctx.closePath();
  };

  // Remplissage léger : partie AU-DESSUS de zéro en up, EN-DESSOUS en down (clips séparés).
  ctx.save();
  ctx.beginPath();
  ctx.rect(g.left, g.top, g.plotW, Math.max(0, yZero - g.top));
  ctx.clip();
  tracerAire();
  ctx.fillStyle = rgbaTokenCanvas("--up", 0.16, "#2dc08e");
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(g.left, yZero, g.plotW, Math.max(0, g.bottom - yZero));
  ctx.clip();
  tracerAire();
  ctx.fillStyle = rgbaTokenCanvas("--down", 0.16, "#f92855");
  ctx.fill();
  ctx.restore();

  // Ligne de zéro : pointillé discret.
  ctx.save();
  ctx.strokeStyle = dim;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(g.left, yZero);
  ctx.lineTo(g.right, yZero);
  ctx.stroke();
  ctx.restore();

  // Courbe du premium.
  ctx.beginPath();
  serie.forEach((p, i) => {
    const x = xAt(g, i, n);
    const y = yAt(g, p.premiumPct, dom);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // Étiquettes Y : max (haut), 0, min (bas).
  ctx.fillStyle = dim;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(formatPct(dom.vMax, 2), 4, g.top + 4);
  ctx.fillText(formatPct(0, 2, { signe: false }), 4, yZero);
  ctx.fillText(formatPct(dom.vMin, 2), 4, g.bottom - 4);

  // Étiquettes X : dates sous-échantillonnées (~CIBLE_LABELS_X points régulièrement espacés).
  ctx.fillStyle = dim;
  ctx.textBaseline = "top";
  const pas = Math.max(1, Math.ceil(n / CIBLE_LABELS_X));
  for (let i = 0; i < n; i += pas) {
    const p = serie[i];
    if (p === undefined) continue;
    const x = xAt(g, i, n);
    ctx.textAlign = i === 0 ? "left" : "center";
    ctx.fillText(formatDateCourte(p.t), x, g.bottom + 5);
  }
}

// ─────────────────────────── Composant ───────────────────────────

/** Ton du badge « premium courant » : up si positif, down si négatif, neutre si null / nul. */
function tonPremium(courant: number | null): TonBadge {
  if (courant === null || !Number.isFinite(courant) || courant === 0) return "neutre";
  return courant > 0 ? "up" : "down";
}

interface Survol {
  xPix: number;
  largeur: number;
  point: PointPremium;
}

export function CbpremWindow() {
  const base = useStore(cbpremStore, (s) => s.base);
  const enCours = useStore(cbpremStore, (s) => s.enCours);
  const serie = useStore(cbpremStore, (s) => s.serie);
  const stats = useStore(cbpremStore, (s) => s.stats);
  const erreur = useStore(cbpremStore, (s) => s.erreur);
  const majTs = useStore(cbpremStore, (s) => s.majTs);

  const [survol, setSurvol] = useState<Survol | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Run auto au PREMIER open (FloatingWindow ne monte l'enfant que si ouvert). La garde
  // `majTs === null` (aucun run terminé) + `!enCours` + pas d'erreur évite un double run —
  // StrictMode-safe : `run()` pose `enCours:true` de façon synchrone avant son premier await,
  // donc le second montage voit `enCours` vrai et n'entre pas. `base` n'est PAS en dépendance :
  // `setBase` relance déjà `run()` dans le store (via Segmente), l'ajouter double-runnerait.
  useEffect(() => {
    const s = cbpremStore.getState();
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
    void cbpremStore.getState().run();
  };

  const courant = stats?.courant ?? null;

  return (
    <>
      <EnTeteFenetre
        mnemo="CBPREM"
        titre="Premium Coinbase"
        sousTitre={`${base}-USD vs ${base}USDT · demande institutionnelle US`}
        actions={
          <>
            <Segmente
              options={[
                { id: "BTC", label: "BTC" },
                { id: "ETH", label: "ETH" },
              ] as const}
              actif={base}
              onChange={(b) => cbpremStore.getState().setBase(b)}
            />
            <button
              type="button"
              onClick={rafraichir}
              disabled={enCours}
              className="rounded border border-border bg-bg px-2 py-1 text-[11px] text-text-dim transition hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
            >
              ↻ Rafraîchir
            </button>
          </>
        }
      />

      {/* Bandeau de synthèse : premium courant teinté, moyenne 7 j, z-score 30 j. */}
      <div className="flex shrink-0 items-center gap-4 border-b border-border px-4 py-2 text-[11px]">
        <span className="flex items-center gap-1.5">
          <span className="text-text-dim">Premium</span>
          <Badge ton={tonPremium(courant)}>{formatPct(courant, 3)}</Badge>
        </span>
        <span className="text-text-dim">
          Moy 7j <span className="tabular-nums text-text">{formatPct(stats?.moyenne7j ?? null, 3)}</span>
        </span>
        <span className="text-text-dim">
          Z 30j <span className="tabular-nums text-text">{formatDec(stats?.z30j ?? null, 2)}</span>
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-4 py-4">
        {erreur !== null && serie.length === 0 ? (
          <ErreurBloc>{erreur}</ErreurBloc>
        ) : enCours && serie.length === 0 ? (
          <Chargement libelle="Collecte klines Coinbase / Binance…" />
        ) : serie.length === 0 ? (
          <Vide>Aucun premium exploitable (klines communes Coinbase/Binance requises). Réessayez avec Rafraîchir.</Vide>
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
                titre={formatDateHeure(survol.point.t)}
                lignes={[
                  {
                    label: "Premium",
                    valeur: formatPct(survol.point.premiumPct, 3),
                    couleur: lireTokenCanvas(
                      survol.point.premiumPct >= 0 ? "--up" : "--down",
                      survol.point.premiumPct >= 0 ? "#2dc08e" : "#f92855",
                    ),
                  },
                ]}
              />
            )}
          </div>
        )}

        <div className="mt-3 flex items-center justify-between">
          <NoteSource>
            Coinbase vs Binance · klines 1h · 30 j · USD vs USDT — inclut l'écart de peg
          </NoteSource>
          <Fraicheur loading={enCours} majTs={majTs} />
        </div>
      </div>
    </>
  );
}
