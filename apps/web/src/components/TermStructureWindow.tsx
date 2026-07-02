/**
 * Fenêtre « Structure par terme » (mnémonique TERM) — dockable à droite, NON MODALE.
 *
 * Trace la courbe de BASIS ANNUALISÉ de BTC et ETH par échéance, en FUSIONNANT les futures
 * datés de Binance COIN-M et de Deribit (deux sources, un même axe). Lit en toutes lettres
 * le régime de marché (contango / backwardation / plat) par actif. Superpose en pointillés
 * les instantanés J-1 et J-7, sauvegardés via le daemon /kv (repli localStorage) — pour voir
 * la déformation de la courbe dans le temps.
 *
 * Données LENTES (~1 min) : elles vivent dans le state React (comme MacroPanel) ; le canvas
 * est redessiné impérativement à chaque mise à jour. Le polling ne tourne QUE fenêtre ouverte.
 * Dégradation gracieuse : chaque source est récupérée indépendamment (Promise.allSettled) ;
 * une source en panne n'affiche rien pour elle, sans erreur console en boucle.
 */
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { Commande } from "../commands/registry";
import {
  fetchBinanceCoinMTermStructure,
  type PointBasis,
} from "../data/binanceDapi";
import { fetchDeribitTermStructure } from "../data/deribit";
import { daemonPret, detectDaemon, kvGet, kvPut } from "../data/daemon";
import { windowManagerStore, mirrorOpenState } from "../store/windowManager";

// ─────────────────────────── Store UI (vanilla, éphémère, non persisté) ───────────────────────────

export interface TermStructureUiState {
  open: boolean;
  openTermStructure: () => void;
  closeTermStructure: () => void;
  toggleTermStructure: () => void;
}

export const termStructureUiStore = createStore<TermStructureUiState>(() => ({
  open: false,
  openTermStructure: () => windowManagerStore.getState().openWindow("termStructure"),
  closeTermStructure: () => windowManagerStore.getState().closeWindow("termStructure"),
  toggleTermStructure: () => windowManagerStore.getState().toggleWindow("termStructure"),
}));

mirrorOpenState("termStructure", termStructureUiStore);

// ─────────────────────────── Constantes ───────────────────────────

const REFRESH_MS = 60_000; // ~1 min (données lentes).
const ACTIFS = ["BTC", "ETH"] as const;
type Actif = (typeof ACTIFS)[number];
/** Couleur de tracé par actif. */
const COULEUR: Record<Actif, string> = { BTC: "#f7931a", ETH: "#8b5cf6" };
/** Seuil (fraction annualisée) au-delà duquel on qualifie contango/backwardation. */
const SEUIL_REGIME = 0.005; // ±0,5 %/an
const NS_SNAPSHOT = "termstructure";
/** Préfixe des clés localStorage de repli des instantanés. */
const PREFIXE_LS = "axiom:termstructure:";

// ─────────────────────────── Instantané J-1 / J-7 ───────────────────────────

/** Un point d'instantané minimal : échéance + basis (fraction annualisée). */
interface PointSnap {
  e: number;
  b: number;
}
interface Snapshot {
  points: PointSnap[];
}

/** Clé de jour AAAA-MM-JJ pour aujourd'hui − `offsetJours`. */
function cleJour(offsetJours: number): string {
  return new Date(Date.now() - offsetJours * 86_400_000).toISOString().slice(0, 10);
}

/** Clé KV/localStorage d'un instantané (actif + date). */
function cleSnap(actif: Actif, dateISO: string): string {
  return `${actif}:${dateISO}`;
}

/** Sauve l'instantané du jour (daemon /kv + localStorage en repli). */
function sauverSnapshot(actif: Actif, points: PointBasis[]): void {
  const snap: Snapshot = { points: points.map((p) => ({ e: p.expiryMs, b: p.basisAnnualise })) };
  const cle = cleSnap(actif, cleJour(0));
  try {
    localStorage.setItem(PREFIXE_LS + cle, JSON.stringify(snap));
  } catch {
    /* quota / mode privé : ignoré */
  }
  // Doublé vers le daemon SEULEMENT s'il est déjà confirmé présent (évite les erreurs
  // réseau « connection refused » en boucle quand aucun daemon ne tourne).
  if (daemonPret()) void kvPut(NS_SNAPSHOT, cle, snap);
}

/** Lit l'instantané à J-`offset` (daemon d'abord si présent, puis localStorage), ou null. */
async function lireSnapshot(actif: Actif, offset: number): Promise<PointSnap[] | null> {
  const cle = cleSnap(actif, cleJour(offset));
  if (daemonPret()) {
    const depuisKv = (await kvGet(NS_SNAPSHOT, cle)) as Snapshot | null;
    if (depuisKv && Array.isArray(depuisKv.points)) return depuisKv.points;
  }
  try {
    const brut = localStorage.getItem(PREFIXE_LS + cle);
    if (brut) {
      const snap = JSON.parse(brut) as Snapshot;
      if (Array.isArray(snap.points)) return snap.points;
    }
  } catch {
    /* illisible : ignoré */
  }
  return null;
}

// ─────────────────────────── Lecture du régime (contango / backwardation) ───────────────────────────

/** Moyenne des basis annualisés (fraction) d'un jeu de points, ou NaN si vide. */
function basisMoyen(points: PointBasis[]): number {
  const vals = points.map((p) => p.basisAnnualise).filter(Number.isFinite);
  if (vals.length === 0) return NaN;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Phrase de régime pour un actif (contango / backwardation / plat + basis moyen en %/an). */
function phraseRegime(points: PointBasis[]): string {
  const moy = basisMoyen(points);
  if (!Number.isFinite(moy)) return "données indisponibles";
  const pct = `${moy >= 0 ? "+" : ""}${(moy * 100).toFixed(1)} %/an`;
  if (moy > SEUIL_REGIME) return `contango (${pct}) — futures au-dessus du spot`;
  if (moy < -SEUIL_REGIME) return `backwardation (${pct}) — futures sous le spot`;
  return `courbe plate (${pct})`;
}

// ─────────────────────────── Dessin canvas ───────────────────────────

/** Données de dessin par actif : courbe live + instantanés J-1 / J-7. */
interface CourbeActif {
  live: PointBasis[];
  j1: PointSnap[] | null;
  j7: PointSnap[] | null;
}

/** Formatte une date d'échéance courte (JJ/MM). */
function dateCourte(ms: number): string {
  return new Date(ms).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

/**
 * Dessine les courbes de basis (axe X = date d'échéance, axe Y = basis annualisé %). Points
 * live en trait plein, J-1 en tirets, J-7 en pointillés fins. Ligne zéro repère de neutralité.
 */
function dessiner(canvas: HTMLCanvasElement, data: Record<Actif, CourbeActif>): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const cssW = canvas.clientWidth || 380;
  const cssH = canvas.clientHeight || 200;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const padL = 40;
  const padR = 10;
  const padT = 12;
  const padB = 22;
  const plotW = Math.max(1, cssW - padL - padR);
  const plotH = Math.max(1, cssH - padT - padB);

  // Domaine X (échéances) et Y (basis %) à partir des points live des deux actifs.
  const liveTous = [...data.BTC.live, ...data.ETH.live];
  if (liveTous.length === 0) {
    ctx.fillStyle = "#6b7280";
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText("En attente de données…", padL, padT + plotH / 2);
    return;
  }
  const xs = liveTous.map((p) => p.expiryMs);
  const ys = liveTous.map((p) => p.basisAnnualise * 100);
  let xMin = Math.min(...xs);
  let xMax = Math.max(...xs);
  if (xMax === xMin) xMax = xMin + 86_400_000;
  let yMin = Math.min(0, ...ys);
  let yMax = Math.max(0, ...ys);
  if (yMax === yMin) yMax = yMin + 1;
  const marge = (yMax - yMin) * 0.1;
  yMin -= marge;
  yMax += marge;

  const px = (ms: number) => padL + ((ms - xMin) / (xMax - xMin)) * plotW;
  const py = (pct: number) => padT + (1 - (pct - yMin) / (yMax - yMin)) * plotH;

  // Grille Y + étiquettes (min / 0 / max).
  ctx.strokeStyle = "rgba(148,163,184,0.15)";
  ctx.fillStyle = "#6b7280";
  ctx.font = "10px system-ui, sans-serif";
  ctx.lineWidth = 1;
  for (const val of [yMin, (yMin + yMax) / 2, yMax]) {
    const y = py(val);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(cssW - padR, y);
    ctx.stroke();
    ctx.fillText(`${val.toFixed(1)}%`, 4, y + 3);
  }
  // Ligne zéro (neutralité) accentuée.
  if (yMin < 0 && yMax > 0) {
    ctx.strokeStyle = "rgba(148,163,184,0.5)";
    ctx.beginPath();
    ctx.moveTo(padL, py(0));
    ctx.lineTo(cssW - padR, py(0));
    ctx.stroke();
  }

  // Étiquettes X (première et dernière échéance).
  ctx.fillStyle = "#6b7280";
  ctx.fillText(dateCourte(xMin), padL, cssH - 6);
  const txtFin = dateCourte(xMax);
  ctx.fillText(txtFin, cssW - padR - ctx.measureText(txtFin).width, cssH - 6);

  /** Trace une polyligne + points, avec style de trait donné. */
  const tracer = (
    pts: { x: number; y: number }[],
    couleur: string,
    largeur: number,
    dash: number[],
    alpha: number,
    avecPoints: boolean,
  ) => {
    if (pts.length === 0) return;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = couleur;
    ctx.lineWidth = largeur;
    ctx.setLineDash(dash);
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    ctx.setLineDash([]);
    if (avecPoints) {
      ctx.fillStyle = couleur;
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  };

  const clampY = (pct: number) => Math.min(yMax, Math.max(yMin, pct));
  const projSnap = (snap: PointSnap[]) =>
    snap
      .filter((s) => s.e >= xMin && s.e <= xMax && Number.isFinite(s.b))
      .sort((a, b) => a.e - b.e)
      .map((s) => ({ x: px(s.e), y: py(clampY(s.b * 100)) }));

  for (const actif of ACTIFS) {
    const c = data[actif];
    const couleur = COULEUR[actif];
    if (c.j7) tracer(projSnap(c.j7), couleur, 1, [2, 3], 0.35, false); // J-7 pointillés fins
    if (c.j1) tracer(projSnap(c.j1), couleur, 1.2, [5, 4], 0.55, false); // J-1 tirets
    const liveProj = c.live.map((p) => ({ x: px(p.expiryMs), y: py(clampY(p.basisAnnualise * 100)) }));
    tracer(liveProj, couleur, 1.8, [], 1, true); // live plein + points
  }
}

// ─────────────────────────── Composant ───────────────────────────

export function TermStructureWindow() {
  const open = useStore(termStructureUiStore, (s) => s.open);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [courbes, setCourbes] = useState<Record<Actif, CourbeActif>>({
    BTC: { live: [], j1: null, j7: null },
    ETH: { live: [], j1: null, j7: null },
  });
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [majTs, setMajTs] = useState<number | null>(null);

  // Chargement + polling conditionnés à l'ouverture.
  useEffect(() => {
    if (!open) return;
    let ignore = false;

    const charger = async () => {
      setLoading(true);
      // Sonde le daemon (mémoïsée 60 s) pour savoir si les instantanés /kv sont disponibles.
      await detectDaemon();
      const resultat: Record<Actif, CourbeActif> = {
        BTC: { live: [], j1: null, j7: null },
        ETH: { live: [], j1: null, j7: null },
      };
      let auMoinsUne = false;

      for (const actif of ACTIFS) {
        const [binance, deribit, j1, j7] = await Promise.allSettled([
          fetchBinanceCoinMTermStructure(actif),
          fetchDeribitTermStructure(actif),
          lireSnapshot(actif, 1),
          lireSnapshot(actif, 7),
        ]);
        const live: PointBasis[] = [];
        if (binance.status === "fulfilled") live.push(...binance.value);
        if (deribit.status === "fulfilled") live.push(...deribit.value);
        live.sort((a, b) => a.expiryMs - b.expiryMs);
        if (live.length > 0) {
          auMoinsUne = true;
          sauverSnapshot(actif, live);
        }
        resultat[actif] = {
          live,
          j1: j1.status === "fulfilled" ? j1.value : null,
          j7: j7.status === "fulfilled" ? j7.value : null,
        };
      }

      if (ignore) return;
      setCourbes(resultat);
      setErreur(auMoinsUne ? null : "Structure par terme indisponible pour le moment.");
      setMajTs(Date.now());
      setLoading(false);
    };

    void charger();
    const timer = setInterval(charger, REFRESH_MS);
    return () => {
      ignore = true;
      clearInterval(timer);
    };
  }, [open]);

  // Redessine le canvas à chaque mise à jour des courbes (fenêtre ouverte).
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (canvas) dessiner(canvas, courbes);
  }, [open, courbes]);

  return (
    <>
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-text">
            Structure par terme
          </h2>
          <p className="mt-0.5 text-[11px] text-text-dim">
            Basis annualisé · Binance COIN-M + Deribit
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mb-3 flex items-center justify-between rounded-md border border-border bg-bg px-3 py-2 text-[11px] text-text-dim">
          <span>BTC / ETH · basis (future − spot)/spot p.a.</span>
          <span>{loading ? "maj…" : majTs ? "maj ~1 min" : "—"}</span>
        </div>

        {erreur && (
          <div className="mb-3 rounded-md border border-down/40 px-3 py-2 text-[11px] text-down">
            {erreur}
          </div>
        )}

        <div className="rounded-md border border-border bg-bg p-2">
          <canvas ref={canvasRef} className="h-[200px] w-full" />
        </div>

        <div className="mt-3 space-y-2">
          {ACTIFS.map((actif) => (
            <div key={actif} className="rounded-md border border-border bg-bg px-3 py-2">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: COULEUR[actif] }}
                  aria-hidden="true"
                />
                <span className="text-xs font-medium text-text">{actif}</span>
                <span className="ml-auto text-[11px] tabular-nums text-text-dim">
                  {courbes[actif].live.length} échéance
                  {courbes[actif].live.length > 1 ? "s" : ""}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-text-dim">
                {phraseRegime(courbes[actif].live)}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-3 text-[10px] leading-snug text-text-dim">
          Trait plein = aujourd'hui · tirets = J-1 · pointillés = J-7 (instantanés locaux,
          daemon /kv sinon localStorage). Sources Binance COIN-M + Deribit, ~1 min.
        </p>
      </div>
    </>
  );
}

// ─────────────────────────── Commande palette (enregistrée par l'intégrateur) ───────────────────────────

export const commandes: Commande[] = [
  {
    id: "panneau:term-structure",
    mnemonique: "TERM",
    libelle: "Structure par terme (basis)",
    categorie: "panneau",
    motsCles: [
      "term structure",
      "structure par terme",
      "basis",
      "contango",
      "backwardation",
      "courbe",
      "futures",
      "deribit",
      "coin-m",
    ],
    apercu: "Ouvre / ferme la courbe de basis annualisé BTC + ETH",
    action: () => termStructureUiStore.getState().toggleTermStructure(),
  },
];
