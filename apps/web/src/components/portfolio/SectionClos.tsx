/**
 * Section « Clos » repliée + stats simples (win rate, PnL cumulé, meilleure/pire).
 *
 * Présentationnel : la liste des positions closes, l'état d'ouverture et la suppression armée
 * (confirmSuppr) sont pilotés par la fenêtre ; la suppression appelle directement le store.
 */
import type { Dispatch, SetStateAction } from "react";
import { formatUsd, formatPrice } from "../../lib/format";
import { Vide } from "../ui";
import { pnlRealisePosition, portfolioStore, statsClotures, type Position } from "../../store/portfolio";

interface SectionClosProps {
  stats: ReturnType<typeof statsClotures>;
  showClosed: boolean;
  setShowClosed: Dispatch<SetStateAction<boolean>>;
  closedPositions: Position[];
  confirmSuppr: string | null;
  setConfirmSuppr: Dispatch<SetStateAction<string | null>>;
  voirSurChart: (p: Position) => void;
}

export function SectionClos({
  stats,
  showClosed,
  setShowClosed,
  closedPositions,
  confirmSuppr,
  setConfirmSuppr,
  voirSurChart,
}: SectionClosProps) {
  return (
    <section className="mt-3">
      <button
        type="button"
        onClick={() => setShowClosed((v) => !v)}
        aria-expanded={showClosed}
        className="flex w-full items-center justify-between rounded-md border border-border bg-bg px-3 py-2 text-[11px] text-text-dim transition hover:text-text"
      >
        <span className="uppercase tracking-wider">Clos ({stats.nombre})</span>
        <span className="flex items-center gap-3 tabular-nums">
          <span>
            Win {stats.nombre > 0 ? `${stats.winRate.toFixed(0)}%` : "—"}
          </span>
          <span className={stats.pnlCumule > 0 ? "text-up" : stats.pnlCumule < 0 ? "text-down" : undefined}>
            {stats.nombre > 0 ? `${stats.pnlCumule > 0 ? "+" : ""}${formatUsd(stats.pnlCumule)}` : "—"}
          </span>
          <span>{showClosed ? "▾" : "▸"}</span>
        </span>
      </button>
      {showClosed && (
        <div className="mt-1 space-y-1">
          {stats.nombre > 0 && (
            <div className="flex justify-between rounded-md border border-border bg-bg px-3 py-1.5 text-[10px] text-text-dim">
              <span>Meilleure <span className="tabular-nums text-up">{formatUsd(stats.meilleure ?? undefined)}</span></span>
              <span>Pire <span className="tabular-nums text-down">{formatUsd(stats.pire ?? undefined)}</span></span>
            </div>
          )}
          {closedPositions.length === 0 ? (
            <Vide>Aucune position clôturée.</Vide>
          ) : (
            closedPositions.map((p) => {
              const pnl = pnlRealisePosition(p);
              return (
                <div key={p.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-bg px-2.5 py-1.5 text-[11px]">
                  <button type="button" onClick={() => voirSurChart(p)} className="flex items-center gap-1.5 text-left" title="Voir sur le chart">
                    <span className="font-medium text-text">{p.symbole}</span>
                    <span className={`text-[9px] font-semibold uppercase ${p.direction === "long" ? "text-up" : "text-down"}`}>
                      {p.direction}
                    </span>
                  </button>
                  <span className="flex items-center gap-2 text-[10px] text-text-dim">
                    <span className="tabular-nums">{formatPrice(p.prixEntree)} → {formatPrice(p.prixSortie ?? 0)}</span>
                    <span
                      className={`tabular-nums font-medium ${
                        pnl && pnl.net > 0 ? "text-up" : pnl && pnl.net < 0 ? "text-down" : ""
                      }`}
                    >
                      {pnl ? `${pnl.net > 0 ? "+" : ""}${formatUsd(pnl.net)}` : "—"}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        // 1er clic : arme la confirmation ; 2e clic : supprime (pattern SettingsPanel.restaurer).
                        // Position close = historique irrécupérable → confirmation obligatoire.
                        if (confirmSuppr !== p.id) {
                          setConfirmSuppr(p.id);
                          return;
                        }
                        setConfirmSuppr(null);
                        portfolioStore.getState().supprimer(p.id);
                      }}
                      onBlur={() => setConfirmSuppr((c) => (c === p.id ? null : c))}
                      aria-label={
                        confirmSuppr === p.id
                          ? `Confirmer la suppression de ${p.symbole}`
                          : `Supprimer ${p.symbole}`
                      }
                      className={
                        confirmSuppr === p.id
                          ? "text-[10px] font-semibold uppercase text-down"
                          : "text-text-dim transition hover:text-down"
                      }
                    >
                      {confirmSuppr === p.id ? "confirmer ?" : "✕"}
                    </button>
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}
