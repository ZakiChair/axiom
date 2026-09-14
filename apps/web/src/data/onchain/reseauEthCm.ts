/**
 * Réseau ETH — Coin Metrics Community (sans clé, CORS ouvert, appel direct), UN seul fetch.
 *
 * Sept métriques quotidiennes sur 800 j (CapMrktCurUSD, CapMVRVCur, SplyCur, SplyExNtv,
 * FlowInExNtv, FlowOutExNtv, FeeTotNtv) alimentent quatre blocs :
 * - réserve exchanges : stock labellisé (SplyExNtv), part de l'offre au même jour, variations
 *   30/90/365 j. Le PÉRIMÈTRE D'ADRESSES est révisable (marches de +0,2 à +5,4 M ETH en un
 *   jour) : chaque horizon porte un drapeau de marche, et aucun « plus bas depuis », rang ou
 *   courbe du niveau n'est calculé ;
 * - flux net exchanges = FlowInExNtv − FlowOutExNtv (vue commune avec BTC) ;
 * - émission nette annualisée = variation calendaire de SplyCur × 365 / n ; frais totaux =
 *   somme de FeeTotNtv (frais payés, sans ventilation) ;
 * - prix réalisé reconstitué = CapMrktCurUSD ÷ CapMVRVCur ÷ SplyCur, écart au spot CM
 *   (CapMrktCurUSD ÷ SplyCur) du même jour.
 * Flux et réserve sont en statut « flash » (valeurs récentes révisables) : signalé.
 * Cache 6 h de la donnée DÉRIVÉE seule ; cache périmé resservi en cas d'échec, sinon null.
 */
import { ecrireCache, estFrais, lireCache } from "./cache";
import { ecartPrixRealise, variationCalendaire } from "./cohorts";
import {
  chargerLignesCoinMetrics,
  CM_TTL_MS,
  parseCoinMetrics,
  type CoinMetricsParse,
  type PointMetrique,
} from "./coinmetrics";
import { dernierStatutCm, FENETRE_FLUX_JOURS, fluxNetQuotidien, sommeJours } from "./fluxExchangesCm";
import type { ResultatFrais } from "./mempool";
import { healthStore } from "../../store/health";

const JOUR_MS = 86_400_000;
const CLE_CACHE = "cm:eth:reseau";
export const METRIQUES_ETH_CM = [
  "CapMrktCurUSD", "CapMVRVCur", "SplyCur", "SplyExNtv", "FlowInExNtv", "FlowOutExNtv", "FeeTotNtv",
] as const;
/** Marche de périmètre : |Δréserve − flux net| d'UN jour au-delà de 0,5 % du stock de la veille. */
export const SEUIL_MARCHE_PERIMETRE_PCT = 0.5;
const HORIZONS = [30, 90, 365] as const;
/**
 * Délai interne (< 15 s du chargeur CHAIN) : le catch ci-dessous ressert le cache périmé AVANT que
 * la course du chargeur ne rejette « Délai réseau dépassé » et ne publie null.
 */
const DELAI_MS = 14_000;

export interface VariationReserve {
  jours: 30 | 90 | 365;
  absolue: number | null;
  pct: number | null;
  /** Δréserve − Σ flux net du même horizon (ETH) ; null si les séries ne finissent pas le même jour. */
  ecartPerimetre: number | null;
  /** true : marche de périmètre dans l'horizon ; false : contrôlé sans marche ; null : contrôle impossible (jour manquant). */
  marche: boolean | null;
}
export interface ReserveExchangesEth { stockEth: number; partOffrePct: number | null; observeLe: number; variations: VariationReserve[] }
export interface EmissionNetteEth { pctAn7: number | null; pctAn30: number | null; pctAn365: number | null; fraisTotaux30Eth: number | null; observeLe: number | null }
export interface PrixRealiseEth { prixRealiseUsd: number | null; spotCmUsd: number | null; ecartSpotPct: number | null; mvrv: number | null; observeLe: number | null }
export interface ReseauEthCm {
  reserve: ReserveExchangesEth | null;
  /** Flux net quotidien des exchanges (ETH), ≤ 800 j. */
  fluxNet: PointMetrique[];
  emission: EmissionNetteEth;
  prixRealise: PrixRealiseEth;
  flash: boolean;
  /** Observation la PLUS ANCIENNE parmi les blocs disponibles : un bloc frais ne masque pas un bloc en retard. */
  derniereObservation: number | null;
}

/** Émission nette annualisée (%/an) = (SplyCur[t]/SplyCur[t−n] − 1) × 365/n × 100, date calendaire exacte. PURE. */
export function emissionNetteAnnualisee(offre: readonly PointMetrique[], jours: number): number | null {
  const pct = variationCalendaire(offre, jours)?.pct;
  return pct == null ? null : (pct * 365) / jours;
}

/**
 * Δréserve sur `jours` + écart au Σ flux net du même horizon, et drapeau de marche : un jour de
 * l'horizon où |Δréserve − flux net| dépasse 0,5 % du stock de la veille. PURE.
 */
export function variationReserve(reserve: readonly PointMetrique[], net: readonly PointMetrique[], jours: 30 | 90 | 365): VariationReserve {
  const v = variationCalendaire(reserve, jours);
  if (v === null) return { jours, absolue: null, pct: null, ecartPerimetre: null, marche: null };
  const netJusqua = net.filter((p) => p.time <= v.fin);
  const somme = netJusqua.at(-1)?.time === v.fin ? sommeJours(netJusqua, jours) : null;
  const stocks = new Map(reserve.map((p) => [p.time, p.value]));
  const flux = new Map(net.map((p) => [p.time, p.value]));
  let marche: boolean | null = false;
  for (let t = v.debut + JOUR_MS; t <= v.fin && marche !== true; t += JOUR_MS) {
    const veille = stocks.get(t - JOUR_MS);
    const jour = stocks.get(t);
    const f = flux.get(t);
    if (veille === undefined || jour === undefined || f === undefined) marche = null;
    else if (Math.abs(jour - veille - f) > (SEUIL_MARCHE_PERIMETRE_PCT / 100) * Math.abs(veille)) marche = true;
  }
  return { jours, absolue: v.absolue, pct: v.pct, ecartPerimetre: somme === null ? null : v.absolue - somme, marche };
}

/** Prix réalisé = CapMrktCurUSD / CapMVRVCur / SplyCur, au MÊME jour (dernier jour commun aux trois). PURE. */
export function prixRealiseEth(cap: readonly PointMetrique[], mvrv: readonly PointMetrique[], offre: readonly PointMetrique[]): PrixRealiseEth {
  const vide: PrixRealiseEth = { prixRealiseUsd: null, spotCmUsd: null, ecartSpotPct: null, mvrv: null, observeLe: null };
  const mvrvParJour = new Map(mvrv.map((p) => [p.time, p.value]));
  const offreParJour = new Map(offre.map((p) => [p.time, p.value]));
  for (let i = cap.length - 1; i >= 0; i -= 1) {
    const { time, value: capUsd } = cap[i]!;
    const m = mvrvParJour.get(time);
    const o = offreParJour.get(time);
    if (m === undefined || o === undefined) continue;
    if (!(capUsd > 0 && m > 0 && o > 0)) return vide;
    const prixRealiseUsd = capUsd / m / o;
    const spotCmUsd = capUsd / o;
    return { prixRealiseUsd, spotCmUsd, ecartSpotPct: ecartPrixRealise(spotCmUsd, prixRealiseUsd), mvrv: m, observeLe: time };
  }
  return vide;
}

/** Assemble les quatre blocs depuis les séries parsées et le statut flash. PURE. */
export function calculerReseauEthCm(series: CoinMetricsParse, flash: boolean): ReseauEthCm {
  const points = (m: string) => series[m]?.points ?? [];
  const offre = points("SplyCur");
  const stocks = points("SplyExNtv");
  const fluxNet = fluxNetQuotidien(points("FlowInExNtv"), points("FlowOutExNtv"));

  const dernierStock = stocks.at(-1);
  const offreDuJour = dernierStock && offre.find((p) => p.time === dernierStock.time)?.value;
  const reserve: ReserveExchangesEth | null = dernierStock === undefined ? null : {
    stockEth: dernierStock.value,
    partOffrePct: offreDuJour ? (100 * dernierStock.value) / offreDuJour : null,
    observeLe: dernierStock.time,
    variations: HORIZONS.map((jours) => variationReserve(stocks, fluxNet, jours)),
  };

  const finOffre = offre.at(-1)?.time ?? null;
  const frais = points("FeeTotNtv");
  const emission: EmissionNetteEth = {
    pctAn7: emissionNetteAnnualisee(offre, 7),
    pctAn30: emissionNetteAnnualisee(offre, 30),
    pctAn365: emissionNetteAnnualisee(offre, 365),
    fraisTotaux30Eth: finOffre !== null && frais.at(-1)?.time === finOffre ? sommeJours(frais, 30) : null,
    observeLe: finOffre,
  };

  const prixRealise = prixRealiseEth(points("CapMrktCurUSD"), points("CapMVRVCur"), offre);
  const observations = [reserve?.observeLe, fluxNet.at(-1)?.time, emission.observeLe, prixRealise.observeLe]
    .filter((t): t is number => typeof t === "number");
  return {
    reserve, fluxNet, emission, prixRealise, flash,
    derniereObservation: observations.length > 0 ? Math.min(...observations) : null,
  };
}

/** Fetch unique ETH 800 j, cache 6 h (clé `cm:eth:reseau`, dérivé seul), dégradation gracieuse. */
export async function fetchReseauEthCm(signal?: AbortSignal): Promise<ResultatFrais<ReseauEthCm> | null> {
  const cache = await lireCache<ReseauEthCm>(CLE_CACHE);
  if (estFrais(cache, CM_TTL_MS) && cache !== null) return { donnee: cache.donnee, ts: cache.ts, perime: false };
  try {
    const debut = new Date(Date.now() - FENETRE_FLUX_JOURS * JOUR_MS).toISOString().slice(0, 10);
    const delai = AbortSignal.timeout(DELAI_MS);
    const lignes = await chargerLignesCoinMetrics(METRIQUES_ETH_CM, signal ? AbortSignal.any([signal, delai]) : delai, { asset: "eth", debut });
    const flash = ["FlowInExNtv", "FlowOutExNtv", "SplyExNtv"].some((m) => dernierStatutCm(lignes, m) === "flash");
    const donnee = calculerReseauEthCm(parseCoinMetrics({ data: lignes }, "eth", METRIQUES_ETH_CM), flash);
    if (donnee.derniereObservation === null) throw new Error("Coin Metrics ETH vide");
    await ecrireCache(CLE_CACHE, donnee);
    healthStore.getState().setEtat("coinmetrics", "polling", { dernierMessageTs: Date.now() });
    return { donnee, ts: Date.now(), perime: false };
  } catch (e) {
    if (signal?.aborted) return cache ? { donnee: cache.donnee, ts: cache.ts, perime: true } : null;
    healthStore.getState().marquerErreur("coinmetrics", e instanceof Error ? e.message : "échec");
    return cache !== null ? { donnee: cache.donnee, ts: cache.ts, perime: true } : null;
  }
}
