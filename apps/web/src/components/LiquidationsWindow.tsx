/**
 * Fenêtre « Liquidations » (mnémonique LIQ) — flux LIVE des liquidations forcées du
 * perpétuel Bybit pour le symbole courant (data/liquidations.ts). Affiche les
 * totaux notionnels long/short accumulés depuis la souscription, une barre de dominance,
 * et le feed des dernières liquidations. Échantillon (~1 msg/s côté Binance), pas exhaustif.
 *
 * Rendu par FloatingWindow (frame fournie par App.tsx). Reset au changement de symbole.
 */
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { marketStore } from "../store/market";
import { subscribeLiquidations, resumerLiquidations, type Liquidation } from "../data/liquidations";
import { liqMarksStore } from "../chart/liquidationMarkers";
import { EnTeteFenetre, Vide, NoteSource } from "./ui";
import { formatUsd, formatHeure, formatPrice, formatPourcentage } from "../lib/format";

/** Nombre max de liquidations conservées dans le feed (borne mémoire/affichage). */
const MAX_FEED = 60;

/**
 * Bascule « Sur le graphe » : active/désactive les marqueurs de liquidation sur le
 * chart (liqMarksStore, cf. chart/liquidationMarkers.ts). Rend la feature découvrable
 * depuis la fenêtre, sans passer par ⌘K LIQMARK.
 */
function ToggleChart() {
  const actif = useStore(liqMarksStore, (s) => s.actif);
  const basculer = useStore(liqMarksStore, (s) => s.basculer);
  return (
    <button
      type="button"
      onClick={basculer}
      aria-pressed={actif}
      title="Afficher les liquidations sur le graphe (marqueurs)"
      className={`rounded border px-2 py-1 text-[11px] font-medium transition ${
        actif ? "border-accent bg-bg text-accent" : "border-border bg-bg text-text-dim hover:text-text"
      }`}
    >
      {actif ? "● Sur le graphe" : "Sur le graphe"}
    </button>
  );
}

export function LiquidationsWindow() {
  const symbol = useStore(marketStore, (s) => s.symbol);
  const [liqs, setLiqs] = useState<Liquidation[]>([]);

  useEffect(() => {
    setLiqs([]); // reset au changement de symbole
    const stop = subscribeLiquidations(symbol, (l) => {
      setLiqs((prev) => [l, ...prev].slice(0, MAX_FEED));
    });
    return stop;
  }, [symbol]);

  const resume = resumerLiquidations(liqs);
  const partLongPct = resume.partLong === null ? null : resume.partLong * 100;

  return (
    <div className="flex h-full flex-col">
      <EnTeteFenetre
        titre="Liquidations"
        sousTitre={`${symbol} · perp Bybit (live)`}
        actions={<ToggleChart />}
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {/* Totaux notionnels long/short depuis la souscription. */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded border border-border bg-bg px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-text-dim">Longs liquidés</div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums text-down">{formatUsd(resume.longUsd)}</div>
          </div>
          <div className="rounded border border-border bg-bg px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-text-dim">Shorts liquidés</div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums text-up">{formatUsd(resume.shortUsd)}</div>
          </div>
        </div>

        {/* Barre de dominance long/short (part du notionnel). */}
        {partLongPct !== null && (
          <div className="mt-3">
            <div className="flex h-2 overflow-hidden rounded bg-surface">
              <div className="bg-down" style={{ width: `${partLongPct}%` }} />
              <div className="flex-1 bg-up" />
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-text-dim">
              <span>Longs {formatPourcentage(partLongPct)}</span>
              <span>Shorts {formatPourcentage(100 - partLongPct)}</span>
            </div>
          </div>
        )}

        {/* Feed des dernières liquidations. */}
        <div className="mt-4">
          {liqs.length === 0 ? (
            <Vide>En attente de liquidations… (flux live, rien depuis la souscription)</Vide>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-text-dim">
                  <th className="pb-1 font-medium">Heure</th>
                  <th className="pb-1 font-medium">Côté</th>
                  <th className="pb-1 text-right font-medium">Notionnel</th>
                  <th className="pb-1 text-right font-medium">Prix</th>
                </tr>
              </thead>
              <tbody>
                {liqs.map((l, i) => (
                  <tr key={`${l.time}-${i}`} className="border-b border-border/40">
                    <td className="py-1 tabular-nums text-text-dim">{formatHeure(l.time)}</td>
                    <td className={`py-1 font-medium ${l.side === "long" ? "text-down" : "text-up"}`}>
                      {l.side === "long" ? "Long" : "Short"}
                    </td>
                    <td className="py-1 text-right tabular-nums text-text">{formatUsd(l.notionalUsd)}</td>
                    <td className="py-1 text-right tabular-nums text-text-dim">{formatPrice(l.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="mt-3">
          <NoteSource>
            Flux `allLiquidation` Bybit (live). Long = position longue fermée de force (vente).
            Cumul depuis l'ouverture de la fenêtre.
          </NoteSource>
        </div>
      </div>
    </div>
  );
}
