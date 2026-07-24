/**
 * Section BRIEF — événements éco du jour (fort impact). Dégradation gracieuse via
 * `corps` ; l'étiquette passé/à-venir se calcule vs `instant`.
 */
import type { EvenementBrief } from "../../data/brief";
import { formatDelai, formatHeureMinute } from "../../lib/format";
import { navigateTo } from "../../lib/navigation";
import { NoteSource, Vide } from "../ui";
import { corps, TitreBloc, type Section } from "./commun";

interface Props {
  eco: Section<EvenementBrief[]>;
  instant: number;
  noteFraicheur: string;
}

export function SectionEco({ eco, instant, noteFraicheur }: Props) {
  return (
    <section className="space-y-2">
      <TitreBloc>Événements éco du jour</TitreBloc>
      {corps(eco, "Calendrier éco indisponible.", (evs) =>
        evs.length === 0 ? (
          <Vide>Aucun événement à fort impact aujourd'hui.</Vide>
        ) : (
          <div className="space-y-1">
            {evs.map((ev, i) => (
              <button
                key={`${ev.time}-${i}`}
                type="button"
                onClick={() =>
                  navigateTo({
                    markTime: ev.time,
                    markLabel: `${ev.pays} ${ev.titre}`,
                    source: "brief",
                  })
                }
                title="Marquer sur le chart"
                className="flex w-full items-baseline gap-2 text-left text-[11px] transition hover:bg-bg"
              >
                <span className="w-14 shrink-0 tabular-nums text-text-dim">
                  {ev.timeApprox ? "~" : ""}
                  {formatHeureMinute(ev.time)}
                </span>
                <span className="w-10 shrink-0 text-text-dim">{ev.pays}</span>
                <span className="min-w-0 flex-1 truncate text-text">{ev.titre}</span>
                <span className="shrink-0 text-[10px] text-text-dim">
                  {ev.time <= instant ? "passé" : formatDelai(ev.time, instant)}
                </span>
              </button>
            ))}
          </div>
        ),
      )}
      <NoteSource>ForexFactory · FRED · FOMC (fort impact seulement) · {noteFraicheur}.</NoteSource>
    </section>
  );
}
