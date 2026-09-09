/**
 * Harmonisation temporelle des séries macro — fonctions PURES, sans dépendance.
 *
 * Les quatre sources du catalogue datent leurs observations au DÉBUT de période
 * (« 2026-04 » pour avril, « 2026-Q2 » pour le deuxième trimestre). Juger la fraîcheur
 * sur cette date ferait passer un PIB du T2 2026 pour vieux de cinq mois au 6 septembre,
 * alors qu'il couvre une période close depuis le 30 juin. `finDePeriode` corrige cela et
 * permet de réutiliser la primitive `Fraicheur` de ui.tsx au lieu de seuils maison.
 */
import type { MacroSeries } from "./types";

/** Fréquence de publication d'une série du catalogue. */
export type FrequenceMacro = "D" | "W" | "M" | "Q";

/**
 * Convertit une période SDMX / Eurostat en ms UTC du DÉBUT de période.
 * Formes reconnues : « YYYY-MM » (mensuel) et « YYYY-Qn » (trimestriel).
 * Toute autre forme renvoie NaN — on n'invente pas une date, l'appelant écarte le point.
 */
export function periodeVersMs(periode: string): number {
  const mensuel = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(periode);
  if (mensuel) {
    return Date.UTC(Number(mensuel[1]), Number(mensuel[2]) - 1, 1);
  }
  const trimestriel = /^(\d{4})-Q([1-4])$/.exec(periode);
  if (trimestriel) {
    return Date.UTC(Number(trimestriel[1]), (Number(trimestriel[2]) - 1) * 3, 1);
  }
  return NaN;
}

/**
 * Dernier instant de la période qui COMMENCE à `debutMs`.
 * `Date.UTC(annee, mois, 0)` désigne le dernier jour du mois PRÉCÉDENT — d'où le
 * décalage de +1 mois (M) ou +3 mois (Q) : les mois courts et les bissextiles sont
 * gérés par le calendrier lui-même, sans table.
 */
export function finDePeriode(debutMs: number, frequence: FrequenceMacro, decalageFinMois = 0): number {
  if (frequence === "D" || frequence === "W") return debutMs;
  const d = new Date(debutMs);
  const moisSuivant = d.getUTCMonth() + (frequence === "Q" ? 3 : 1) + decalageFinMois;
  return Date.UTC(d.getUTCFullYear(), moisSuivant, 0, 23, 59, 59, 999);
}

/** Copie triée par temps croissant. L'OCDE renvoie ses périodes dans le désordre. */
export function trierChrono(serie: MacroSeries): MacroSeries {
  return [...serie].sort((a, b) => a.time - b.time);
}

/** Points dont l'horodatage est supérieur ou égal à `depuisMs`. */
export function filtrerFenetre(serie: MacroSeries, depuisMs: number): MacroSeries {
  return serie.filter((p) => p.time >= depuisMs);
}

/** Variation contre le MÊME mois/trimestre antérieur, jamais contre le Nᵉ point. */
export function variationPeriode(serie: MacroSeries, mois: 1 | 12): MacroSeries {
  const parDate = new Map(serie.filter((p) => Number.isFinite(p.value)).map((p) => [p.time, p]));
  return trierChrono(serie).flatMap((p) => {
    const date = new Date(p.time);
    const reference = parDate.get(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - mois, 1));
    if (reference === undefined || reference.value <= 0 || !Number.isFinite(p.value)) return [];
    const value = ((p.value - reference.value) * 100) / reference.value;
    const qualite = [p.qualite, reference.qualite ? `base : ${reference.qualite}` : undefined].filter(Boolean).join(" ; ");
    return Number.isFinite(value) ? [{ ...p, value, ...(qualite ? { qualite } : {}) }] : [];
  });
}

/**
 * Taux annualisé sur 3 ou 6 mois, contre le même mois civil antérieur. Une absence
 * dans le calendrier ou un niveau non strictement positif invalide le point : on ne
 * remplace jamais une période manquante par le nième point précédent.
 */
export function variationAnnualisee(serie: MacroSeries, mois: 3 | 6): MacroSeries {
  const parDate = new Map(serie.filter((p) => Number.isFinite(p.value)).map((p) => [p.time, p]));
  const exposant = 12 / mois;
  return trierChrono(serie).flatMap((p) => {
    const date = new Date(p.time);
    const reference = parDate.get(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - mois, 1));
    if (!reference || p.value <= 0 || reference.value <= 0 || !Number.isFinite(p.value)) return [];
    const value = 100 * ((p.value / reference.value) ** exposant - 1);
    return Number.isFinite(value) ? [{ ...p, value }] : [];
  });
}

/** Variations PAYEMS en milliers et moyenne des trois variations mensuelles consécutives. */
export function variationsEmploi(serie: MacroSeries): { variation: MacroSeries; moyenne3m: MacroSeries } {
  const niveaux = trierChrono(serie).filter((p) => Number.isFinite(p.value));
  const parDate = new Map(niveaux.map((p) => [p.time, p]));
  const variation = niveaux.flatMap((p) => {
    const date = new Date(p.time);
    const precedent = parDate.get(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
    if (!precedent) return [];
    return [{ ...p, value: p.value - precedent.value }];
  });
  const parVariation = new Map(variation.map((p) => [p.time, p]));
  const moyenne3m = variation.flatMap((p) => {
    const date = new Date(p.time);
    const v1 = parVariation.get(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
    const v2 = parVariation.get(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 2, 1));
    if (!v1 || !v2) return [];
    return [{ ...p, value: (v2.value + v1.value + p.value) / 3 }];
  });
  return { variation, moyenne3m };
}

/** Jointure exacte des observations : aucun report d'un taux du jour précédent. */
export function differenceDatesCommunes(gauche: MacroSeries, droite: MacroSeries, facteur = 1): MacroSeries {
  const parDate = new Map(droite.map((p) => [p.time, p.value]));
  return trierChrono(gauche).flatMap((p) => {
    const d = parDate.get(p.time);
    const value = d === undefined ? NaN : (p.value - d) * facteur;
    return Number.isFinite(value) ? [{ time: p.time, value }] : [];
  });
}
