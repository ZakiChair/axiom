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
import { etatMatrice, fetchFundingMatrix, fundingSpreadApr, type FundingVenue } from "../data/fundingCrossExchange";
import { EnTeteFenetre, Chargement, ErreurBloc, Vide, NoteSource, Fraicheur, TuileStat } from "./ui";
import { TableTriable, type ColonneTable } from "./TableTriable";
import { formatPct } from "../lib/format";

const RAFRAICHISSEMENT_MS = 60_000;

/** Classe de couleur selon le signe (funding > 0 = longs paient). */
function couleurSigne(v: number): string {
  if (v > 0) return "text-up";
  if (v < 0) return "text-down";
  return "text-text-dim";
}

/** Colonnes de la matrice — ● vert = APR max, ● rouge = APR min (dépend de la liste triée reçue). */
function colonnesFunding(venues: readonly FundingVenue[]): ColonneTable<FundingVenue>[] {
  return [
    {
      id: "venue",
      label: "Venue",
      rendu: (v) => {
        const i = venues.indexOf(v);
        return (
          <span className="text-text">
            {venues.length >= 2 && i === 0 && (
              <span aria-hidden className="mr-1 text-up" title="APR le plus élevé">●</span>
            )}
            {venues.length >= 2 && i === venues.length - 1 && (
              <span aria-hidden className="mr-1 text-down" title="APR le plus bas">●</span>
            )}
            {v.label}
          </span>
        );
      },
    },
    {
      id: "funding",
      label: "Funding / intervalle",
      align: "right",
      rendu: (v) => (
        <span className={couleurSigne(v.ratePct)}>
          {formatPct(v.ratePct, 4)} <span className="text-text-dim">/ {v.intervalHours}h</span>
        </span>
      ),
    },
    {
      id: "apr",
      label: "APR",
      align: "right",
      rendu: (v) => <span className={`font-semibold ${couleurSigne(v.apr)}`}>{formatPct(v.apr, 2)}</span>,
    },
  ];
}

export function FundingMatrixWindow() {
  const symbol = useStore(marketStore, (s) => s.symbol);
  const [venues, setVenues] = useState<FundingVenue[] | null>(null);
  const [chargement, setChargement] = useState(true);
  const [injoignable, setInjoignable] = useState(false);
  const [majTs, setMajTs] = useState<number | null>(null);

  useEffect(() => {
    let annule = false;
    // Changement de symbole : la matrice en place porte sur l'ANCIEN symbole — la
    // conserver mentirait autant qu'un écrasement à vide.
    setVenues(null);
    setMajTs(null);
    setInjoignable(false);
    const charger = async () => {
      setChargement(true);
      const { venues: v, echecs } = await fetchFundingMatrix(symbol); // allSettled interne : ne rejette pas
      if (annule) return;
      setChargement(false);
      // Toutes les venues injoignables : on CONSERVE la matrice et l'horodatage
      // précédents — écraser à vide et rafraîchir la fraîcheur affirmerait « aucun
      // funding, à l'instant », ce qui est faux (cf. etatMatrice).
      if (etatMatrice(v, echecs) === "injoignable") {
        setInjoignable(true);
        return;
      }
      setInjoignable(false);
      setVenues(v);
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
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {spread !== null && (
          <TuileStat
            disposition="inline"
            label="Écart CEX/DEX (APR)"
            valeur={formatPct(spread, 2, { signe: false })}
            couleur={spread >= 10 ? "var(--ui-amber)" : undefined}
          />
        )}
        {/* « dernière matrice conservée » seulement s'il Y EN A une : sur premier échec
            (ou matrice vide), l'annoncer serait un second mensonge. */}
        {injoignable && (
          <ErreurBloc>
            Venues injoignables
            {venues !== null && venues.length > 0 ? " — dernière matrice conservée" : ""}.
          </ErreurBloc>
        )}
        {chargement && venues === null ? (
          <Chargement />
        ) : venues && venues.length > 0 ? (
          <TableTriable<FundingVenue>
            colonnes={colonnesFunding(venues)}
            lignes={venues}
            cle={(v) => v.exchange}
          />
        ) : injoignable ? null : (
          <Vide>Aucun funding disponible (symbole non listé en perp USDT sur ces venues ?)</Vide>
        )}
        <NoteSource>
          APR = taux × (24 / intervalle) × 365. Binance/Bybit/OKX règlent /8 h, Hyperliquid /1 h.
          Écart = APR max − APR min entre venues ; ≥ 10 points d'APR = tension de financement
          inter-venues (arbitrage/positionnement asymétrique). ● vert = APR max, ● rouge = APR min.
        </NoteSource>
      </div>
    </div>
  );
}
