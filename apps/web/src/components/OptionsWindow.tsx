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
import { windowManagerStore, mirrorOpenState } from "../store/windowManager";

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
const COULEUR_CALL = "#34d399";
const COULEUR_PUT = "#f87171";

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

/** Formatte un strike de façon compacte (ex. 78 000 → 78k). */
function formatStrike(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(0)}k`;
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

  const finies = points.filter((p) => Number.isFinite(p.markIv) && p.markIv > 0);
  if (finies.length === 0) {
    ctx.fillStyle = "#6b7280";
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
    ctx.fillText(`${val.toFixed(0)}%`, 4, y + 3);
  }
  // Étiquettes X (strike min / max).
  ctx.fillText(formatStrike(xMin), padL, cssH - 6);
  const txtMax = formatStrike(xMax);
  ctx.fillText(txtMax, cssW - padR - ctx.measureText(txtMax).width, cssH - 6);

  /** Repère vertical (sous-jacent / max pain). */
  const repere = (val: number, couleur: string, etiquette: string) => {
    if (!Number.isFinite(val) || val < xMin || val > xMax) return;
    const x = px(val);
    ctx.strokeStyle = couleur;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = couleur;
    ctx.fillText(etiquette, Math.min(x + 3, cssW - padR - 30), padT + 9);
  };
  repere(underlying, "rgba(148,163,184,0.8)", "sj");
  if (maxPain !== null) repere(maxPain, "#eab308", "max pain");

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
  tracer(finies.filter((p) => p.type === "call"), COULEUR_CALL);
  tracer(finies.filter((p) => p.type === "put"), COULEUR_PUT);
}

// ─────────────────────────── Format utilitaire ───────────────────────────

function formatUsd(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return `$${v.toLocaleString("fr-FR", { maximumFractionDigits: 0 })}`;
}

function joursAvant(expiryMs: number): string {
  const j = (expiryMs - Date.now()) / 86_400_000;
  if (j < 1) return `${(j * 24).toFixed(0)} h`;
  return `${j.toFixed(0)} j`;
}

// ─────────────────────────── Composant ───────────────────────────

export function OptionsWindow() {
  const open = useStore(optionsUiStore, (s) => s.open);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [devise, setDevise] = useState<Devise>("BTC");
  const [chain, setChain] = useState<OptionPoint[]>([]);
  const [dvol, setDvol] = useState<number | null>(null);
  const [expiry, setExpiry] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [majTs, setMajTs] = useState<number | null>(null);

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

  // Redessine le smile à chaque changement de données (fenêtre ouverte).
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (canvas) dessinerSmile(canvas, pointsEcheance, underlying, maxPain);
  }, [open, pointsEcheance, underlying, maxPain]);

  return (
    <>
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-text">Options</h2>
          <p className="mt-0.5 text-[11px] text-text-dim">Smile IV · max pain · Deribit</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* Sélecteurs devise + échéance */}
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

        <div className="mb-3 flex items-center justify-between text-[11px] text-text-dim">
          <span>Smile IV mark (calls / puts)</span>
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
        <div className="mt-1 flex items-center gap-4 text-[10px] text-text-dim">
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-3 rounded" style={{ backgroundColor: COULEUR_CALL }} />
            calls
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-3 rounded" style={{ backgroundColor: COULEUR_PUT }} />
            puts
          </span>
        </div>

        {/* Métriques */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Metric label="Max pain" value={maxPain !== null ? formatUsd(maxPain) : "—"} />
          <Metric label="Sous-jacent" value={formatUsd(underlying)} />
          <Metric
            label="Put/Call (OI)"
            value={Number.isFinite(pcRatio) ? pcRatio.toFixed(2) : "—"}
            color={Number.isFinite(pcRatio) ? (pcRatio > 1 ? COULEUR_PUT : COULEUR_CALL) : undefined}
          />
          <Metric label="DVOL" value={dvol !== null ? `${dvol.toFixed(1)}%` : "—"} />
        </div>

        <p className="mt-3 text-[10px] leading-snug text-text-dim">
          Max pain calculé côté client (min. de valeur intrinsèque versée aux détenteurs).
          Données Deribit, ~1 min.
        </p>
      </div>
    </>
  );
}

/** Ligne « libellé / valeur » (mêmes tokens que le reste du terminal). */
function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 rounded-md border border-border bg-bg px-3 py-2">
      <span className="text-[11px] text-text-dim">{label}</span>
      <span
        className="tabular-nums text-sm font-medium text-text"
        style={color ? { color } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

// ─────────────────────────── Commande palette (enregistrée par l'intégrateur) ───────────────────────────

export const commandes: Commande[] = [
  {
    id: "panneau:options",
    mnemonique: "OMON",
    libelle: "Options (smile IV, max pain)",
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
    ],
    apercu: "Ouvre / ferme le moniteur d'options Deribit",
    action: () => optionsUiStore.getState().toggleOptions(),
  },
];
