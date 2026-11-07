/**
 * Bloc « Maturité constante » de la vue Term IV d'OMON (composant présentationnel, SUG-20).
 *
 * Reçoit la surface interpolée et ses lectures d'historique (calculées par l'orchestrateur à
 * partir de data/surfaceConstante) : tableau ATM / RR25 / BF25 (et 10Δ si adossé à l'OI) à 7, 30
 * et 90 j, comparaison au dernier instantané d'un jour antérieur, sparkline et percentile 1 an
 * seulement à partir de 90 points, couverture toujours affichée. Aucun calcul de marché ici.
 */
import type { LectureHistorique, LectureMaturite, PointMaturiteConstante } from "../../data/surfaceConstante";
import { MIN_POINTS_HISTORIQUE, SEUIL_OI_AILE_10D_USD } from "../../data/surfaceConstante";
import { formatDateComplete, formatPourcentage, formatUsd, VALEUR_ABSENTE } from "../../lib/format";
import { NoteSource } from "../ui";
import { TableTriable, type ColonneTable } from "../TableTriable";
import { formatDateHeureUtc, formatPointsIv } from "./format";

interface Props {
  lectures: LectureMaturite[];
  couverture: LectureHistorique["couverture"];
  /** Archive doublée dans le KV du daemon (sinon : ce navigateur seulement). */
  daemon: boolean;
  nbEcheancesRetenues: number;
  nbEcheancesEcartees: number;
  nowMs: number;
}

/** Échéances encadrantes en jours (« 6–8 j » ; « 30 j » si une échéance tombe pile). */
function libelleBornes(p: PointMaturiteConstante, nowMs: number): string {
  if (p.avantMs === null || p.apresMs === null) return "non encadrée";
  const j = (ms: number) => Math.max(0, (ms - nowMs) / 86_400_000).toFixed(0);
  return p.avantMs === p.apresMs ? `${j(p.avantMs)} j` : `${j(p.avantMs)}–${j(p.apresMs)} j`;
}

/** Cellule 10Δ : valeur, « masqué » (OI des ailes insuffisant) ou « — ». */
function cellule10(p: PointMaturiteConstante, v: number | null): { texte: string; titre?: string } {
  if (p.aile10 === "oi-insuffisante") {
    return { texte: "masqué", titre: `Ailes 10Δ peu adossées à l'OI (< ${formatUsd(SEUIL_OI_AILE_10D_USD)} par option d'ancrage) : IV surtout modélisée par Deribit` };
  }
  return { texte: formatPointsIv(v) };
}

/** Colonnes du tableau (non triable : trois horizons dans l'ordre). */
function colonnesSurface(nowMs: number): ColonneTable<LectureMaturite>[] {
  const non = (p: PointMaturiteConstante) => p.etat === "non-encadree";
  return [
    { id: "horizon", label: "Horizon", largeur: "0.7fr", rendu: ({ point: p }) => `${p.jours} j` },
    { id: "atm", label: "ATM", align: "right", rendu: ({ point: p }) => (non(p) ? "non mesuré" : formatPourcentage(p.atm, 1)) },
    {
      id: "rr25",
      label: "RR25",
      align: "right",
      rendu: ({ point: p }) => (
        <span className={p.rr25 === null ? "" : p.rr25 >= 0 ? "text-up" : "text-down"}>{formatPointsIv(p.rr25)}</span>
      ),
    },
    { id: "bf25", label: "BF25", align: "right", rendu: ({ point: p }) => formatPointsIv(p.bf25) },
    ...(["rr10", "bf10"] as const).map((champ): ColonneTable<LectureMaturite> => ({
      id: champ,
      label: champ.toUpperCase(),
      align: "right",
      rendu: ({ point: p }) => {
        const c = cellule10(p, p[champ]);
        return <span className="text-text-dim" title={c.titre}>{c.texte}</span>;
      },
    })),
    {
      id: "bornes",
      label: "Échéances",
      align: "right",
      rendu: ({ point: p }) => <span className="text-text-dim">{libelleBornes(p, nowMs)}</span>,
    },
  ];
}

/** Sparkline SVG inline (même facture que celle de COT) d'une série d'historique. */
function Sparkline({ serie }: { serie: { t: number; v: number }[] }) {
  const largeur = 120;
  const hauteur = 18;
  const vals = serie.map((p) => p.v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const step = serie.length > 1 ? largeur / (serie.length - 1) : 0;
  const points = serie.map((p, i) => `${(i * step).toFixed(1)},${(hauteur - ((p.v - min) / span) * hauteur).toFixed(1)}`).join(" ");
  return (
    <svg width={largeur} height={hauteur} className="shrink-0 text-text-dim" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1} strokeLinejoin="round" />
    </svg>
  );
}

/** Ligne d'historique d'une série : sparkline + percentile si ≥ 90 points, sinon le décompte. */
function LigneHistorique({ libelle, lecture }: { libelle: string; lecture: LectureHistorique }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <span className="text-text-dim">{libelle}</span>
      {lecture.sparkline ? (
        <span className="flex items-center gap-2">
          <Sparkline serie={lecture.serie} />
          <span className="tabular-nums">
            {lecture.percentile === null ? VALEUR_ABSENTE : `${lecture.percentile}e percentile`} sur 1 an (n = {lecture.serie.length})
          </span>
        </span>
      ) : (
        <span className="text-text-dim">
          {lecture.serie.length}/{MIN_POINTS_HISTORIQUE} instantanés : sparkline et percentile non affichés
        </span>
      )}
    </div>
  );
}

export function SurfaceConstanteBloc({ lectures, couverture, daemon, nbEcheancesRetenues, nbEcheancesEcartees, nowMs }: Props) {
  const l30 = lectures.find((l) => l.point.jours === 30);
  const precedent = l30?.rr25.precedent ?? l30?.atm.precedent ?? null;
  const nonEncadres = lectures.filter((l) => l.point.etat === "non-encadree").map((l) => `${l.point.jours} j`);
  return (
    <div className="mt-3" data-testid="surface-constante">
      <div className="mb-1 text-[11px] text-text-dim">Maturité constante (≈ interpolée : delta, puis variance totale)</div>
      <TableTriable<LectureMaturite>
        colonnes={colonnesSurface(nowMs)}
        lignes={lectures}
        cle={(l) => String(l.point.jours)}
        ariaLabel="Surface à maturité constante"
        vide="Aucune échéance exploitable."
      />
      {nonEncadres.length > 0 && (
        <p className="mt-1 text-[10px] text-text-dim">
          {nonEncadres.join(", ")} non mesuré{nonEncadres.length > 1 ? "s" : ""} : horizon non encadré par deux
          échéances exploitables (pas d&apos;extrapolation).
        </p>
      )}

      <div className="mt-2 flex flex-col gap-1">
        <div className="text-[11px] text-text-dim">
          Historique ({daemon ? "daemon + ce navigateur" : "ce navigateur seulement"}, 1 instantané par jour UTC après 08:05) :{" "}
          {couverture === null
            ? "aucun instantané pour l'instant."
            : `${couverture.jours} jour${couverture.jours > 1 ? "s" : ""} capturé${couverture.jours > 1 ? "s" : ""} sur ${couverture.joursPossibles} depuis le ${formatDateComplete(couverture.debutMs)}.`}
        </div>
        {l30 && precedent !== null && (
          <div className="text-[11px]">
            <span className="text-text-dim">Depuis l&apos;instantané du {formatDateHeureUtc(precedent.t)} (30 j) : </span>
            RR25 {formatPointsIv(l30.point.rr25 === null || l30.rr25.precedent === null ? null : l30.point.rr25 - l30.rr25.precedent.v)}
            {" · "}ATM {formatPointsIv(l30.point.atm === null || l30.atm.precedent === null ? null : l30.point.atm - l30.atm.precedent.v)}
            {" · "}BF25 {formatPointsIv(l30.point.bf25 === null || l30.bf25.precedent === null ? null : l30.point.bf25 - l30.bf25.precedent.v)}
          </div>
        )}
        {l30 && <LigneHistorique libelle="RR25 30 j" lecture={l30.rr25} />}
        {l30 && <LigneHistorique libelle="ATM 30 j" lecture={l30.atm} />}
      </div>

      <div className="mt-2">
        <NoteSource>
          Maturité constante : par échéance, options hors de la monnaie lues en delta forward non
          ajusté de la prime (N(d1), IV mark Deribit, forward de l&apos;échéance) et interpolées
          linéairement en delta ; ATM forward (K = F) interpolé en ln(K/F). Puis variance totale σ²T
          interpolée entre les deux échéances encadrantes. RR = IV call − IV put (négatif = puts plus
          chers) ; BF = moyenne des ailes − ATM. Garde-fous : ≥ 2 strikes hors de la monnaie de chaque
          côté, échéances de plus de 24 h ({nbEcheancesRetenues} retenues, {nbEcheancesEcartees} écartées) ;
          10Δ affiché seulement si chaque option d&apos;ancrage porte ≥ {formatUsd(SEUIL_OI_AILE_10D_USD)} d&apos;OI.
          Surface modélisée par Deribit, mesure risque-neutre ; un tiers en delta ajusté de la prime
          placerait le 25Δ ailleurs. Historique sans rattrapage ni collecteur : il ne grandit que si
          OMON est ouvert après 08:05 UTC ; percentile 1 an indisponible avant 90 instantanés.
        </NoteSource>
      </div>
    </div>
  );
}
