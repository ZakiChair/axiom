/**
 * Section BRIEF — flux ETF de la veille (SoSoValue). Dégradation gracieuse via
 * `corps` ; « indisponible » par actif quand la donnée manque.
 */
import type { EtfBrief } from "../../data/brief";
import { formatUsd } from "../../lib/format";
import { NoteSource } from "../ui";
import { corps, couleurVariation, TitreBloc, type Section } from "./commun";

interface Props {
  etf: Section<EtfBrief[]>;
  noteFraicheur: string;
}

export function SectionEtf({ etf, noteFraicheur }: Props) {
  return (
    <section className="space-y-2">
      <TitreBloc>Flux ETF · veille</TitreBloc>
      {corps(etf, "Flux ETF indisponibles.", (actifs) => (
        <div className="space-y-1">
          {actifs.map((e) => (
            <div key={e.actif} className="flex items-baseline justify-between text-[11px]">
              <span className="uppercase text-text-dim">{e.actif}</span>
              {e.disponible && e.total !== null ? (
                <span className="tabular-nums" style={{ color: couleurVariation(e.total) }}>
                  {formatUsd(e.total)}
                  {e.jour !== null && <span className="ml-1 text-[10px] text-text-dim">({e.jour})</span>}
                </span>
              ) : (
                <span className="text-text-dim">indisponible</span>
              )}
            </div>
          ))}
        </div>
      ))}
      <NoteSource>Données SoSoValue (flux nets quotidiens) · {noteFraicheur}.</NoteSource>
    </section>
  );
}
