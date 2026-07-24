/**
 * Régime de marché : assemble les entrées du score composite (data/regime.ts)
 * depuis les caches TTL 1 h de data/referentiels.ts + fetchers existants,
 * toutes en Promise.allSettled (une source en échec → composant null).
 * Poller 15 min (pattern startMacroHistoryPolling), démarré dans main.tsx.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import { calculerRegime, type Regime } from "../data/regime";
import { referentiel, type Referentiel, type PointSerie } from "../lib/referentiel";
import {
  deltasFenetre,
  histDvol,
  histFearGreed,
  histFunding,
  histOiUsd,
  histVolRealisee,
} from "../data/referentiels";
import { fetchEtfBrief, fetchWatchlistOvernight } from "../data/brief";
import { chargerEmetteurs } from "../data/macro/stablecoinsDetail";

/** Données « courantes » du chapeau BRIEF (dérivées du même rafraîchissement). */
export interface Chapeau {
  nuitBtcPct: number | null;
  nuitEthPct: number | null;
  /** Fear & Greed courant 0..100 (dernier point de l'historique). */
  fearGreed: number | null;
  fearGreedRef: Referentiel | null;
  /** Dernier funding réglé BTC, en fraction. */
  fundingBtcRate: number | null;
  fundingRef: Referentiel | null;
  dvolCourant: number | null;
  /** Δ DVOL vs veille, en points. */
  dvolDeltaPts: number | null;
  dvolRef: Referentiel | null;
  /** ΔOI BTC ~24 h en %. */
  deltaOi24hPct: number | null;
}

export interface RegimeState {
  regime: Regime | null;
  chapeau: Chapeau | null;
  majTs: number | null;
}

export const regimeStore: StoreApi<RegimeState> = createStore<RegimeState>(() => ({
  regime: null,
  chapeau: null,
  majTs: null,
}));

const JOUR_MS = 86_400_000;
const POLL_MS = 15 * 60_000;

function dernier(serie: PointSerie[] | null): number | null {
  const p = serie?.[serie.length - 1];
  return p !== undefined && Number.isFinite(p.v) ? p.v : null;
}

/** Percentile de la dernière valeur dans sa propre série (null si réf. en construction). */
function percentileCourant(serie: PointSerie[] | null, now: number): number | null {
  const v = dernier(serie);
  if (serie === null || v === null) return null;
  const ref = referentiel(serie, v, now);
  return ref === null ? null : ref.percentile;
}

export async function rafraichirRegime(): Promise<void> {
  const now = Date.now();
  const [tickers, fg, funding, dvol, volReal, oi, etf, emetteurs] = await Promise.allSettled([
    fetchWatchlistOvernight(["BTCUSDT", "ETHUSDT"]),
    histFearGreed(),
    histFunding("BTCUSDT"),
    histDvol("BTC"),
    histVolRealisee("BTCUSDT"),
    histOiUsd("BTCUSDT"),
    fetchEtfBrief(),
    chargerEmetteurs(),
  ]);

  const lignes = tickers.status === "fulfilled" ? tickers.value : [];
  const nuitBtcPct = lignes.find((l) => l.symbole === "BTCUSDT")?.variation24h ?? null;
  const nuitEthPct = lignes.find((l) => l.symbole === "ETHUSDT")?.variation24h ?? null;

  const serieFg = fg.status === "fulfilled" ? fg.value : null;
  const serieFunding = funding.status === "fulfilled" ? funding.value : null;
  const serieDvol = dvol.status === "fulfilled" ? dvol.value : null;
  const serieVolReal = volReal.status === "fulfilled" ? volReal.value : null;
  const serieOi = oi.status === "fulfilled" ? oi.value : null;

  const fearGreedCourant = dernier(serieFg);
  const fearGreedRef =
    serieFg !== null && fearGreedCourant !== null
      ? referentiel(serieFg, fearGreedCourant, now)
      : null;

  const fundingBtcRate = dernier(serieFunding);
  const fundingRef =
    serieFunding !== null && fundingBtcRate !== null
      ? referentiel(serieFunding, fundingBtcRate, now)
      : null;

  const dvolCourant = dernier(serieDvol);
  const avantDernierDvolBrut = serieDvol?.[serieDvol.length - 2]?.v;
  const avantDernierDvol =
    avantDernierDvolBrut !== undefined && Number.isFinite(avantDernierDvolBrut)
      ? avantDernierDvolBrut
      : null;
  const dvolDeltaPts =
    dvolCourant !== null && avantDernierDvol !== null ? dvolCourant - avantDernierDvol : null;
  const dvolRef =
    serieDvol !== null && dvolCourant !== null ? referentiel(serieDvol, dvolCourant, now) : null;

  const deltas24h = serieOi !== null ? deltasFenetre(serieOi, JOUR_MS) : [];
  const deltaOi24hPct = dernier(deltas24h.length > 0 ? deltas24h : null);

  let fluxEtfJourUsd: number | null = null;
  if (etf.status === "fulfilled") {
    const dispo = etf.value.filter((e) => e.disponible && e.total !== null);
    if (dispo.length > 0) fluxEtfJourUsd = dispo.reduce((s, e) => s + (e.total ?? 0), 0);
  }

  let impressionStablecoins7jPct: number | null = null;
  if (emetteurs.status === "fulfilled") {
    let tot = 0;
    let tot7 = 0;
    for (const e of emetteurs.value) {
      if (
        e.mcap7jUsd !== null &&
        Number.isFinite(e.mcap7jUsd) &&
        e.mcap7jUsd > 0 &&
        Number.isFinite(e.mcapUsd)
      ) {
        tot += e.mcapUsd;
        tot7 += e.mcap7jUsd;
      }
    }
    if (tot7 > 0) impressionStablecoins7jPct = (tot / tot7 - 1) * 100;
  }

  const regime = calculerRegime({
    directionBtc24hPct: nuitBtcPct,
    fearGreed: fearGreedCourant,
    fundingBtcPercentile: percentileCourant(serieFunding, now),
    dvolBtcPercentile: percentileCourant(serieDvol, now),
    volRealiseeBtcPercentile: percentileCourant(serieVolReal, now),
    fluxEtfJourUsd,
    impressionStablecoins7jPct,
  });

  regimeStore.setState({
    regime,
    chapeau: {
      nuitBtcPct,
      nuitEthPct,
      fearGreed: fearGreedCourant,
      fearGreedRef,
      fundingBtcRate,
      fundingRef,
      dvolCourant,
      dvolDeltaPts,
      dvolRef,
      deltaOi24hPct,
    },
    majTs: now,
  });
}

/**
 * Démarre le rafraîchissement (immédiat puis toutes les 15 min — léger : les
 * historiques sont sous cache TTL 1 h, seules les valeurs courantes se re-fetchent).
 * Appelé une fois au boot (main.tsx). Renvoie une fonction d'arrêt.
 */
export function startRegimePolling(): () => void {
  void rafraichirRegime().catch(() => undefined);
  const timer = setInterval(() => void rafraichirRegime().catch(() => undefined), POLL_MS);
  return () => clearInterval(timer);
}
