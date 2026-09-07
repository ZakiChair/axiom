/**
 * Section BRIEF — inflation en glissement annuel des six zones suivies.
 *
 * LIT le cache du store macro, ne déclenche AUCUN fetch : le point marché est un
 * instantané. La section est absente (et non vide) quand rien n'est chargé — c'est
 * l'orchestrateur qui la conditionne, comme pour SectionCot.
 */
import type { LigneMacroBrief } from "../../data/brief";
import { formatPourcentage } from "../../lib/format";
import { NoteSource } from "../ui";
import { TitreBloc } from "./commun";

interface Props {
  macro: LigneMacroBrief[];
}

export function SectionMacro({ macro }: Props) {
  return (
    <section className="space-y-2">
      <TitreBloc>Inflation (a/a)</TitreBloc>
      <div className="space-y-1">
        {macro.map((l) => (
          <div key={l.region} className="flex items-baseline justify-between gap-2 text-[11px]">
            <span className="text-text">{l.region}</span>
            {l.valeur !== null ? (
              <span className="tabular-nums text-text">{formatPourcentage(l.valeur)}</span>
            ) : (
              /* Motif explicite, jamais un tiret muet. */
              <span className="text-warn">{l.message}</span>
            )}
          </div>
        ))}
      </div>
      <NoteSource>FRED · Eurostat · OCDE · ONS — lu du cache local, publication mensuelle.</NoteSource>
    </section>
  );
}
