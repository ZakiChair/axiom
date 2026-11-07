/**
 * Vue HEATMAP OI (strike × échéance) de la fenêtre « Options » (OMON) — extraite d'OptionsWindow.tsx
 * (composant présentationnel).
 *
 * Bloc TOUJOURS monté, masqué en CSS via `visible` — convention de montage des canvases d'OMON
 * (cf. VueSmile). TOUTE la logique (state, mémos, effets, handlers) reste dans l'orchestrateur ;
 * ce fichier ne reçoit que des props. ZÉRO changement de rendu.
 * Quatrième métrique « ΔOI » (DeltaOi.tsx, chantier du 7 novembre 2026) : variation non signée
 * depuis un instantané quotidien J-1 ou J-7, date de référence toujours affichée.
 */
import type { CelluleOi, GrilleOi } from "../../data/oiHeatmap";
import type { CelluleDeltaOi, ReferencesOi, ResultatDeltaOi } from "../../data/deltaOiStrikes";
import { formatUsd, formatDec, formatUsdSigne } from "../../lib/format";
import { ErreurBloc, NoteSource, Fraicheur, InfobulleGraphe } from "../ui";
import { formatStrike, joursAvant, HEATMAP_PAD_L, HEATMAP_PAD_R, type SurvolHeatmap } from "./dessins";
import { formatUsdExact } from "./format";
import { DeltaOi, formatDeltaContrats, type ChoixReferenceOi } from "./DeltaOi";

/** Métriques de la heatmap : OI, |GEX|, volume 24 h, ΔOI depuis un instantané daté. */
export type MetriqueHeatmap = "oi" | "gex" | "volume" | "doi";

/** Données de la métrique ΔOI (calculées par l'orchestrateur). */
export interface DonneesDeltaOi {
  devise: "BTC" | "ETH";
  choix: ChoixReferenceOi;
  refs: ReferencesOi | null;
  resultat: ResultatDeltaOi | null;
  top: { construits: CelluleDeltaOi[]; vides: CelluleDeltaOi[] } | null;
  expiryMs: number | null;
  celluleSurvol: CelluleDeltaOi | null;
}

interface Props {
  visible: boolean;
  heatmapMetrique: MetriqueHeatmap;
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
  deltaOi: DonneesDeltaOi;
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
  deltaOi,
}: Props) {
  const enDelta = heatmapMetrique === "doi";
  const celluleDelta = enDelta ? deltaOi.celluleSurvol : null;
  return (
    <div className={visible ? undefined : "hidden"}>
      <div className="mb-3 flex items-center justify-between text-[11px] text-text-dim">
        <span>
          {heatmapMetrique === "oi"
            ? "Open interest"
            : heatmapMetrique === "gex"
              ? "|GEX| (murs de gamma)"
              : heatmapMetrique === "doi"
                ? "ΔOI (non signé)"
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
            onPointerDown={onSurvolHeatmap}
              onPointerMove={onSurvolHeatmap}
            onPointerLeave={(event) => { if (event.pointerType !== "touch") onSortieHeatmap(); }}
          />
          {survolHeatmap && grilleOi && (celluleSurvol || celluleDelta) && (
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
                ...(celluleDelta
                  ? [
                      { label: "ΔOI call", valeur: formatDeltaContrats(celluleDelta.deltaCall) },
                      { label: "ΔOI put", valeur: formatDeltaContrats(celluleDelta.deltaPut) },
                      { label: `ΔOI (${deltaOi.devise})`, valeur: formatDeltaContrats(celluleDelta.delta) },
                      { label: "ΔOI au spot", valeur: formatUsdSigne(celluleDelta.deltaUsd) },
                      ...(celluleDelta.nouveau ? [{ label: "Instrument", valeur: "nouveau (Δ = OI)" }] : []),
                      ...(celluleDelta.absent ? [{ label: "Côté disparu", valeur: "non mesuré" }] : []),
                    ]
                  : []),
                ...(celluleSurvol
                  ? [
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
                    ]
                  : []),
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
        {enDelta ? (
          <>
            <span className="flex items-center gap-1">
              <span className="inline-block h-1.5 w-3 rounded bg-accent" />
              OI en hausse
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-1.5 w-3 rounded bg-warn" />
              OI en baisse
            </span>
            <span className="flex items-center gap-1">
              <span className="text-text-dim">•</span>
              nouveau
            </span>
          </>
        ) : heatmapMetrique === "gex" ? (
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

      {enDelta && (
        <DeltaOi
          devise={deltaOi.devise}
          choix={deltaOi.choix}
          refs={deltaOi.refs}
          resultat={deltaOi.resultat}
          top={deltaOi.top}
          expiryMs={deltaOi.expiryMs}
        />
      )}

      <div className="mt-3">
        {enDelta && (
          <NoteSource>
            ΔOI = OI courant − OI de l&apos;instantané de référence, par strike et échéance, en
            contrats Deribit (1 contrat = 1 {deltaOi.devise}) et en USD au spot courant ; échéances
            réglées depuis exclues ; instrument listé depuis = « nouveau » (Δ = OI entier : un strike
            neuf naît de zéro) ; instrument disparu = non mesuré. Le ΔOI n&apos;est PAS signé : une
            hausse peut venir d&apos;achats comme de ventes (couvertes ou non) ; il ne dit ni qui est
            acheteur ni le sens du marché. Roulements d&apos;échéance et blocs isolés le gonflent.
            Deribit seul (ni IBIT, ni CME, ni OKX). Instantanés pris par ce navigateur (et le daemon
            s&apos;il est présent) : sans ouverture d&apos;OMON la veille après 08:05 UTC, pas de J-1.
          </NoteSource>
        )}
        <NoteSource>
          Carte des positions options (toutes échéances). Couleur = open interest, |GEX|
          (murs de gamma, teinte up/down selon le signe) OU volume 24h, échelle log. ◆ = max
          pain par échéance, pointillé = spot. Données Deribit, ~1 min.
        </NoteSource>
      </div>
    </div>
  );
}
