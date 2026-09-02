/**
 * Section BRIEF — review de session (soir) : PnL réalisé, trades clos, alertes
 * déclenchées, éco passés. Données locales (portfolio + alertes + éco). Le bloc
 * « Éco passés » branche sur le statut de la section `eco`, pas sur la session.
 *
 * EXCEPTION aux autres sections (purement présentationnelles) : celle-ci lit AUSSI le
 * journal du daemon à son montage (`GET /alerts/journal`), seul témoin des alertes
 * déclenchées onglet fermé, et le fusionne au journal front (cf. `sessionAlertes.ts`).
 * Sans daemon, l'affichage est strictement inchangé.
 */
import { useEffect, useMemo, useState } from "react";
import type { EvenementBrief, SessionBrief, TradeClosBrief } from "../../data/brief";
import { journalAlertesGet, type DeclenchementDaemon } from "../../data/daemon";
import { debutJourLocalMs } from "../../store/portfolio";
import { formatHeureMinute, formatPct, formatUsdSigne } from "../../lib/format";
import { navigateTo } from "../../lib/navigation";
import { fusionnerAlertesSession } from "./sessionAlertes";
import { Chargement, ErreurBloc, TuileStat, NoteSource, TitreSection, Vide } from "../ui";
import { TableTriable, type ColonneTable } from "../TableTriable";
import { couleurVariation, TitreBloc, type Section } from "./commun";

/**
 * Ligne de trade clos + clé stable pour TableTriable (`cle` n'a pas accès à
 * l'index de la liste — symbole+dateSortie seuls peuvent collisionner si 2
 * clôtures du même symbole tombent sur la même milliseconde).
 */
interface LigneTradeClos extends TradeClosBrief {
  cle: string;
}

const COLONNES_TRADES_CLOS: ColonneTable<LigneTradeClos>[] = [
  { id: "heure", label: "Heure", rendu: (t) => <span className="text-text-dim">{formatHeureMinute(t.dateSortie)}</span> },
  { id: "symbole", label: "Symbole", rendu: (t) => <span className="text-text">{t.symbole}</span> },
  { id: "direction", label: "Sens", rendu: (t) => <span className="text-text-dim">{t.direction}</span> },
  {
    id: "pnl",
    label: "PnL",
    align: "right",
    rendu: (t) => <span style={{ color: couleurVariation(t.pnlNet) }}>{formatUsdSigne(t.pnlNet)}</span>,
  },
  {
    id: "pnlPct",
    label: "PnL %",
    align: "right",
    rendu: (t) => <span style={{ color: couleurVariation(t.pnlPct) }}>{formatPct(t.pnlPct)}</span>,
  },
];

interface Props {
  session: SessionBrief;
  eco: Section<EvenementBrief[]>;
  noteFraicheur: string;
}

export function SectionSession({ session, eco, noteFraicheur }: Props) {
  // Journal daemon : une seule lecture au montage (chemin froid, pas de poll).
  const [journalDaemon, setJournalDaemon] = useState<DeclenchementDaemon[]>([]);
  useEffect(() => {
    let monte = true;
    void journalAlertesGet().then((j) => {
      if (monte && j !== null) setJournalDaemon(j);
    });
    return () => {
      monte = false;
    };
  }, []);

  const alertes = useMemo(() => {
    const maintenant = Date.now();
    return fusionnerAlertesSession(
      session.alertes,
      journalDaemon,
      debutJourLocalMs(maintenant),
      maintenant,
    );
  }, [session.alertes, journalDaemon]);

  return (
    <section className="space-y-2">
      <TitreBloc>Session · review</TitreBloc>
      <div className="grid grid-cols-3 gap-2">
        <TuileStat
          disposition="inline"
          label="PnL réalisé"
          valeur={formatUsdSigne(session.pnlRealise)}
          couleur={couleurVariation(session.pnlRealise)}
        />
        <TuileStat disposition="inline" label="Trades clos" valeur={String(session.tradesClos.length)} />
        <TuileStat disposition="inline" label="W / L" valeur={`${session.gagnants} / ${session.perdants}`} />
      </div>

      <div className="space-y-1">
        <TitreSection>Trades clos</TitreSection>
        {session.tradesClos.length === 0 ? (
          <Vide>Aucun trade clôturé aujourd&apos;hui.</Vide>
        ) : (
          <TableTriable
            colonnes={COLONNES_TRADES_CLOS}
            lignes={session.tradesClos.map((t, i) => ({ ...t, cle: `${t.symbole}-${t.dateSortie}-${i}` }))}
            cle={(t) => t.cle}
            // Source RÉELLE de la position (exchange d'origine) : forcer Binance
            // renvoyait un actif Kraken/tradfi sur `binance:<symbole>`.
            surClicLigne={(t) => navigateTo({ symbol: t.symbole, exchange: t.source, source: "brief" })}
          />
        )}
      </div>

      <div className="space-y-1">
        <TitreSection extra={alertes.length > 0 ? String(alertes.length) : undefined}>
          Alertes déclenchées
        </TitreSection>
        {alertes.length === 0 ? (
          <Vide>Aucune alerte déclenchée aujourd&apos;hui.</Vide>
        ) : (
          <div className="space-y-1">
            {alertes.map((a, i) => (
              <div
                key={`${a.alertId}-${a.ts}-${i}`}
                className="flex items-baseline gap-2 text-[11px]"
              >
                <span className="w-12 shrink-0 tabular-nums text-text-dim">
                  {formatHeureMinute(a.ts)}
                </span>
                <span className="min-w-0 flex-1 truncate text-text">{a.message}</span>
                {a.daemon && (
                  <span
                    title="Déclenchée par le daemon, application fermée"
                    className="shrink-0 text-[10px] text-text-dim"
                  >
                    pendant votre absence
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1">
        <TitreSection>Éco passés</TitreSection>
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
        Portefeuille local · journal alertes (local + daemon) · calendrier éco (passés) ·{" "}
        {noteFraicheur}.
      </NoteSource>
    </section>
  );
}
