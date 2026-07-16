/**
 * Fenêtre « Options » (mnémonique OMON) — dockable à droite, NON MODALE. Source Deribit.
 *
 * Par échéance sélectionnée : SMILE de volatilité implicite (IV mark par strike, calls et
 * puts), MAX PAIN calculé côté client (fonction pure), PUT/CALL ratio sur l'open interest et
 * DVOL (indice de volatilité implicite) si disponible. Sélecteurs devise (BTC/ETH) + échéance.
 *
 * Données LENTES (~1 min) : elles vivent dans le state React ; le smile est redessiné
 * impérativement au canvas. Le polling ne tourne QUE fenêtre ouverte. Dégradation gracieuse :
 * chaîne d'options et DVOL récupérés indépendamment (Promise.allSettled), pas d'erreur en boucle.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { Commande } from "../commands/registry";
import {
  computeMaxPain,
  fetchDeribitOptionChain,
  fetchDvol,
  putCallRatioOi,
  type OptionPoint,
  type StrikeOi,
} from "../data/deribit";
import {
  aggregateGexDex,
  computeCryptoGexDex,
  EQUITY_CONTRACT_MULTIPLIER,
  type GexDexPoint,
} from "../data/gexDex";
import {
  CBOE_TICKERS,
  cboeExpiries,
  cboeOptionsToLegs,
  fetchCboeChain,
  type CboeChain,
  type CboeTicker,
} from "../data/cboe";
import { windowManagerStore, mirrorOpenState } from "../store/windowManager";
import { formatUsd, formatDec, formatPourcentage } from "../lib/format";
import { lireTokenCanvas } from "../lib/canvasTokens";
import { Metric, EnTeteFenetre, ErreurBloc, NoteSource, Fraicheur } from "./ui";

// ─────────────────────────── Store UI (vanilla, éphémère, non persisté) ───────────────────────────

export interface OptionsUiState {
  open: boolean;
  openOptions: () => void;
  closeOptions: () => void;
  toggleOptions: () => void;
}

export const optionsUiStore = createStore<OptionsUiState>(() => ({
  open: false,
  openOptions: () => windowManagerStore.getState().openWindow("options"),
  closeOptions: () => windowManagerStore.getState().closeWindow("options"),
  toggleOptions: () => windowManagerStore.getState().toggleWindow("options"),
}));

mirrorOpenState("options", optionsUiStore);

// ─────────────────────────── Constantes ───────────────────────────

const REFRESH_MS = 60_000; // ~1 min.
const DEVISES = ["BTC", "ETH"] as const;
type Devise = (typeof DEVISES)[number];

// ─────────────────────────── Agrégations dérivées (pures, hors réseau) ───────────────────────────

/** Échéances disponibles (futures), triées croissant, avec le nombre d'options. */
function echeancesDispo(chain: OptionPoint[]): { expiryMs: number; count: number }[] {
  const now = Date.now();
  const parExp = new Map<number, number>();
  for (const p of chain) {
    if (p.expiryMs <= now) continue;
    parExp.set(p.expiryMs, (parExp.get(p.expiryMs) ?? 0) + 1);
  }
  return [...parExp.entries()]
    .map(([expiryMs, count]) => ({ expiryMs, count }))
    .sort((a, b) => a.expiryMs - b.expiryMs);
}

/** Agrège l'open interest par strike (calls / puts) pour un jeu de points d'une échéance. */
function agregerParStrike(points: OptionPoint[]): StrikeOi[] {
  const parStrike = new Map<number, StrikeOi>();
  for (const p of points) {
    const cur = parStrike.get(p.strike) ?? { strike: p.strike, callOi: 0, putOi: 0 };
    if (p.type === "call") cur.callOi += Number.isFinite(p.openInterest) ? p.openInterest : 0;
    else cur.putOi += Number.isFinite(p.openInterest) ? p.openInterest : 0;
    parStrike.set(p.strike, cur);
  }
  return [...parStrike.values()].sort((a, b) => a.strike - b.strike);
}

// ─────────────────────────── Dessin du smile ───────────────────────────

/**
 * Montant USD EXACT (« $68,432 ») pour les strikes et prix spot des Metric : un
 * strike est un identifiant de contrat, pas un ordre de grandeur — le compactage
 * K/M de formatUsd rendrait indistincts deux strikes voisins (ex. 3 425 vs
 * 3 430). Milliers en-US, sans décimales (grilles de strikes entières).
 */
function formatUsdExact(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/** Formatte un strike de façon compacte (ex. 78 000 → 78K). */
function formatStrike(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(0)}K`;
  return v.toFixed(v < 10 ? 1 : 0);
}

/**
 * Dessine le smile IV (axe X = strike, axe Y = IV mark %). Calls et puts en deux séries
 * (ligne + points). Repères verticaux : prix du sous-jacent et max pain.
 */
function dessinerSmile(
  canvas: HTMLCanvasElement,
  points: OptionPoint[],
  underlying: number,
  maxPain: number | null,
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

  const padL = 40;
  const padR = 10;
  const padT = 12;
  const padB = 22;
  const plotW = Math.max(1, cssW - padL - padR);
  const plotH = Math.max(1, cssH - padT - padB);

  // Couleurs du thème (lues au dessin pour suivre le thème courant).
  const couleurDim = lireTokenCanvas("--text-dim", "#9ca3af");
  const couleurBordure = lireTokenCanvas("--border", "#262626");
  const couleurSerie3 = lireTokenCanvas("--serie-3", "#f59e0b");
  const couleurUp = lireTokenCanvas("--up", "#2dc08e");
  const couleurDown = lireTokenCanvas("--down", "#f92855");
  const couleurBg = lireTokenCanvas("--bg", "#0a0a0a");

  const finies = points.filter((p) => Number.isFinite(p.markIv) && p.markIv > 0);
  if (finies.length === 0) {
    ctx.fillStyle = couleurDim;
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText("Pas d'IV pour cette échéance…", padL, padT + plotH / 2);
    return;
  }
  const strikes = finies.map((p) => p.strike);
  const ivs = finies.map((p) => p.markIv);
  let xMin = Math.min(...strikes);
  let xMax = Math.max(...strikes);
  if (xMax === xMin) xMax = xMin + 1;
  let yMin = Math.min(...ivs);
  let yMax = Math.max(...ivs);
  if (yMax === yMin) yMax = yMin + 1;
  const marge = (yMax - yMin) * 0.1;
  yMin = Math.max(0, yMin - marge);
  yMax += marge;

  const px = (s: number) => padL + ((s - xMin) / (xMax - xMin)) * plotW;
  const py = (iv: number) => padT + (1 - (iv - yMin) / (yMax - yMin)) * plotH;

  // Grille + étiquettes Y (IV %).
  ctx.strokeStyle = couleurBordure;
  ctx.fillStyle = couleurDim;
  ctx.font = "10px system-ui, sans-serif";
  ctx.lineWidth = 1;
  for (const val of [yMin, (yMin + yMax) / 2, yMax]) {
    const y = py(val);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(cssW - padR, y);
    ctx.stroke();
    ctx.fillText(`${val.toFixed(0)}%`, 4, y + 3);
  }
  // Étiquettes X (strike min / max).
  ctx.fillText(formatStrike(xMin), padL, cssH - 6);
  const txtMax = formatStrike(xMax);
  ctx.fillText(txtMax, cssW - padR - ctx.measureText(txtMax).width, cssH - 6);

  /**
   * Repère vertical (sous-jacent / max pain). Le trait pointillé démarre SOUS la bande
   * du libellé et un halo opaque (--bg) est peint derrière le texte : ainsi aucune
   * pointillée (la sienne ni la voisine) ne barre les glyphes (audit #6/#13). yLibelle
   * étage les deux libellés en hauteur quand ils sont proches en x.
   */
  const repere = (val: number, couleur: string, etiquette: string, yLibelle: number) => {
    if (!Number.isFinite(val) || val < xMin || val > xMax) return;
    const x = px(val);
    ctx.strokeStyle = couleur;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, yLibelle + 4);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    const lx = Math.min(x + 3, cssW - padR - 30);
    const larg = ctx.measureText(etiquette).width;
    ctx.fillStyle = couleurBg;
    ctx.fillRect(lx - 2, yLibelle - 8, larg + 4, 12);
    ctx.fillStyle = couleur;
    ctx.fillText(etiquette, lx, yLibelle);
  };
  // Étager les libellés quand max pain et sous-jacent sont proches (sinon ils se chevauchent).
  const xSj = Number.isFinite(underlying) ? px(underlying) : NaN;
  const xMp = maxPain !== null && Number.isFinite(maxPain) ? px(maxPain) : NaN;
  const proches = Number.isFinite(xSj) && Number.isFinite(xMp) && Math.abs(xSj - xMp) < 42;
  repere(underlying, couleurDim, "sj", padT + 9);
  if (maxPain !== null) repere(maxPain, couleurSerie3, "max pain", proches ? padT + 22 : padT + 9);

  /** Trace une série (calls ou puts) : ligne + points. */
  const tracer = (serie: OptionPoint[], couleur: string) => {
    const pts = serie
      .filter((p) => Number.isFinite(p.markIv) && p.markIv > 0)
      .sort((a, b) => a.strike - b.strike)
      .map((p) => ({ x: px(p.strike), y: py(p.markIv) }));
    if (pts.length === 0) return;
    ctx.strokeStyle = couleur;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    ctx.fillStyle = couleur;
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  tracer(finies.filter((p) => p.type === "call"), couleurUp);
  tracer(finies.filter((p) => p.type === "put"), couleurDown);
}

// ─────────────────────────── Dessin des barres GEX/DEX ───────────────────────────

/**
 * Dessine un histogramme d'exposition par strike (axe X = strike, barres pos./nég. depuis
 * la ligne zéro, couleurs --up/--down du thème). Repère vertical sur le spot. Ne montre que
 * les strikes dont l'exposition dépasse 0,5 % du maximum (focalise sur la zone active).
 */
function dessinerBarres(
  canvas: HTMLCanvasElement,
  points: GexDexPoint[],
  spot: number,
  metrique: "gex" | "dex",
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

  const padL = 46;
  const padR = 10;
  const padT = 12;
  const padB = 22;
  const plotW = Math.max(1, cssW - padL - padR);
  const plotH = Math.max(1, cssH - padT - padB);

  const couleurDim = lireTokenCanvas("--text-dim", "#9ca3af");
  const couleurBordure = lireTokenCanvas("--border", "#262626");
  const couleurUp = lireTokenCanvas("--up", "#2dc08e");
  const couleurDown = lireTokenCanvas("--down", "#f92855");

  const val = (p: GexDexPoint) => (metrique === "gex" ? p.gex : p.dex);
  const maxAbs = points.reduce((m, p) => Math.max(m, Math.abs(val(p))), 0);
  const visibles = maxAbs > 0 ? points.filter((p) => Math.abs(val(p)) >= maxAbs * 0.005) : [];

  if (visibles.length === 0) {
    ctx.fillStyle = couleurDim;
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText("Pas d'exposition pour cette échéance…", padL, padT + plotH / 2);
    return;
  }

  const strikes = visibles.map((p) => p.strike);
  let xMin = Math.min(...strikes, Number.isFinite(spot) ? spot : Infinity);
  let xMax = Math.max(...strikes, Number.isFinite(spot) ? spot : -Infinity);
  if (xMax === xMin) xMax = xMin + 1;
  const vals = visibles.map(val);
  const yHi = Math.max(0, ...vals);
  const yLo = Math.min(0, ...vals);
  const yRange = yHi - yLo || 1;

  const px = (s: number) => padL + ((s - xMin) / (xMax - xMin)) * plotW;
  const py = (v: number) => padT + (1 - (v - yLo) / yRange) * plotH;

  // Grille + étiquettes Y (exposition compacte).
  ctx.font = "10px system-ui, sans-serif";
  ctx.lineWidth = 1;
  for (const v of [yHi, 0, yLo]) {
    const y = py(v);
    ctx.strokeStyle = v === 0 ? couleurDim : couleurBordure;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(cssW - padR, y);
    ctx.stroke();
    ctx.fillStyle = couleurDim;
    ctx.fillText(formatUsd(v), 2, y + 3);
  }
  // Étiquettes X (strikes extrêmes).
  ctx.fillStyle = couleurDim;
  ctx.fillText(formatStrike(xMin), padL, cssH - 6);
  const txtMax = formatStrike(xMax);
  ctx.fillText(txtMax, cssW - padR - ctx.measureText(txtMax).width, cssH - 6);

  // Barres (largeur fixe centrée sur le strike).
  const largeur = Math.max(1.5, Math.min(14, (plotW / visibles.length) * 0.7));
  const yZero = py(0);
  for (const p of visibles) {
    const v = val(p);
    const x = px(p.strike);
    const yv = py(v);
    ctx.fillStyle = v >= 0 ? couleurUp : couleurDown;
    ctx.fillRect(x - largeur / 2, Math.min(yv, yZero), largeur, Math.abs(yv - yZero));
  }

  // Repère vertical du spot.
  if (Number.isFinite(spot) && spot >= xMin && spot <= xMax) {
    const x = px(spot);
    ctx.strokeStyle = couleurDim;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = couleurDim;
    ctx.fillText("spot", Math.min(x + 3, cssW - padR - 24), padT + 9);
  }
}

// ─────────────────────────── Format utilitaire ───────────────────────────

function joursAvant(expiryMs: number): string {
  const j = (expiryMs - Date.now()) / 86_400_000;
  if (j < 1) return `${(j * 24).toFixed(0)} h`;
  return `${j.toFixed(0)} j`;
}

// ─────────────────────────── Composant ───────────────────────────

export function OptionsWindow() {
  const open = useStore(optionsUiStore, (s) => s.open);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const barCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [devise, setDevise] = useState<Devise>("BTC");
  const [chain, setChain] = useState<OptionPoint[]>([]);
  const [dvol, setDvol] = useState<number | null>(null);
  const [expiry, setExpiry] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [majTs, setMajTs] = useState<number | null>(null);

  // Vue : smile IV (existant) OU GEX/DEX. En GEX/DEX : classe crypto (Deribit) ou actions (CBOE).
  const [vue, setVue] = useState<"smile" | "gexdex">("smile");
  const [classe, setClasse] = useState<"crypto" | "actions">("crypto");
  const [metrique, setMetrique] = useState<"gex" | "dex">("gex");
  // Chaîne CBOE (indices actions) — chargée seulement en GEX/DEX « Actions ».
  const [cboeTicker, setCboeTicker] = useState<CboeTicker>("SPX");
  const [cboeChaine, setCboeChaine] = useState<CboeChain | null>(null);
  const [cboeExpiry, setCboeExpiry] = useState<number | null>(null);
  const [cboeErreur, setCboeErreur] = useState<string | null>(null);
  const [cboeLoading, setCboeLoading] = useState(false);

  // Chargement + polling conditionnés à l'ouverture et à la devise.
  useEffect(() => {
    if (!open) return;
    let ignore = false;

    const charger = async () => {
      setLoading(true);
      const [chaine, vol] = await Promise.allSettled([
        fetchDeribitOptionChain(devise),
        fetchDvol(devise),
      ]);
      if (ignore) return;
      if (chaine.status === "fulfilled") {
        setChain(chaine.value);
        setErreur(chaine.value.length === 0 ? "Aucune option renvoyée par Deribit." : null);
      } else {
        setChain([]);
        setErreur("Chaîne d'options Deribit indisponible.");
      }
      setDvol(vol.status === "fulfilled" ? vol.value : null);
      setMajTs(Date.now());
      setLoading(false);
    };

    void charger();
    const timer = setInterval(charger, REFRESH_MS);
    return () => {
      ignore = true;
      clearInterval(timer);
    };
  }, [open, devise]);

  // Échéances disponibles (recalculées à chaque changement de chaîne).
  const echeances = useMemo(() => echeancesDispo(chain), [chain]);

  // Sélectionne l'échéance la plus proche si aucune valide n'est retenue.
  useEffect(() => {
    if (echeances.length === 0) {
      setExpiry(null);
      return;
    }
    setExpiry((prev) => {
      if (prev !== null && echeances.some((e) => e.expiryMs === prev)) return prev;
      return echeances[0]?.expiryMs ?? null;
    });
  }, [echeances]);

  // Points de l'échéance sélectionnée + métriques dérivées.
  const pointsEcheance = useMemo(
    () => (expiry === null ? [] : chain.filter((p) => p.expiryMs === expiry)),
    [chain, expiry],
  );
  const maxPain = useMemo(() => computeMaxPain(agregerParStrike(pointsEcheance)), [pointsEcheance]);
  const pcRatio = useMemo(() => putCallRatioOi(pointsEcheance), [pointsEcheance]);
  const underlying = useMemo(() => {
    const u = pointsEcheance.map((p) => p.underlying).find((v) => Number.isFinite(v) && v > 0);
    return u ?? NaN;
  }, [pointsEcheance]);

  // Chaîne CBOE : chargée + pollée UNIQUEMENT en vue GEX/DEX « Actions » (dégradation gracieuse
  // totale — fetchCboeChain renvoie null en cas d'échec, jamais d'exception).
  useEffect(() => {
    if (!open || vue !== "gexdex" || classe !== "actions") return;
    let ignore = false;
    const charger = async () => {
      setCboeLoading(true);
      const chaine = await fetchCboeChain(cboeTicker);
      if (ignore) return;
      setCboeChaine(chaine);
      setCboeErreur(chaine ? null : "Chaîne CBOE indisponible (endpoint non contractuel).");
      setCboeLoading(false);
    };
    void charger();
    const timer = setInterval(charger, REFRESH_MS);
    return () => {
      ignore = true;
      clearInterval(timer);
    };
  }, [open, vue, classe, cboeTicker]);

  // Échéances CBOE disponibles + sélection de la plus proche (même logique que Deribit).
  const cboeEcheances = useMemo(
    () => (cboeChaine ? cboeExpiries(cboeChaine.options, Date.now()) : []),
    [cboeChaine],
  );
  useEffect(() => {
    if (cboeEcheances.length === 0) {
      setCboeExpiry(null);
      return;
    }
    setCboeExpiry((prev) => {
      if (prev !== null && cboeEcheances.some((e) => e.expiryMs === prev)) return prev;
      return cboeEcheances[0]?.expiryMs ?? null;
    });
  }, [cboeEcheances]);

  // Exposition GEX/DEX par strike : crypto (Black-Scholes client-side) ou actions (greeks CBOE).
  const gexDexSpot = classe === "crypto" ? underlying : (cboeChaine?.spot ?? NaN);
  const gexDexPoints = useMemo<GexDexPoint[]>(() => {
    if (vue !== "gexdex") return [];
    if (classe === "crypto") {
      if (!Number.isFinite(underlying)) return [];
      return computeCryptoGexDex(pointsEcheance, underlying, Date.now());
    }
    if (!cboeChaine || cboeExpiry === null) return [];
    return aggregateGexDex(
      cboeOptionsToLegs(cboeChaine.options, cboeExpiry),
      cboeChaine.spot,
      EQUITY_CONTRACT_MULTIPLIER,
    );
  }, [vue, classe, pointsEcheance, underlying, cboeChaine, cboeExpiry]);

  const gexNet = useMemo(() => gexDexPoints.reduce((s, p) => s + p.gex, 0), [gexDexPoints]);
  const dexNet = useMemo(() => gexDexPoints.reduce((s, p) => s + p.dex, 0), [gexDexPoints]);
  const strikePicGex = useMemo(() => {
    let best: GexDexPoint | null = null;
    for (const p of gexDexPoints) if (!best || Math.abs(p.gex) > Math.abs(best.gex)) best = p;
    return best?.strike ?? null;
  }, [gexDexPoints]);

  // Redessine le smile à chaque changement de données (fenêtre ouverte, vue smile).
  useEffect(() => {
    if (!open || vue !== "smile") return;
    const canvas = canvasRef.current;
    if (canvas) dessinerSmile(canvas, pointsEcheance, underlying, maxPain);
  }, [open, vue, pointsEcheance, underlying, maxPain]);

  // Redessine l'histogramme GEX/DEX (fenêtre ouverte, vue gexdex).
  useEffect(() => {
    if (!open || vue !== "gexdex") return;
    const canvas = barCanvasRef.current;
    if (canvas) dessinerBarres(canvas, gexDexPoints, gexDexSpot, metrique);
  }, [open, vue, gexDexPoints, gexDexSpot, metrique]);

  return (
    <>
      <EnTeteFenetre titre="Options" sousTitre="Smile IV · max pain · GEX/DEX" />

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* Bascule de vue : Smile ↔ GEX/DEX */}
        <div className="mb-3 flex overflow-hidden rounded-md border border-border text-[11px]">
          {(["smile", "gexdex"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVue(v)}
              className={`flex-1 px-3 py-1.5 transition ${
                vue === v ? "bg-bg text-text" : "text-text-dim hover:text-text"
              }`}
            >
              {v === "smile" ? "Smile" : "GEX/DEX"}
            </button>
          ))}
        </div>

        {/* En GEX/DEX : bascules classe (crypto/actions) + métrique (GEX/DEX) */}
        {vue === "gexdex" && (
          <div className="mb-3 flex items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-border">
              {(["crypto", "actions"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setClasse(c)}
                  className={`px-3 py-1.5 text-[11px] transition ${
                    classe === c ? "bg-bg text-text" : "text-text-dim hover:text-text"
                  }`}
                >
                  {c === "crypto" ? "Crypto" : "Actions"}
                </button>
              ))}
            </div>
            <div className="flex overflow-hidden rounded-md border border-border">
              {(["gex", "dex"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMetrique(m)}
                  className={`px-3 py-1.5 text-[11px] uppercase transition ${
                    metrique === m ? "bg-bg text-text" : "text-text-dim hover:text-text"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Sélecteurs devise + échéance Deribit (smile ET gex/dex crypto) */}
        {(vue === "smile" || classe === "crypto") && (
          <div className="mb-3 flex items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-border">
              {DEVISES.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDevise(d)}
                  className={`px-3 py-1.5 text-[11px] transition ${
                    devise === d ? "bg-bg text-text" : "text-text-dim hover:text-text"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
            <select
              value={expiry ?? ""}
              onChange={(e) => setExpiry(Number(e.target.value))}
              aria-label="Échéance"
              className="flex-1 rounded-md border border-border bg-bg px-2 py-1.5 text-[11px] text-text"
            >
              {echeances.length === 0 && <option value="">—</option>}
              {echeances.map((e) => (
                <option key={e.expiryMs} value={e.expiryMs}>
                  {new Date(e.expiryMs).toLocaleDateString("fr-FR", {
                    day: "2-digit",
                    month: "short",
                    year: "2-digit",
                  })}{" "}
                  · {joursAvant(e.expiryMs)} · {e.count} opt
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Sélecteurs ticker + échéance CBOE (gex/dex actions) */}
        {vue === "gexdex" && classe === "actions" && (
          <div className="mb-3 flex items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-border">
              {CBOE_TICKERS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setCboeTicker(t)}
                  className={`px-3 py-1.5 text-[11px] transition ${
                    cboeTicker === t ? "bg-bg text-text" : "text-text-dim hover:text-text"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <select
              value={cboeExpiry ?? ""}
              onChange={(e) => setCboeExpiry(Number(e.target.value))}
              aria-label="Échéance CBOE"
              className="flex-1 rounded-md border border-border bg-bg px-2 py-1.5 text-[11px] text-text"
            >
              {cboeEcheances.length === 0 && <option value="">—</option>}
              {cboeEcheances.map((e) => (
                <option key={e.expiryMs} value={e.expiryMs}>
                  {new Date(e.expiryMs).toLocaleDateString("fr-FR", {
                    day: "2-digit",
                    month: "short",
                    year: "2-digit",
                  })}{" "}
                  · {joursAvant(e.expiryMs)} · {e.count} opt
                </option>
              ))}
            </select>
          </div>
        )}

        {/* ─────────── Vue SMILE (existante) ─────────── */}
        {vue === "smile" && (
          <>
            <div className="mb-3 flex items-center justify-between text-[11px] text-text-dim">
              <span>Smile IV mark (calls / puts)</span>
              <Fraicheur loading={loading} majTs={majTs} />
            </div>

            {erreur && (
              <div className="mb-3">
                <ErreurBloc>{erreur}</ErreurBloc>
              </div>
            )}

            <div className="rounded-md border border-border bg-bg p-2">
              <canvas ref={canvasRef} className="h-[200px] w-full" />
            </div>
            <div className="mt-1 flex items-center gap-4 text-[10px] text-text-dim">
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-3 rounded bg-up" />
                calls
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-3 rounded bg-down" />
                puts
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <Metric label="Max pain" value={formatUsdExact(maxPain)} />
              <Metric label="Sous-jacent" value={formatUsdExact(underlying)} />
              <Metric
                label="Put/Call (OI)"
                value={formatDec(pcRatio, 2)}
                couleur={Number.isFinite(pcRatio) ? (pcRatio > 1 ? "var(--down)" : "var(--up)") : undefined}
              />
              <Metric label="DVOL" value={formatPourcentage(dvol, 1)} />
            </div>

            <div className="mt-3">
              <NoteSource>
                Max pain calculé côté client (min. de valeur intrinsèque versée aux détenteurs).
                Données Deribit, ~1 min.
              </NoteSource>
            </div>
          </>
        )}

        {/* ─────────── Vue GEX/DEX ─────────── */}
        {vue === "gexdex" && (
          <>
            <div className="mb-3 flex items-center justify-between text-[11px] text-text-dim">
              <span>{metrique === "gex" ? "Gamma exposure" : "Delta exposure"} par strike</span>
              <Fraicheur loading={classe === "crypto" ? loading : cboeLoading} majTs={majTs} />
            </div>

            {classe === "actions" && (
              <div className="mb-3 rounded-md border border-border bg-bg px-3 py-1.5 text-[10px] text-text-dim">
                CBOE — données différées (~15 min), endpoint non contractuel.
              </div>
            )}

            {(classe === "crypto" ? erreur : cboeErreur) && (
              <div className="mb-3">
                <ErreurBloc>{classe === "crypto" ? erreur : cboeErreur}</ErreurBloc>
              </div>
            )}

            <div className="rounded-md border border-border bg-bg p-2">
              <canvas ref={barCanvasRef} className="h-[200px] w-full" />
            </div>
            <div className="mt-1 flex items-center gap-4 text-[10px] text-text-dim">
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-3 rounded bg-up" />
                exposition positive
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-3 rounded bg-down" />
                exposition négative
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <Metric
                label="GEX net"
                value={formatUsd(gexNet)}
                couleur={gexNet !== 0 ? (gexNet > 0 ? "var(--up)" : "var(--down)") : undefined}
              />
              <Metric
                label="DEX net"
                value={formatUsd(dexNet)}
                couleur={dexNet !== 0 ? (dexNet > 0 ? "var(--up)" : "var(--down)") : undefined}
              />
              <Metric label="Spot" value={formatUsdExact(gexDexSpot)} />
              <Metric
                label="Strike |GEX| max"
                value={formatUsdExact(strikePicGex)}
              />
            </div>

            <div className="mt-3">
              <NoteSource>
                {classe === "crypto"
                  ? "GEX/DEX calculés côté client (Black-Scholes sur IV mark Deribit, OI en unités de base, multiplicateur 1). Une seule échéance."
                  : "Greeks pré-calculés CBOE (multiplicateur 100). GEX = Σ(Γc·OIc − Γp·OIp)·S²·0,01·mult ; DEX = Σ(Δ·OI)·S·mult."}
              </NoteSource>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ─────────────────────────── Commande palette (enregistrée par l'intégrateur) ───────────────────────────

export const commandes: Commande[] = [
  {
    id: "panneau:options",
    mnemonique: "OMON",
    libelle: "Options (smile IV, max pain, GEX/DEX)",
    categorie: "panneau",
    motsCles: [
      "options",
      "omon",
      "smile",
      "iv",
      "volatilite implicite",
      "max pain",
      "put call ratio",
      "dvol",
      "deribit",
      "gex",
      "dex",
      "gamma exposure",
      "delta exposure",
      "cboe",
      "spx",
      "ndx",
      "vix",
    ],
    apercu: "Ouvre / ferme le moniteur d'options (smile, GEX/DEX crypto & actions)",
    action: () => optionsUiStore.getState().toggleOptions(),
  },
];
