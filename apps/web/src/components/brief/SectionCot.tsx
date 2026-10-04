/**
 * Section BRIEF — COT : cache legacy SEUL, 3 instruments au |Δ net entre rapports|
 * max, mouvements longs/shorts séparés. Le garde de présence reste dans l'orchestrateur, qui
 * ne monte cette section qu'avec un `cot` non nul.
 */
import { NoteSource } from "../ui";
import { TitreBloc, type CotChart } from "./commun";
import { NetCot, PeriodeCot, PositionsCot } from "../cot/PositionsCot";

interface Props {
  cot: CotChart;
}

export function SectionCot({ cot }: Props) {
  return (
    <section className="space-y-2">
      <TitreBloc>COT · positions non-commerciales</TitreBloc>
      <div className="space-y-3">
        {cot.lignes.map(({ ligne }) => (
          <article key={ligne.nom} className="space-y-1" aria-label={ligne.libelle}>
            <h4 className="text-[11px] font-medium text-text">{ligne.libelle}</h4>
            <PeriodeCot ligne={ligne} />
            <PositionsCot ligne={ligne} />
            <NetCot ligne={ligne} />
          </article>
        ))}
      </div>
      <NoteSource>
        CFTC legacy · longs = acheteurs, shorts = vendeurs. Ajouts / réductions nets entre
        les rapports datés, pas des ouvertures / clôtures brutes : elles peuvent se compenser.
        Net = longs − shorts, sans prévision de prix.
      </NoteSource>
    </section>
  );
}
