/**
 * Régime de marché : assemble les entrées du score composite (data/regime.ts)
 * depuis les caches TTL 1 h de data/referentiels.ts + fetchers existants (+ le
 * verdict gamma dealer BTC, cache TTL 10 min de data/gammaRegime.ts),
 * toutes en Promise.allSettled (une source en échec → composant null).
 * Poller 15 min (pattern startMacroHistoryPolling), démarré dans main.tsx.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import { agregerFluxEtfRegime, calculerRegime, type Regime } from "../data/regime";
import { cadenceObservee, referentiel, type OptionsReferentiel, type Referentiel, type PointSerie } from "../lib/referentiel";
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
import { chargerVerdictGammaBtc } from "../data/gammaRegime";
import type { RegimeGamma } from "../data/gexDex";
import { enregistrerQualite } from "./qualiteMetriques";
import type { QualiteMetrique } from "../data/qualiteMetrique";

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
  /** Régime gamma des dealers BTC (verdict OMON, toutes échéances), null si indisponible. */
  regimeGamma: RegimeGamma | null;
  /** GEX net BTC toutes échéances (USD par 1 % de mouvement), null si indisponible. */
  gexNetUsd: number | null;
  /** Distance spot↔gamma flip en % du spot, null si flip absent ou verdict indisponible. */
  distanceFlipPct: number | null;
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

function dernierPoint(serie: PointSerie[] | null, now = Date.now()): PointSerie | null {
  const p = serie
    ?.filter((point) => Number.isFinite(point.t) && point.t <= now && Number.isFinite(point.v))
    .sort((a, b) => a.t - b.t)
    .at(-1);
  return p ?? null;
}

function dernier(serie: PointSerie[] | null, now = Date.now()): number | null {
  const p = dernierPoint(serie, now);
  return p !== null && Number.isFinite(p.v) ? p.v : null;
}

/** Percentile de la dernière valeur dans sa propre série (null si réf. en construction). */
export function percentileCourant(
  serie: PointSerie[] | null,
  now: number,
  options: OptionsReferentiel = {},
): number | null {
  const v = dernier(serie, now);
  if (serie === null || v === null) return null;
  const ref = referentiel(serie, v, now, options);
  return ref === null ? null : ref.percentile;
}

function publierQualiteSerie(
  id: string,
  libelle: string,
  sourceId: string,
  sourceEffective: string,
  serie: PointSerie[] | null,
  now: number,
  cadenceMs: number | null,
  ageMaxMs: number,
  acces: QualiteMetrique["acces"] = "public",
): void {
  const points = serie?.filter((p) => Number.isFinite(p.t) && p.t <= now && Number.isFinite(p.v)) ?? [];
  const dates = [...new Set(points.map((p) => p.t))].sort((a, b) => a - b);
  const observeLe = dates.at(-1) ?? null;
  const attendus = cadenceMs !== null && dates.length > 1
    ? Math.floor((dates.at(-1)! - dates[0]!) / cadenceMs) + 1
    : null;
  const couverture = attendus === null ? null : { disponibles: dates.length, attendus };
  const age = observeLe === null ? Number.POSITIVE_INFINITY : now - observeLe;
  const tropPeu = dates.length < 20;
  const troue = couverture !== null && couverture.attendus > 0 && couverture.disponibles / couverture.attendus < 0.8;
  const statut: QualiteMetrique["statut"] = observeLe === null
    ? "indisponible"
    : age > ageMaxMs
      ? "perime"
      : tropPeu
        ? "en-construction"
        : troue
          ? "partiel"
          : "frais";
  const raison = observeLe === null ? "Aucune observation exploitable."
    : age > ageMaxMs ? "Dernière observation trop ancienne pour le régime."
      : tropPeu ? `${dates.length}/20 observations minimales.`
        : troue ? "Couverture temporelle insuffisante."
          : undefined;
  enregistrerQualite(id, libelle, {
    sourceId,
    sourceEffective,
    observeLe,
    recupereLe: now,
    cadenceMs,
    couverture,
    estime: false,
    acces: observeLe === null ? "indisponible" : acces,
    statut,
    ...(raison ? { raison } : {}),
  });
}

export async function rafraichirRegime(): Promise<void> {
  const now = Date.now();
  const [tickers, fg, funding, dvol, volReal, oi, etf, emetteurs, gamma] = await Promise.allSettled([
    fetchWatchlistOvernight(["BTCUSDT", "ETHUSDT"]),
    histFearGreed(),
    histFunding("BTCUSDT"),
    histDvol("BTC"),
    histVolRealisee("BTCUSDT"),
    histOiUsd("BTCUSDT"),
    fetchEtfBrief(),
    chargerEmetteurs(),
    // Verdict gamma dealer BTC : cache TTL 10 min → au plus 1 appel Deribit par cycle 15 min.
    chargerVerdictGammaBtc(now),
  ]);

  const lignes = tickers.status === "fulfilled" ? tickers.value : [];
  const nuitBtcPct = lignes.find((l) => l.symbole === "BTCUSDT")?.variation24h ?? null;
  const nuitEthPct = lignes.find((l) => l.symbole === "ETHUSDT")?.variation24h ?? null;

  const serieFg = fg.status === "fulfilled" ? fg.value : null;
  const serieFunding = funding.status === "fulfilled" ? funding.value : null;
  const serieDvol = dvol.status === "fulfilled" ? dvol.value : null;
  const serieVolReal = volReal.status === "fulfilled" ? volReal.value : null;
  const serieOi = oi.status === "fulfilled" ? oi.value : null;

  const fearGreedCourant = dernier(serieFg, now);
  const fearGreedRef =
    serieFg !== null && fearGreedCourant !== null
      ? referentiel(serieFg, fearGreedCourant, now, { cadenceAttendueMs: JOUR_MS, ageMaxMs: 3 * JOUR_MS })
      : null;

  const cadenceFunding = serieFunding === null ? null : cadenceObservee(serieFunding, now);
  const fundingBtcRate = dernier(serieFunding, now);
  const fundingRef =
    serieFunding !== null && fundingBtcRate !== null
      ? referentiel(serieFunding, fundingBtcRate, now, {
        ...(cadenceFunding !== null ? { cadenceAttendueMs: cadenceFunding } : {}),
        ageMaxMs: Math.max(12 * 3_600_000, (cadenceFunding ?? 0) * 2),
      })
      : null;

  const dvolCourant = dernier(serieDvol, now);
  const avantDernierDvolBrut = serieDvol?.[serieDvol.length - 2]?.v;
  const avantDernierDvol =
    avantDernierDvolBrut !== undefined && Number.isFinite(avantDernierDvolBrut)
      ? avantDernierDvolBrut
      : null;
  const dvolDeltaPts =
    dvolCourant !== null && avantDernierDvol !== null ? dvolCourant - avantDernierDvol : null;
  const dvolRef =
    serieDvol !== null && dvolCourant !== null
      ? referentiel(serieDvol, dvolCourant, now, { cadenceAttendueMs: JOUR_MS, ageMaxMs: 3 * JOUR_MS })
      : null;

  const deltas24h = serieOi !== null ? deltasFenetre(serieOi, JOUR_MS) : [];
  const deltaOi24hPct = dernier(deltas24h.length > 0 ? deltas24h : null, now);

  const etfRegime = etf.status === "fulfilled" ? agregerFluxEtfRegime(etf.value, now) : null;

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

  const verdictBtc = gamma.status === "fulfilled" ? gamma.value : null;

  const regime = calculerRegime({
    directionBtc24hPct: nuitBtcPct,
    fearGreed: fearGreedCourant,
    fundingBtcPercentile: percentileCourant(serieFunding, now, {
      ...(cadenceFunding !== null ? { cadenceAttendueMs: cadenceFunding } : {}),
      ageMaxMs: Math.max(12 * 3_600_000, (cadenceFunding ?? 0) * 2),
    }),
    dvolBtcPercentile: percentileCourant(serieDvol, now, { cadenceAttendueMs: JOUR_MS, ageMaxMs: 3 * JOUR_MS }),
    volRealiseeBtcPercentile: percentileCourant(serieVolReal, now, { cadenceAttendueMs: JOUR_MS, ageMaxMs: 3 * JOUR_MS }),
    fluxEtfJourUsd: null,
    etf: etfRegime,
    impressionStablecoins7jPct,
    regimeGammaBtc:
      verdictBtc !== null
        ? { regime: verdictBtc.verdict.regime, gexNetUsd: verdictBtc.gexNetUsd }
        : null,
  });

  publierQualiteSerie("regime:fear-greed", "Fear & Greed", "alternative-me", "Alternative.me", serieFg, now, JOUR_MS, 3 * JOUR_MS);
  publierQualiteSerie("regime:funding", "Funding BTC", "binance-futures", "Binance USDⓈ-M", serieFunding, now, cadenceFunding, Math.max(12 * 3_600_000, (cadenceFunding ?? 0) * 2));
  publierQualiteSerie("regime:dvol", "DVOL BTC", "deribit", "Deribit", serieDvol, now, JOUR_MS, 3 * JOUR_MS);
  publierQualiteSerie("regime:vol-realisee", "Vol réalisée BTC", "binance", "Binance spot", serieVolReal, now, JOUR_MS, 3 * JOUR_MS);
  publierQualiteSerie("regime:oi", "Open Interest BTC", "binance-futures", "Binance USDⓈ-M", serieOi, now, 3_600_000, 3 * 3_600_000);
  const etfCouverture = etfRegime === null ? null : { disponibles: etfRegime.couverture.presents.length, attendus: etfRegime.couverture.attendus.length };
  enregistrerQualite("regime:etf", "Flux ETF spot", {
    sourceId: "sosovalue", sourceEffective: "SoSoValue", observeLe: etfRegime === null ? null : Date.parse(`${etfRegime.jour}T00:00:00Z`), recupereLe: now,
    cadenceMs: JOUR_MS, couverture: etfCouverture, estime: false, acces: etfRegime === null ? "indisponible" : "cle",
    statut: etfRegime === null ? "indisponible" : etfRegime.ageJours > 5 ? "perime" : etfCouverture?.disponibles === etfCouverture?.attendus ? "frais" : "partiel",
    ...(etfRegime === null ? { raison: "Aucune séance valide rapportée." } : etfCouverture?.disponibles !== etfCouverture?.attendus ? { raison: "Séance incomplète BTC/ETH/SOL." } : {}),
  });
  enregistrerQualite("regime:stablecoins", "Offre stablecoins 7 j", {
    sourceId: "defillama", sourceEffective: "DefiLlama", observeLe: null, recupereLe: now,
    cadenceMs: JOUR_MS, couverture: null, estime: false, acces: emetteurs.status === "fulfilled" ? "public" : "indisponible", statut: emetteurs.status === "fulfilled" ? "partiel" : "indisponible",
    raison: emetteurs.status === "fulfilled" ? "La liste courante ne fournit pas de date d'observation globale." : "Chargement des stablecoins en échec.",
  });
  enregistrerQualite("regime:gamma", "Gamma dealers BTC", {
    sourceId: "deribit", sourceEffective: "Deribit", observeLe: verdictBtc === null ? null : now, recupereLe: now,
    cadenceMs: 15 * 60_000, couverture: null, estime: true, acces: verdictBtc === null ? "indisponible" : "public", statut: verdictBtc === null ? "indisponible" : "frais",
    ...(verdictBtc === null ? { raison: "Chaîne d'options ou verdict indisponible." } : {}),
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
      regimeGamma: verdictBtc?.verdict.regime ?? null,
      gexNetUsd: verdictBtc?.gexNetUsd ?? null,
      distanceFlipPct: verdictBtc?.verdict.distanceFlipPct ?? null,
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
