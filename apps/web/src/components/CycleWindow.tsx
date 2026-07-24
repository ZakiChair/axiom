/**
 * Fenêtre « CYCLE » — position dans le cycle de 4 ans du Bitcoin (halving).
 *
 * Superposition des 4 cycles alignés sur le JOUR 0 = halving, en ÉCHELLE LOG sur l'indice
 * (prix / prix au halving) : l'ampleur des mouvements devient comparable d'un cycle à
 * l'autre. Le cycle courant est tracé en trait épais avec un marqueur au jour courant.
 *
 * Présentation PURE (patron NetliqWindow) : l'état vit dans `cycleStore` (vanilla) ; seul
 * le survol est local à React. Tracé canvas en px CSS sous `setTransform(dpr,…)`, couleurs
 * lues AU DESSIN (thème courant), géométrie (projection jour→x, indice→y log) PARTAGÉE
 * entre dessin et survol (mêmes littéraux — sinon le curseur ne coïnciderait pas).
 *
 * ⚠️ NOTE D'HONNÊTETÉ affichée : les cycles passés ne préjugent pas du courant. Les
 * planchers (bottoms) historiques sont des constantes documentées, pas des mesures live.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { cycleStore } from "../store/cycle";
import { FENETRE_JOURS, statsCycle, type SerieCycle } from "../data/cycle";
import { COMPARE_PALETTE } from "../store/compare";
import { lireTokenCanvas } from "../lib/canvasTokens";
import { zoneMvrvZ } from "../lib/zonesOnchain";
import { formatDateCourte, formatDec, formatEntier, VALEUR_ABSENTE } from "../lib/format";
import {
  Badge,
  Chargement,
  EnTeteFenetre,
  ErreurBloc,
  Fraicheur,
  InfobulleGraphe,
  Metric,
  NoteSource,
  Vide,
  type TonBadge,
} from "./ui";

/** Un jour en millisecondes (dates de halving et de sommet reconstruites depuis le jour post-halving). */
const JOUR_MS = 86_400_000;

/**
 * Métadonnées par cycle : plancher (drawdown top→bottom) HISTORIQUE documenté (constantes,
 * pas des mesures live) et année du plancher. Le cycle courant (2024) n'a pas de plancher.
 * Sources : cycles 2013→2015 ≈ −85 %, 2017→2018 ≈ −84 %, 2021→2022 ≈ −77 %.
 */
const CYCLE_META: Record<number, { bottomPct: number | null; anneeBottom: string }> = {
  1: { bottomPct: -85, anneeBottom: "2015" },
  2: { bottomPct: -84, anneeBottom: "2018" },
  3: { bottomPct: -77, anneeBottom: "2022" },
  4: { bottomPct: null, anneeBottom: "en cours" },
};

/** Repli hex (thème sombre) de chaque token de COMPARE_PALETTE, dans le MÊME ordre. */
const REPLI_HEX: Record<string, string> = {
  "--serie-3": "#f59e0b",
  "--serie-6": "#60a5fa",
  "--serie-2": "#a78bfa",
  "--serie-4": "#f472b6",
};

/** Couleur (token thème, lue au dessin) d'un cycle par son rang (1..4). */
function couleurCycle(halvingIndex: number): string {
  const token = COMPARE_PALETTE[(halvingIndex - 1) % COMPARE_PALETTE.length]!;
  return lireTokenCanvas(token, REPLI_HEX[token] ?? "#94a3b8");
}

/** Libellé court d'un cycle : « Cycle 2020 » (année du halving). */
function libelleCycle(halvingMs: number): string {
  return `Cycle ${new Date(halvingMs).getUTCFullYear()}`;
}

/** Le cycle courant = la dernière série dont le halving est déjà passé (max halvingIndex). */
function cycleCourant(series: readonly SerieCycle[]): SerieCycle | null {
  const now = Date.now();
  let courant: SerieCycle | null = null;
  for (const s of series) if (s.halvingMs <= now) courant = s;
  return courant;
}

// ─────────────────────────── Géométrie de tracé (partagée dessin / survol) ───────────────────────────

const PAD_L = 40;
const PAD_R = 16;
const PAD_T = 12;
const PAD_B = 22;

interface Geometrie {
  left: number;
  top: number;
  right: number;
  bottom: number;
  plotW: number;
  plotH: number;
}

/** Cadre de tracé en px CSS — MÊMES littéraux de padding pour le dessin ET le survol. */
function geometrie(w: number, h: number): Geometrie {
  const left = PAD_L;
  const top = PAD_T;
  const right = w - PAD_R;
  const bottom = h - PAD_B;
  return { left, top, right, bottom, plotW: right - left, plotH: bottom - top };
}

/** Abscisse d'un jour post-halving (0..1500 → left..right). */
function xAt(g: Geometrie, jour: number): number {
  return g.left + (jour / FENETRE_JOURS) * g.plotW;
}

/** Domaine LOG (base 10) commun à tous les cycles : bornes des log10(indice > 0). */
interface DomaineLog {
  logMin: number;
  logMax: number;
}

/** Ordonnée d'un indice en échelle log (indice ≤ 0 non projetable → renvoie NaN). */
function yAt(g: Geometrie, indice: number, dom: DomaineLog): number {
  if (!(indice > 0)) return NaN;
  const l = Math.log10(indice);
  const etendue = dom.logMax - dom.logMin || 1;
  return g.bottom - ((l - dom.logMin) / etendue) * g.plotH;
}

/** Domaine log commun sur toutes les séries (marge de respiration 4 % en haut/bas). */
function domaineLog(series: readonly SerieCycle[]): DomaineLog {
  let logMin = Infinity;
  let logMax = -Infinity;
  for (const s of series) {
    for (const p of s.points) {
      if (!(p.indice > 0)) continue;
      const l = Math.log10(p.indice);
      if (l < logMin) logMin = l;
      if (l > logMax) logMax = l;
    }
  }
  if (!Number.isFinite(logMin) || !Number.isFinite(logMax)) return { logMin: -1, logMax: 2 };
  const marge = (logMax - logMin) * 0.04 || 0.1;
  return { logMin: logMin - marge, logMax: logMax + marge };
}

/** Valeurs d'indice « rondes » servant de lignes de repère en échelle log. */
const REPERES_INDICE = [0.25, 0.5, 1, 2, 3, 5, 10, 20, 30, 50, 100, 200];

// ─────────────────────────── Dessin ───────────────────────────

function dessiner(canvas: HTMLCanvasElement, series: readonly SerieCycle[]): void {
  const ctx = canvas.getContext("2d");
  if (ctx === null) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0 || series.length === 0) return;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const dim = lireTokenCanvas("--text-dim", "#94a3b8");
  const grille = lireTokenCanvas("--grid", "#1f2937");

  const g = geometrie(w, h);
  const dom = domaineLog(series);
  const courant = cycleCourant(series);

  ctx.font = "9px ui-sans-serif, system-ui, sans-serif";

  // Grille horizontale : repères d'indice ronds dans le domaine + étiquettes Y à gauche (×N).
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const v of REPERES_INDICE) {
    const y = yAt(g, v, dom);
    if (!Number.isFinite(y) || y < g.top || y > g.bottom) continue;
    ctx.strokeStyle = grille;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(g.left, y);
    ctx.lineTo(g.right, y);
    ctx.stroke();
    ctx.fillStyle = dim;
    ctx.fillText(`×${v}`, g.left - 4, y);
  }

  // Étiquettes X : jours post-halving (0, 300, …, 1500).
  ctx.textBaseline = "top";
  for (let jour = 0; jour <= FENETRE_JOURS; jour += 300) {
    const x = xAt(g, jour);
    ctx.textAlign = jour === 0 ? "left" : "center";
    ctx.fillStyle = dim;
    ctx.fillText(`${jour} j`, x, g.bottom + 5);
  }

  // Une courbe par cycle. Le cycle courant est tracé EN DERNIER (au-dessus), trait épais.
  const ordre = [...series].sort((a, b) =>
    a === courant ? 1 : b === courant ? -1 : a.halvingIndex - b.halvingIndex,
  );
  for (const s of ordre) {
    const estCourant = s === courant;
    ctx.strokeStyle = couleurCycle(s.halvingIndex);
    ctx.lineWidth = estCourant ? 2.2 : 1.2;
    ctx.globalAlpha = estCourant ? 1 : 0.85;
    ctx.beginPath();
    let trace = false;
    for (const p of s.points) {
      const y = yAt(g, p.indice, dom);
      if (!Number.isFinite(y)) continue;
      const x = xAt(g, p.jour);
      if (!trace) {
        ctx.moveTo(x, y);
        trace = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Marqueur au dernier point du cycle courant (jour courant).
    if (estCourant && s.points.length > 0) {
      const dernier = s.points[s.points.length - 1]!;
      const x = xAt(g, dernier.jour);
      const y = yAt(g, dernier.indice, dom);
      if (Number.isFinite(y)) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = couleurCycle(s.halvingIndex);
        ctx.beginPath();
        ctx.arc(x, y, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
}

// ─────────────────────────── Composant ───────────────────────────

/** Ligne d'infobulle : l'indice d'un cycle au jour survolé. */
interface LigneSurvol {
  label: string;
  indice: number | null;
  couleur: string;
}

interface Survol {
  xPix: number;
  largeur: number;
  jour: number;
  lignes: LigneSurvol[];
}

/** Indice d'un cycle au jour le plus proche du jour survolé (null si hors plage du cycle). */
function indiceAuJour(s: SerieCycle, jour: number): number | null {
  let meilleur: number | null = null;
  let ecartMin = Infinity;
  for (const p of s.points) {
    const ecart = Math.abs(p.jour - jour);
    if (ecart < ecartMin) {
      ecartMin = ecart;
      meilleur = p.indice;
    }
  }
  // Tolérance : on n'affiche pas un point trop éloigné (cycle sans donnée à ce jour).
  return ecartMin <= 20 ? meilleur : null;
}

/** Ton du MVRV Z-Score (zones canoniques). Pour le ratio de repli : neutre. */
function tonMvrv(v: number, zscore: boolean): TonBadge {
  if (!zscore) return "neutre";
  return zoneMvrvZ(v)?.ton ?? "neutre";
}

export function CycleWindow() {
  const enCours = useStore(cycleStore, (s) => s.enCours);
  const series = useStore(cycleStore, (s) => s.series);
  const mayer = useStore(cycleStore, (s) => s.mayer);
  const mvrv = useStore(cycleStore, (s) => s.mvrv);
  const halving = useStore(cycleStore, (s) => s.halving);
  const erreur = useStore(cycleStore, (s) => s.erreur);
  const majTs = useStore(cycleStore, (s) => s.majTs);

  const [survol, setSurvol] = useState<Survol | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Run auto au PREMIER open (garde majTs === null + !enCours) — StrictMode-safe (patron NETLIQ).
  useEffect(() => {
    const s = cycleStore.getState();
    if (!s.enCours && s.majTs === null && s.erreur === null) void s.run();
  }, []);

  // Dessin — redessine sur nouvelles séries et redimensionnement.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || series.length === 0) return;
    const redraw = (): void => dessiner(canvas, series);
    redraw();
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [series]);

  const courant = useMemo(() => cycleCourant(series), [series]);
  const statsCourant = useMemo(
    () => (courant ? statsCycle(courant.points) : null),
    [courant],
  );

  // Survol : jour le plus proche → trait + indices de chaque cycle à ce jour.
  const onMove = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    if (series.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const g = geometrie(rect.width, rect.height);
    const mx = e.clientX - rect.left;
    if (mx < g.left || mx > g.right) {
      setSurvol(null);
      return;
    }
    const jour = Math.max(0, Math.min(FENETRE_JOURS, Math.round(((mx - g.left) / g.plotW) * FENETRE_JOURS)));
    const lignes: LigneSurvol[] = [...series]
      .sort((a, b) => a.halvingIndex - b.halvingIndex)
      .map((s) => ({
        label: libelleCycle(s.halvingMs),
        indice: indiceAuJour(s, jour),
        couleur: couleurCycle(s.halvingIndex),
      }));
    setSurvol({ xPix: xAt(g, jour), largeur: rect.width, jour, lignes });
  };

  const onLeave = (): void => setSurvol(null);

  const rafraichir = (): void => {
    void cycleStore.getState().run(true);
  };

  // Tuiles de synthèse.
  const joursDepuisHalving = statsCourant?.jourCourant ?? null;
  const drawdownCourant = statsCourant?.drawdownDepuisTopPct ?? null;
  const msProchainHalving = halving?.msEstimes ?? null;

  return (
    <>
      <EnTeteFenetre
        mnemo="CYCLE"
        titre="Cycle 4 ans (halving)"
        sousTitre="4 cycles alignés jour-0 · indice prix/halving (échelle log)"
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

      {/* Tuiles : jours depuis halving 2024, drawdown vs ATH, Mayer, MVRV, countdown halving. */}
      <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-border px-4 py-3 sm:grid-cols-3">
        <Metric
          label="Jours post-halving 2024"
          value={joursDepuisHalving !== null ? `${formatEntier(joursDepuisHalving)} j` : VALEUR_ABSENTE}
        />
        <Metric
          label="Drawdown vs ATH cycle"
          value={
            drawdownCourant !== null && Number.isFinite(drawdownCourant)
              ? `${formatDec(drawdownCourant, 1)} %`
              : VALEUR_ABSENTE
          }
          couleur={
            drawdownCourant !== null && drawdownCourant < 0
              ? lireTokenCanvas("--down", "#f92855")
              : undefined
          }
        />
        <Metric
          label="Mayer Multiple"
          value={mayer !== null ? formatDec(mayer, 2) : VALEUR_ABSENTE}
        />
        <Metric
          label={mvrv?.zscore === false ? "MVRV (ratio)" : "MVRV Z-Score"}
          value={mvrv !== null ? formatDec(mvrv.valeur, 2) : VALEUR_ABSENTE}
          // Le badge de zone (froid/chaud/surchauffe) n'a de sens QUE sur le Z-Score : les
          // seuils canoniques ne s'appliquent pas au ratio de repli → pas de badge pour lui.
          extra={
            mvrv !== null && mvrv.zscore ? (
              <Badge ton={tonMvrv(mvrv.valeur, true)}>{zoneMvrvZ(mvrv.valeur)?.libelle ?? "—"}</Badge>
            ) : undefined
          }
        />
        <Metric
          label="Prochain halving"
          value={msProchainHalving !== null ? `~${formatEntier(msProchainHalving / JOUR_MS)} j` : VALEUR_ABSENTE}
          extra={
            msProchainHalving !== null ? (
              <span className="text-[10px] text-text-dim">
                ≈ {formatDateCourte(Date.now() + msProchainHalving)}
              </span>
            ) : undefined
          }
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
        {erreur !== null && series.length === 0 ? (
          <ErreurBloc>{erreur}</ErreurBloc>
        ) : enCours && series.length === 0 ? (
          <Chargement libelle="Collecte de l'historique de prix (Coin Metrics)…" />
        ) : series.length === 0 ? (
          <Vide>Aucun cycle exploitable. Réessayez avec Rafraîchir.</Vide>
        ) : (
          <>
            <div className="relative min-h-0 flex-1">
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
                  titre={`Jour ${formatEntier(survol.jour)}`}
                  lignes={survol.lignes.map((l) => ({
                    label: l.label,
                    valeur: l.indice !== null ? `×${formatDec(l.indice, 2)}` : VALEUR_ABSENTE,
                    couleur: l.couleur,
                  }))}
                />
              )}
            </div>

            {/* Tableau par cycle : halving, sommet (date/×/jour), plancher historique, état courant. */}
            <div className="mt-3 max-h-40 shrink-0 overflow-y-auto">
              <table className="w-full text-[11px] tabular-nums">
                <thead className="text-text-dim">
                  <tr className="border-b border-border text-left">
                    <th className="py-1 pr-2 font-medium">Cycle</th>
                    <th className="py-1 pr-2 font-medium">Sommet</th>
                    <th className="py-1 pr-2 font-medium">×</th>
                    <th className="py-1 pr-2 font-medium">Jour</th>
                    <th className="py-1 pr-2 font-medium">Plancher hist.</th>
                    <th className="py-1 font-medium">Courant</th>
                  </tr>
                </thead>
                <tbody>
                  {[...series]
                    .sort((a, b) => a.halvingIndex - b.halvingIndex)
                    .map((s) => {
                      const st = statsCycle(s.points);
                      const meta = CYCLE_META[s.halvingIndex];
                      const topDate = Number.isFinite(st.topJour)
                        ? formatDateCourte(s.halvingMs + st.topJour * JOUR_MS)
                        : VALEUR_ABSENTE;
                      const estCourant = s === courant;
                      return (
                        <tr key={s.halvingIndex} className="border-b border-border/50">
                          <td className="py-1 pr-2">
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                className="inline-block h-2 w-2 rounded-full"
                                style={{ backgroundColor: couleurCycle(s.halvingIndex) }}
                              />
                              {libelleCycle(s.halvingMs)}
                              {estCourant && <span className="text-[9px] text-accent">courant</span>}
                            </span>
                          </td>
                          <td className="py-1 pr-2 text-text-dim">{topDate}</td>
                          <td className="py-1 pr-2">{Number.isFinite(st.topIndice) ? `×${formatDec(st.topIndice, 1)}` : VALEUR_ABSENTE}</td>
                          <td className="py-1 pr-2 text-text-dim">{Number.isFinite(st.topJour) ? `${formatEntier(st.topJour)} j` : VALEUR_ABSENTE}</td>
                          <td className="py-1 pr-2 text-down">
                            {meta?.bottomPct != null ? `${formatEntier(meta.bottomPct)} % (${meta.anneeBottom})` : "en cours"}
                          </td>
                          <td className="py-1">
                            {Number.isFinite(st.indiceCourant) ? `×${formatDec(st.indiceCourant, 2)}` : VALEUR_ABSENTE}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            <div className="mt-2 flex items-center justify-between gap-2">
              <NoteSource>
                Coin Metrics · PriceUSD daily depuis 2010 · les cycles passés ne préjugent pas du
                courant ; tops historiques 368/525/549/481 j post-halving · planchers documentés
              </NoteSource>
              <Fraicheur loading={enCours} majTs={majTs} />
            </div>
          </>
        )}
      </div>
    </>
  );
}
