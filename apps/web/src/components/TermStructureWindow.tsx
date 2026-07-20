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
import { useEffect, useMemo, useState } from "react";
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
import { formatDateCourte, formatPct, VALEUR_ABSENTE } from "../lib/format";
import { lireTokenCanvas } from "../lib/canvasTokens";
import { type Domaine, indicesVisibles, pixelVersValeur, valeurVersPixel } from "../lib/domaineAxe";
import { useDomaineZoom } from "../hooks/useDomaineZoom";
import { EnTeteFenetre, ErreurBloc, NoteSource, Fraicheur, InfobulleGraphe } from "./ui";

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
/** Couleur de tracé par actif — couleurs de marque BTC/ETH, volontairement hors thème. */
const COULEUR: Record<Actif, string> = { BTC: "#f7931a", ETH: "#8b5cf6" };
/** Seuil (fraction annualisée) au-delà duquel on qualifie contango/backwardation. */
const SEUIL_REGIME = 0.005; // ±0,5 %/an
const NS_SNAPSHOT = "termstructure";
/** Préfixe des clés localStorage de repli des instantanés. */
const PREFIXE_LS = "axiom:termstructure:";
/** Marges horizontales du plot — partagées avec le curseur de survol (même conversion
 * pixel↔échéance que px(ms), sinon le trait/tooltip survolé dérive de la courbe tracée). */
const TERM_PAD_L = 40;
const TERM_PAD_R = 10;

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
  const pct = `${formatPct(moy * 100, 1)}/an`;
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

/**
 * Dessine les courbes de basis (axe X = date d'échéance zoomable, axe Y = basis annualisé %).
 * Points live en trait plein, J-1 en tirets, J-7 en pointillés fins. Ligne zéro repère de
 * neutralité. `domaine` = fenêtre d'échéances visible (zoom/pan `useDomaineZoom` côté hôte).
 */
function dessiner(canvas: HTMLCanvasElement, data: Record<Actif, CourbeActif>, domaine: Domaine): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const cssW = canvas.clientWidth || 380;
  const cssH = canvas.clientHeight || 200;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  // Couleurs du thème courant, lues AU DESSIN (repeint avec les bonnes teintes
  // au prochain rendu après un changement de thème). Cf. VolWindow.lireTokens.
  const cTextDim = lireTokenCanvas("--text-dim", "#9ca3af");
  const cBorder = lireTokenCanvas("--border", "#262626");

  const padL = TERM_PAD_L;
  const padR = TERM_PAD_R;
  const padT = 12;
  const padB = 22;
  const plotW = Math.max(1, cssW - padL - padR);
  const plotH = Math.max(1, cssH - padT - padB);

  const liveTous = [...data.BTC.live, ...data.ETH.live];
  if (liveTous.length === 0) {
    ctx.fillStyle = cTextDim;
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText("En attente de données…", padL, padT + plotH / 2);
    return;
  }

  // Sous-ensemble visible dans le domaine (fenêtre de zoom), par actif — points déjà triés
  // par expiryMs croissant (garanti au chargement, l.306). L'échelle Y ne porte QUE sur ces
  // points visibles, comme les autres graphes du kit (BacktestWindow, VolWindow, OMON…).
  const visiblesDe = (live: PointBasis[]): PointBasis[] => {
    const { debut, fin } = indicesVisibles(live, (p) => p.expiryMs, domaine);
    return live.slice(debut, fin + 1);
  };
  const visiblesBTC = visiblesDe(data.BTC.live);
  const visiblesETH = visiblesDe(data.ETH.live);
  const ysVisibles = [...visiblesBTC, ...visiblesETH].map((p) => p.basisAnnualise * 100);
  let yMin = Math.min(0, ...ysVisibles);
  let yMax = Math.max(0, ...ysVisibles);
  if (yMax === yMin) yMax = yMin + 1;
  const marge = (yMax - yMin) * 0.1;
  yMin -= marge;
  yMax += marge;

  const px = (ms: number) => padL + valeurVersPixel(domaine, ms, plotW);
  const py = (pct: number) => padT + (1 - (pct - yMin) / (yMax - yMin)) * plotH;

  // Grille Y + étiquettes (min / 0 / max).
  ctx.strokeStyle = cBorder;
  ctx.fillStyle = cTextDim;
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
    ctx.strokeStyle = cTextDim;
    ctx.beginPath();
    ctx.moveTo(padL, py(0));
    ctx.lineTo(cssW - padR, py(0));
    ctx.stroke();
  }

  // Étiquettes X (bornes du domaine visible, pas de toute la série — cohérent avec le zoom).
  ctx.fillStyle = cTextDim;
  ctx.fillText(formatDateCourte(domaine.min), padL, cssH - 6);
  const txtFin = formatDateCourte(domaine.max);
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
      .filter((s) => s.e >= domaine.min && s.e <= domaine.max && Number.isFinite(s.b))
      .sort((a, b) => a.e - b.e)
      .map((s) => ({ x: px(s.e), y: py(clampY(s.b * 100)) }));

  const visiblesParActif: Record<Actif, PointBasis[]> = { BTC: visiblesBTC, ETH: visiblesETH };
  for (const actif of ACTIFS) {
    const c = data[actif];
    const couleur = COULEUR[actif];
    if (c.j7) tracer(projSnap(c.j7), couleur, 1, [2, 3], 0.35, false); // J-7 pointillés fins
    if (c.j1) tracer(projSnap(c.j1), couleur, 1.2, [5, 4], 0.55, false); // J-1 tirets
    const liveProj = visiblesParActif[actif].map((p) => ({
      x: px(p.expiryMs),
      y: py(clampY(p.basisAnnualise * 100)),
    }));
    tracer(liveProj, couleur, 1.8, [], 1, true); // live plein + points
  }
}

// ─────────────────────────── Composant ───────────────────────────

export function TermStructureWindow() {
  const open = useStore(termStructureUiStore, (s) => s.open);

  const [courbes, setCourbes] = useState<Record<Actif, CourbeActif>>({
    BTC: { live: [], j1: null, j7: null },
    ETH: { live: [], j1: null, j7: null },
  });
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [majTs, setMajTs] = useState<number | null>(null);

  // Bornes de l'axe X (échéances) = min/max des expiryMs des DEUX actifs live.
  const bornes = useMemo<Domaine | null>(() => {
    const tous = [...courbes.BTC.live, ...courbes.ETH.live];
    if (tous.length === 0) return null;
    let min = Math.min(...tous.map((p) => p.expiryMs));
    let max = Math.max(...tous.map((p) => p.expiryMs));
    if (max === min) max = min + 86_400_000;
    return { min, max };
  }, [courbes]);
  const { refCanvas, domaine } = useDomaineZoom(bornes);

  // Curseur (survol) : échéance la plus proche, basis BTC/ETH à cette échéance.
  const [survol, setSurvol] = useState<{
    xPix: number;
    largeur: number;
    echeance: number;
    btc: number | null;
    eth: number | null;
  } | null>(null);
  const onSurvol = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (domaine === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const plotW = Math.max(1, rect.width - TERM_PAD_L - TERM_PAD_R);
    const cible = pixelVersValeur(domaine, e.clientX - rect.left - TERM_PAD_L, plotW);
    const union = [...courbes.BTC.live, ...courbes.ETH.live];
    let echeance: number | null = null;
    let ecart = Number.POSITIVE_INFINITY;
    for (const p of union) {
      const d = Math.abs(p.expiryMs - cible);
      if (d < ecart) {
        ecart = d;
        echeance = p.expiryMs;
      }
    }
    if (echeance === null) return;
    const btc = courbes.BTC.live.find((p) => p.expiryMs === echeance) ?? null;
    const eth = courbes.ETH.live.find((p) => p.expiryMs === echeance) ?? null;
    setSurvol({
      xPix: TERM_PAD_L + valeurVersPixel(domaine, echeance, plotW),
      largeur: rect.width,
      echeance,
      btc: btc ? btc.basisAnnualise : null,
      eth: eth ? eth.basisAnnualise : null,
    });
  };

  // Chargement + polling conditionnés à l'ouverture.
  useEffect(() => {
    if (!open) return;
    let ignore = false;

    const charger = async () => {
      setLoading(true);
      // Sonde le daemon (mémoïsée 60 s) pour savoir si les instantanés /kv sont disponibles.
      await detectDaemon("kv");
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

  // Redessine le canvas à chaque mise à jour des courbes ou du domaine (fenêtre ouverte).
  useEffect(() => {
    if (!open) return;
    const canvas = refCanvas.current;
    if (canvas && domaine) dessiner(canvas, courbes, domaine);
  }, [open, courbes, domaine]);

  return (
    <>
      <EnTeteFenetre mnemo="TERM" titre="Structure par terme" sousTitre="Basis annualisé · Binance COIN-M + Deribit" />

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mb-3 flex items-center justify-between rounded-md border border-border bg-bg px-3 py-2 text-[11px] text-text-dim">
          <span>BTC / ETH · basis (future − spot)/spot p.a.</span>
          <Fraicheur loading={loading} majTs={majTs} />
        </div>

        {erreur && (
          <div className="mb-3">
            <ErreurBloc>{erreur}</ErreurBloc>
          </div>
        )}

        <div className="relative rounded-md border border-border bg-bg p-2">
          <canvas
            ref={refCanvas}
            className="h-[200px] w-full"
            onMouseMove={onSurvol}
            onMouseLeave={() => setSurvol(null)}
          />
          {survol && (
            <InfobulleGraphe
              xPix={survol.xPix}
              largeurGraphe={survol.largeur}
              titre={formatDateCourte(survol.echeance)}
              lignes={[
                {
                  label: "BTC",
                  valeur: survol.btc !== null ? formatPct(survol.btc * 100, 2) : VALEUR_ABSENTE,
                  couleur: COULEUR.BTC,
                },
                {
                  label: "ETH",
                  valeur: survol.eth !== null ? formatPct(survol.eth * 100, 2) : VALEUR_ABSENTE,
                  couleur: COULEUR.ETH,
                },
              ]}
            />
          )}
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

        <div className="mt-3">
          <NoteSource>
            Trait plein = aujourd'hui · tirets = J-1 · pointillés = J-7 (instantanés locaux,
            daemon /kv sinon localStorage). Sources Binance COIN-M + Deribit, ~1 min.
          </NoteSource>
        </div>
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
