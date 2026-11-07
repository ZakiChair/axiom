/**
 * ΔOI de la Heatmap OMON (composant présentationnel, SUG-C8 lot 1) : date de l'instantané de
 * référence toujours affichée, état explicite quand il manque, couverture des instantanés, top 5
 * des strikes dont l'OI a monté ou baissé pour l'échéance sélectionnée. Descriptif : le ΔOI n'est
 * pas signé (aucun sens d'achat ou de vente, aucun libellé haussier ou baissier).
 */
import type { CelluleDeltaOi, ReferencesOi, ResultatDeltaOi } from "../../data/deltaOiStrikes";
import { JOURS_CONSERVES } from "../../data/deltaOiStrikes";
import { formatDec, formatUsdSigne } from "../../lib/format";
import { Badge } from "../ui";
import { formatDateHeureUtc, formatJourUtc, formatUsdExact } from "./format";

export type ChoixReferenceOi = "j1" | "j7";

interface Props {
  devise: "BTC" | "ETH";
  choix: ChoixReferenceOi;
  /** null = références en cours de lecture. */
  refs: ReferencesOi | null;
  resultat: ResultatDeltaOi | null;
  top: { construits: CelluleDeltaOi[]; vides: CelluleDeltaOi[] } | null;
  expiryMs: number | null;
}

/** « +12.5 » / « −3.0 » contrats ; « — » si non mesuré. */
export function formatDeltaContrats(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatDec(Math.abs(v), 1)}`;
}

/** En-tête : « Δ depuis le … UTC » ou l'état explicite d'absence. */
export function enTeteDeltaOi(choix: ChoixReferenceOi, refs: ReferencesOi | null, resultat: ResultatDeltaOi | null): string {
  if (refs === null) return "Lecture des instantanés…";
  const jour = choix === "j1" ? refs.jourJ1 : refs.jourJ7;
  const libelle = choix === "j1" ? "J-1" : "J-7";
  if (resultat === null) return `Aucun instantané du ${formatJourUtc(jour)} (${libelle}) : ΔOI non mesuré.`;
  return `Δ depuis le ${formatDateHeureUtc(resultat.refT)} (${libelle})`;
}

function ListeTop({ titre, cellules, devise }: { titre: string; cellules: CelluleDeltaOi[]; devise: string }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-text-dim">{titre}</div>
      {cellules.length === 0 ? (
        <div className="text-[11px] text-text-dim">Aucun strike.</div>
      ) : (
        <ul className="flex flex-col gap-0.5 text-[11px] tabular-nums">
          {cellules.map((c) => (
            <li key={c.strike} className="flex flex-wrap items-center justify-between gap-x-2">
              <span className="flex items-center gap-1">
                {formatUsdExact(c.strike)}
                {c.nouveau && (
                  <Badge ton="neutre" title="Instrument absent de l'instantané de référence (listé depuis) : Δ = OI entier">
                    nouveau
                  </Badge>
                )}
              </span>
              <span>
                {formatDeltaContrats(c.delta)} {devise}
                <span className="ml-1 text-text-dim">{formatUsdSigne(c.deltaUsd)}</span>
              </span>
              <span className="w-full text-right text-[10px] text-text-dim">
                OI {formatDec(c.oiAvant, 1)} → {formatDec(c.oiApres, 1)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DeltaOi({ devise, choix, refs, resultat, top, expiryMs }: Props) {
  const jours = refs?.joursLocaux ?? [];
  return (
    <div className="mt-3" data-testid="delta-oi">
      <div className="text-[11px]">
        <span className={resultat === null ? "text-text-dim" : ""}>{enTeteDeltaOi(choix, refs, resultat)}</span>
        {resultat !== null && resultat.echeancesExpirees > 0 && (
          <span className="text-text-dim"> · {resultat.echeancesExpirees} échéance{resultat.echeancesExpirees > 1 ? "s" : ""} réglée{resultat.echeancesExpirees > 1 ? "s" : ""} depuis, exclue{resultat.echeancesExpirees > 1 ? "s" : ""}</span>
        )}
      </div>
      {refs !== null && (
        <div className="mt-0.5 text-[10px] text-text-dim">
          Instantanés dans ce navigateur :{" "}
          {jours.length === 0 ? "aucun" : jours.map(formatJourUtc).join(", ")} — un par jour UTC,
          pris au premier chargement après 08:05 UTC, {JOURS_CONSERVES + 1} jours conservés
          {refs.daemon ? " ; le daemon fournit aussi ceux pris par un autre navigateur (référence J-1 / J-7 comprise)." : " (pas de daemon : ce navigateur seulement)."}
        </div>
      )}
      {resultat !== null && expiryMs !== null && top !== null && (
        <div className="mt-2 rounded-md border border-border bg-bg p-2">
          <div className="mb-1 text-[11px] text-text-dim">
            Top 5 de l&apos;échéance du{" "}
            {new Date(expiryMs).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit", timeZone: "UTC" })} (calls + puts, en contrats = {devise})
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <ListeTop titre="Construits · OI en hausse" cellules={top.construits} devise={devise} />
            <ListeTop titre="Vidés · OI en baisse" cellules={top.vides} devise={devise} />
          </div>
        </div>
      )}
    </div>
  );
}
