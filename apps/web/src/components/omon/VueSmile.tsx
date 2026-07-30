/**
 * Vue SMILE de la fenêtre « Options » (OMON) — extraite d'OptionsWindow.tsx (composant présentationnel).
 *
 * Bloc TOUJOURS monté (visibilité en CSS via `visible`, pas d'unmount) : le canvas porte les
 * listeners natifs de useDomaineZoom, câblés au montage — un unmount/remount au changement d'onglet
 * les perdrait. TOUTE la logique (state, mémos, effets, useDomaineZoom, handlers) reste dans
 * l'orchestrateur ; ce fichier ne reçoit que des props. ZÉRO changement de rendu.
 */
import type { Skew25d } from "../../data/skew";
import { formatUsd, formatDec, formatPct, formatPourcentage, formatEntier } from "../../lib/format";
import { TuileStat, ErreurBloc, NoteSource, Fraicheur, InfobulleGraphe } from "../ui";
import { formatStrike } from "./dessins";
import { formatUsdExact } from "./format";

/** Point du smile survolé — calls et puts sont deux OptionPoint séparés, d'où jusqu'à 4 lignes. */
export interface SurvolSmile {
  xPix: number;
  largeur: number;
  strike: number;
  ivCall: number | null;
  ivPut: number | null;
  oiCall: number | null;
  oiPut: number | null;
}

interface Props {
  visible: boolean;
  loading: boolean;
  majTs: number | null;
  erreur: string | null;
  refCanvas: React.RefObject<HTMLCanvasElement>;
  survolSmile: SurvolSmile | null;
  onSurvolSmile: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onSortieSmile: () => void;
  maxPain: number | null;
  underlying: number;
  dvol: number | null;
  dvolIvRank: number | null;
  pcRatio: number;
  skew25: Skew25d | null;
  pcVolRatio: number;
  notionnelOi: number;
}

export function VueSmile({
  visible,
  loading,
  majTs,
  erreur,
  refCanvas,
  survolSmile,
  onSurvolSmile,
  onSortieSmile,
  maxPain,
  underlying,
  dvol,
  dvolIvRank,
  pcRatio,
  skew25,
  pcVolRatio,
  notionnelOi,
}: Props) {
  return (
    <div className={visible ? undefined : "hidden"}>
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
        <div className="relative">
          <canvas
            ref={refCanvas}
            className="h-[200px] w-full"
            onMouseMove={onSurvolSmile}
            onMouseLeave={onSortieSmile}
          />
          {survolSmile && (
            <InfobulleGraphe
              xPix={survolSmile.xPix}
              largeurGraphe={survolSmile.largeur}
              titre={`Strike ${formatStrike(survolSmile.strike)}`}
              lignes={[
                { label: "IV call", valeur: formatPourcentage(survolSmile.ivCall, 1), couleur: "var(--up)" },
                { label: "IV put", valeur: formatPourcentage(survolSmile.ivPut, 1), couleur: "var(--down)" },
                { label: "OI call", valeur: formatDec(survolSmile.oiCall, 2) },
                { label: "OI put", valeur: formatDec(survolSmile.oiPut, 2) },
              ]}
            />
          )}
        </div>
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
        <TuileStat disposition="inline" label="Max pain" valeur={formatUsdExact(maxPain)} />
        <TuileStat disposition="inline" label="Sous-jacent" valeur={formatUsdExact(underlying)} />
        {/* DVOL + IV Rank appariés dans la même ligne de la grille 2 colonnes (IV Rank
            « à côté de » DVOL) — Put/Call décalé après pour laisser la paire ensemble. */}
        <TuileStat disposition="inline" label="DVOL" valeur={formatPourcentage(dvol, 1)} />
        <div title="percentile du DVOL sur 90 j">
          <TuileStat
            disposition="inline"
            label="IV Rank (90 j)"
            valeur={formatEntier(dvolIvRank)}
            couleur={
              dvolIvRank === null
                ? undefined
                : dvolIvRank >= 80
                  ? "var(--down)"
                  : dvolIvRank <= 20
                    ? "var(--up)"
                    : undefined
            }
          />
        </div>
        <TuileStat
          disposition="inline"
          label="Put/Call (OI)"
          valeur={formatDec(pcRatio, 2)}
          couleur={Number.isFinite(pcRatio) ? (pcRatio > 1 ? "var(--down)" : "var(--up)") : undefined}
        />
        <TuileStat
          disposition="inline"
          label="Skew 25Δ (RR)"
          valeur={formatPct(skew25?.rr25 ?? null, 1)}
          couleur={
            skew25 && skew25.rr25 !== 0
              ? skew25.rr25 > 0
                ? "var(--up)"
                : "var(--down)"
              : undefined
          }
        />
        <TuileStat
          disposition="inline"
          label="P/C (Vol) (toutes éch.)"
          valeur={formatDec(pcVolRatio, 2)}
          couleur={
            Number.isFinite(pcVolRatio) ? (pcVolRatio > 1 ? "var(--down)" : "var(--up)") : undefined
          }
        />
        <TuileStat disposition="inline" label="Notionnel OI (toutes éch.)" valeur={formatUsd(notionnelOi)} />
      </div>

      <div className="mt-3">
        <NoteSource>
          Max pain calculé côté client (min. de valeur intrinsèque versée aux détenteurs).
          Skew 25Δ = IV(call 25Δ) − IV(put 25Δ), deltas Black-Scholes côté client
          (négatif = puts chers). Données Deribit, ~1 min.
        </NoteSource>
      </div>
    </div>
  );
}
