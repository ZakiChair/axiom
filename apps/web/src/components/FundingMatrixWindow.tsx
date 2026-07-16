/**
 * Fenêtre « Funding cross-exchange » (mnémonique FUNDX). Compare le taux de funding
 * perp du symbole courant sur Binance / Bybit / OKX / Hyperliquid, NORMALISÉ en APR
 * (les intervalles diffèrent — cf. data/fundingCrossExchange.ts). L'écart CEX vs perp
 * DEX (Hyperliquid) est le signal : divergence de funding = arbitrage / stress relatif.
 *
 * Rendu par FloatingWindow (frame fournie par App.tsx) : ce composant rend le CONTENU.
 * Rafraîchissement périodique 60 s ; snapshot live (pas d'historique).
 */
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { marketStore } from "../store/market";
import { fetchFundingMatrix, fundingSpreadApr, type FundingVenue } from "../data/fundingCrossExchange";
import { EnTeteFenetre, Chargement, Vide, NoteSource, Fraicheur, Metric } from "./ui";
import { formatPct } from "../lib/format";

const RAFRAICHISSEMENT_MS = 60_000;

/** Classe de couleur selon le signe (funding > 0 = longs paient). */
function couleurSigne(v: number): string {
  if (v > 0) return "text-up";
  if (v < 0) return "text-down";
  return "text-text-dim";
}

export function FundingMatrixWindow() {
  const symbol = useStore(marketStore, (s) => s.symbol);
  const [venues, setVenues] = useState<FundingVenue[] | null>(null);
  const [chargement, setChargement] = useState(true);
  const [majTs, setMajTs] = useState<number | null>(null);

  useEffect(() => {
    let annule = false;
    const charger = async () => {
      setChargement(true);
      const v = await fetchFundingMatrix(symbol); // allSettled interne : ne rejette pas
      if (annule) return;
      setVenues(v);
      setChargement(false);
      setMajTs(Date.now());
    };
    void charger();
    const id = setInterval(() => void charger(), RAFRAICHISSEMENT_MS);
    return () => {
      annule = true;
      clearInterval(id);
    };
  }, [symbol]);

  const spread = venues ? fundingSpreadApr(venues) : null;

  return (
    <div className="flex h-full flex-col">
      <EnTeteFenetre
        mnemo="FUNDX"
        titre="Funding cross-exchange"
        sousTitre={
          <>
            {symbol} · funding annualisé (APR)
            {" · "}
            <Fraicheur loading={chargement} majTs={majTs} />
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {spread !== null && (
          <div className="mb-3">
            <Metric
              label="Écart CEX/DEX (APR)"
              value={formatPct(spread, 2, { signe: false })}
              couleur={spread >= 10 ? "var(--ui-amber)" : undefined}
            />
          </div>
        )}
        {chargement && venues === null ? (
          <Chargement />
        ) : venues && venues.length > 0 ? (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-text-dim">
                <th className="pb-2 font-medium">Venue</th>
                <th className="pb-2 text-right font-medium">Funding / {" "}intervalle</th>
                <th className="pb-2 text-right font-medium">APR</th>
              </tr>
            </thead>
            <tbody>
              {venues.map((v, i) => (
                <tr key={v.exchange} className="border-b border-border/50">
                  <td className="py-2 text-text">
                    {venues.length >= 2 && i === 0 && (
                      <span aria-hidden className="mr-1 text-up" title="APR le plus élevé">●</span>
                    )}
                    {venues.length >= 2 && i === venues.length - 1 && (
                      <span aria-hidden className="mr-1 text-down" title="APR le plus bas">●</span>
                    )}
                    {v.label}
                  </td>
                  <td className={`py-2 text-right tabular-nums ${couleurSigne(v.ratePct)}`}>
                    {formatPct(v.ratePct, 4)} <span className="text-text-dim">/ {v.intervalHours}h</span>
                  </td>
                  <td className={`py-2 text-right font-semibold tabular-nums ${couleurSigne(v.apr)}`}>
                    {formatPct(v.apr, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Vide>Aucun funding disponible (symbole non listé en perp USDT sur ces venues ?)</Vide>
        )}
        <div className="mt-3">
          <NoteSource>
            APR = taux × (24 / intervalle) × 365. Binance/Bybit/OKX règlent /8 h, Hyperliquid /1 h.
            Écart = APR max − APR min entre venues ; ≥ 10 points d'APR = tension de financement
            inter-venues (arbitrage/positionnement asymétrique). ● vert = APR max, ● rouge = APR min.
          </NoteSource>
        </div>
      </div>
    </div>
  );
}
