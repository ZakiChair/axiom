/**
 * Section BRIEF — COT (semaine) : cache legacy SEUL, 3 instruments au |Δ hebdo net|
 * max. Le garde de présence (cache vide → absente) reste dans l'orchestrateur, qui
 * ne monte cette section qu'avec un `cot` non nul.
 */
import { formatDateCourte, formatEntier } from "../../lib/format";
import { NoteSource } from "../ui";
import { couleurVariation, TitreBloc, type CotChart } from "./commun";

interface Props {
  cot: CotChart;
}

export function SectionCot({ cot }: Props) {
  return (
    <section className="space-y-2">
      <TitreBloc>COT · semaine</TitreBloc>
      <div className="space-y-1">
        {cot.lignes.map(({ ligne, delta }) => (
          <div
            key={ligne.nom}
            className="flex items-baseline justify-between gap-2 text-[11px] tabular-nums"
          >
            <span className="min-w-0 flex-1 truncate text-text">{ligne.libelle}</span>
            <span style={{ color: couleurVariation(delta) }}>
              Δ {delta >= 0 ? "+" : ""}
              {formatEntier(delta)}
            </span>
          </div>
        ))}
      </div>
      <NoteSource>
        Rapport COT CFTC (legacy, net non-commercial) · Δ 1 semaine ·{" "}
        {cot.dateRapport !== null ? formatDateCourte(cot.dateRapport) : "date n/d"}.
      </NoteSource>
    </section>
  );
}
