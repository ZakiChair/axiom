/**
 * Vue HEATMAP OI (strike × échéance) de la fenêtre « Options » (OMON) — extraite d'OptionsWindow.tsx
 * (composant présentationnel).
 *
 * Bloc TOUJOURS monté, masqué en CSS via `visible` — convention de montage des canvases d'OMON
 * (cf. VueSmile). TOUTE la logique (state, mémos, effets, handlers) reste dans l'orchestrateur ;
 * ce fichier ne reçoit que des props. ZÉRO changement de rendu.
 */
import type { CelluleOi, GrilleOi } from "../../data/oiHeatmap";
import { formatUsd, formatDec } from "../../lib/format";
import { ErreurBloc, NoteSource, Fraicheur, InfobulleGraphe } from "../ui";
import { formatStrike, joursAvant, HEATMAP_PAD_L, HEATMAP_PAD_R, type SurvolHeatmap } from "./dessins";
import { formatUsdExact } from "./format";

interface Props {
  visible: boolean;
  heatmapMetrique: "oi" | "gex" | "volume";
  loading: boolean;
  majTs: number | null;
  erreur: string | null;
  heatmapCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  onSurvolHeatmap: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onSortieHeatmap: () => void;
  survolHeatmap: SurvolHeatmap | null;
  celluleSurvol: CelluleOi | null;
  grilleOi: GrilleOi | null;
  primeCellule: number | null;
}

export function VueHeatmap({
  visible,
  heatmapMetrique,
  loading,
  majTs,
  erreur,
  heatmapCanvasRef,
  onSurvolHeatmap,
  onSortieHeatmap,
  survolHeatmap,
  celluleSurvol,
  grilleOi,
  primeCellule,
}: Props) {
  return (
    <div className={visible ? undefined : "hidden"}>
      <div className="mb-3 flex items-center justify-between text-[11px] text-text-dim">
        <span>
          {heatmapMetrique === "oi"
            ? "Open interest"
            : heatmapMetrique === "gex"
              ? "|GEX| (murs de gamma)"
              : "Volume 24h"}{" "}
          par strike × échéance
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
            ref={heatmapCanvasRef}
            className="h-[300px] w-full"
            onMouseMove={onSurvolHeatmap}
            onMouseLeave={onSortieHeatmap}
          />
          {survolHeatmap && celluleSurvol && grilleOi && (
            <InfobulleGraphe
              xPix={
                HEATMAP_PAD_L +
                ((grilleOi.echeances.indexOf(survolHeatmap.expiryMs) + 0.5) /
                  Math.max(1, grilleOi.echeances.length)) *
                  Math.max(
                    1,
                    (heatmapCanvasRef.current?.clientWidth ?? 0) - HEATMAP_PAD_L - HEATMAP_PAD_R,
                  )
              }
              largeurGraphe={heatmapCanvasRef.current?.clientWidth ?? 0}
              titre={`${joursAvant(survolHeatmap.expiryMs)} · Strike ${formatStrike(survolHeatmap.strike)}`}
              lignes={[
                { label: "OI call", valeur: formatDec(celluleSurvol.callOi, 2), couleur: "var(--up)" },
                { label: "OI put", valeur: formatDec(celluleSurvol.putOi, 2), couleur: "var(--down)" },
                { label: "OI total", valeur: formatDec(celluleSurvol.oiTotal, 2) },
                { label: "Vol 24h", valeur: formatDec(celluleSurvol.volume24h, 2) },
                {
                  label: "V/OI",
                  valeur: formatDec(
                    celluleSurvol.oiTotal > 0 ? celluleSurvol.volume24h / celluleSurvol.oiTotal : null,
                    2,
                  ),
                },
                { label: "GEX", valeur: formatUsd(celluleSurvol.gex) },
                {
                  label: "Max pain",
                  valeur: formatUsdExact(grilleOi.maxPainParEcheance.get(survolHeatmap.expiryMs) ?? null),
                },
                ...(heatmapMetrique === "volume"
                  ? [{ label: "Prime OI", valeur: formatUsd(primeCellule) }]
                  : []),
              ]}
            />
          )}
        </div>
      </div>
      <div className="mt-1 flex items-center gap-4 text-[10px] text-text-dim">
        {heatmapMetrique === "gex" ? (
          <>
            <span className="flex items-center gap-1">
              <span className="inline-block h-1.5 w-3 rounded bg-up" />
              GEX positif
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-1.5 w-3 rounded bg-down" />
              GEX négatif
            </span>
          </>
        ) : (
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-3 rounded bg-accent" />
            {heatmapMetrique === "oi" ? "open interest (log)" : "volume 24h (log)"}
          </span>
        )}
        <span className="flex items-center gap-1">
          <span className="text-accent">◆</span>
          max pain
        </span>
      </div>

      <div className="mt-3">
        <NoteSource>
          Carte des positions options (toutes échéances). Couleur = open interest, |GEX|
          (murs de gamma, teinte up/down selon le signe) OU volume 24h, échelle log. ◆ = max
          pain par échéance, pointillé = spot. Données Deribit, ~1 min.
        </NoteSource>
      </div>
    </div>
  );
}
