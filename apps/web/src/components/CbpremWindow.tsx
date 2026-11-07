/**
 * Fenêtre « CBPREM » — Premium Coinbase : gap % du spot Coinbase vs Binance sur
 * ~30 j (klines 1h), proxy de la demande institutionnelle US (cf. data/cbprem.ts).
 * Premium positif = Coinbase paie plus cher (demande US) ; négatif = décote.
 * Deux lectures au choix (segmenté) : « Ajusté USDT » (défaut, jambe Binance convertie
 * en USD par le taux USDT/USD Kraken — peg neutralisé, doc 02 § B7) ou « Brute » (USD vs
 * USDT, inclut l'écart de peg). Si l'ajustement est indisponible, le segmenté est neutralisé
 * sur Brute et une note discrète le dit ; la `NoteSource` dit la vérité selon le mode.
 * Bandes ±2σ et z GLISSANTS 7 j, causaux : chaque point est jugé avec les 168 h qui le
 * précèdent (lui inclus), jamais avec la suite de la série ; les bandes sont tracées point
 * par point et s'interrompent là où elles sont indisponibles (moins de 30 points, σ nul).
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
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { cbpremStore } from "../store/cbprem";
import { bandesGlissantes, zPoint, type BandeGlissante, type PointPremium } from "../data/cbprem";
import { lireTokenCanvas, rgbaTokenCanvas, POLICE_CANVAS } from "../lib/canvasTokens";
import { formatDateCourte, formatDateHeure, formatDec, formatPct } from "../lib/format";
import {
  Badge,
  BoutonRafraichir,
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

/** Bandes glissantes point par point (null = indisponible à ce point) — cf. data/cbprem.ts. */
type Bandes = readonly (BandeGlissante | null)[];

/** Plages [début, fin] d'indices consécutifs où la bande glissante est disponible. */
function plagesDisponibles(bandes: Bandes): [number, number][] {
  const plages: [number, number][] = [];
  let debut = -1;
  bandes.forEach((b, i) => {
    if (b !== null && debut < 0) debut = i;
    if (b === null && debut >= 0) {
      plages.push([debut, i - 1]);
      debut = -1;
    }
  });
  if (debut >= 0) plages.push([debut, bandes.length - 1]);
  return plages;
}

/** Pas « ronds » autorisés en % pour la grille Y, du plus FIN au plus GROSSIER. */
const PAS_PCT = [0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5] as const;

/**
 * Ticks ronds (multiples d'un `PAS_PCT`) contenus dans `[min, max]`, visant ~`n`
 * lignes. Logique DUPLIQUÉE localement de la grille NETLIQ (décision spec : pas de
 * module commun pour deux fenêtres). À nombre de multiples égal, le pas plus
 * GROSSIER l'emporte (grille plus aérée). `[]` si bornes invalides ou `n ≤ 0`.
 */
function ticksPct(min: number, max: number, n: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min || n <= 0) return [];

  let meilleurPas: number = PAS_PCT[0];
  let meilleurEcart = Infinity;
  for (const pas of PAS_PCT) {
    const count = Math.floor(max / pas) - Math.ceil(min / pas) + 1;
    if (count <= 0) continue;
    const ecart = Math.abs(count - n);
    if (ecart <= meilleurEcart) {
      meilleurEcart = ecart;
      meilleurPas = pas;
    }
  }

  const ticks: number[] = [];
  for (let v = Math.ceil(min / meilleurPas) * meilleurPas; v <= max; v += meilleurPas) {
    ticks.push(v);
  }
  return ticks;
}

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
 * toute la série partage un signe) PUIS pour contenir moyenne ± 2σ de chaque bande
 * glissante disponible (sinon les bandes sortiraient du cadre et seraient invisibles),
 * enfin une marge de respiration.
 */
function domaineY(serie: readonly PointPremium[], bandes: Bandes): DomaineY {
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const p of serie) {
    if (p.premiumPct < vMin) vMin = p.premiumPct;
    if (p.premiumPct > vMax) vMax = p.premiumPct;
  }
  vMin = Math.min(vMin, 0);
  vMax = Math.max(vMax, 0);
  for (const b of bandes) {
    if (b === null) continue;
    vMin = Math.min(vMin, b.moyenne - 2 * b.sigma);
    vMax = Math.max(vMax, b.moyenne + 2 * b.sigma);
  }
  const marge = (vMax - vMin) * 0.08 || 1;
  return { vMin: vMin - marge, vMax: vMax + marge };
}

/** Ordonnée d'une valeur de premium. */
function yAt(g: Geometrie, v: number, dom: DomaineY): number {
  return g.bottom - ((v - dom.vMin) / (dom.vMax - dom.vMin)) * g.plotH;
}

// ─────────────────────────── Dessin ───────────────────────────

function dessiner(
  canvas: HTMLCanvasElement,
  serie: readonly PointPremium[],
  bandes: Bandes,
  moyenne7j: number | null,
): void {
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
  const grille = lireTokenCanvas("--grid", "#1f2937");

  const g = geometrie(w, h);
  const dom = domaineY(serie, bandes);
  const yZero = yAt(g, 0, dom);

  ctx.font = POLICE_CANVAS;

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

  // Bornes glissantes moyenne ± 2σ, point par point, sur chaque plage disponible.
  const plages = plagesDisponibles(bandes);
  const borne = (i: number, k: 2 | -2): number => {
    const b = bandes[i] as BandeGlissante; // indice pris dans une plage disponible
    return yAt(g, b.moyenne + k * b.sigma, dom);
  };

  // Bandes ±2σ : remplissage très faible entre les deux bornes (repère de dispersion en fond).
  ctx.fillStyle = rgbaTokenCanvas("--text-dim", 0.04, "#94a3b8");
  for (const [debut, fin] of plages) {
    ctx.beginPath();
    for (let i = debut; i <= fin; i++) ctx.lineTo(xAt(g, i, n), borne(i, 2));
    for (let i = fin; i >= debut; i--) ctx.lineTo(xAt(g, i, n), borne(i, -2));
    ctx.closePath();
    ctx.fill();
  }

  // Grille horizontale : 3-4 lignes aux ticks ronds % + étiquettes Y à gauche.
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const t of ticksPct(dom.vMin, dom.vMax, 4)) {
    const y = yAt(g, t, dom);
    ctx.strokeStyle = grille;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(g.left, y);
    ctx.lineTo(g.right, y);
    ctx.stroke();
    ctx.fillStyle = dim;
    // Tolérance : `ticksPct` accumule par flottant, le tick zéro peut valoir ~1e-17
    // (sinon affiché « -0.00% » — signe parasite sur l'axe).
    ctx.fillText(Math.abs(t) < 1e-9 ? "0.00%" : formatPct(t, 2), g.left - 4, y);
  }

  // Lignes ±2σ glissantes : pointillé discret token dim, interrompu hors des plages disponibles.
  ctx.save();
  ctx.strokeStyle = dim;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  for (const [debut, fin] of plages) {
    for (const k of [2, -2] as const) {
      ctx.beginPath();
      for (let i = debut; i <= fin; i++) ctx.lineTo(xAt(g, i, n), borne(i, k));
      ctx.stroke();
    }
  }
  ctx.restore();

  // Ligne « moyenne 7 j » : pointillé token accent (tendance courte).
  if (moyenne7j !== null && Number.isFinite(moyenne7j)) {
    const yM = yAt(g, moyenne7j, dom);
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(g.left, yM);
    ctx.lineTo(g.right, yM);
    ctx.stroke();
    ctx.restore();
  }

  // Ligne de zéro : trait PLEIN — référence principale, distincte des bandes pointillées.
  ctx.save();
  ctx.strokeStyle = dim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(g.left, yZero);
  ctx.lineTo(g.right, yZero);
  ctx.stroke();
  ctx.restore();

  // Courbe du premium — dessinée EN DERNIER, au-dessus des bandes et de la grille.
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

  // Étiquettes X : dates abrégées fr « JJ/MM » sous-échantillonnées (~CIBLE_LABELS_X).
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
  /** Bande glissante du point survolé (null = indisponible : moins de 30 pts sur 168 h ou σ nul). */
  bande: BandeGlissante | null;
}

/** Ligne d'infobulle du z glissant : valeur et nombre de points de la fenêtre, ou « indisponible ». */
function ligneZ(point: PointPremium, bande: BandeGlissante | null): { label: string; valeur: string; couleur: string } {
  const label = "z glissant 7j";
  if (bande === null) return { label, valeur: "indisponible", couleur: lireTokenCanvas("--text-dim", "#94a3b8") };
  const z = zPoint(point.premiumPct, bande);
  // Teinté down si extrême (|z| ≥ 2), sinon discret.
  const extreme = Math.abs(z) >= 2;
  return {
    label,
    valeur: `${formatDec(z, 2)} · ${bande.n} pts`,
    couleur: lireTokenCanvas(extreme ? "--down" : "--text-dim", extreme ? "#f92855" : "#94a3b8"),
  };
}

export function CbpremWindow() {
  const base = useStore(cbpremStore, (s) => s.base);
  const enCours = useStore(cbpremStore, (s) => s.enCours);
  const serie = useStore(cbpremStore, (s) => s.serie);
  const stats = useStore(cbpremStore, (s) => s.stats);
  const erreur = useStore(cbpremStore, (s) => s.erreur);
  const majTs = useStore(cbpremStore, (s) => s.majTs);
  const mode = useStore(cbpremStore, (s) => s.mode);
  // Booléen dérivé (pas la série elle-même) : le composant ne re-rend que si la disponibilité change.
  const ajusteeDispo = useStore(cbpremStore, (s) => s.serieAjustee.length > 0);
  const ecartPegPct = useStore(cbpremStore, (s) => s.ecartPegPct);
  const noteAjustement = useStore(cbpremStore, (s) => s.noteAjustement);

  const [survol, setSurvol] = useState<Survol | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Bandes glissantes causales (168 h, point par point) : partagées entre le tracé ±2σ et le
  // z du survol. Mémoïsées sur la série ; la dernière est celle du z courant (statsPremium).
  const bandes = useMemo(() => bandesGlissantes(serie), [serie]);
  const moyenne7j = stats?.moyenne7j ?? null;

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
    const redraw = (): void => dessiner(canvas, serie, bandes, moyenne7j);
    redraw();
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [serie, bandes, moyenne7j]);

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
    setSurvol({ xPix: xAt(g, idx, serie.length), largeur: rect.width, point, bande: bandes[idx] ?? null });
  };

  const onLeave = (): void => setSurvol(null);

  const rafraichir = (): void => {
    void cbpremStore.getState().run();
  };

  const courant = stats?.courant ?? null;

  // Segmenté de lecture. `Segmente` (ui.tsx) n'a pas de prop `disabled` : quand l'ajustée est
  // indisponible, le store force déjà `mode = "brute"` et ignore `setMode("ajuste")` ; on
  // neutralise en plus le contrôle visuellement (convention `disabled:opacity-40`) et au pointeur.
  const segmenteMode = (
    <Segmente
      options={[
        { id: "ajuste", label: "Ajusté USDT", title: "Jambe Binance convertie en USD (USDT/USD Kraken) — peg neutralisé" },
        { id: "brute", label: "Brute", title: "USD vs USDT — inclut l'écart de peg USDT" },
      ] as const}
      actif={mode}
      onChange={(m) => cbpremStore.getState().setMode(m)}
    />
  );

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
            {ajusteeDispo ? (
              segmenteMode
            ) : (
              // <div> (pas <span>) : `Segmente` rend un <div>, un bloc dans un inline serait invalide.
              <div
                className="pointer-events-none opacity-40"
                aria-disabled="true"
                title="Ajustement USDT indisponible — prime brute seule"
              >
                {segmenteMode}
              </div>
            )}
            <BoutonRafraichir onClick={rafraichir} disabled={enCours} />
          </>
        }
      />

      {/* Bandeau de synthèse : premium courant teinté, moyenne 7 j, z glissant 7 j, écart de peg. */}
      <div className="flex shrink-0 flex-wrap items-center gap-4 border-b border-border px-4 py-2 text-[11px]">
        <span className="flex items-center gap-1.5">
          <span className="text-text-dim">Premium</span>
          <Badge ton={tonPremium(courant)}>{formatPct(courant, 3)}</Badge>
        </span>
        <span className="text-text-dim">
          Moy 7j <span className="tabular-nums text-text">{formatPct(stats?.moyenne7j ?? null, 3)}</span>
        </span>
        <span
          className="text-text-dim"
          title="z descriptif du dernier premium contre les 168 h qui le précèdent, lui inclus (σ population). Indisponible sous 30 points dans la fenêtre ou si σ est nul."
        >
          Z glissant 7j{" "}
          <span className="tabular-nums text-text">
            {/* Pas encore de run : tiret ; run fait mais z non calculable : état explicite. */}
            {stats === null || stats.zGlissant7j !== null ? formatDec(stats?.zGlissant7j ?? null, 2) : "indisponible"}
          </span>
        </span>
        <span className="text-text-dim" title="(USDT/USD − 1) × 100 au dernier point aligné, source Kraken">
          Écart USDT/USD <span className="tabular-nums text-text">{formatPct(ecartPegPct, 3)}</span>
        </span>
        {/* Note d'ajustement : discrète (dim, en bout de bandeau), seulement si l'ajustée manque. */}
        {noteAjustement !== null && <span className="ml-auto text-[10px] text-text-dim">{noteAjustement}</span>}
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
        {erreur !== null && serie.length === 0 ? (
          <ErreurBloc>{erreur}</ErreurBloc>
        ) : enCours && serie.length === 0 ? (
          <Chargement libelle="Collecte klines Coinbase / Binance / Kraken…" />
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
              onPointerDown={onMove}
              onPointerMove={onMove}
              onPointerLeave={(event) => { if (event.pointerType !== "touch") onLeave(); }}
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
                  ligneZ(survol.point, survol.bande),
                ]}
              />
            )}
          </div>
        )}

        <div className="mt-3 flex items-center justify-between">
          {/* La note dit la vérité selon le mode : peg neutralisé (ajusté) ou inclus (brute). */}
          <NoteSource>
            {mode === "ajuste"
              ? "Coinbase vs Binance × USDT/USD Kraken · klines 1h · 30 j — peg neutralisé"
              : "Coinbase vs Binance · klines 1h · 30 j · USD vs USDT — inclut l'écart de peg"}
            {" · bandes ±2σ et z glissants 7 j, passé seul, descriptifs"}
          </NoteSource>
          <Fraicheur loading={enCours} majTs={majTs} />
        </div>
      </div>
    </>
  );
}
