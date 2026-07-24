/**
 * Section BRIEF — régime · largeur de marché (breadth) : jauges MM50/MM200, A/D,
 * tendance MM50. Dégradation gracieuse propre via `corps`.
 */
import type { ResumBreadth } from "../../data/breadth";
import { NoteSource } from "../ui";
import { corps, JaugeBreadth, TitreBloc, type Section } from "./commun";

interface Props {
  breadth: Section<ResumBreadth>;
  noteFraicheur: string;
}

export function SectionBreadth({ breadth, noteFraicheur }: Props) {
  return (
    <section className="space-y-2">
      <TitreBloc>Régime · largeur de marché</TitreBloc>
      {corps(breadth, "Largeur de marché indisponible.", (b) => {
        const dTend = b.pctMm50Prec === null ? null : b.pctAuDessusMm50 - b.pctMm50Prec;
        // Tendance MM50 vs calcul précédent : ▲ hausse, ▼ baisse, — stable/premier calcul.
        const fleche = dTend === null || Math.abs(dTend) < 0.5 ? "—" : dTend > 0 ? "▲" : "▼";
        const couleurFleche =
          dTend === null || Math.abs(dTend) < 0.5
            ? "var(--text-dim)"
            : dTend > 0
              ? "var(--up)"
              : "var(--down)";
        return (
          <div className="space-y-2">
            <JaugeBreadth label="% > MM50" pct={b.pctAuDessusMm50} />
            <JaugeBreadth label="% > MM200" pct={b.pctAuDessusMm200} />
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[11px]">
              <span className="text-text-dim">
                A/D jour{" "}
                <span className="tabular-nums text-up">{b.adJour.hausses}</span>
                <span> / </span>
                <span className="tabular-nums text-down">{b.adJour.baisses}</span>
              </span>
              <span className="text-text-dim">
                Tendance MM50 <span style={{ color: couleurFleche }}>{fleche}</span>
              </span>
            </div>
            <p className="text-[10px] text-text-dim">
              {b.nUnivers < 50 ? `${b.nUnivers}/50 valides` : `${b.nUnivers} valides`}
            </p>
          </div>
        );
      })}
      <NoteSource>Binance ticker 24 h + klines 1d (top 50) · cache 12 h · {noteFraicheur}.</NoteSource>
    </section>
  );
}
