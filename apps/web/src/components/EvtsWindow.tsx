/**
 * EVTS — Étude d'évènements : aligne la performance du prix du symbole suivi autour des
 * dernières occurrences d'un évènement macro (CPI / NFP / FOMC), en base 100 par rapport
 * à la bougie qui couvre l'évènement (H0).
 *
 * Données : dates via `chargerDatesEvenement` (Task 1, FRED release/dates pour CPI/NFP,
 * statique pour FOMC). Pour CHAQUE évènement passé, un fetch fenêtré `getAdapter.fetchKlines`
 * (pas de pagination massive — ~1 fetch de ≤ 106 bougies par occurrence). Alignement /
 * agrégats / stats via les fonctions PURES de lib/evts.ts (Task 2). Rendu impératif canvas.
 *
 * Honnêteté d'échantillon : les agrégats (médiane, bande p25–p75) et les stats ne portent
 * QUE sur les fenêtres COMPLÈTES affichées ; les occurrences exclues sont listées avec leur
 * raison (fenêtre incomplète — ex. évènement trop récent — ou échec de chargement).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type { Candle, ExchangeId } from "@axiom/types";
import { getAdapter } from "../data/adapters";
import {
  chargerDatesEvenement,
  TYPES_EVENEMENT,
  type TypeEvenement,
} from "../data/macro/eventDates";
import {
  agregerFenetres,
  alignerFenetre,
  derniersPasses,
  fenetreFetch,
  libelleStatParType,
  statsEvts,
  type AgregatEvts,
  type FenetreAlignee,
  type OccurrenceExclue,
} from "../lib/evts";
import { lireTokenCanvas, POLICE_CANVAS, rgbaTokenCanvas } from "../lib/canvasTokens";
import { formatDateComplete, formatPct, formatPourcentage } from "../lib/format";
import { marketStore } from "../store/market";
import { evtsUiStore } from "../store/evts";
import { windowManagerStore } from "../store/windowManager";
import { Chargement, EnTeteFenetre, ErreurBloc, TuileStat, NoteSource, Segmente, Vide } from "./ui";

// ─────────────────────────── Contrôles ───────────────────────────

type Tf = "1h" | "1d";
type Statut = "idle" | "loading" | "ready" | "error";

/** Millisecondes par bougie selon le TF (contrat Task 3). */
const TF_MS: Record<Tf, number> = { "1h": 3_600_000, "1d": 86_400_000 };

const OPTIONS_TF: ReadonlyArray<{ id: Tf; label: string }> = [
  { id: "1h", label: "1 h" },
  { id: "1d", label: "1 j" },
];
const OPTIONS_DEMI: ReadonlyArray<{ id: number; label: string }> = [
  { id: 12, label: "±12" },
  { id: 24, label: "±24" },
  { id: 48, label: "±48" },
];
const OPTIONS_N: ReadonlyArray<{ id: number; label: string }> = [
  { id: 6, label: "6" },
  { id: 12, label: "12" },
  { id: 24, label: "24" },
];

/** Unité d'offset lisible selon le TF (axe X, libellés de stats). */
function uniteTf(tf: Tf): string {
  return tf === "1h" ? "h" : "j";
}

/** Libellé FR de la raison d'exclusion d'une occurrence. */
function libelleRaison(raison: OccurrenceExclue["raison"]): string {
  return raison === "fetch-echec" ? "échec de chargement" : "fenêtre incomplète";
}

// ─────────────────────────── Calcul (fetch par évènement) ───────────────────────────

interface ResultatCalcul {
  /** true si aucune date exploitable (source en panne / aucun évènement passé). */
  datesVides: boolean;
  /** Un résultat par occurrence passée, dans l'ordre chronologique (alignée ou exclue). */
  resultats: (FenetreAlignee | OccurrenceExclue)[];
}

/**
 * Charge les dates de `type`, prend les `n` derniers évènements PASSÉS, puis effectue UN
 * fetch fenêtré par évènement et aligne chaque fenêtre. Échec de fetch individuel →
 * `OccurrenceExclue "fetch-echec"`, sans faire échouer les autres.
 */
async function calculerEvts(
  exchange: ExchangeId,
  symbol: string,
  type: TypeEvenement,
  tf: Tf,
  demiFenetre: number,
  n: number,
  signal: AbortSignal,
): Promise<ResultatCalcul> {
  const dates = await chargerDatesEvenement(type);
  if (signal.aborted) return { datesVides: false, resultats: [] };

  const passes = derniersPasses(dates, Date.now(), n);
  if (passes.length === 0) return { datesVides: true, resultats: [] };

  const adapter = getAdapter(exchange);
  const tfMs = TF_MS[tf];
  const resultats = await Promise.all(
    passes.map(async (d): Promise<FenetreAlignee | OccurrenceExclue> => {
      try {
        const { limit, endTime } = fenetreFetch(d.time, demiFenetre, tfMs);
        const candles: Candle[] = await adapter.fetchKlines(symbol, tf, { limit, endTime });
        return alignerFenetre(candles, d.time, demiFenetre);
      } catch {
        return { eventTime: d.time, raison: "fetch-echec" };
      }
    }),
  );
  return { datesVides: false, resultats };
}

// ─────────────────────────── Rendu canvas ───────────────────────────

/**
 * Spaghetti fin (fenêtres individuelles, --text-dim), bande p25–p75 translucide (--serie-1),
 * médiane épaisse (--serie-1), base 100 (ligne pointillée horizontale) + ligne verticale de
 * l'évènement à l'offset 0, axe X en offsets. DPR-aware (patron drawBuckets/VolWindow).
 */
function dessinerEvts(
  canvas: HTMLCanvasElement,
  fenetres: FenetreAlignee[],
  agg: AgregatEvts,
  demiFenetre: number,
  tf: Tf,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const dim = lireTokenCanvas("--text-dim", "#94a3b8");
  const serie = lireTokenCanvas("--serie-1", "#38bdf8");
  const border = lireTokenCanvas("--border", "#334155");

  // Bornes Y = enveloppe de tous les points (le spaghetti englobe bande + médiane), base
  // 100 (ratio 1) toujours incluse pour ancrer la lecture.
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const f of fenetres) {
    for (const p of f.points) {
      if (p.ratio < yMin) yMin = p.ratio;
      if (p.ratio > yMax) yMax = p.ratio;
    }
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) return;
  yMin = Math.min(yMin, 1);
  yMax = Math.max(yMax, 1);
  const marge = (yMax - yMin) * 0.08 || 0.001;
  yMin -= marge;
  yMax += marge;

  const left = 44;
  const top = 12;
  const bottom = h - 22;
  const plotW = Math.max(1, w - left - 8);
  const plotH = Math.max(1, bottom - top);
  const xAt = (offset: number): number => left + ((offset + demiFenetre) / (2 * demiFenetre)) * plotW;
  const yAt = (ratio: number): number => top + (1 - (ratio - yMin) / (yMax - yMin)) * plotH;

  ctx.font = POLICE_CANVAS;

  // Base 100 (référence horizontale pointillée).
  const yBase = yAt(1);
  ctx.strokeStyle = border;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(left, yBase);
  ctx.lineTo(left + plotW, yBase);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = dim;
  ctx.fillText("100", 6, yBase + 3);

  // Ligne verticale de l'évènement (offset 0 = H0).
  const x0 = xAt(0);
  ctx.strokeStyle = border;
  ctx.beginPath();
  ctx.moveTo(x0, top);
  ctx.lineTo(x0, bottom);
  ctx.stroke();

  // Spaghetti des fenêtres individuelles.
  ctx.strokeStyle = dim;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1;
  for (const f of fenetres) {
    ctx.beginPath();
    f.points.forEach((p, i) => {
      const x = xAt(p.offset);
      const y = yAt(p.ratio);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Bande p25–p75 (translucide) puis médiane (épaisse) — seulement si l'agrégat a ≥ 2 points.
  if (agg.offsets.length >= 2) {
    ctx.beginPath();
    agg.offsets.forEach((off, i) => {
      const x = xAt(off);
      const y = yAt(agg.p75[i] ?? 1);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    for (let i = agg.offsets.length - 1; i >= 0; i--) {
      ctx.lineTo(xAt(agg.offsets[i] ?? 0), yAt(agg.p25[i] ?? 1));
    }
    ctx.closePath();
    ctx.fillStyle = rgbaTokenCanvas("--serie-1", 0.16, "#38bdf8");
    ctx.fill();

    ctx.beginPath();
    agg.offsets.forEach((off, i) => {
      const x = xAt(off);
      const y = yAt(agg.mediane[i] ?? 1);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = serie;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Axe X : offsets aux bords + 0, dans l'unité du TF.
  const unite = uniteTf(tf);
  ctx.fillStyle = dim;
  ctx.fillText(`−${demiFenetre}${unite}`, left, bottom + 14);
  ctx.fillText("0", x0 - 3, bottom + 14);
  const txtDroite = `+${demiFenetre}${unite}`;
  ctx.fillText(txtDroite, left + plotW - ctx.measureText(txtDroite).width, bottom + 14);
}

// ─────────────────────────── Composant ───────────────────────────

export function EvtsWindow() {
  const open = useStore(evtsUiStore, (s) => s.open);
  const exchange = useStore(marketStore, (s) => s.exchange);
  const symbolGlobal = useStore(marketStore, (s) => s.symbol);
  const groupColor = useStore(windowManagerStore, (s) => s.windows["evts"]?.groupColor ?? null);
  const symbolGroupe = useStore(windowManagerStore, (s) => (groupColor ? s.groupSymbols[groupColor] : undefined));
  const symbol = symbolGroupe ?? symbolGlobal;

  const [type, setType] = useState<TypeEvenement>("cpi");
  const [tf, setTf] = useState<Tf>("1h");
  const [demiFenetre, setDemiFenetre] = useState(24);
  const [n, setN] = useState(12);

  const [statut, setStatut] = useState<Statut>("idle");
  const [datesVides, setDatesVides] = useState(false);
  const [resultats, setResultats] = useState<(FenetreAlignee | OccurrenceExclue)[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    setStatut("loading");
    void calculerEvts(exchange, symbol, type, tf, demiFenetre, n, ctrl.signal)
      .then((out) => {
        if (ctrl.signal.aborted) return;
        setDatesVides(out.datesVides);
        setResultats(out.resultats);
        setStatut("ready");
        // statsParType (Task 4) : uniquement si au moins une fenêtre alignée.
        const fenetres = out.resultats.filter((r): r is FenetreAlignee => "points" in r);
        if (fenetres.length > 0) {
          const stats = statsEvts(fenetres);
          evtsUiStore
            .getState()
            .setStatParType(type, symbol, libelleStatParType(stats.perfMedianePost, demiFenetre, tf));
        }
      })
      .catch((err) => {
        if (!ctrl.signal.aborted) {
          console.error("[AXIOM] étude d'évènements indisponible", err);
          setStatut("error");
        }
      });
    return () => ctrl.abort();
  }, [open, type, tf, demiFenetre, n, symbol, exchange]);

  const fenetres = useMemo(
    () => resultats.filter((r): r is FenetreAlignee => "points" in r),
    [resultats],
  );
  const agg = useMemo(() => agregerFenetres(fenetres), [fenetres]);
  const stats = useMemo(() => statsEvts(fenetres), [fenetres]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || statut !== "ready" || fenetres.length === 0) return;
    const redraw = (): void => dessinerEvts(canvas, fenetres, agg, demiFenetre, tf);
    redraw();
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [fenetres, agg, demiFenetre, tf, statut]);

  const labelType = TYPES_EVENEMENT.find((t) => t.id === type)?.label ?? type;
  const unite = uniteTf(tf);
  const noteSource =
    type === "fomc"
      ? "Dates FOMC : calendrier officiel de la Réserve fédérale (statique). Heures 14:00 ET → UTC, DST approx."
      : `Dates ${labelType} : FRED release/dates. Heures 08:30 ET → UTC, DST approx.`;

  return (
    <>
      <EnTeteFenetre
        mnemo="EVTS"
        titre="Étude d'évènements"
        sousTitre={`${symbol} · ${labelType} · ±${demiFenetre} ${unite} · base 100 (H0)`}
        actions={
          statut === "ready" && !datesVides ? (
            <div className="text-right text-[11px] text-text-dim">
              {fenetres.length}/{resultats.length} alignées
            </div>
          ) : undefined
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 py-3">
        {/* Contrôles : type · TF · demi-fenêtre · N derniers. */}
        <div className="flex flex-wrap gap-2">
          <div className="min-w-[150px] flex-1">
            <Segmente
              options={TYPES_EVENEMENT.map((t) => ({ id: t.id, label: t.label }))}
              actif={type}
              onChange={setType}
            />
          </div>
          <div className="min-w-[96px]">
            <Segmente options={OPTIONS_TF} actif={tf} onChange={setTf} />
          </div>
          <div className="min-w-[132px]">
            <Segmente options={OPTIONS_DEMI} actif={demiFenetre} onChange={setDemiFenetre} />
          </div>
          <div className="min-w-[110px]">
            <Segmente options={OPTIONS_N} actif={n} onChange={setN} />
          </div>
        </div>

        {statut === "loading" && <Chargement />}
        {statut === "error" && (
          <ErreurBloc>Étude d'évènements indisponible pour ce symbole.</ErreurBloc>
        )}
        {statut === "ready" && datesVides && (
          <Vide>Dates {labelType} indisponibles — aucun évènement à aligner.</Vide>
        )}

        {statut === "ready" && !datesVides && (
          <>
            {/* Graphe (ou message si aucune fenêtre complète — la liste ci-dessous reste
                honnête sur les exclusions). */}
            <div className="relative min-h-[220px] flex-1">
              {fenetres.length >= 1 ? (
                <canvas ref={canvasRef} className="h-full w-full" />
              ) : (
                <Vide>Aucune fenêtre complète sur cet échantillon (voir exclusions).</Vide>
              )}
            </div>

            {/* Stats — seulement quand l'échantillon aligné est non vide. */}
            {fenetres.length >= 1 && (
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                <TuileStat disposition="inline" label={`Niveau méd. à −${demiFenetre}${unite}`} valeur={formatPct(stats.perfMedianePre, 1)} />
                <TuileStat
                  disposition="inline"
                  label={`Perf méd. à +${demiFenetre}${unite}`}
                  valeur={formatPct(stats.perfMedianePost, 1)}
                  couleur={stats.perfMedianePost >= 0 ? "var(--up)" : "var(--down)"}
                />
                <TuileStat disposition="inline" label="Vol. post" valeur={formatPourcentage(stats.volPost, 1)} />
                <TuileStat disposition="inline" label="Min" valeur={formatPct(stats.min, 1)} couleur="var(--down)" />
                <TuileStat disposition="inline" label="Max" valeur={formatPct(stats.max, 1)} couleur="var(--up)" />
              </div>
            )}

            {/* Occurrences : date locale + ✔ ou raison d'exclusion. */}
            <div className="max-h-[132px] overflow-y-auto rounded border border-border">
              {resultats.map((r, i) => {
                const alignee = "points" in r;
                return (
                  <div
                    key={`${r.eventTime}-${i}`}
                    className="flex items-center justify-between gap-2 border-b border-border/60 px-2 py-1 text-[11px] last:border-b-0"
                  >
                    <span className="tabular-nums text-text-dim">{formatDateComplete(r.eventTime)}</span>
                    <span className={alignee ? "text-up" : "text-text-dim"}>
                      {alignee ? "✔" : libelleRaison(r.raison)}
                    </span>
                  </div>
                );
              })}
            </div>

            <NoteSource>{noteSource}</NoteSource>
          </>
        )}
      </div>
    </>
  );
}
