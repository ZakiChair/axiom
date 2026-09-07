/**
 * Section BRIEF — famille et zones sélectionnées dans MACRO.
 *
 * LIT le cache du store macro, ne déclenche AUCUN fetch : le point marché est un
 * instantané. La section est absente (et non vide) quand rien n'est chargé — c'est
 * l'orchestrateur qui la conditionne, comme pour SectionCot.
 */
import type { LigneMacroBrief } from "../../data/brief";
import { valeurMacroBrief } from "../../data/brief";
import { NoteSource } from "../ui";
import { TitreBloc } from "./commun";

interface Props {
  macro: LigneMacroBrief[];
}

export function SectionMacro({ macro }: Props) {
  return (
    <section className="space-y-2">
      <TitreBloc>{macro[0]?.indicateur ?? "Macro — sélection"}</TitreBloc>
      <div className="space-y-1">
        {macro.map((l) => (
          <div key={l.region} className="flex items-baseline justify-between gap-2 text-[11px]">
            <span className="text-text">{l.region}</span>
            {l.valeur !== null ? (
              <span className="tabular-nums text-text">{valeurMacroBrief(l)}</span>
            ) : (
              /* Motif explicite, jamais un tiret muet. */
              <span className="text-warn">{l.message}</span>
            )}
          </div>
        ))}
      </div>
      <NoteSource>Sélection MACRO · lu du cache local, période d’observation affichée. Données révisables.</NoteSource>
    </section>
  );
}
