/**
 * Section « Ouvertes » : liste des positions ouvertes + éditeur de clôture inline.
 *
 * IMPÉRATIF : les cellules prix/pnl/pct sont enregistrées dans la Map `cells` (refs de
 * callback inline) pour un repaint hors render-loop (cf. BUILD-CONTRACT — AUCUN re-render
 * React sur tick). Ce composant NE lit AUCUN prix live via le state React ; il ne rend que
 * la structure statique des lignes, alimentée impérativement par la fenêtre.
 */
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { formatPrice } from "../../lib/format";
import { Vide } from "../ui";
import { portfolioStore, type Position } from "../../store/portfolio";
import { registerCell, type RowCells } from "./domCells";

interface SectionOuvertesProps {
  openPositions: Position[];
  cells: MutableRefObject<Map<string, RowCells>>;
  closing: { id: string; prix: string } | null;
  setClosing: Dispatch<SetStateAction<{ id: string; prix: string } | null>>;
  confirmSuppr: string | null;
  setConfirmSuppr: Dispatch<SetStateAction<string | null>>;
  voirSurChart: (p: Position) => void;
  demanderCloture: (p: Position) => void;
  confirmerCloture: (p: Position) => void;
}

export function SectionOuvertes({
  openPositions,
  cells,
  closing,
  setClosing,
  confirmSuppr,
  setConfirmSuppr,
  voirSurChart,
  demanderCloture,
  confirmerCloture,
}: SectionOuvertesProps) {
  return (
    <section>
      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-text-dim">
        <span>Ouvertes</span>
        <span>{openPositions.length}</span>
      </div>
      {openPositions.length === 0 ? (
        <Vide>Aucune position ouverte. Ajoutez-en une ci-dessous.</Vide>
      ) : (
        <div className="space-y-1">
          {openPositions.map((p) => (
            <div key={p.id} className="rounded-md border border-border bg-bg px-2.5 py-2 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => voirSurChart(p)}
                  className="flex min-w-0 items-center gap-1.5 text-left"
                  title="Voir sur le chart"
                >
                  <span className="font-medium text-text">{p.symbole}</span>
                  <span
                    className={`rounded px-1 text-[9px] font-semibold uppercase ${
                      p.direction === "long" ? "text-up" : "text-down"
                    }`}
                  >
                    {p.direction}
                  </span>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  <span ref={(el) => registerCell(cells.current, p.id, "pnl", el)} className="tabular-nums font-medium">—</span>
                  <span ref={(el) => registerCell(cells.current, p.id, "pct", el)} className="tabular-nums text-[10px]">—</span>
                </div>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-text-dim">
                <span className="tabular-nums">
                  {p.taille} @ {formatPrice(p.prixEntree)}
                  {p.fraisPct !== undefined ? ` · ${p.fraisPct}%` : ""}
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums text-text-dim">
                    mkt <span ref={(el) => registerCell(cells.current, p.id, "prix", el)} className="text-text">—</span>
                  </span>
                  {closing?.id !== p.id && (
                    <button
                      type="button"
                      onClick={() => demanderCloture(p)}
                      className="rounded border border-border px-1.5 py-0.5 text-[10px] transition hover:text-accent"
                    >
                      Clôturer
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      // 1er clic : arme la confirmation ; 2e clic : supprime (pattern SettingsPanel.restaurer).
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
              {/* Éditeur de clôture inline (prix marché prérempli) */}
              {closing?.id === p.id && (
                <div className="mt-2 flex items-center gap-1.5 border-t border-border pt-2">
                  <label className="text-[10px] text-text-dim">Prix sortie</label>
                  <input
                    autoFocus
                    value={closing.prix}
                    onChange={(e) => setClosing({ id: p.id, prix: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") confirmerCloture(p);
                      if (e.key === "Escape") setClosing(null);
                    }}
                    inputMode="decimal"
                    className="w-24 rounded border border-border bg-bg px-1.5 py-0.5 text-[11px] tabular-nums text-text outline-none focus:border-text-dim"
                  />
                  <button
                    type="button"
                    onClick={() => confirmerCloture(p)}
                    className="rounded border border-border bg-surface px-2 py-0.5 text-[10px] transition hover:text-accent"
                  >
                    OK
                  </button>
                  <button
                    type="button"
                    onClick={() => setClosing(null)}
                    className="rounded px-1 text-[10px] text-text-dim transition hover:text-text"
                  >
                    Annuler
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
