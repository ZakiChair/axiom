/**
 * Section « Risque » (VaR · β · stress) — rendu repliable.
 *
 * Purement présentationnel : reçoit l'état de collecte et la vue dérivée du hook
 * usePortfolioRisque, et affiche badges VaR/CVaR, tableau des contributions, grille de
 * stress et courbe de P&L. Collecte LAZY au dépliage ; bouton Rafraîchir force la collecte.
 */
import type { Dispatch, SetStateAction } from "react";
import { formatUsd, formatPct, formatDec } from "../../lib/format";
import { Vide } from "../ui";
import { CourbePnl } from "./CourbePnl";
import type { EtatRisque, VueRisque } from "./usePortfolioRisque";

interface SectionRisqueProps {
  showRisk: boolean;
  setShowRisk: Dispatch<SetStateAction<boolean>>;
  risque: EtatRisque;
  collecterRisque: (force: boolean) => Promise<void>;
  vueRisque: VueRisque;
}

export function SectionRisque({ showRisk, setShowRisk, risque, collecterRisque, vueRisque }: SectionRisqueProps) {
  return (
    <section className="mt-3">
      <button
        type="button"
        onClick={() => setShowRisk((v) => !v)}
        aria-expanded={showRisk}
        className="flex w-full items-center justify-between rounded-md border border-border bg-bg px-3 py-2 text-[11px] text-text-dim transition hover:text-text"
      >
        <span className="uppercase tracking-wider">Risque (VaR · β · stress)</span>
        <span>{showRisk ? "▾" : "▸"}</span>
      </button>
      {showRisk && (
        <div className="mt-1 space-y-2">
          <div className="flex items-center justify-between text-[10px] text-text-dim">
            <span>Composition actuelle · 90 j Binance</span>
            <button
              type="button"
              onClick={() => void collecterRisque(true)}
              disabled={risque.status === "loading"}
              className="rounded border border-border bg-surface px-2 py-0.5 text-[10px] transition hover:text-accent disabled:opacity-40"
            >
              {risque.status === "loading" ? "Collecte…" : "Rafraîchir"}
            </button>
          </div>

          {risque.status === "loading" && <Vide>Collecte des klines 1 j…</Vide>}
          {risque.status === "error" && <Vide>Collecte échouée : {risque.message}</Vide>}
          {vueRisque?.vide && (
            <Vide>
              Aucun symbole exploitable (périmètre crypto-Binance).
              {vueRisque.horsCalcul > 0 ? ` ${vueRisque.horsCalcul} position(s) hors calcul.` : ""}
            </Vide>
          )}

          {vueRisque && !vueRisque.vide && (
            <>
              {vueRisque.horsCalcul > 0 && (
                <p className="text-[10px] text-text-dim">
                  {vueRisque.horsCalcul} position(s) hors calcul de risque (hors périmètre crypto-Binance).
                </p>
              )}

              {/* Badges VaR / CVaR 1 j */}
              {vueRisque.risqueP === null ? (
                <Vide>Historique insuffisant (&lt; 30 j communs).</Vide>
              ) : (
                <div className="grid grid-cols-3 gap-2 text-center">
                  {(
                    [
                      ["VaR 95% · 1j", vueRisque.risqueP.var95Pct],
                      ["VaR 99% · 1j", vueRisque.risqueP.var99Pct],
                      ["CVaR 95%", vueRisque.risqueP.cvar95Pct],
                    ] as const
                  ).map(([label, pct]) => (
                    <div key={label} className="rounded-md border border-border bg-bg px-2 py-1.5">
                      <div className="text-[9px] uppercase tracking-wider text-text-dim">{label}</div>
                      <div className="tabular-nums text-sm font-medium text-down">
                        {pct >= 0 ? "−" : "+"}{formatUsd(Math.abs(pct) * vueRisque.sommeAbs)}
                      </div>
                      <div className="tabular-nums text-[10px] text-text-dim">
                        {formatPct(pct * 100, 2, { signe: false })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Tableau des contributions au risque */}
              <div className="rounded-md border border-border bg-bg px-2.5 py-2">
                <div className="mb-1.5 grid grid-cols-[1fr_auto_auto_auto] gap-2 text-[9px] uppercase tracking-wider text-text-dim">
                  <span>Symbole</span>
                  <span className="text-right">Poids</span>
                  <span className="text-right">β BTC</span>
                  <span className="text-right">Contrib.</span>
                </div>
                {vueRisque.lignes.map((l) => (
                  <div
                    key={l.symbol}
                    className="grid grid-cols-[1fr_auto_auto_auto] gap-2 py-0.5 text-[11px] tabular-nums"
                  >
                    <span className="font-medium text-text">{l.symbol}</span>
                    <span className="text-right text-text-dim">
                      {formatPct(l.poidsPct, 1, { signe: false })}
                    </span>
                    <span className="text-right text-text-dim">{formatDec(l.beta, 2)}</span>
                    <span
                      className={`text-right ${
                        l.ctrPct > 0 ? "text-up" : l.ctrPct < 0 ? "text-down" : "text-text-dim"
                      }`}
                    >
                      {formatPct(l.ctrPct, 1)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Grille de stress (choc BTC → impact linéaire en β) */}
              <div className="grid grid-cols-2 gap-2">
                {vueRisque.stress.map((c) => (
                  <div key={c.chocPct} className="rounded-md border border-border bg-bg px-2 py-1.5">
                    <div className="text-[9px] uppercase tracking-wider text-text-dim">
                      Choc BTC {c.chocPct > 0 ? "+" : ""}
                      {c.chocPct}%
                    </div>
                    <div
                      className={`tabular-nums text-sm font-medium ${
                        c.impactUsd > 0 ? "text-up" : c.impactUsd < 0 ? "text-down" : "text-text"
                      }`}
                    >
                      {c.impactUsd > 0 ? "+" : ""}
                      {formatUsd(c.impactUsd)}
                    </div>
                    {c.couvertUsd < vueRisque.sommeAbs && (
                      <div className="text-[9px] text-text-dim">
                        couvre {((c.couvertUsd / vueRisque.sommeAbs) * 100).toFixed(0)}% du notionnel
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Courbe de P&L de la composition actuelle (90 j) */}
              {vueRisque.equity.length >= 2 && (
                <div className="rounded-md border border-border bg-bg px-2 py-2">
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-text-dim">
                    P&amp;L de la composition actuelle (90 j)
                  </div>
                  <CourbePnl points={vueRisque.equity} />
                </div>
              )}

              {/* Note d'honnêteté : 3 approximations assumées */}
              <p className="text-[9px] leading-relaxed text-text-dim">
                Approximations : composition ACTUELLE rétro-projetée (constante dans le temps) ;
                stress LINÉAIRE en β vs BTC ; périmètre crypto-Binance uniquement. La VaR en %
                est exprimée sur le notionnel BRUT (Σ|positions|).
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
