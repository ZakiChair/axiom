import type { QualiteMetrique } from "../qualiteMetrique";
import { AGE_MAX_FLUX_MS } from "./fluxCapitaux.contract";
export { AGE_MAX_FLUX_MS } from "./fluxCapitaux.contract";
import { getBgeometricsKey } from "../../store/onchain";
import { getSoSoValueKey } from "../../store/sosovalue";
import type { PointSupply } from "../macro/stablecoinsDetail";
import { parseHistoriqueStablecoinChaine } from "./economieChaines";
import {
  BG_EXCHANGE_NETFLOW,
  BG_EXCHANGE_RESERVE,
  BG_LTH_REALIZED_PRICE,
  BG_REALIZED_CAP,
  BG_STH_REALIZED_PRICE,
  chargerBgeometricMetrique,
  type DefMetriqueBg,
} from "./bgeometrics";
import { fetchEtfHistory, historiqueRatiosEtf, type JourEtf } from "./etfHistory";
import type { PointMetrique } from "./coinmetrics";
import type { ActifEtf } from "./etf";

const JOUR_MS = 86_400_000;
const HEURE_MS = 3_600_000;
const STABLECOINS_URL = "https://stablecoins.llama.fi/stablecoincharts/all";
export type MetriqueFluxId =
  | `etf-${ActifEtf}-flow` | `etf-${ActifEtf}-ratio`
  | "stablecoins-stock" | "stablecoins-variation-7j"
  | "realized-cap-stock" | "realized-cap-variation-30j" | "realized-cap-variation-90j"
  | "sth-realized-price" | "lth-realized-price" | "exchange-netflow" | "exchange-reserve";
export interface MetriqueFluxCapitaux {
  id: MetriqueFluxId;
  libelle: string;
  valeur: number | null;
  unite: string;
  periode: string;
  observeLe: number | null;
  source: string;
  qualite?: QualiteMetrique;
  alerte: boolean;
}
export interface VueFluxCapitaux { metriques: MetriqueFluxCapitaux[]; recupereLe: number }
export interface LectureFluxCapitaux { id: "etf" | "realized-cap"; titre: string; detail: string }
export interface EntreesFluxCapitaux {
  now: number;
  etf: Record<ActifEtf, JourEtf[]>;
  stablecoins: PointSupply[];
  realizedCap: PointMetrique[];
  sthRealizedPrice: PointMetrique[];
  lthRealizedPrice?: PointMetrique[];
  exchangeNetflow: PointMetrique[];
  exchangeReserve: PointMetrique[];
}

function dernierValide<T extends { time: number }>(serie: readonly T[], now: number): T | null {
  return [...serie].filter((p) => Number.isFinite(p.time) && p.time <= now).sort((a, b) => a.time - b.time).at(-1) ?? null;
}

export function variationSurHorizon(serie: readonly PointMetrique[], now: number, jours: number): number | null {
  const valides = [...serie].filter((p) => Number.isFinite(p.time) && p.time <= now && Number.isFinite(p.value)).sort((a, b) => a.time - b.time);
  const dernier = valides.at(-1);
  if (!dernier) return null;
  const cible = dernier.time - jours * JOUR_MS;
  const precedent = valides.find((point) => point.time === cible);
  if (!precedent || precedent.value === 0) return null;
  return ((dernier.value - precedent.value) / precedent.value) * 100;
}

export interface SourceFlux {
  recupereLe: number;
  disponible: boolean;
  perime: boolean;
  repli?: boolean;
  raison?: string;
  acces: QualiteMetrique["acces"];
}

export function qualifierMetriqueFlux(
  sourceId: string,
  sourceEffective: string,
  observeLe: number | null,
  now: number,
  valeur: number | null,
  source: SourceFlux,
  couverture: QualiteMetrique["couverture"],
): QualiteMetrique {
  const observationPerimee = observeLe === null || observeLe > now || now - observeLe > AGE_MAX_FLUX_MS;
  const incomplet = couverture !== null && couverture.disponibles < couverture.attendus;
  const statut: QualiteMetrique["statut"] = !source.disponible
    ? "indisponible"
    : source.perime || observationPerimee
      ? "perime"
      : valeur === null
        ? "en-construction"
        : incomplet
          ? "partiel"
          : "frais";
  const raisonAge = observationPerimee && observeLe !== null
    ? observeLe > now ? "Observation datée dans le futur" : "Dernière observation trop ancienne"
    : undefined;
  return {
    sourceId,
    sourceEffective: source.repli ? `cache ${sourceEffective}` : sourceEffective,
    observeLe,
    recupereLe: source.recupereLe,
    cadenceMs: JOUR_MS,
    ageMaxMs: AGE_MAX_FLUX_MS,
    couverture,
    estime: false,
    acces: source.acces,
    statut,
    ...((source.raison ?? raisonAge) ? { raison: source.raison ?? raisonAge } : {}),
  };
}

function couvertureHorizon(serie: readonly PointMetrique[], now: number, jours: number): QualiteMetrique["couverture"] {
  const dernier = dernierValide(serie.filter((point) => Number.isFinite(point.value)), now);
  if (!dernier) return { disponibles: 0, attendus: jours + 1 };
  const debut = dernier.time - jours * JOUR_MS;
  const disponibles = new Set(serie.filter((point) => point.time >= debut && point.time <= dernier.time && Number.isFinite(point.value)).map((point) => point.time)).size;
  return { disponibles: Math.min(disponibles, jours + 1), attendus: jours + 1 };
}

export interface StablecoinsFluxCharge {
  points: PointSupply[];
  recupereLe: number;
  disponible: boolean;
  perime: boolean;
  repli?: boolean;
  raison?: string;
}
export interface OptionsStablecoinsFlux { signal?: AbortSignal; fetcher?: typeof fetch; now?: () => number }
let cacheStablecoins: { expireLe: number; valeur: StablecoinsFluxCharge } | null = null;
let stablecoinsEnCours: { promesse: Promise<StablecoinsFluxCharge>; signal?: AbortSignal } | null = null;

export function _viderCacheStablecoinsFlux(): void {
  cacheStablecoins = null;
  stablecoinsEnCours = null;
}

/** Historique agrégé DefiLlama avec date d'acquisition et repli de cache explicites. */
export async function chargerStablecoinsFlux(options: OptionsStablecoinsFlux = {}): Promise<StablecoinsFluxCharge> {
  const now = options.now ?? Date.now;
  const instant = now();
  if (cacheStablecoins && cacheStablecoins.expireLe > instant) return cacheStablecoins.valeur;
  if (stablecoinsEnCours && !stablecoinsEnCours.signal?.aborted) return stablecoinsEnCours.promesse;
  const fetcher = options.fetcher ?? fetch;
  const repli = cacheStablecoins?.valeur;
  let promesse!: Promise<StablecoinsFluxCharge>;
  promesse = (async (): Promise<StablecoinsFluxCharge> => {
    try {
      const timeout = AbortSignal.timeout(15_000);
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
      const response = await fetcher(STABLECOINS_URL, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const points = parseHistoriqueStablecoinChaine(await response.json())
        .filter((point) => point.time <= now())
        .map((point) => ({ time: point.time, totalUsd: point.value }));
      if (points.length === 0) throw new Error("historique vide");
      const recupereLe = now();
      const valeur: StablecoinsFluxCharge = { points, recupereLe, disponible: true, perime: false };
      cacheStablecoins = { expireLe: recupereLe + HEURE_MS, valeur };
      return valeur;
    } catch (erreur) {
      if (options.signal?.aborted) throw erreur;
      const raison = erreur instanceof Error ? erreur.message : "source injoignable";
      return repli
        ? { ...repli, perime: true, repli: true, raison: `Cache périmé · ${raison}` }
        : { points: [], recupereLe: now(), disponible: false, perime: false, raison };
    } finally {
      if (stablecoinsEnCours?.promesse === promesse) stablecoinsEnCours = null;
    }
  })();
  stablecoinsEnCours = { promesse, ...(options.signal ? { signal: options.signal } : {}) };
  return promesse;
}

export function alignerFluxCapitaux(entrees: EntreesFluxCapitaux): VueFluxCapitaux {
  const dernierStable = dernierValide(entrees.stablecoins, entrees.now);
  const stablePoints = entrees.stablecoins.map((p) => ({ time: p.time, value: p.totalUsd }));
  const dernierCap = dernierValide(entrees.realizedCap, entrees.now);
  const dernierSth = dernierValide(entrees.sthRealizedPrice, entrees.now);
  const dernierLth = dernierValide(entrees.lthRealizedPrice ?? [], entrees.now);
  const dernierNetflow = dernierValide(entrees.exchangeNetflow, entrees.now);
  const dernierReserve = dernierValide(entrees.exchangeReserve, entrees.now);
  const etf = (["btc", "eth", "sol"] as const).flatMap((actif): MetriqueFluxCapitaux[] => {
    const dernier = dernierValide(entrees.etf[actif], entrees.now);
    const ratio = historiqueRatiosEtf(entrees.etf[actif], entrees.now).points.at(-1);
    return [
      { id: `etf-${actif}-flow`, libelle: `Flux ETF ${actif.toUpperCase()}`, valeur: dernier?.fluxUsd ?? null,
        unite: "USD/j", periode: "séance", observeLe: dernier?.time ?? null, source: "SoSoValue", alerte: false },
      { id: `etf-${actif}-ratio`, libelle: `ETF ${actif.toUpperCase()} flux / encours`, valeur: ratio?.value ?? null,
        unite: "% AUM/j", periode: "séance", observeLe: ratio?.time ?? null, source: "SoSoValue", alerte: true },
    ];
  });
  return {
    recupereLe: entrees.now,
    metriques: [
      ...etf,
      { id: "stablecoins-stock", libelle: "Stock stablecoins", valeur: dernierStable?.totalUsd ?? null, unite: "USD", periode: "niveau", observeLe: dernierStable?.time ?? null, source: "DefiLlama", alerte: false },
      { id: "stablecoins-variation-7j", libelle: "Variation stablecoins", valeur: variationSurHorizon(stablePoints, entrees.now, 7), unite: "%", periode: "7 j", observeLe: dernierStable?.time ?? null, source: "DefiLlama", alerte: true },
      { id: "realized-cap-stock", libelle: "Capitalisation réalisée BTC", valeur: dernierCap?.value ?? null, unite: "USD", periode: "niveau", observeLe: dernierCap?.time ?? null, source: "BGeometrics", alerte: false },
      { id: "realized-cap-variation-30j", libelle: "Capitalisation réalisée BTC", valeur: variationSurHorizon(entrees.realizedCap, entrees.now, 30), unite: "%", periode: "30 j", observeLe: dernierCap?.time ?? null, source: "BGeometrics", alerte: true },
      { id: "realized-cap-variation-90j", libelle: "Capitalisation réalisée BTC", valeur: variationSurHorizon(entrees.realizedCap, entrees.now, 90), unite: "%", periode: "90 j", observeLe: dernierCap?.time ?? null, source: "BGeometrics", alerte: true },
      { id: "sth-realized-price", libelle: "Prix réalisé STH", valeur: dernierSth?.value ?? null, unite: "USD/BTC", periode: "niveau", observeLe: dernierSth?.time ?? null, source: "BGeometrics", alerte: false },
      { id: "lth-realized-price", libelle: "Prix réalisé LTH", valeur: dernierLth?.value ?? null, unite: "USD/BTC", periode: "niveau", observeLe: dernierLth?.time ?? null, source: "BGeometrics", alerte: false },
      { id: "exchange-netflow", libelle: "Flux net exchanges", valeur: dernierNetflow?.value ?? null, unite: "BTC/j", periode: "jour", observeLe: dernierNetflow?.time ?? null, source: "BGeometrics", alerte: true },
      { id: "exchange-reserve", libelle: "Réserves exchanges", valeur: dernierReserve?.value ?? null, unite: "BTC", periode: "niveau", observeLe: dernierReserve?.time ?? null, source: "BGeometrics", alerte: false },
    ],
  };
}

function direction(valeur: number): "positif" | "negatif" | "neutre" {
  return valeur > 0 ? "positif" : valeur < 0 ? "negatif" : "neutre";
}

function dateUtc(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/** Lectures descriptives entre séries comparables ; aucune causalité ni score n'est inféré. */
export function lireAccordsFlux(metriques: readonly MetriqueFluxCapitaux[]): LectureFluxCapitaux[] {
  const utilisable = (id: MetriqueFluxId) => {
    const m = metriques.find((item) => item.id === id);
    return m?.valeur !== null && m?.valeur !== undefined && Number.isFinite(m.valeur) && m.observeLe !== null && m.qualite?.statut === "frais" ? m : null;
  };
  const lectures: LectureFluxCapitaux[] = [];
  const ratios = (["btc", "eth", "sol"] as const).map((actif) => ({ actif, metrique: utilisable(`etf-${actif}-ratio`) })).filter((x) => x.metrique !== null);
  if (ratios.length >= 2) {
    const dates = new Set(ratios.map((x) => x.metrique!.observeLe));
    if (dates.size === 1) {
      const groupes = new Map<string, string[]>();
      for (const ratio of ratios) {
        const sens = direction(ratio.metrique!.valeur!);
        groupes.set(sens, [...(groupes.get(sens) ?? []), ratio.actif.toUpperCase()]);
      }
      const accord = groupes.size === 1;
      const detailDirections = [...groupes].map(([sens, actifs]) => `${actifs.join("/")} ${sens}`).join(" ; ");
      lectures.push({ id: "etf", titre: accord ? "Même direction des ETF" : "Désaccord entre ETF",
        detail: `${detailDirections} sur la séance du ${dateUtc(ratios[0]!.metrique!.observeLe!)}. Comparaison de signes des ratios flux/encours de cette séance.` });
    }
  }
  const cap30 = utilisable("realized-cap-variation-30j");
  const cap90 = utilisable("realized-cap-variation-90j");
  if (cap30 && cap90 && cap30.observeLe === cap90.observeLe) {
    const d30 = direction(cap30.valeur!);
    const d90 = direction(cap90.valeur!);
    lectures.push({ id: "realized-cap", titre: d30 === d90 ? "Même direction selon les horizons" : "Désaccord entre horizons",
      detail: `Capitalisation réalisée : 30 j ${d30}, 90 j ${d90}, observation du ${dateUtc(cap30.observeLe!)}. Les périodes diffèrent et ne sont pas additionnées.` });
  }
  return lectures;
}

interface SerieChargee extends SourceFlux { points: PointMetrique[] }
async function chargerBg(def: DefMetriqueBg, signal?: AbortSignal): Promise<SerieChargee> {
  const commenceLe = Date.now();
  const charge = await chargerBgeometricMetrique(def, getBgeometricsKey(), signal);
  const resultat = charge.resultat;
  const points = resultat?.serie.points ?? [];
  return { points, recupereLe: resultat?.ts ?? Date.now(), disponible: points.length > 0, perime: Boolean(resultat?.perime || charge.raison), repli: Boolean(resultat && (charge.raison || resultat.ts < commenceLe)),
    ...(charge.raison ? { raison: charge.raison } : {}), acces: charge.statut === "abonnement" ? "abonnement" : getBgeometricsKey() ? "cle" : "public" };
}

/** Charge une fois les données partagées par CHAIN, BRIEF, STBL et le runtime d'alertes. */
export async function chargerFluxCapitaux(signal?: AbortSignal): Promise<VueFluxCapitaux> {
  const now = Date.now();
  const [btc, eth, sol, stable, cap, sth, lth, netflow, reserve] = await Promise.all([
    fetchEtfHistory("btc", getSoSoValueKey(), signal), fetchEtfHistory("eth", getSoSoValueKey(), signal), fetchEtfHistory("sol", getSoSoValueKey(), signal),
    chargerStablecoinsFlux({ signal }), chargerBg(BG_REALIZED_CAP, signal), chargerBg(BG_STH_REALIZED_PRICE, signal), chargerBg(BG_LTH_REALIZED_PRICE, signal),
    chargerBg(BG_EXCHANGE_NETFLOW, signal), chargerBg(BG_EXCHANGE_RESERVE, signal),
  ]);
  const vue = alignerFluxCapitaux({ now, etf: { btc: btc.points, eth: eth.points, sol: sol.points }, stablecoins: stable.points,
    realizedCap: cap.points, sthRealizedPrice: sth.points, lthRealizedPrice: lth.points, exchangeNetflow: netflow.points, exchangeReserve: reserve.points });
  const etfResultats = { btc, eth, sol };
  for (const metrique of vue.metriques) {
    let source: SourceFlux = { recupereLe: stable.recupereLe, disponible: stable.disponible, perime: stable.perime, repli: stable.repli,
      ...(stable.raison ? { raison: stable.raison } : {}), acces: "public" };
    let couverture: QualiteMetrique["couverture"] = { disponibles: metrique.valeur === null ? 0 : 1, attendus: 1 };
    if (metrique.id.startsWith("etf-")) {
      const actif = metrique.id.slice(4, 7) as ActifEtf;
      const resultat = etfResultats[actif];
      source = { recupereLe: resultat.ts, disponible: resultat.points.length > 0, perime: resultat.perime, repli: resultat.repli,
        ...(resultat.raison ? { raison: resultat.raison } : {}), acces: getSoSoValueKey() ? "cle" : "public" };
      if (metrique.id.endsWith("-ratio")) {
        const ratios = historiqueRatiosEtf(resultat.points, now).points.length;
        couverture = { disponibles: Math.min(ratios, 20), attendus: 20 };
      }
    } else if (metrique.id.startsWith("realized-cap")) {
      source = cap;
      if (metrique.id.endsWith("30j")) couverture = couvertureHorizon(cap.points, now, 30);
      if (metrique.id.endsWith("90j")) couverture = couvertureHorizon(cap.points, now, 90);
    } else if (metrique.id === "sth-realized-price") source = sth;
    else if (metrique.id === "lth-realized-price") source = lth;
    else if (metrique.id === "exchange-netflow") source = netflow;
    else if (metrique.id === "exchange-reserve") source = reserve;
    else if (metrique.id === "stablecoins-variation-7j") couverture = couvertureHorizon(stable.points.map((p) => ({ time: p.time, value: p.totalUsd })), now, 7);
    metrique.qualite = qualifierMetriqueFlux(`flux:${metrique.id}`, metrique.source, metrique.observeLe, now, metrique.valeur, source, couverture);
  }
  return vue;
}
