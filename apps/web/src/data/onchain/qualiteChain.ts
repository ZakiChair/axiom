import type { QualiteMetrique } from "../qualiteMetrique";
import { analyserJourEtf, type ActifEtf, type EtfResultat } from "./etf";
import type { BgResultat, DefMetriqueBg } from "./bgeometrics";
import type { CoinMetricsParse, CoinMetricsResultat } from "./coinmetrics";
import type { ResultatFrais } from "./mempool";
import type { ReseauEthCm } from "./reseauEthCm";

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
        ageMaxMs: 3 * JOUR_MS,
        couverture: null,
        estime: false,
        acces: resultat === null ? "indisponible" : "public",
        statut,
        ...(raison ? { raison } : {}),
      },
    };
  });
}

/**
 * Qualité du bloc Réseau ETH · Coin Metrics (un seul fetch, quatre blocs). L'observation est la
 * plus ancienne des blocs disponibles ; le statut flash et le périmètre révisable sont rappelés.
 */
export function qualiteReseauEthCm(resultat: ResultatFrais<ReseauEthCm> | null, erreur: string | undefined, now: number): QualiteMetrique {
  const r = resultat?.donnee;
  const disponibles = r ? [r.reserve !== null, r.fluxNet.length > 0, r.emission.pctAn30 !== null, r.prixRealise.prixRealiseUsd !== null].filter(Boolean).length : 0;
  const observeLe = r?.derniereObservation ?? null;
  const statut: QualiteMetrique["statut"] = resultat === null ? "indisponible"
    : resultat.perime || observeLe === null || now - observeLe > 3 * JOUR_MS ? "perime"
      : disponibles < 4 ? "partiel" : "frais";
  const raison = erreur ?? (resultat === null ? "Coin Metrics ETH indisponible et aucun cache exploitable."
    : r?.flash ? "Statut flash Coin Metrics : flux et réserve exchanges révisables ; périmètre d'adresses révisable." : undefined);
  return {
    sourceId: "coinmetrics",
    sourceEffective: resultat?.perime ? "cache Coin Metrics" : "Coin Metrics Community",
    observeLe,
    recupereLe: resultat?.ts ?? null,
    cadenceMs: JOUR_MS,
    ageMaxMs: 3 * JOUR_MS,
    couverture: resultat === null ? null : { disponibles, attendus: 4 },
    estime: false,
    acces: resultat === null ? "indisponible" : "public",
    statut,
    ...(raison ? { raison } : {}),
  };
}

/** Date UTC « JJ/MM/AAAA » d'une observation quotidienne. */
const dateUtc = (time: number): string =>
  new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(time);

/**
 * Motif d'affichage d'un résultat BGeometrics périmé. PURE. « cache » : valeur resservie faute
 * d'appel abouti ; « embargo » : métrique sous embargo dont la dernière observation avait 6 à 9 jours
 * AU MOMENT DE L'APPEL (`ts` : appel réseau ou écriture du cache frais 24 h, jamais le rendu) :
 * J-7 livré à 00:00 UTC, mis à jour vers 05 h UTC, donc 7 à ~8,2 j à l'appel ; « retard » : tout autre âge excessif.
 */
export function motifPeremptionBg(resultat: BgResultat | null, def: DefMetriqueBg): "cache" | "embargo" | "retard" | null {
  if (resultat === null) return null;
  if (resultat.repli) return "cache";
  if (!resultat.perime) return null;
  const age = resultat.ts - (resultat.serie.dernier?.time ?? 0);
  return def.embargo && age >= 6 * JOUR_MS && age <= 9 * JOUR_MS ? "embargo" : "retard";
}

/**
 * Qualité d'une tuile Valorisation BGeometrics. « cache » seulement pour une valeur resservie
 * faute d'appel abouti (`repli`) ; une donnée fraîchement récupérée mais ancienne signale l'embargo
 * de l'offre gratuite ou une source en retard (cf. motifPeremptionBg), avec la date de sa dernière
 * observation. Le statut « perime » est inchangé.
 */
export function qualiteBgeometrics(resultat: BgResultat | null, erreur: string | undefined, avecCle: boolean, recupereLe: number, def: DefMetriqueBg): QualiteMetrique {
  const dernier = resultat?.serie.dernier;
  const motif = motifPeremptionBg(resultat, def);
  const raison = resultat === null || erreur ? erreur ?? "Métrique BGeometrics indisponible ou quota épuisé."
    : motif === "embargo" && dernier ? `Offre gratuite BGeometrics : les 7 derniers jours sont réservés aux abonnés (dernière observation accessible : ${dateUtc(dernier.time)}).`
      : motif === "retard" && dernier ? `Dernière observation publiée par BGeometrics : ${dateUtc(dernier.time)} (source en retard).`
        : undefined;
  return {
    sourceId: "bgeometrics", sourceEffective: resultat?.repli ? "cache BGeometrics" : "BGeometrics",
    observeLe: dernier?.time ?? null, recupereLe: resultat?.ts ?? recupereLe, cadenceMs: JOUR_MS, ageMaxMs: 3 * JOUR_MS,
    couverture: resultat ? { disponibles: resultat.serie.points.length, attendus: 120 } : null, estime: false,
    acces: resultat === null ? "indisponible" : avecCle ? "cle" : "public",
    statut: resultat === null ? "indisponible" : resultat.perime ? "perime" : resultat.serie.points.length < 20 ? "en-construction" : "frais",
    ...(raison ? { raison } : {}),
  };
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
      ageMaxMs: 5 * JOUR_MS,
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
      sourceId: "bgeometrics", sourceEffective: repli.repli ? "cache BGeometrics (repli)" : "BGeometrics (repli)",
      observeLe, recupereLe: repli.ts, cadenceMs: JOUR_MS, ageMaxMs: 5 * JOUR_MS, couverture: null, estime: false, acces: "cle",
      // Règle des séances ETF (5 j) : `repli.perime` bascule dès 3 j, faux positif chaque lendemain de week-end.
      statut: repli.repli || observeLe === null || now - observeLe > 5 * JOUR_MS ? "perime" : "partiel",
      raison: observeLe === null ? "Observation future du repli rejetée." : "SoSoValue indisponible ; repli BTC natif.",
    };
  }
  const analyse = analyserJourEtf(valeur.principal.jour, now);
  if (!valeur.principal.disponible) {
    return { sourceId: "sosovalue", sourceEffective: valeur.principal.sourceEffective ?? "SoSoValue", observeLe: null,
      recupereLe: valeur.principal.recupereLe ?? null, cadenceMs: JOUR_MS, ageMaxMs: 5 * JOUR_MS, couverture: null, estime: false, acces: "indisponible",
      statut: "indisponible", raison: erreur ?? valeur.principal.raison ?? "Flux indisponible." };
  }
  const perime = analyse.ageJours !== null && analyse.ageJours > 5;
  return {
    sourceId: "sosovalue", sourceEffective: valeur.principal.sourceEffective ?? "SoSoValue",
    // analyserJourEtf compte les jours entiers : expire au début du sixième jour.
    observeLe: analyse.observeLe, recupereLe: valeur.principal.recupereLe ?? null, cadenceMs: JOUR_MS, ageMaxMs: 6 * JOUR_MS - 1, couverture: null,
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
