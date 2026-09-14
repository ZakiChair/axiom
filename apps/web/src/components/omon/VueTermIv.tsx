/**
 * Vue TERM IV (IV ATM + RR25 par échéance) de la fenêtre « Options » (OMON) — extraite
 * d'OptionsWindow.tsx (composant présentationnel).
 *
 * Bloc TOUJOURS monté, masqué en CSS via `visible` — convention de montage des canvases d'OMON
 * (cf. VueSmile / VueHeatmap). TOUTE la logique (state, mémos, effets, handlers) reste dans
 * l'orchestrateur ; ce fichier ne reçoit que des props. ZÉRO changement de rendu.
 */
import type { PointTermIv } from "../../data/termIv";
import type { PointMouvementAttendu } from "../../data/mouvementAttendu";
import type { SegmentVolForward } from "../../data/volForward";
import { useMemo } from "react";
import { formatPct, formatPourcentage, formatEntier, formatUsd, VALEUR_ABSENTE } from "../../lib/format";
import { Badge, ErreurBloc, NoteSource, Fraicheur, InfobulleGraphe } from "../ui";
import { TableTriable, type ColonneTable } from "../TableTriable";
import { joursAvant, TERMIV_PAD_L, TERMIV_PAD_R } from "./dessins";
import { formatUsdExact } from "./format";

/** « ±x » sauf valeur absente (jamais « ±— »). */
function plusMoins(texte: string): string {
  return texte === VALEUR_ABSENTE ? texte : `±${texte}`;
}

/** Ligne du tableau : mouvement attendu de l'échéance + vol forward vers l'échéance suivante. */
type LigneMouvement = PointMouvementAttendu & { segment: SegmentVolForward | null };

/** Libellés courts distincts des événements de la fenêtre (« FOMC, CPI »). */
function libellesEvenements(s: SegmentVolForward): string {
  return [...new Set(s.evenements.map((e) => e.libelle))].join(", ");
}

/** σ fwd en %, ou « — » avec le motif (fenêtre masquée, variance forward négative). */
function valeurSigmaFwd(s: SegmentVolForward): string {
  if (s.masque) return `${VALEUR_ABSENTE} (< 12 h)`;
  if (s.varianceNegative) return `${VALEUR_ABSENTE} (variance < 0)`;
  return formatPourcentage(s.sigmaFwd, 1);
}

const COLONNES_MOUVEMENT: ColonneTable<LigneMouvement>[] = [
  {
    id: "echeance",
    label: "Échéance",
    rendu: (p) => (
      <span className="flex flex-wrap items-center gap-1">
        {/* Sous le seuil de bruit, les heures : « 2 j » arrondi masquerait une échéance à 1,6 j. */}
        {p.bruitee ? `${(p.joursRestants * 24).toFixed(0)} h` : joursAvant(p.expiryMs)}
        {p.bruitee && (
          <Badge ton="warn" title="Échéance à moins de 2 jours : IV et straddle bruités (expiration 08:00 UTC, strikes espacés)">
            bruité
          </Badge>
        )}
      </span>
    ),
  },
  { id: "iv", label: "IV ATM", align: "right", largeur: "0.8fr", rendu: (p) => formatPourcentage(p.ivAtm, 1) },
  {
    id: "em",
    label: "±1σ (IV)",
    align: "right",
    rendu: (p) => (
      <>
        <span className="block">{plusMoins(formatPourcentage(p.emIvPct, 2))}</span>
        <span className="block text-text-dim">{plusMoins(formatUsd(p.emIvUsd))}</span>
      </>
    ),
  },
  {
    id: "straddle",
    label: "Straddle",
    align: "right",
    rendu: (p) => (
      <>
        <span className="block">{plusMoins(formatPourcentage(p.straddlePct, 2))}</span>
        <span className="block text-text-dim">{plusMoins(formatUsd(p.straddleUsd))}</span>
      </>
    ),
  },
  {
    id: "bornes",
    label: "F ± straddle",
    align: "right",
    largeur: "1.6fr",
    rendu: (p) =>
      p.borneBasse === null || p.borneHaute === null
        ? VALEUR_ABSENTE
        : `${formatUsdExact(p.borneBasse)}–${formatUsdExact(p.borneHaute)}`,
  },
  {
    id: "fwd",
    label: "σ fwd →",
    align: "right",
    largeur: "1.2fr",
    // Trois lignes courtes (colonne étroite) : σ fwd, move 1σ de la fenêtre ou motif du « — »,
    // événements ECO et part attribuable estimée.
    rendu: ({ segment: s }) => {
      if (s === null) return VALEUR_ABSENTE;
      const evenements = libellesEvenements(s);
      return (
        <>
          <span className="block">{formatPourcentage(s.sigmaFwd, 1)}</span>
          <span className="block text-text-dim">
            {s.masque ? "< 12 h" : s.varianceNegative ? "var. < 0" : plusMoins(formatPourcentage(s.move1SigmaPct, 2))}
          </span>
          {evenements !== "" && (
            <span className="block text-serie-3">
              {evenements}
              {s.moveEvenementPct !== null && ` ≈${plusMoins(formatPourcentage(s.moveEvenementPct, 2))}`}
            </span>
          )}
        </>
      );
    },
  },
];

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
  mouvements: PointMouvementAttendu[];
  segments: SegmentVolForward[];
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
  mouvements,
  segments,
}: Props) {
  const pointSurvol = survolTermIv === null ? undefined : termIvPoints[survolTermIv];
  // Retrouvé par échéance, pas par index : les deux listes n'omettent pas les mêmes échéances.
  const mouvementSurvol =
    pointSurvol === undefined ? undefined : mouvements.find((m) => m.expiryMs === pointSurvol.expiryMs);
  // Fenêtre qui PART de l'échéance survolée (la dernière échéance n'en a pas).
  const segmentSurvol =
    pointSurvol === undefined ? undefined : segments.find((s) => s.debutMs === pointSurvol.expiryMs);
  const lignes = useMemo<LigneMouvement[]>(
    () => mouvements.map((m) => ({ ...m, segment: segments.find((s) => s.debutMs === m.expiryMs) ?? null })),
    [mouvements, segments],
  );
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
                { label: "Move 1σ (IV)", valeur: plusMoins(formatPourcentage(mouvementSurvol?.emIvPct, 2)) },
                { label: "Straddle", valeur: plusMoins(formatPourcentage(mouvementSurvol?.straddlePct, 2)) },
                ...(segmentSurvol === undefined
                  ? []
                  : [
                      { label: "σ fwd → suiv.", valeur: valeurSigmaFwd(segmentSurvol), couleur: "var(--serie-3)" },
                      { label: "Move 1σ fenêtre", valeur: plusMoins(formatPourcentage(segmentSurvol.move1SigmaPct, 2)) },
                      ...(segmentSurvol.evenements.length === 0
                        ? []
                        : [
                            { label: "Évt", valeur: libellesEvenements(segmentSurvol) },
                            {
                              label: "Part évt (estim.)",
                              valeur:
                                segmentSurvol.moveEvenementPct === null
                                  ? VALEUR_ABSENTE
                                  : `≈${plusMoins(formatPourcentage(segmentSurvol.moveEvenementPct, 2))}`,
                            },
                          ]),
                    ]),
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
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 border-t border-dashed border-serie-3" />
          σ fwd
        </span>
      </div>

      <div className="mt-3">
        <div className="mb-1 text-[11px] text-text-dim">Mouvement attendu d&apos;ici chaque échéance</div>
        <TableTriable<LigneMouvement>
          colonnes={COLONNES_MOUVEMENT}
          lignes={lignes}
          cle={(p) => String(p.expiryMs)}
          ariaLabel="Mouvement attendu par échéance"
          maxHauteur="12rem"
          vide="Aucune échéance exploitable."
        />
      </div>

      <div className="mt-3">
        <NoteSource>
          Term structure de la volatilité : IV ATM (strike le plus proche du spot, moyenne
          call/put) et RR25 (skew 25Δ) par échéance. Pointillé = DVOL (indice de vol). Pente
          montante = contango, descendante = backwardation. Données Deribit, ~1 min.
        </NoteSource>
        <NoteSource>
          Mouvement attendu : straddle ATM = mark call + mark put au strike le plus proche du
          forward de l&apos;échéance, × forward (IV ATM du tableau ancrée sur ce forward, celle de
          la courbe sur le spot commun). ±1σ (IV) = F × IV ATM × √(T/365 j). F ± straddle ≈ ±0,8σ
          (≈ 57 % en log-normal ; 65–66 % observé sur BTC à 7 et 30 j, DVOL en proxy), pas ±1σ
          ni 68 %. Marks Deribit (prix modèle), mesure risque-neutre : surestime en moyenne
          l&apos;amplitude réalisée, aucune direction. Échéances à moins de 2 jours bruitées.
        </NoteSource>
        <NoteSource>
          Vol forward (pointillé, colonne σ fwd →) : variance additive entre échéances consécutives
          de la courbe, σ fwd² = (σ₂²T₂ − σ₁²T₁)/(T₂ − T₁), IV ATM ancrée sur le spot commun ;
          « — » si la variance forward est négative (surface incohérente) ; fenêtres dont une
          échéance a moins de 12 h masquées. Événements ECO USD à fort impact situés dans la
          fenêtre (« Évt » : autre publication, détail dans ECO). Part d&apos;événement ≈ √(σ fwd²
          − σ base²) × √(Δt/365 j), σ base = médiane des σ fwd des fenêtres de 7 j au plus sans
          événement : estimation, lue seulement sur ces fenêtres courtes. IV des quotidiennes peu
          adossée à l&apos;OI : ±2,5 à 3 pts d&apos;incertitude sur σ fwd, amplifiée quand Δt = 1 j.
          Mesure risque-neutre, prime de variance incluse.
        </NoteSource>
      </div>
    </div>
  );
}
