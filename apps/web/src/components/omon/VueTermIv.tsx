/**
 * Vue TERM IV (IV ATM + RR25 par échéance) de la fenêtre « Options » (OMON) — extraite
 * d'OptionsWindow.tsx (composant présentationnel).
 *
 * Bloc TOUJOURS monté, masqué en CSS via `visible` — convention de montage des canvases d'OMON
 * (cf. VueSmile / VueHeatmap). TOUTE la logique (state, mémos, effets, handlers) reste dans
 * l'orchestrateur ; ce fichier ne reçoit que des props. ZÉRO changement de rendu.
 */
import type { PointTermIv } from "../../data/termIv";
import { formatPct, formatPourcentage, formatEntier } from "../../lib/format";
import { ErreurBloc, NoteSource, Fraicheur, InfobulleGraphe } from "../ui";
import { joursAvant, TERMIV_PAD_L, TERMIV_PAD_R } from "./dessins";

interface Props {
  visible: boolean;
  loading: boolean;
  majTs: number | null;
  erreur: string | null;
  termIvCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  onSurvolTermIv: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onSortieTermIv: () => void;
  survolTermIv: number | null;
  termIvPoints: PointTermIv[];
}

export function VueTermIv({
  visible,
  loading,
  majTs,
  erreur,
  termIvCanvasRef,
  onSurvolTermIv,
  onSortieTermIv,
  survolTermIv,
  termIvPoints,
}: Props) {
  return (
    <div className={visible ? undefined : "hidden"}>
      <div className="mb-3 flex items-center justify-between text-[11px] text-text-dim">
        <span>IV ATM &amp; RR25 par échéance</span>
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
            ref={termIvCanvasRef}
            className="h-[220px] w-full"
            onMouseMove={onSurvolTermIv}
            onMouseLeave={onSortieTermIv}
          />
          {survolTermIv !== null && termIvPoints[survolTermIv] && (
            <InfobulleGraphe
              xPix={
                TERMIV_PAD_L +
                ((survolTermIv + 0.5) / Math.max(1, termIvPoints.length)) *
                  Math.max(1, (termIvCanvasRef.current?.clientWidth ?? 0) - TERMIV_PAD_L - TERMIV_PAD_R)
              }
              largeurGraphe={termIvCanvasRef.current?.clientWidth ?? 0}
              titre={joursAvant(termIvPoints[survolTermIv]!.expiryMs)}
              lignes={[
                {
                  label: "IV ATM",
                  valeur: formatPourcentage(termIvPoints[survolTermIv]!.ivAtm, 1),
                  couleur: "var(--accent)",
                },
                {
                  label: "RR25",
                  valeur: formatPct(termIvPoints[survolTermIv]!.rr25, 1),
                  couleur:
                    termIvPoints[survolTermIv]!.rr25 !== null
                      ? termIvPoints[survolTermIv]!.rr25! >= 0
                        ? "var(--up)"
                        : "var(--down)"
                      : undefined,
                },
                { label: "Nb strikes", valeur: formatEntier(termIvPoints[survolTermIv]!.nbStrikes) },
              ]}
            />
          )}
        </div>
      </div>
      <div className="mt-1 flex items-center gap-4 text-[10px] text-text-dim">
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-3 rounded bg-accent" />
          IV ATM
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-3 rounded bg-up" />
          RR25 ≥ 0
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-3 rounded bg-down" />
          RR25 &lt; 0
        </span>
      </div>

      <div className="mt-3">
        <NoteSource>
          Term structure de la volatilité : IV ATM (strike le plus proche du spot, moyenne
          call/put) et RR25 (skew 25Δ) par échéance. Pointillé = DVOL (indice de vol). Pente
          montante = contango, descendante = backwardation. Données Deribit, ~1 min.
        </NoteSource>
      </div>
    </div>
  );
}
