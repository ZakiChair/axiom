/**
 * Vue SMILE de la fenêtre « Options » (OMON) — extraite d'OptionsWindow.tsx (composant présentationnel).
 *
 * Bloc TOUJOURS monté (visibilité en CSS via `visible`, pas d'unmount) : le canvas porte les
 * listeners natifs de useDomaineZoom, câblés au montage — un unmount/remount au changement d'onglet
 * les perdrait. TOUTE la logique (state, mémos, effets, useDomaineZoom, handlers) reste dans
 * l'orchestrateur ; ce fichier ne reçoit que des props. ZÉRO changement de rendu.
 */
import type { Skew25d } from "../../data/skew";
import type { LectureProbasNiveau } from "../../data/probaImplicite";
import { formatUsd, formatDec, formatPct, formatPourcentage, formatEntier } from "../../lib/format";
import { TuileStat, ErreurBloc, NoteSource, Fraicheur, InfobulleGraphe, Input } from "../ui";
import { formatStrike } from "./dessins";
import { formatUsdExact } from "./format";

/** Point du smile survolé — calls et puts sont deux OptionPoint séparés, d'où jusqu'à 4 lignes
 *  (plus les deux probabilités implicites au strike survolé). */
export interface SurvolSmile extends LectureProbasNiveau {
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
  /** Niveau saisi (texte brut) ; vide = niveauDefaut. */
  niveauProba: string;
  onNiveauProba: (v: string) => void;
  /** Forward de l'échéance arrondi (null sans courbe exploitable). */
  niveauDefaut: number | null;
  lectureProba: LectureProbasNiveau;
}

/** Probabilité [0 ; 1] en %, « — » si absente (jamais un zéro de remplissage). */
const formatProba = (p: number | null): string => formatPourcentage(p === null ? null : 100 * p, 1);

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
  niveauProba,
  onNiveauProba,
  niveauDefaut,
  lectureProba,
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
                { label: "P(clôture > K à T)", valeur: formatProba(survolSmile.pCloture) },
                { label: "P(toucher) log-normal", valeur: formatProba(survolSmile.pToucher) },
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
        {/* Probabilité implicite d'un niveau : P(clôture) en tuile, P(toucher) en infobulle
            (maths et lectures distinctes, jamais présentées côte à côte comme équivalentes). */}
        <div className="col-span-2 flex items-center gap-2">
          <Input
            type="number"
            aria-label="Niveau de prix"
            placeholder={niveauDefaut === null ? "niveau (USD)" : String(niveauDefaut)}
            value={niveauProba}
            onChange={(e) => onNiveauProba(e.target.value)}
            className="w-28"
          />
          <div className="flex-1">
            <TuileStat
              disposition="inline"
              label="P(clôture > K à T), risque-neutre"
              valeur={formatProba(lectureProba.pCloture)}
              title={`P(toucher avant T), modèle log-normal : ${formatProba(lectureProba.pToucher)}`}
            />
          </div>
        </div>
      </div>

      <div className="mt-3">
        <NoteSource>
          Max pain calculé côté client (min. de valeur intrinsèque versée aux détenteurs).
          Skew 25Δ = IV(call 25Δ) − IV(put 25Δ), deltas Black-Scholes côté client
          (négatif = puts chers). Données Deribit, ~1 min.
        </NoteSource>
        <NoteSource>
          P(clôture &gt; K à T) : Breeden-Litzenberger, pentes des prix de call entre strikes voisins
          affectées au milieu de l&apos;intervalle, interpolées, bornées à [0 ; 1], monotonie imposée ; marks
          Deribit × forward (surface modèle, pas des cotations) ; mesure risque-neutre, pas une
          probabilité réelle ; « — » hors de la grille de strikes. Niveau vide = forward de l&apos;échéance
          arrondi. P(toucher avant T), en infobulle : modèle log-normal sans dérive,
          2·Φ(−|ln(K/F)| / σ ATM·√T), qui surestime en pratique le taux de contact observé.
        </NoteSource>
      </div>
    </div>
  );
}
