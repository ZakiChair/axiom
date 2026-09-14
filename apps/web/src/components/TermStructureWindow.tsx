/**
 * Fenêtre « Structure par terme » (mnémonique TERM) — dockable à droite, NON MODALE.
 *
 * Trace la courbe de BASIS ANNUALISÉ de BTC et ETH par échéance, en FUSIONNANT les futures
 * datés de Binance COIN-M et de Deribit (deux sources, un même axe). Lit en toutes lettres
 * le régime de marché (contango / backwardation / plat) par actif. Superpose en pointillés
 * les instantanés J-1 et J-7, sauvegardés via le daemon /kv (repli localStorage) — pour voir
 * la déformation de la courbe dans le temps. Superpose aussi la courbe du T-bill US (tirets
 * longs) et lit le PORTAGE EXCÉDENTAIRE (basis − T-bill de même durée, portageExcedentaire.ts).
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
import { formatDateComplete, formatDateCourte, formatPct, VALEUR_ABSENTE } from "../lib/format";
import { lireTokenCanvas, POLICE_CANVAS } from "../lib/canvasTokens";
import { type Domaine, indicesVisibles, pixelVersValeur, valeurVersPixel } from "../lib/domaineAxe";
import { useDomaineZoom } from "../hooks/useDomaineZoom";
import type { CourbeRendements } from "../data/macro/treasuryYields";
import {
  calculerPortage,
  chargerCourbeTbill,
  dateCourbeUsVersMs,
  echantillonsTbill,
  JOURS_MATURITE_CONSTANTE,
  JOURS_MIN_PORTAGE,
  portageMaturiteConstante,
} from "../data/portageExcedentaire";
import { EnTeteFenetre, ErreurBloc, NoteSource, Fraicheur, InfobulleGraphe, TuileStat } from "./ui";

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
/** Tirets longs de la courbe T-bill US, distincts de J-1 [5, 4] et de J-7 [2, 3]. */
const TIRETS_TBILL = [6, 3];
const LIBELLE_SOURCE = { deribit: "Deribit", binance: "Binance COIN-M" } as const;

/** Écart en points de % signé (« +0.70 pt »), ou « — » si non fini. */
function formatPoints(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return VALEUR_ABSENTE;
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)} pt`;
}

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
 * `tbill` = courbe T-bill US déjà échantillonnée sur le domaine (tirets longs, incluse dans l'échelle).
 */
function dessiner(
  canvas: HTMLCanvasElement,
  data: Record<Actif, CourbeActif>,
  domaine: Domaine,
  tbill: { ms: number; pct: number }[],
): void {
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
    ctx.font = POLICE_CANVAS;
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
  const ysVisibles = [
    ...[...visiblesBTC, ...visiblesETH].map((p) => p.basisAnnualise * 100),
    ...tbill.map((p) => p.pct),
  ];
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
  ctx.font = POLICE_CANVAS;
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

  // T-bill US sous les courbes d'actifs (tracées ensuite, donc au-dessus), token de thème.
  const cTbill = lireTokenCanvas("--text", "#e5e5e5");
  const tbillProj = tbill.map((p) => ({ x: px(p.ms), y: py(clampY(p.pct)) }));
  tracer(tbillProj, cTbill, 1.2, TIRETS_TBILL, 0.85, false);
  const dernierTbill = tbillProj.at(-1);
  if (dernierTbill) {
    const txt = "T-bill US";
    ctx.fillStyle = cTbill;
    ctx.fillText(txt, Math.max(padL, dernierTbill.x - ctx.measureText(txt).width), dernierTbill.y - 4);
  }

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
  // Courbe T-bill US (donnée lente, publiée 1×/jour ouvré US) ; null tant qu'indisponible.
  const [courbeTbill, setCourbeTbill] = useState<CourbeRendements | null>(null);

  // Bornes de l'axe X (échéances) = min/max des expiryMs des DEUX actifs live.
  const bornes = useMemo<Domaine | null>(() => {
    const tous = [...courbes.BTC.live, ...courbes.ETH.live];
    if (tous.length === 0) return null;
    let min = Math.min(...tous.map((p) => p.expiryMs));
    let max = Math.max(...tous.map((p) => p.expiryMs));
    if (max === min) max = min + 86_400_000;
    return { min, max };
  }, [courbes]);
  // Portage excédentaire par échéance (≥ 7 j) et à maturité constante 90 j, par actif.
  const portage = useMemo(() => {
    const parActif = {
      BTC: calculerPortage(courbes.BTC.live, courbeTbill),
      ETH: calculerPortage(courbes.ETH.live, courbeTbill),
    };
    return {
      parActif,
      constant: {
        BTC: portageMaturiteConstante(parActif.BTC, courbeTbill),
        ETH: portageMaturiteConstante(parActif.ETH, courbeTbill),
      },
    };
  }, [courbes, courbeTbill]);
  // Curseur (survol) : échéance la plus proche, basis BTC/ETH à cette échéance. Déclaré
  // avant useDomaineZoom : son setter est référencé par l'onGeste qui vide le survol après
  // un zoom/pan/double-clic (sinon le trait reste figé sur l'ancien point).
  const [survol, setSurvol] = useState<{
    xPix: number;
    largeur: number;
    echeance: number;
    btc: number | null;
    eth: number | null;
    tbill: number | null;
    portageBtc: number | null;
    portageEth: number | null;
  } | null>(null);
  const { refCanvas, domaine } = useDomaineZoom(bornes, () => setSurvol(null), { gauche: TERM_PAD_L, droite: TERM_PAD_R });
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
    const portageBtc = portage.parActif.BTC.find((p) => p.expiryMs === echeance) ?? null;
    const portageEth = portage.parActif.ETH.find((p) => p.expiryMs === echeance) ?? null;
    setSurvol({
      xPix: TERM_PAD_L + valeurVersPixel(domaine, echeance, plotW),
      largeur: rect.width,
      echeance,
      btc: btc ? btc.basisAnnualise : null,
      eth: eth ? eth.basisAnnualise : null,
      tbill: (portageBtc ?? portageEth)?.tbillPct ?? null,
      portageBtc: portageBtc?.excesPt ?? null,
      portageEth: portageEth?.excesPt ?? null,
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
      // Un seul appel par cycle (mémo 1 h) ; ne rejette jamais, une panne ne remplit pas `erreur`.
      const promesseTbill = chargerCourbeTbill(Date.now());

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

      const tbill = await promesseTbill;

      if (ignore) return;
      setCourbes(resultat);
      setCourbeTbill(tbill);
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
    if (canvas && domaine) {
      dessiner(canvas, courbes, domaine, majTs !== null ? echantillonsTbill(courbeTbill, majTs, domaine) : []);
    }
  }, [open, courbes, domaine, courbeTbill, majTs]);

  return (
    <>
      <EnTeteFenetre mnemo="TERM" titre="Structure par terme" sousTitre="Basis annualisé · Binance COIN-M + Deribit · T-bill US" />

      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="mb-3 flex items-center justify-between rounded-md border border-border bg-bg px-3 py-2 text-[11px] text-text-dim">
          <span>
            BTC / ETH · basis (future − spot)/spot p.a.
            {courbeTbill ? ` · T-bill US au ${formatDateComplete(dateCourbeUsVersMs(courbeTbill.date))}` : ""}
          </span>
          <Fraicheur loading={loading} majTs={majTs} />
        </div>

        {erreur && (
          <div className="mb-3">
            <ErreurBloc>{erreur}</ErreurBloc>
          </div>
        )}

        <div className="rounded-md border border-border bg-bg p-2">
          <div className="relative">
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
                  {
                    label: "T-bill US",
                    valeur: formatPct(survol.tbill, 2, { signe: false }),
                    couleur: "var(--text)",
                  },
                  { label: "Portage BTC", valeur: formatPoints(survol.portageBtc), couleur: COULEUR.BTC },
                  { label: "Portage ETH", valeur: formatPoints(survol.portageEth), couleur: COULEUR.ETH },
                ]}
              />
            )}
          </div>
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

        <div className="mt-3 space-y-2">
          {ACTIFS.map((actif) => {
            const c = portage.constant[actif];
            return (
              <TuileStat
                key={actif}
                label={`Portage excédentaire ${JOURS_MATURITE_CONSTANTE} j · ${actif}`}
                valeur={formatPoints(c?.excesPt ?? null)}
                title={
                  `Basis interpolé linéairement à ${JOURS_MATURITE_CONSTANTE} j entre les deux échéances ` +
                  `d'une même source qui encadrent cette durée (Deribit, sinon Binance COIN-M), moins le ` +
                  `T-bill US à ${JOURS_MATURITE_CONSTANTE} j ; taux simple act/365 des deux côtés.`
                }
                pied={
                  c ? (
                    <>
                      <span>
                        {LIBELLE_SOURCE[c.source]} · {c.avant.instrument}
                        {c.apres !== c.avant ? ` ↔ ${c.apres.instrument}` : ""}
                      </span>
                      <span>T-bill {formatPct(c.tbillPct, 2, { signe: false })}</span>
                    </>
                  ) : (
                    <span>
                      {!courbeTbill
                        ? "courbe T-bill US indisponible"
                        : courbes[actif].live.length === 0
                          ? "basis indisponible"
                          : `aucune paire d'échéances encadrant ${JOURS_MATURITE_CONSTANTE} j`}
                    </span>
                  )
                }
              />
            );
          })}
        </div>

        <div className="mt-3">
          <NoteSource>
            Trait plein = aujourd'hui · tirets = J-1 · pointillés = J-7 (instantanés locaux,
            daemon /kv sinon localStorage). Sources Binance COIN-M + Deribit, ~1 min. Tirets
            longs neutres = T-bill US (courbe des rendements au pair du Trésor américain, publiée
            en fin de jour ouvré à New York), convertie en taux simple act/365 ; portage = basis −
            T-bill de même durée, échéances &lt; {JOURS_MIN_PORTAGE} j exclues. Tuiles : basis
            interpolé à {JOURS_MATURITE_CONSTANTE} j entre les deux échéances encadrantes d'une
            même source (Deribit, sinon Binance COIN-M). Le T-bill n'est pas le coût de
            financement réel d'un basis trade, et l'open interest des futures datés Deribit reste
            faible face au CME.
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
