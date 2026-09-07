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
export type FrequenceMacro = "M" | "Q";

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
export function finDePeriode(debutMs: number, frequence: FrequenceMacro): number {
  const d = new Date(debutMs);
  const moisSuivant = d.getUTCMonth() + (frequence === "Q" ? 3 : 1);
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
