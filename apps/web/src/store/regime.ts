/**
 * Régime de marché : assemble les entrées du score composite (data/regime.ts)
 * depuis les caches TTL 1 h de data/referentiels.ts + fetchers existants (+ le
 * verdict gamma BTC sous conventions de signe, cache TTL 10 min de data/gammaRegime.ts),
 * toutes en Promise.allSettled (une source en échec → composant null).
 * Poller 15 min (pattern startMacroHistoryPolling), démarré dans main.tsx.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import { agregerFluxEtfRegime, calculerRegime, type FluxEtfRegime, type Regime } from "../data/regime";
import { cadenceObservee, referentiel, type OptionsReferentiel, type Referentiel, type PointSerie } from "../lib/referentiel";
import {
  deltasFenetre,
  histDvolAvecMeta,
  histFearGreedAvecMeta,
  histFundingAvecMeta,
  histOiUsdAvecMeta,
  histVolRealiseeAvecMeta,
  type HistoriqueReferentiel,
} from "../data/referentiels";
import { fetchWatchlistOvernight } from "../data/brief";
import { fetchEtfFlows, type ActifEtf, type EtfResultat } from "../data/onchain/etf";
import { getSoSoValueKey } from "./sosovalue";
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

export interface MetadataEtfRegime {
  recupereLe: number | null;
  sourceEffective: string;
}

/** Métadonnées des seules valeurs qui composent la séance retenue par l'agrégat. */
export function metadataEtfRegime(
  actifs: readonly ActifEtf[],
  resultats: readonly EtfResultat[],
  agregat: FluxEtfRegime | null,
): MetadataEtfRegime {
  if (agregat === null) return { recupereLe: null, sourceEffective: "SoSoValue" };
  const contributeurs = actifs.flatMap((actif, index) => {
    const resultat = resultats[index];
    if (
      resultat === undefined
      || !agregat.couverture.presents.includes(actif)
      || !resultat.disponible
      || resultat.jour !== agregat.jour
      || resultat.total === undefined
      || !Number.isFinite(resultat.total)
    ) return [];
    return [resultat];
  });
  const acquisitions = contributeurs.map((resultat) => resultat.recupereLe);
  const recupereLe = acquisitions.length > 0 && acquisitions.every((ts): ts is number => ts !== null && ts !== undefined && Number.isFinite(ts))
    ? Math.min(...acquisitions)
    : null;
  const depuisCache = contributeurs.some((resultat) => resultat.sourceEffective?.startsWith("cache "));
  const sources = [...new Set(contributeurs.map((resultat) => resultat.sourceEffective).filter((source): source is string => Boolean(source)))];
  return {
    recupereLe,
    sourceEffective: depuisCache ? "cache SoSoValue" : sources.length === 1 ? sources[0] ?? "SoSoValue" : "SoSoValue",
  };
}

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
  recupereLe: number | null,
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
    recupereLe,
    cadenceMs,
    ageMaxMs,
    couverture,
    estime: false,
    acces: observeLe === null ? "indisponible" : acces,
    statut,
    ...(raison ? { raison } : {}),
  });
}

export async function rafraichirRegime(): Promise<void> {
  const now = Date.now();
  const cleEtf = getSoSoValueKey();
  const actifsEtf: readonly ActifEtf[] = ["btc", "eth", "sol"];
  const [tickers, fg, funding, dvol, volReal, oi, etf, emetteurs, gamma] = await Promise.allSettled([
    fetchWatchlistOvernight(["BTCUSDT", "ETHUSDT"]),
    histFearGreedAvecMeta(),
    histFundingAvecMeta("BTCUSDT"),
    histDvolAvecMeta("BTC"),
    histVolRealiseeAvecMeta("BTCUSDT"),
    histOiUsdAvecMeta("BTCUSDT"),
    Promise.all(actifsEtf.map((actif) => fetchEtfFlows(actif, cleEtf))),
    chargerEmetteurs(),
    // Verdict gamma BTC sous hypothèses : cache TTL 10 min → au plus 1 appel par cycle 15 min.
    chargerVerdictGammaBtc(now),
  ]);

  const lignes = tickers.status === "fulfilled" ? tickers.value : [];
  const nuitBtcPct = lignes.find((l) => l.symbole === "BTCUSDT")?.variation24h ?? null;
  const nuitEthPct = lignes.find((l) => l.symbole === "ETHUSDT")?.variation24h ?? null;

  const histFg: HistoriqueReferentiel | null = fg.status === "fulfilled" ? fg.value : null;
  const histFunding: HistoriqueReferentiel | null = funding.status === "fulfilled" ? funding.value : null;
  const histDvol: HistoriqueReferentiel | null = dvol.status === "fulfilled" ? dvol.value : null;
  const histVolReal: HistoriqueReferentiel | null = volReal.status === "fulfilled" ? volReal.value : null;
  const histOi: HistoriqueReferentiel | null = oi.status === "fulfilled" ? oi.value : null;
  const serieFg = histFg?.points ?? null;
  const serieFunding = histFunding?.points ?? null;
  const serieDvol = histDvol?.points ?? null;
  const serieVolReal = histVolReal?.points ?? null;
  const serieOi = histOi?.points ?? null;

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

  const etfResultats: EtfResultat[] = etf.status === "fulfilled" ? etf.value : [];
  const etfRegime = agregerFluxEtfRegime(
    actifsEtf.map((actif, index) => ({
      actif,
      disponible: etfResultats[index]?.disponible ?? false,
      jour: etfResultats[index]?.jour ?? null,
      total: etfResultats[index]?.total ?? null,
    })),
    now,
  );

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
        ? {
          regime: verdictBtc.verdict.regime,
          gexNetUsd: verdictBtc.gexNetUsd,
          hypotheses: verdictBtc.scenarios.map((scenario) => ({
            libelle: scenario.libelle,
            regime: scenario.verdict.regime,
          })),
        }
        : null,
  });

  publierQualiteSerie("regime:fear-greed", "Fear & Greed", "alternative-me", histFg?.sourceEffective ?? "Alternative.me", serieFg, now, JOUR_MS, 3 * JOUR_MS, histFg?.recupereLe ?? null);
  publierQualiteSerie("regime:funding", "Funding BTC", "binance-futures", histFunding?.sourceEffective ?? "Binance USDⓈ-M", serieFunding, now, cadenceFunding, Math.max(12 * 3_600_000, (cadenceFunding ?? 0) * 2), histFunding?.recupereLe ?? null);
  publierQualiteSerie("regime:dvol", "DVOL BTC", "deribit", histDvol?.sourceEffective ?? "Deribit", serieDvol, now, JOUR_MS, 3 * JOUR_MS, histDvol?.recupereLe ?? null);
  publierQualiteSerie("regime:vol-realisee", "Vol réalisée BTC", "binance", histVolReal?.sourceEffective ?? "Binance spot", serieVolReal, now, JOUR_MS, 3 * JOUR_MS, histVolReal?.recupereLe ?? null);
  publierQualiteSerie("regime:oi", "Open Interest BTC", "binance-futures", histOi?.sourceEffective ?? "Binance USDⓈ-M", serieOi, now, 3_600_000, 3 * 3_600_000, histOi?.recupereLe ?? null);
  const etfCouverture = etfRegime === null ? null : { disponibles: etfRegime.couverture.presents.length, attendus: etfRegime.couverture.attendus.length };
  const metadataEtf = metadataEtfRegime(actifsEtf, etfResultats, etfRegime);
  enregistrerQualite("regime:etf", "Flux ETF spot", {
    sourceId: "sosovalue", sourceEffective: metadataEtf.sourceEffective, observeLe: etfRegime === null ? null : Date.parse(`${etfRegime.jour}T00:00:00Z`), recupereLe: metadataEtf.recupereLe,
    cadenceMs: JOUR_MS, ageMaxMs: 6 * JOUR_MS - 1, couverture: etfCouverture, estime: false, acces: etfRegime === null ? "indisponible" : "cle",
    statut: etfRegime === null ? "indisponible" : etfRegime.ageJours > 5 ? "perime" : etfCouverture?.disponibles === etfCouverture?.attendus ? "frais" : "partiel",
    ...(etfRegime === null ? { raison: "Aucune séance valide rapportée." } : etfCouverture?.disponibles !== etfCouverture?.attendus ? { raison: "Séance incomplète BTC/ETH/SOL." } : {}),
  });
  enregistrerQualite("regime:stablecoins", "Offre stablecoins 7 j", {
    sourceId: "defillama", sourceEffective: "DefiLlama", observeLe: null, recupereLe: null,
    cadenceMs: JOUR_MS, couverture: null, estime: false, acces: emetteurs.status === "fulfilled" ? "public" : "indisponible", statut: emetteurs.status === "fulfilled" ? "partiel" : "indisponible",
    raison: emetteurs.status === "fulfilled" ? "La liste courante ne fournit pas de date d'observation globale ; acquisition du cache non transmise." : "Chargement des stablecoins en échec.",
  });
  enregistrerQualite("regime:gamma", "Gamma dealers BTC", {
    sourceId: "deribit", sourceEffective: "Deribit", observeLe: null, recupereLe: verdictBtc?.recupereLe ?? null,
    cadenceMs: 15 * 60_000, couverture: null, estime: true, acces: verdictBtc === null ? "indisponible" : "public", statut: verdictBtc === null ? "indisponible" : "partiel",
    raison: verdictBtc === null ? "Chaîne d'options ou verdict indisponible." : "Horodatage de marché de la chaîne non transmis ; acquisition réelle conservée, y compris depuis le cache.",
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
