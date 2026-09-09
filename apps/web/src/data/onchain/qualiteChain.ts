import type { QualiteMetrique } from "../qualiteMetrique";
import { analyserJourEtf, type ActifEtf, type EtfResultat } from "./etf";
import type { BgResultat } from "./bgeometrics";
import type { CoinMetricsParse, CoinMetricsResultat } from "./coinmetrics";

const JOUR_MS = 86_400_000;

export interface EntreeQualiteChain {
  id: string;
  libelle: string;
  qualite: QualiteMetrique;
}

const LIBELLES_CM: Record<string, string> = {
  AdrActCnt: "Adresses actives BTC",
  TxCnt: "Transactions BTC",
  FeeTotNtv: "Frais totaux BTC",
  CapMrktCurUSD: "Capitalisation BTC",
  CapMVRVCur: "MVRV BTC",
};

/** Une qualité Coin Metrics par série : aucune métrique récente ne masque une voisine vide. */
export function qualitesCoinMetrics(resultat: CoinMetricsResultat | null, now: number): EntreeQualiteChain[] {
  const series: CoinMetricsParse = resultat?.series
    ?? Object.fromEntries(Object.keys(LIBELLES_CM).map((id) => [id, { points: [] }]));
  return Object.entries(series).map(([id, serie]) => {
    const futures = serie.points.filter((p) => Number.isFinite(p.time) && p.time > now).length;
    const points = serie.points.filter((p) => Number.isFinite(p.time) && p.time <= now && Number.isFinite(p.value));
    const observeLe = points.reduce<number | null>((max, p) => max === null || p.time > max ? p.time : max, null);
    const age = observeLe === null ? Number.POSITIVE_INFINITY : now - observeLe;
    const raisonFuture = futures > 0 ? `${futures} observation future rejetée${futures > 1 ? "s" : ""}.` : undefined;
    const statut: QualiteMetrique["statut"] = observeLe === null ? "indisponible"
      : resultat?.perime || age > 3 * JOUR_MS ? "perime"
        : points.length < 20 ? "en-construction" : "frais";
    const raison = observeLe === null ? raisonFuture ?? "Aucune observation exploitable."
      : resultat?.raison ?? (age > 3 * JOUR_MS ? "Dernière observation quotidienne trop ancienne." : raisonFuture ?? (points.length < 20 ? `${points.length}/20 observations minimales.` : undefined));
    return {
      id,
      libelle: LIBELLES_CM[id] ?? id,
      qualite: {
        sourceId: "coinmetrics",
        sourceEffective: resultat?.sourceEffective ?? (resultat?.perime ? "cache Coin Metrics" : "Coin Metrics Community"),
        observeLe,
        recupereLe: resultat?.ts ?? null,
        cadenceMs: JOUR_MS,
        couverture: null,
        estime: false,
        acces: resultat === null ? "indisponible" : "public",
        statut,
        ...(raison ? { raison } : {}),
      },
    };
  });
}

export interface ValeurPublicationEtf {
  actif: ActifEtf;
  principal: EtfResultat;
  repli: BgResultat | null;
}

/** Qualité de la branche ETF telle que publiée par le panneau, y compris timeout sans valeur. */
export function qualitePublicationEtf(
  actif: ActifEtf,
  valeur: ValeurPublicationEtf | null,
  erreur: string | undefined,
  precedente: QualiteMetrique | undefined,
  now: number,
): QualiteMetrique {
  if (valeur === null) {
    return {
      sourceId: precedente?.sourceId ?? "sosovalue",
      sourceEffective: precedente?.sourceEffective ?? "SoSoValue",
      observeLe: precedente?.observeLe ?? null,
      recupereLe: precedente?.recupereLe ?? null,
      cadenceMs: JOUR_MS,
      couverture: null,
      estime: false,
      acces: precedente?.acces ?? "indisponible",
      statut: "indisponible",
      raison: erreur ?? `ETF ${actif.toUpperCase()} indisponible.`,
    };
  }
  const repli = actif === "btc" && !valeur.principal.disponible ? valeur.repli : null;
  if (repli?.serie.dernier) {
    const observeLe = repli.serie.dernier.time <= now ? repli.serie.dernier.time : null;
    return {
      sourceId: "bgeometrics", sourceEffective: repli.perime ? "cache BGeometrics (repli)" : "BGeometrics (repli)",
      observeLe, recupereLe: repli.ts, cadenceMs: JOUR_MS, couverture: null, estime: false, acces: "cle",
      statut: repli.perime || observeLe === null || now - observeLe > 5 * JOUR_MS ? "perime" : "partiel",
      raison: observeLe === null ? "Observation future du repli rejetée." : "SoSoValue indisponible ; repli BTC natif.",
    };
  }
  const analyse = analyserJourEtf(valeur.principal.jour, now);
  if (!valeur.principal.disponible) {
    return { sourceId: "sosovalue", sourceEffective: valeur.principal.sourceEffective ?? "SoSoValue", observeLe: null,
      recupereLe: valeur.principal.recupereLe ?? null, cadenceMs: JOUR_MS, couverture: null, estime: false, acces: "indisponible",
      statut: "indisponible", raison: erreur ?? valeur.principal.raison ?? "Flux indisponible." };
  }
  const perime = analyse.ageJours !== null && analyse.ageJours > 5;
  return {
    sourceId: "sosovalue", sourceEffective: valeur.principal.sourceEffective ?? "SoSoValue",
    observeLe: analyse.observeLe, recupereLe: valeur.principal.recupereLe ?? null, cadenceMs: JOUR_MS, couverture: null,
    estime: false, acces: "cle", statut: analyse.observeLe === null ? "partiel" : perime ? "perime" : "frais",
    ...(analyse.raison ? { raison: analyse.raison } : perime ? { raison: "Séance ETF âgée de plus de cinq jours calendaires." } : {}),
  };
}

export interface TraitementPublicationEtf {
  actif: ActifEtf;
  valeur: ValeurPublicationEtf | null;
  erreur: string | undefined;
  precedente: QualiteMetrique | undefined;
  now: number;
  appliquerValeur: (valeur: ValeurPublicationEtf) => void;
  appliquerQualite: (qualite: QualiteMetrique) => void;
}

/** Branche de publication du panneau : la valeur précédente survit à l'échec, sa qualité non. */
export function traiterPublicationEtfChain(params: TraitementPublicationEtf): void {
  if (params.valeur !== null) params.appliquerValeur(params.valeur);
  params.appliquerQualite(qualitePublicationEtf(
    params.actif,
    params.valeur,
    params.erreur,
    params.precedente,
    params.now,
  ));
}
