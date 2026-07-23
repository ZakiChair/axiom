/**
 * Fenêtre « SQZ » — Radar de squeeze : nuage de points funding × ΔOI de l'univers
 * Signaux, dans un plan à quatre quadrants (cf. data/squeeze.ts). Chaque bulle = un
 * symbole ; rayon ∝ volume 24 h ; couleur par quadrant (carburant-squeeze = up,
 * longs-crowded = down, reste = série/gris). Survol → infobulle ; clic → navigation du
 * chart maître vers le symbole. Un run à l'ouverture (pas de polling) + bouton Rafraîchir.
 *
 * Suit le pattern canvas des fenêtres analytiques (CorrWindow/SeasonalityWindow) : dessin
 * en CSS px sous `setTransform(dpr,…)`, ResizeObserver pour la réactivité, couleurs par
 * tokens (`lireTokenCanvas`/`rgbaTokenCanvas`). L'état de données vit dans `squeezeStore`
 * (vanilla) ; seuls le survol et la fraîcheur sont locaux à React. La projection
 * données→pixels est PURE (squeezeWindow.util.ts).
 */
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { squeezeStore } from "../store/squeeze";
import { marketStore } from "../store/market";
import { navigateTo } from "../lib/navigation";
import { plusProchePoint, rayonPoint, type PointRadar, type QuadrantSqueeze } from "../data/squeeze";
import { lireTokenCanvas, rgbaTokenCanvas } from "../lib/canvasTokens";
import { formatPct, formatUsd } from "../lib/format";
import { Chargement, EnTeteFenetre, ErreurBloc, Fraicheur, NoteSource, Vide } from "./ui";
import { domaineAxes, projeterEnPixels, type PointPixel } from "./squeezeWindow.util";

// ─────────────────────────── Constantes de rendu ───────────────────────────

/** Marge intérieure du canvas (px CSS) : loge les bulles RAYON_MAX + labels sans rogner. */
const PAD = 34;
/** Rayon de capture du survol (px), aligné sur le cahier des charges. */
const CAPTURE = 12;
/** Nombre de symboles étiquetés (les plus gros volumes). */
const NB_LABELS = 8;

/** Libellés FR lisibles des quadrants (infobulle + étiquettes de coin). */
const LABEL_QUADRANT: Record<QuadrantSqueeze, string> = {
  "carburant-squeeze": "Carburant squeeze",
  "longs-crowded": "Longs crowded",
  "shorts-crowded": "Shorts crowded",
  deleveraging: "Déleveraging",
  neutre: "Neutre",
};

// ─────────────────────────── Composant ───────────────────────────

export function SqueezeWindow() {
  const points = useStore(squeezeStore, (s) => s.points);
  const enCours = useStore(squeezeStore, (s) => s.enCours);
  const couverture = useStore(squeezeStore, (s) => s.couverture);
  const erreur = useStore(squeezeStore, (s) => s.erreur);

  const [tooltip, setTooltip] = useState<{ x: number; y: number; point: PointRadar } | null>(null);
  const [majTs, setMajTs] = useState<number | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Projection courante partagée entre le dessin et le hit-testing (même repère CSS px).
  const projRef = useRef<PointPixel[]>([]);

  // Run auto au PREMIER open (FloatingWindow ne monte l'enfant que si ouvert). Le store
  // n'a pas de setter `open` : on le pose ici. La garde !enCours && rien-encore évite un
  // double run (StrictMode : run() passe enCours:true avant son premier await).
  useEffect(() => {
    squeezeStore.setState({ open: true });
    const s = squeezeStore.getState();
    if (!s.enCours && s.points.length === 0 && s.erreur === null && s.couverture === "") {
      void s.run();
    }
    return () => squeezeStore.setState({ open: false });
  }, []);

  // Horodatage de fraîcheur : marqué à la fin de chaque run (transition enCours true→false).
  const enCoursPrec = useRef(enCours);
  useEffect(() => {
    if (enCoursPrec.current && !enCours) setMajTs(Date.now());
    enCoursPrec.current = enCours;
  }, [enCours]);

  // Dessin du nuage (canvas) — redessine sur nouveaux points et au redimensionnement.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const dessiner = (): void => {
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

      // Tokens (lus au dessin : suit le thème courant).
      const dim = lireTokenCanvas("--text-dim", "#94a3b8");
      const texte = lireTokenCanvas("--text", "#e5e7eb");
      const border = lireTokenCanvas("--border", "#262626");

      const domaine = domaineAxes(points);
      // Pixel de l'origine (funding=0, ΔOI=0) via la MÊME projection que les points :
      // garantit que les lignes de quadrant coïncident avec le repère des bulles.
      const [origine] = projeterEnPixels([{ fundingPct: 0, dOiPct: 0 }], domaine, w, h, PAD);
      const cx = origine?.x ?? w / 2;
      const cy = origine?.y ?? h / 2;

      // Lignes de quadrant en pointillé (axes x=0 et y=0) + cadre discret.
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.strokeRect(PAD, PAD, w - 2 * PAD, h - 2 * PAD);
      ctx.save();
      ctx.strokeStyle = dim;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(cx, PAD);
      ctx.lineTo(cx, h - PAD);
      ctx.moveTo(PAD, cy);
      ctx.lineTo(w - PAD, cy);
      ctx.stroke();
      ctx.restore();

      // Étiquettes de quadrant dans les quatre coins (ΔOI+ en haut ; funding+ à droite).
      ctx.font = "9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = dim;
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.fillText(LABEL_QUADRANT["carburant-squeeze"], PAD + 4, PAD + 3);
      ctx.textAlign = "right";
      ctx.fillText(LABEL_QUADRANT["longs-crowded"], w - PAD - 4, PAD + 3);
      ctx.textBaseline = "bottom";
      ctx.fillText(LABEL_QUADRANT.deleveraging, w - PAD - 4, h - PAD - 3);
      ctx.textAlign = "left";
      ctx.fillText(LABEL_QUADRANT["shorts-crowded"], PAD + 4, h - PAD - 3);

      // Projection + rayons.
      const proj = projeterEnPixels(points, domaine, w, h, PAD);
      projRef.current = proj;
      const volumeMax = points.reduce((m, p) => Math.max(m, p.volumeUsd24h), 0);

      // Bulles : semi-transparentes, colorées par quadrant (up = squeeze, down = longs crowded).
      points.forEach((p, i) => {
        const px = proj[i];
        if (px === undefined) return;
        const r = rayonPoint(p.volumeUsd24h, volumeMax);
        const token =
          p.quadrant === "carburant-squeeze"
            ? "--up"
            : p.quadrant === "longs-crowded"
              ? "--down"
              : "--text-dim";
        const repli = p.quadrant === "carburant-squeeze" ? "#2dc08e" : p.quadrant === "longs-crowded" ? "#f92855" : "#94a3b8";
        ctx.beginPath();
        ctx.arc(px.x, px.y, r, 0, Math.PI * 2);
        ctx.fillStyle = rgbaTokenCanvas(token, 0.45, repli);
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = rgbaTokenCanvas(token, 0.9, repli);
        ctx.stroke();
      });

      // Étiquettes des NB_LABELS plus gros volumes (au-dessus des bulles).
      const topIdx = [...points.keys()]
        .sort((a, b) => (points[b]?.volumeUsd24h ?? 0) - (points[a]?.volumeUsd24h ?? 0))
        .slice(0, NB_LABELS);
      ctx.fillStyle = texte;
      ctx.font = "9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      for (const i of topIdx) {
        const p = points[i];
        const px = proj[i];
        if (p === undefined || px === undefined) continue;
        const r = rayonPoint(p.volumeUsd24h, volumeMax);
        ctx.fillText(p.symbol, px.x, px.y - r - 2);
      }
    };

    dessiner();
    const ro = new ResizeObserver(dessiner);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [points]);

  // Survol : point le plus proche dans le rayon de capture → infobulle React.
  const onMove = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const idx = plusProchePoint(projRef.current, mx, my, CAPTURE);
    const p = idx >= 0 ? points[idx] : undefined;
    setTooltip(p ? { x: mx, y: my, point: p } : null);
  };

  const onLeave = (): void => setTooltip(null);

  // Clic : navigue le chart maître vers le symbole survolé (binance, TF courant).
  const onClick = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const idx = plusProchePoint(projRef.current, e.clientX - rect.left, e.clientY - rect.top, CAPTURE);
    const p = idx >= 0 ? points[idx] : undefined;
    if (p === undefined) return;
    navigateTo({
      symbol: p.symbol,
      exchange: "binance",
      timeframe: marketStore.getState().timeframe,
      source: "eqs",
    });
  };

  const rafraichir = (): void => {
    void squeezeStore.getState().run();
  };

  return (
    <>
      <EnTeteFenetre
        mnemo="SQZ"
        titre="Radar de squeeze"
        sousTitre="Funding × ΔOI ~24 h · univers Signaux"
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

      <div className="flex flex-1 flex-col overflow-hidden px-4 py-4">
        {erreur !== null && points.length === 0 ? (
          <ErreurBloc>{erreur}</ErreurBloc>
        ) : enCours && points.length === 0 ? (
          <Chargement libelle="Collecte funding / ΔOI…" />
        ) : points.length === 0 ? (
          <Vide>Aucun symbole exploitable (funding et ΔOI requis). Réessayez avec Rafraîchir.</Vide>
        ) : (
          <div className="relative min-h-0 flex-1">
            {/* Refresh non destructif : un nuage valide n'est jamais remplacé par un bloc
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
              onClick={onClick}
              className="h-full w-full cursor-pointer"
            />
            {tooltip && (
              <div
                className="pointer-events-none absolute z-10 rounded border border-border bg-surface px-2 py-1 text-[10px] tabular-nums text-text shadow-lg"
                style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
              >
                <div className="font-medium">{tooltip.point.symbol}</div>
                <div className="text-text-dim">
                  funding {formatPct(tooltip.point.fundingPct, 4)} · ΔOI {formatPct(tooltip.point.dOiPct)}
                </div>
                <div className="text-text-dim">
                  vol {formatUsd(tooltip.point.volumeUsd24h)} · {LABEL_QUADRANT[tooltip.point.quadrant]}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-3 flex items-center justify-between">
          <NoteSource>
            {couverture || "Nuage funding × ΔOI de l'univers Signaux (perp-based)."} Clic = charger le
            symbole sur le chart.
          </NoteSource>
          <Fraicheur loading={enCours} majTs={majTs} />
        </div>
      </div>
    </>
  );
}
