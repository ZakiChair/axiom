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
import {
  plusProchePoint,
  rayonPoint,
  SEUIL_DOI_PCT,
  SEUIL_FUNDING_PCT,
  type PointRadar,
  type QuadrantSqueeze,
} from "../data/squeeze";
import { lireTokenCanvas, rgbaTokenCanvas } from "../lib/canvasTokens";
import { formatPct, formatUsd } from "../lib/format";
import { Chargement, EnTeteFenetre, ErreurBloc, Fraicheur, NoteSource, Vide } from "./ui";
import {
  domaineAxesRobuste,
  estEcrete,
  genTicks,
  placerLabels,
  projeterEnPixels,
  scoreSqueeze,
  type PointPixel,
} from "./squeezeWindow.util";

// ─────────────────────────── Constantes de rendu ───────────────────────────

/** Marge intérieure du canvas (px CSS) : loge bulles RAYON_MAX + graduations d'axes. */
const PAD = 40;
/** Rayon de capture du survol (px), aligné sur le cahier des charges. */
const CAPTURE = 12;
/** Nombre de symboles étiquetés (les plus intenses au sens scoreSqueeze). */
const NB_LABELS = 8;
/** Taille max estimée de l'infobulle (px CSS) : sert à la retourner près des bords. */
const TOOLTIP_W = 170;
const TOOLTIP_H = 56;

/** Libellés FR lisibles des quadrants (infobulle + étiquettes de coin). */
const LABEL_QUADRANT: Record<QuadrantSqueeze, string> = {
  "carburant-squeeze": "Carburant squeeze",
  "longs-crowded": "Longs crowded",
  "shorts-crowded": "Shorts crowded",
  deleveraging: "Déleveraging",
  neutre: "Neutre",
};

/**
 * Couleur par quadrant : token CSS (thème courant) + repli hex (valeurs Dark d'index.css,
 * contexte sans DOM). Cinq teintes distinctes — carburant-squeeze en vert « up », les deux
 * crowded en rouge/bleu, deleveraging en ambre, neutre en gris dim. Partagé par le canvas
 * (rgbaTokenCanvas) et la légende (var(--token) en CSS).
 */
const COULEUR_QUADRANT: Record<QuadrantSqueeze, { token: string; repli: string }> = {
  "carburant-squeeze": { token: "--up", repli: "#2dc08e" },
  "longs-crowded": { token: "--down", repli: "#f92855" },
  "shorts-crowded": { token: "--accent", repli: "#38bdf8" },
  deleveraging: { token: "--serie-3", repli: "#f59e0b" },
  neutre: { token: "--text-dim", repli: "#9ca3af" },
};

/** Ordre d'affichage des pastilles de la légende (mêmes libellés que LABEL_QUADRANT). */
const ORDRE_LEGENDE: QuadrantSqueeze[] = [
  "carburant-squeeze",
  "longs-crowded",
  "shorts-crowded",
  "deleveraging",
  "neutre",
];

/** Légende chromatique fine sous le canvas : 5 pastilles rondes + libellés (10px). */
function LegendeQuadrants() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-dim">
      {ORDRE_LEGENDE.map((q) => (
        <span key={q} className="inline-flex items-center gap-1">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: `var(${COULEUR_QUADRANT[q].token})` }}
          />
          {LABEL_QUADRANT[q]}
        </span>
      ))}
    </div>
  );
}

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

      const domaine = domaineAxesRobuste(points);
      // Pixel de l'origine (funding=0, ΔOI=0) via la MÊME projection que les points :
      // garantit que les lignes de quadrant coïncident avec le repère des bulles.
      const [origine] = projeterEnPixels([{ fundingPct: 0, dOiPct: 0 }], domaine, w, h, PAD);
      const cx = origine?.x ?? w / 2;
      const cy = origine?.y ?? h / 2;

      // Zone neutre : rect [±SEUIL_FUNDING] × [±SEUIL_DOI] PROJETÉ (mêmes coins que les
      // bulles) — fond très discret + libellé, pour situer le seuil de « bruit ».
      const [coinHG, coinBD] = projeterEnPixels(
        [
          { fundingPct: -SEUIL_FUNDING_PCT, dOiPct: SEUIL_DOI_PCT },
          { fundingPct: SEUIL_FUNDING_PCT, dOiPct: -SEUIL_DOI_PCT },
        ],
        domaine,
        w,
        h,
        PAD,
      );
      if (coinHG !== undefined && coinBD !== undefined) {
        ctx.fillStyle = rgbaTokenCanvas("--text-dim", 0.06, "#9ca3af");
        ctx.fillRect(coinHG.x, coinHG.y, coinBD.x - coinHG.x, coinBD.y - coinHG.y);
        ctx.fillStyle = dim;
        ctx.font = "9px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("neutre", (coinHG.x + coinBD.x) / 2, (coinHG.y + coinBD.y) / 2);
      }

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

      // Graduations « rondes » (genTicks) : funding sous le cadre, ΔOI à gauche, projetées
      // par la MÊME projection que les bulles. Titres d'axes aux extrémités.
      ctx.fillStyle = dim;
      ctx.font = "9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (const t of genTicks(-domaine.fMax, domaine.fMax, 5)) {
        const [px] = projeterEnPixels([{ fundingPct: t, dOiPct: 0 }], domaine, w, h, PAD);
        if (px !== undefined) ctx.fillText(formatPct(t, 2), px.x, h - PAD + 4);
      }
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (const t of genTicks(-domaine.oMax, domaine.oMax, 5)) {
        const [px] = projeterEnPixels([{ fundingPct: 0, dOiPct: t }], domaine, w, h, PAD);
        if (px !== undefined) ctx.fillText(formatPct(t, 2), PAD - 4, px.y);
      }
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("funding %/8 h", w / 2, h - 3);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText("ΔOI %", 2, 2);

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

      // Projection : points ÉCRÊTÉS plaqués au bord (clamp AVANT projection). projRef partage
      // ces positions clampées → le hit-test vise la bulle telle que dessinée (l'infobulle
      // lit points[idx], donc affiche la vraie valeur hors échelle, pas la clampée).
      const pointsClampes = points.map((p) => ({
        fundingPct: Math.min(domaine.fMax, Math.max(-domaine.fMax, p.fundingPct)),
        dOiPct: Math.min(domaine.oMax, Math.max(-domaine.oMax, p.dOiPct)),
      }));
      const proj = projeterEnPixels(pointsClampes, domaine, w, h, PAD);
      projRef.current = proj;
      const volumeMax = points.reduce((m, p) => Math.max(m, p.volumeUsd24h), 0);

      // Bulles : semi-transparentes, cinq couleurs par quadrant (COULEUR_QUADRANT). Neutre
      // en gris plus effacé (fill 0.25). Un point écrêté porte un second anneau (r+2.5)
      // signalant qu'il est plaqué au bord (valeur hors échelle).
      points.forEach((p, i) => {
        const px = proj[i];
        if (px === undefined) return;
        const r = rayonPoint(p.volumeUsd24h, volumeMax);
        const { token, repli } = COULEUR_QUADRANT[p.quadrant];
        const alphaFill = p.quadrant === "neutre" ? 0.25 : 0.45;
        ctx.beginPath();
        ctx.arc(px.x, px.y, r, 0, Math.PI * 2);
        ctx.fillStyle = rgbaTokenCanvas(token, alphaFill, repli);
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = rgbaTokenCanvas(token, 0.9, repli);
        ctx.stroke();
        if (estEcrete(p, domaine)) {
          ctx.beginPath();
          ctx.arc(px.x, px.y, r + 2.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      });

      // Étiquettes des NB_LABELS points les plus INTENSES (scoreSqueeze), pas les plus gros
      // volumes : on nomme les candidats de squeeze, pas les mastodontes calmes.
      const topIdx = [...points.keys()]
        .sort((a, b) => scoreSqueeze(points[b]!, domaine) - scoreSqueeze(points[a]!, domaine))
        .slice(0, NB_LABELS);
      ctx.fillStyle = texte;
      ctx.font = "9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      // Candidats ancrés au-dessus de chaque bulle, puis placement anti-collision (marché
      // calme : sans ça les labels s'empilent au centre). Largeur mesurée via le contexte.
      const candidats = topIdx.flatMap((i) => {
        const p = points[i];
        const px = proj[i];
        if (p === undefined || px === undefined) return [];
        const r = rayonPoint(p.volumeUsd24h, volumeMax);
        return [{ x: px.x, y: px.y - r - 2, texte: p.symbol }];
      });
      for (const l of placerLabels(candidats, (t) => ctx.measureText(t).width, w, h)) {
        ctx.fillText(l.texte, l.x, l.y);
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
          <>
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
                style={{
                  // Clamp aux bords : bascule à gauche/au-dessus si l'infobulle clipperait
                  // le conteneur overflow-hidden (bord droit / bas).
                  left:
                    tooltip.x + 12 + TOOLTIP_W > (canvasRef.current?.clientWidth ?? Infinity)
                      ? tooltip.x - TOOLTIP_W - 12
                      : tooltip.x + 12,
                  top:
                    tooltip.y + 12 + TOOLTIP_H > (canvasRef.current?.clientHeight ?? Infinity)
                      ? tooltip.y - TOOLTIP_H - 12
                      : tooltip.y + 12,
                }}
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
          <div className="mt-2">
            <LegendeQuadrants />
          </div>
          </>
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
