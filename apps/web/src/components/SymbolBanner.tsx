/**
 * SymbolBanner — bandeau d'en-tête du graphe (monté DANS le conteneur du chart,
 * en surimpression haut-gauche). Affiche : dernier prix, variation 24 h, haut/bas
 * 24 h, volume 24 h et le COMPTE À REBOURS de clôture de la bougie courante.
 *
 * Contrat de perf (comme Watchlist) : AUCUN re-render React sur tick. Le symbole et
 * le timeframe (basse fréquence) viennent d'un sélecteur Zustand (re-render admis à
 * leur changement) ; TOUT le reste (haute fréquence) est écrit IMPÉRATIVEMENT dans le
 * DOM via des refs. Deux sources :
 *  - variation 24 h : abonnement `subscribeTickers` existant (data/ticker.ts) ;
 *  - prix / H-L / volume : dérivés du buffer de bougies (marketStore), fenêtre 24 h.
 */
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { Candle, ExchangeId, Timeframe, Unsubscribe } from "@axiom/types";
import { marketStore } from "../store/market";
import { syntheticsStore } from "../store/synthetics";
import { denominateurStore } from "../store/denominateur";
import {
  classifyTradfi,
  isMarketOpen,
  isTickerSource,
  subscribeTickers,
  type TickerUpdate,
} from "../data/ticker";
import { formatSyntheticLabel, parseSyntheticSymbol } from "../data/synthetic";
import { estSymboleCapitalisation } from "../data/mcap";
import { sourcesCapitalisationStore, type SourceCapitalisation } from "../data/mcapCandles";
import { DENOMINATEURS, estRatio, symboleRatio, type DenominateurId } from "../data/ratio";
import { formatCompact, formatCountdown, formatPct, formatPrice } from "../lib/format";

/** Durée (ms) d'une bougie pour les timeframes à pas FIXE. */
export const TF_DURATION_MS: Partial<Record<Timeframe, number>> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
  "1w": 604_800_000,
};

/**
 * Horodatage (ms) de clôture de la bougie ouverte à `openTime` pour le timeframe `tf`.
 * Pas fixe : `openTime + durée`. TF calendaires (1M/3M/6M/12M) : début du bucket
 * calendaire suivant en UTC (gère le passage d'année). PURE & testée.
 */
export function nextCloseTs(openTime: number, tf: Timeframe): number {
  const ms = TF_DURATION_MS[tf];
  if (ms !== undefined) return openTime + ms;
  const months = tf === "1M" ? 1 : tf === "3M" ? 3 : tf === "6M" ? 6 : tf === "12M" ? 12 : 0;
  if (months > 0) {
    const d = new Date(openTime);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1);
  }
  return openTime; // timeframe inconnu : pas de rebours (rebours nul).
}

/** Statistiques haut/bas/volume sur les 24 dernières heures. */
export interface Rolling24h {
  high: number;
  low: number;
  volume: number;
}

/**
 * Haut/bas/volume sur les bougies dont l'ouverture est ≥ `referenceMs − 24 h`. Le buffer
 * étant trié par temps croissant, on parcourt depuis la fin et on s'arrête au franchissement
 * de la borne. Renvoie null si aucune bougie dans la fenêtre. PURE & testée.
 *
 * APPROXIMATION (documentée) : si le buffer couvre MOINS de 24 h (ex. 500 bougies 1 m ≈ 8 h
 * avant pagination), la fenêtre se réduit aux bougies disponibles — les valeurs sont alors
 * « sur l'historique chargé », pas strictement 24 h.
 */
export function rolling24h(candles: Candle[], referenceMs: number): Rolling24h | null {
  const cutoff = referenceMs - 86_400_000;
  let high = -Infinity;
  let low = Infinity;
  let volume = 0;
  let count = 0;
  for (let i = candles.length - 1; i >= 0; i--) {
    const c = candles[i];
    if (c === undefined) continue;
    if (c.time < cutoff) break; // buffer trié croissant : tout ce qui précède est hors fenêtre.
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
    volume += c.volume;
    count++;
  }
  return count === 0 ? null : { high, low, volume };
}

/**
 * Libellé de provenance d'une série de capitalisation, à partir de la source RÉELLEMENT
 * servie par `capitalisationAdapter.fetchKlines` (jamais re-devinée par disponibilité).
 * `undefined` (fetch pas encore abouti) → null : le bandeau se tait plutôt que de mentir.
 * PURE & testée.
 */
export function libelleSourceCapitalisation(
  source: SourceCapitalisation | undefined,
  timeframe: Timeframe,
): string | null {
  if (source === undefined) return null;
  if (source === "cmc") {
    return `CoinMarketCap · ${timeframe === "1h" || timeframe === "4h" ? timeframe : "daily"}`;
  }
  return source === "ccdata" ? "CCData · daily" : "CoinGecko · local";
}

/**
 * Remet la variation 24 h à l'état neutre (« — », couleur de texte par défaut).
 * Le texte est écrit IMPÉRATIVEMENT dans le DOM (aucun re-render sur tick) : React ne
 * le rétablit pas au changement d'identité — sans ce reset, la variation de l'ANCIEN
 * symbole restait affichée indéfiniment sur un symbole SANS ticker (ratio ÷BTC, SYN,
 * TOTAL — isTickerSource("synthetic") est faux, l'abonnement est un no-op).
 * PURE (élément injecté), testée sans DOM.
 */
export function resetVariation24h(
  el: { textContent: string | null; style: { color: string } } | null,
): void {
  if (el === null) return;
  el.textContent = "—";
  el.style.color = "var(--text)";
}

/** Souscription ticker du bandeau, explicitement liée à la source du marché affiché. */
export function subscribeSymbolBannerTicker(
  exchange: ExchangeId,
  symbol: string,
  cb: (update: TickerUpdate) => void,
): Unsubscribe {
  if (!isTickerSource(exchange)) return () => {};
  return subscribeTickers([symbol], cb, { source: exchange });
}

/** Classes d'un bouton de ratio (état actif = teinte pleine, comme le ÷BTC d'origine). */
function classeBouton(actif: boolean): string {
  return `pointer-events-auto rounded border px-2 py-1 text-xs ${
    actif
      ? "border-emerald-500 bg-emerald-500 text-accent-ink"
      : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500"
  }`;
}

/**
 * Boutons de ratio du bandeau : « ÷BTC » (un clic, contrat inchangé) + un bouton SCINDÉ
 * « ÷ETH ▾ » dont le dénominateur se choisit dans un petit menu (ETH · SOL).
 *
 * Composant ENFANT à dessein : son état de menu (useState) ne doit pas re-rendre le
 * bandeau, dont le prix / H-L / volume sont écrits IMPÉRATIVEMENT dans le DOM.
 *
 * Trois règles :
 *  - le ratio ACTIF se déduit du symbole seul (`estRatio`) — c'est lui qui décide quel
 *    bouton est en teinte pleine et vers quelle jambe le détoggle revient ;
 *  - quand un ratio est actif, les AUTRES dénominateurs se composent depuis sa jambe A
 *    (le symbole SYN courant, de source `synthetic`, n'est pas basculable tel quel) —
 *    d'où ÷BTC ⇄ ÷ETH ⇄ ÷SOL en un clic chacun ;
 *  - le bouton scindé suit le ratio actif quand celui-ci n'est pas ÷BTC (sinon il
 *    deviendrait impossible de le détoggler), sinon la préférence persistée.
 */
function BoutonsRatio({
  exchange,
  symbol,
  timeframe,
}: {
  exchange: ExchangeId;
  symbol: string;
  timeframe: Timeframe;
}) {
  const [menuOuvert, setMenuOuvert] = useState(false);
  const choisi = useStore(denominateurStore, (s) => s.denominateur);
  const setChoisi = useStore(denominateurStore, (s) => s.setDenominateur);

  const actif = estRatio(symbol, exchange);
  // Base de composition : la jambe A du ratio actif, sinon le marché courant.
  const baseEx: ExchangeId = actif?.spec.exA === "mcap"
    ? "synthetic"
    : actif
      ? actif.spec.exA
      : exchange;
  const baseSym = actif ? actif.spec.legA : symbol;

  /** Pose le ratio ÷denom (sans jamais détoggler). Sans cible composable : rien. */
  const poser = (denom: DenominateurId): void => {
    const cible = symboleRatio(baseSym, baseEx, denom);
    if (cible === null) return;
    syntheticsStore.getState().addRecent(cible);
    marketStore.getState().setMarket({ exchange: "synthetic", symbol: cible, timeframe });
  };

  /** Clic sur un bouton : détoggle si CE dénominateur est actif, sinon pose son ratio. */
  const basculer = (denom: DenominateurId): void => {
    if (actif !== null && actif.denom === denom) {
      marketStore.getState().setMarket({
        exchange: baseEx,
        symbol: baseSym,
        timeframe,
      });
      return;
    }
    poser(denom);
  };

  const disponible = (denom: DenominateurId): boolean =>
    actif?.denom === denom || symboleRatio(baseSym, baseEx, denom) !== null;

  // Bouton scindé : ETH · SOL (le BTC garde son bouton propre). Si le dénominateur
  // préféré n'est pas composable ici (ex. ÷ETH sur ETHUSDT), on retombe sur le premier
  // disponible plutôt que de faire disparaître le bouton.
  // Type élargi à DenominateurId : TS 5.5 infère sinon un prédicat ("ETH"|"SOL") qui
  // interdirait de tester la préférence (de type DenominateurId) contre cette liste.
  const candidats: DenominateurId[] = DENOMINATEURS.filter((d) => d !== "BTC");
  const disponibles = candidats.filter(disponible);
  const denomScinde: DenominateurId | undefined =
    actif !== null && actif.denom !== "BTC"
      ? actif.denom
      : disponibles.includes(choisi)
        ? choisi
        : disponibles[0];

  return (
    <>
      {disponible("BTC") && (
        <button
          type="button"
          title={actif?.denom === "BTC" ? `Revenir à ${actif.spec.legA}` : "Ratio vs BTC"}
          onClick={() => basculer("BTC")}
          className={classeBouton(actif?.denom === "BTC")}
        >
          ÷BTC
        </button>
      )}

      {denomScinde !== undefined && (
        <span className="pointer-events-auto relative inline-flex">
          <button
            type="button"
            title={
              actif?.denom === denomScinde
                ? `Revenir à ${actif.spec.legA}`
                : `Ratio vs ${denomScinde}`
            }
            onClick={() => basculer(denomScinde)}
            className={`${classeBouton(actif?.denom === denomScinde)} rounded-r-none border-r-0`}
          >
            ÷{denomScinde}
          </button>
          <button
            type="button"
            aria-label="Choisir l'actif de comparaison"
            aria-expanded={menuOuvert}
            title="Choisir l'actif de comparaison"
            onClick={() => setMenuOuvert((v) => !v)}
            className={`${classeBouton(false)} rounded-l-none px-1`}
          >
            ▾
          </button>

          {menuOuvert && (
            <>
              {/* Fermeture au clic extérieur (même mécanisme que les menus de la Toolbar). */}
              <span
                className="pointer-events-auto fixed inset-0 z-40"
                onClick={() => setMenuOuvert(false)}
              />
              <span className="absolute right-0 top-full z-50 mt-1 flex w-28 flex-col rounded border border-border bg-surface py-1 shadow-xl">
                {candidats.map((denom) => (
                  <button
                    key={denom}
                    type="button"
                    disabled={!disponible(denom)}
                    title={
                      disponible(denom)
                        ? `Comparer vs ${denom}`
                        : `${denom} indisponible sur ce marché`
                    }
                    onClick={() => {
                      setChoisi(denom);
                      poser(denom);
                      setMenuOuvert(false);
                    }}
                    className={`flex items-center gap-1.5 px-2 py-1 text-left text-xs ${
                      disponible(denom)
                        ? "text-text hover:bg-neutral-800"
                        : "cursor-not-allowed text-text-dim"
                    }`}
                  >
                    <span className="w-2 text-accent">{choisi === denom ? "•" : ""}</span>
                    <span>÷{denom}</span>
                  </button>
                ))}
              </span>
            </>
          )}
        </span>
      )}
    </>
  );
}

export function SymbolBanner() {
  const exchange = useStore(marketStore, (s) => s.exchange);
  const symbol = useStore(marketStore, (s) => s.symbol);
  const timeframe = useStore(marketStore, (s) => s.timeframe);
  useStore(marketStore, (s) => s.dataLoad.status);
  const syntheticSpec = exchange === "synthetic" ? parseSyntheticSymbol(symbol) : null;
  const bannerSymbol = syntheticSpec ? formatSyntheticLabel(syntheticSpec) : symbol;
  const estCapitalisation =
    estSymboleCapitalisation(symbol) || syntheticSpec?.exA === "mcap" || syntheticSpec?.exB === "mcap";
  // Pour un ratio, la jambe mcap porte la provenance (fetchKlines est appelé avec elle).
  const cleSource = syntheticSpec?.exA === "mcap"
    ? syntheticSpec.legA
    : syntheticSpec?.exB === "mcap"
      ? syntheticSpec.legB
      : symbol;
  const sourceServie = useStore(
    sourcesCapitalisationStore,
    (s) => s.sources[`${cleSource}:${timeframe}`],
  );
  const sourceCapitalisation = estCapitalisation
    ? libelleSourceCapitalisation(sourceServie, timeframe)
    : null;
  const hasClosedTradfiLeg = syntheticSpec !== null && (
    (syntheticSpec.exA === "twelvedata" && !isMarketOpen(classifyTradfi(syntheticSpec.legA), new Date())) ||
    (syntheticSpec.exB === "twelvedata" && !isMarketOpen(classifyTradfi(syntheticSpec.legB), new Date()))
  );

  const priceRef = useRef<HTMLSpanElement>(null);
  const changeRef = useRef<HTMLSpanElement>(null);
  const highRef = useRef<HTMLSpanElement>(null);
  const lowRef = useRef<HTMLSpanElement>(null);
  const volRef = useRef<HTMLSpanElement>(null);
  const countdownRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    // Dernière variation 24 h connue (source ticker) : sert au texte ET à la couleur du prix.
    let changePct = Number.NaN;

    /** Applique la teinte up/down (token de thème) au prix et à la variation. */
    const applyColor = (): void => {
      const color = !Number.isFinite(changePct)
        ? "var(--text)"
        : changePct >= 0
          ? "var(--up)"
          : "var(--down)";
      if (priceRef.current) priceRef.current.style.color = color;
      if (changeRef.current) changeRef.current.style.color = color;
    };

    /** Recalcule prix + H/L/volume 24 h depuis le buffer de bougies (écritures DOM directes). */
    const updateFromCandles = (): void => {
      const candles = marketStore.getState().candles;
      const last = candles.at(-1);
      if (last === undefined) {
        if (priceRef.current) priceRef.current.textContent = "—";
        if (highRef.current) highRef.current.textContent = "—";
        if (lowRef.current) lowRef.current.textContent = "—";
        if (volRef.current) volRef.current.textContent = "—";
        return;
      }
      if (priceRef.current) priceRef.current.textContent = formatPrice(last.close);
      const stats = rolling24h(candles, Date.now());
      if (highRef.current) highRef.current.textContent = stats ? formatPrice(stats.high) : "—";
      if (lowRef.current) lowRef.current.textContent = stats ? formatPrice(stats.low) : "—";
      if (volRef.current) volRef.current.textContent = stats ? formatCompact(stats.volume) : "—";
      applyColor();
    };

    /** Recalcule le compte à rebours de clôture de la bougie courante. */
    const updateCountdown = (): void => {
      const last = marketStore.getState().candles.at(-1);
      if (countdownRef.current) {
        countdownRef.current.textContent = last
          ? formatCountdown(nextCloseTs(last.time, timeframe) - Date.now())
          : "—";
      }
    };

    // Nouvelle identité : la variation de l'ancien symbole est effacée AVANT toute
    // souscription (elle ne sera ré-écrite que si la nouvelle source a un ticker).
    resetVariation24h(changeRef.current);

    // État initial (le backfill a pu déjà remplir le buffer avant ce montage).
    updateFromCandles();
    updateCountdown();

    // Variation 24 h : ticker existant (routé par source dans data/ticker.ts).
    // Une série synthétique n'a pas de ticker natif ; sa variation viendra d'une
    // dérivation dédiée plus tard, pas du flux d'une jambe arbitraire.
    const unsubTicker = subscribeSymbolBannerTicker(exchange, symbol, (u) => {
      changePct = u.changePercent;
      if (changeRef.current) changeRef.current.textContent = formatPct(u.changePercent);
      applyColor();
    });

    // Prix / H-L / volume : chaque tick du buffer marché (haute fréquence, DOM impératif).
    const unsubMarket = marketStore.subscribe(updateFromCandles);

    // Compte à rebours : 1 Hz.
    const timer = window.setInterval(updateCountdown, 1000);

    return () => {
      unsubTicker();
      unsubMarket();
      window.clearInterval(timer);
    };
  // `exchange` est une partie de l'identité : un changement de source à symbole égal doit
  // aussi remplacer l'abonnement ticker, sinon la variation 24 h resterait celle de l'ancienne.
  }, [exchange, symbol, timeframe]);

  return (
    <div className="pointer-events-none absolute left-2 top-2 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-border bg-surface/80 px-2.5 py-1 text-xs tabular-nums text-text-dim backdrop-blur-sm">
      <span className="font-semibold text-text">{bannerSymbol}</span>
      {sourceCapitalisation !== null && (
        <span className="text-text-dim">{sourceCapitalisation}</span>
      )}
      {hasClosedTradfiLeg && (
        <span className="text-text-dim">jambe tradfi : dernier close (marché fermé)</span>
      )}
      <span className="text-text-dim">{timeframe}</span>
      <BoutonsRatio exchange={exchange} symbol={symbol} timeframe={timeframe} />
      <span ref={priceRef} className="font-semibold text-text">
        —
      </span>
      <span ref={changeRef}>—</span>
      <span>
        H <span ref={highRef} className="text-text">—</span>
      </span>
      <span>
        L <span ref={lowRef} className="text-text">—</span>
      </span>
      <span>
        Vol <span ref={volRef} className="text-text">—</span>
      </span>
      <span>
        ⏱ <span ref={countdownRef} className="text-text">—</span>
      </span>
    </div>
  );
}
