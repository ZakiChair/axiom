/**
 * Section BRIEF — funding · extrêmes : top 3 |funding| > 0.03 %/8 h (premiumIndex,
 * univers complet). Dégradation gracieuse via `corps`.
 */
import type { FundingExtreme } from "../../data/brief";
import { formatPct } from "../../lib/format";
import { navigateTo } from "../../lib/navigation";
import { NoteSource, Vide } from "../ui";
import { corps, couleurVariation, TitreBloc, type Section } from "./commun";

interface Props {
  funding: Section<FundingExtreme[]>;
  noteFraicheur: string;
}

export function SectionFunding({ funding, noteFraicheur }: Props) {
  return (
    <section className="space-y-2">
      <TitreBloc>Funding · extrêmes</TitreBloc>
      {corps(funding, "Funding indisponible.", (lignes) =>
        lignes.length === 0 ? (
          <Vide>Aucun extrême (marché calme).</Vide>
        ) : (
          <div className="space-y-1">
            {lignes.map((f) => (
              <button
                key={f.symbole}
                type="button"
                onClick={() => navigateTo({ symbol: f.symbole, exchange: "binance", source: "brief" })}
                title={`Ouvrir ${f.symbole} dans le chart`}
                className="flex w-full items-baseline justify-between gap-2 text-left text-[11px] tabular-nums transition hover:bg-bg"
              >
                <span className="font-medium text-text">{f.symbole}</span>
                <span style={{ color: couleurVariation(f.fundingPct) }}>
                  {formatPct(f.fundingPct, 4)}
                </span>
              </button>
            ))}
          </div>
        ),
      )}
      <NoteSource>Funding perp Binance (premiumIndex, %/8 h) · {noteFraicheur}.</NoteSource>
    </section>
  );
}
