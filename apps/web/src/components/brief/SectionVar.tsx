/**
 * Section BRIEF — VaR chart : VaR95/99 20 b du chart maître (distribution empirique,
 * instantané). Le garde de présence (< 300 bougies → absente) reste dans
 * l'orchestrateur, qui ne monte cette section qu'avec un `varChart` non nul.
 */
import { formatPct, formatPrice } from "../../lib/format";
import { TuileStat, NoteSource } from "../ui";
import { TitreBloc, type VarChart } from "./commun";

interface Props {
  varChart: VarChart;
  noteFraicheur: string;
}

export function SectionVar({ varChart, noteFraicheur }: Props) {
  return (
    <section className="space-y-2">
      <TitreBloc>VaR · {varChart.symbol} {varChart.timeframe}</TitreBloc>
      <div className="grid grid-cols-2 gap-2">
        <TuileStat
          disposition="inline"
          label="VaR95 · 20 b"
          valeur={formatPct(varChart.h20.pct.p5, 1)}
          couleur="var(--down)"
          extra={
            <span className="text-[10px] tabular-nums text-text-dim">
              {formatPrice(varChart.h20.niveaux.p5)}
            </span>
          }
        />
        <TuileStat
          disposition="inline"
          label="VaR99 · 20 b"
          valeur={formatPct(varChart.h20.pct.p1, 1)}
          couleur="var(--down)"
          extra={
            <span className="text-[10px] tabular-nums text-text-dim">
              {formatPrice(varChart.h20.niveaux.p1)}
            </span>
          }
        />
      </div>
      <NoteSource>
        Distribution empirique des bougies du chart maître (horizon 20 b, {varChart.h20.nEchantillons} échantillons) — PAS une prévision · {noteFraicheur}.
      </NoteSource>
    </section>
  );
}
