/**
 * Section BRIEF — review de session (soir) : PnL réalisé, trades clos, alertes
 * déclenchées, éco passés. Données locales (portfolio + alertes + éco). Le bloc
 * « Éco passés » branche sur le statut de la section `eco`, pas sur la session.
 */
import type { EvenementBrief, SessionBrief } from "../../data/brief";
import { formatHeureMinute, formatPct, formatUsdSigne } from "../../lib/format";
import { navigateTo } from "../../lib/navigation";
import { Chargement, ErreurBloc, Metric, NoteSource, Vide } from "../ui";
import { couleurVariation, TitreBloc, type Section } from "./commun";

interface Props {
  session: SessionBrief;
  eco: Section<EvenementBrief[]>;
  noteFraicheur: string;
}

export function SectionSession({ session, eco, noteFraicheur }: Props) {
  return (
    <section className="space-y-2">
      <TitreBloc>Session · review</TitreBloc>
      <div className="grid grid-cols-3 gap-2">
        <Metric
          label="PnL réalisé"
          value={formatUsdSigne(session.pnlRealise)}
          couleur={couleurVariation(session.pnlRealise)}
        />
        <Metric label="Trades clos" value={String(session.tradesClos.length)} />
        <Metric label="W / L" value={`${session.gagnants} / ${session.perdants}`} />
      </div>

      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-wide text-text-dim">Trades clos</p>
        {session.tradesClos.length === 0 ? (
          <Vide>Aucun trade clôturé aujourd&apos;hui.</Vide>
        ) : (
          <table className="w-full text-[11px] tabular-nums">
            <tbody>
              {session.tradesClos.map((t, i) => (
                <tr
                  key={`${t.symbole}-${t.dateSortie}-${i}`}
                  className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-bg"
                  onClick={() =>
                    navigateTo({ symbol: t.symbole, exchange: "binance", source: "brief" })
                  }
                  title={`Ouvrir ${t.symbole} dans le chart`}
                >
                  <td className="py-1 text-text-dim">{formatHeureMinute(t.dateSortie)}</td>
                  <td className="py-1 text-text">{t.symbole}</td>
                  <td className="py-1 text-text-dim">{t.direction}</td>
                  <td
                    className="py-1 text-right"
                    style={{ color: couleurVariation(t.pnlNet) }}
                  >
                    {formatUsdSigne(t.pnlNet)}
                  </td>
                  <td
                    className="py-1 text-right"
                    style={{ color: couleurVariation(t.pnlPct) }}
                  >
                    {formatPct(t.pnlPct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-wide text-text-dim">
          Alertes déclenchées
          {session.alertes.length > 0 ? ` · ${session.alertes.length}` : ""}
        </p>
        {session.alertes.length === 0 ? (
          <Vide>Aucune alerte déclenchée aujourd&apos;hui.</Vide>
        ) : (
          <div className="space-y-1">
            {session.alertes.map((a, i) => (
              <div
                key={`${a.alertId}-${a.ts}-${i}`}
                className="flex items-baseline gap-2 text-[11px]"
              >
                <span className="w-12 shrink-0 tabular-nums text-text-dim">
                  {formatHeureMinute(a.ts)}
                </span>
                <span className="min-w-0 flex-1 truncate text-text">{a.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-wide text-text-dim">Éco passés</p>
        {eco.statut === "idle" || eco.statut === "loading" ? (
          <Chargement />
        ) : session.ecoPasses === null ? (
          <ErreurBloc>Calendrier éco indisponible.</ErreurBloc>
        ) : session.ecoPasses.length === 0 ? (
          <Vide>Aucun événement à fort impact écoulé aujourd&apos;hui.</Vide>
        ) : (
          <div className="space-y-1">
            {session.ecoPasses.map((ev, i) => (
              <button
                key={`pass-${ev.time}-${i}`}
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
              </button>
            ))}
          </div>
        )}
      </div>
      <NoteSource>
        Portefeuille local · journal alertes · calendrier éco (passés) · {noteFraicheur}.
      </NoteSource>
    </section>
  );
}
