/**
 * Section BRIEF — squeeze · carburant : top 3 carburant-squeeze (funding < 0 &
 * OI ↑) par intensité (même domaine/score que la fenêtre SQZ).
 */
import type { PointRadar } from "../../data/squeeze";
import { formatPct } from "../../lib/format";
import { navigateTo } from "../../lib/navigation";
import { NoteSource, Vide } from "../ui";
import { domaineAxesRobuste, scoreSqueeze } from "../squeezeWindow.util";
import { corps, TitreBloc, type Section } from "./commun";

interface Props {
  squeeze: Section<PointRadar[]>;
  noteFraicheur: string;
}

export function SectionSqueeze({ squeeze, noteFraicheur }: Props) {
  return (
    <section className="space-y-2">
      <TitreBloc>Squeeze · carburant</TitreBloc>
      {corps(squeeze, "Radar de squeeze indisponible.", (points) => {
        // Domaine calculé sur TOUS les points (cohérent avec la fenêtre SQZ), PUIS filtre.
        const domaine = domaineAxesRobuste(points);
        const top = points
          .filter((p) => p.quadrant === "carburant-squeeze")
          .sort((a, b) => scoreSqueeze(b, domaine) - scoreSqueeze(a, domaine))
          .slice(0, 3);
        return top.length === 0 ? (
          <Vide>Aucun carburant-squeeze (funding négatif + OI en hausse).</Vide>
        ) : (
          <div className="space-y-1">
            {top.map((p) => (
              <button
                key={p.symbol}
                type="button"
                onClick={() => navigateTo({ symbol: p.symbol, exchange: "binance", source: "brief" })}
                title={`Ouvrir ${p.symbol} dans le chart`}
                className="flex w-full items-baseline justify-between gap-2 text-left text-[11px] tabular-nums transition hover:bg-bg"
              >
                <span className="font-medium text-text">{p.symbol}</span>
                <span className="flex gap-x-3 text-[10px] text-text-dim">
                  <span>
                    funding <span className="text-down">{formatPct(p.fundingPct, 4)}</span>
                  </span>
                  <span>
                    ΔOI <span className="text-up">{formatPct(p.dOiPct)}</span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        );
      })}
      <NoteSource>Funding × ΔOI ~24 h (Binance perp) · {noteFraicheur}.</NoteSource>
    </section>
  );
}
