/**
 * Section BRIEF — watchlist overnight (Binance REST). Dégradation gracieuse via
 * `corps` ; ligne cliquable → chart.
 */
import type { LigneWatchlist } from "../../data/brief";
import { formatPct, formatPrice } from "../../lib/format";
import { navigateTo } from "../../lib/navigation";
import { NoteSource, Vide } from "../ui";
import { corps, couleurVariation, TitreBloc, type Section } from "./commun";

interface Props {
  watchlist: Section<LigneWatchlist[]>;
  noteFraicheur: string;
}

export function SectionWatchlist({ watchlist, noteFraicheur }: Props) {
  return (
    <section className="space-y-2">
      <TitreBloc>Watchlist · overnight</TitreBloc>
      {corps(watchlist, "Prix overnight indisponibles.", (rows) =>
        rows.length === 0 ? (
          <Vide>Aucun symbole dans la watchlist.</Vide>
        ) : (
          <table className="w-full text-[11px] tabular-nums">
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.symbole}
                  className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-bg"
                  onClick={() =>
                    navigateTo({ symbol: r.symbole, exchange: "binance", source: "brief" })
                  }
                  title={`Ouvrir ${r.symbole} dans le chart`}
                >
                  <td className="py-1 text-text">{r.symbole}</td>
                  <td className="py-1 text-right text-text">{formatPrice(r.prix)}</td>
                  <td className="py-1 text-right" style={{ color: couleurVariation(r.variation24h) }}>
                    {formatPct(r.variation24h)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ),
      )}
      <NoteSource>Données Binance (ticker 24 h) · {noteFraicheur}.</NoteSource>
    </section>
  );
}
