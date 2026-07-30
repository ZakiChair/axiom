/**
 * Section BRIEF — volatilité · DVOL BTC/ETH (Deribit). Dégradation gracieuse via
 * `corps`.
 */
import type { DvolBrief } from "../../data/brief";
import { formatPourcentage, VALEUR_ABSENTE } from "../../lib/format";
import { TuileStat, NoteSource } from "../ui";
import { corps, TitreBloc, type Section } from "./commun";

interface Props {
  dvol: Section<DvolBrief[]>;
  noteFraicheur: string;
}

export function SectionDvol({ dvol, noteFraicheur }: Props) {
  return (
    <section className="space-y-2">
      <TitreBloc>Volatilité · DVOL</TitreBloc>
      {corps(dvol, "DVOL indisponible.", (vals) => (
        <div className="grid grid-cols-2 gap-2">
          {vals.map((v) => (
            <TuileStat
              disposition="inline"
              key={v.devise}
              label={`DVOL ${v.devise}`}
              valeur={v.valeur === null ? VALEUR_ABSENTE : formatPourcentage(v.valeur, 1)}
            />
          ))}
        </div>
      ))}
      <NoteSource>Données Deribit (indice DVOL) · {noteFraicheur}.</NoteSource>
    </section>
  );
}
