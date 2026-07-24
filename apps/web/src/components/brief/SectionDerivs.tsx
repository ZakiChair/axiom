/**
 * Section BRIEF — dérivés : funding + prochain règlement + ΔOI 24 h (BTC/ETH/SOL).
 * Dégradation gracieuse via `corps` ; le délai de règlement se calcule vs `instant`.
 */
import type { LigneDeriv } from "../../data/brief";
import { formatDelai, formatFunding, formatPct, VALEUR_ABSENTE } from "../../lib/format";
import { navigateTo } from "../../lib/navigation";
import { NoteSource } from "../ui";
import { corps, couleurVariation, TitreBloc, type Section } from "./commun";

interface Props {
  derivs: Section<LigneDeriv[]>;
  instant: number;
  noteFraicheur: string;
}

export function SectionDerivs({ derivs, instant, noteFraicheur }: Props) {
  return (
    <section className="space-y-2">
      <TitreBloc>Dérivés</TitreBloc>
      {corps(derivs, "Dérivés indisponibles.", (lignes) => (
        <div className="space-y-2">
          {lignes.map((d) => (
            <button
              key={d.symbole}
              type="button"
              onClick={() =>
                navigateTo({
                  symbol: `${d.symbole}USDT`,
                  exchange: "binance",
                  source: "brief",
                })
              }
              title={`Ouvrir ${d.symbole}USDT dans le chart`}
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-left transition hover:border-text-dim"
            >
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium text-text">{d.symbole}</span>
                <span className="text-[11px] tabular-nums" style={{ color: couleurVariation(d.deltaOiPct) }}>
                  ΔOI 24 h {d.deltaOiPct === null ? VALEUR_ABSENTE : formatPct(d.deltaOiPct)}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-text-dim">
                <span>
                  funding <span className="tabular-nums text-text">{formatFunding(d.fundingActuel)}</span>
                </span>
                <span>
                  prédit <span className="tabular-nums text-text">{formatFunding(d.fundingPredit)}</span>
                </span>
                <span>
                  prochain règlement{" "}
                  <span className="text-text">
                    {d.prochainReglement === null ? VALEUR_ABSENTE : formatDelai(d.prochainReglement, instant)}
                  </span>
                </span>
              </div>
            </button>
          ))}
        </div>
      ))}
      <NoteSource>Funding Coinalyze · Open Interest Binance fapi · {noteFraicheur}.</NoteSource>
    </section>
  );
}
