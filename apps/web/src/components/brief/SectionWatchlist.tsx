/**
 * Section BRIEF — watchlist overnight (Binance REST). Dégradation gracieuse via
 * `corps` ; ligne cliquable → chart.
 */
import type { LigneWatchlist } from "../../data/brief";
import { formatPct, formatPrice } from "../../lib/format";
import { navigateTo } from "../../lib/navigation";
import { NoteSource, Vide } from "../ui";
import { TableTriable, type ColonneTable } from "../TableTriable";
import { corps, couleurVariation, TitreBloc, type Section } from "./commun";

const COLONNES_WATCHLIST: ColonneTable<LigneWatchlist>[] = [
  { id: "symbole", label: "Symbole", rendu: (r) => <span className="text-text">{r.symbole}</span> },
  { id: "prix", label: "Prix", align: "right", rendu: (r) => <span className="text-text">{formatPrice(r.prix)}</span> },
  {
    id: "variation24h",
    label: "24 h",
    align: "right",
    rendu: (r) => <span style={{ color: couleurVariation(r.variation24h) }}>{formatPct(r.variation24h)}</span>,
  },
];

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
          <TableTriable
            colonnes={COLONNES_WATCHLIST}
            lignes={rows}
            cle={(r) => r.symbole}
            // Source RÉELLE du symbole (résolue à la construction de la ligne) : forcer
            // Binance envoyait un actif Kraken/tradfi sur `binance:<symbole>`.
            surClicLigne={(r) => navigateTo({ symbol: r.symbole, exchange: r.source, source: "brief" })}
          />
        ),
      )}
      <NoteSource>Données Binance (ticker 24 h) · {noteFraicheur}.</NoteSource>
    </section>
  );
}
