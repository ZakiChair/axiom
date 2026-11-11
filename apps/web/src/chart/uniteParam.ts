/**
 * Paramètre réservé « unité » d'une instance d'indicateur (SUG-1, phase 1 : graphe seul).
 *
 * `params.unite` nomme l'unité SUPÉRIEURE sur laquelle le graphe calcule l'instance (EMA 1d
 * sur un graphe 1h) avant de projeter chaque valeur à la clôture de sa bougie. La clé vit
 * dans `IndicatorInstance.params`, ouvert (`@axiom/types` reste figé) : aucun def ne déclare
 * d'input `unite`, et `resolveParams` laisse passer la clé sans que `calc` la lise.
 *
 * Ce module reste SANS dépendance : il est sur le chemin de chargement initial (légendes,
 * runtime des alertes). Le contrôle d'éligibilité (`uniteSuperieure.ts`) et le chargement
 * des bougies (`bougiesUnite.ts`) sont chargés à la demande.
 *
 * Phase 1 : les alertes et le backtest calculent sur leurs propres bougies. Un `unite`
 * importé tel quel y serait ignoré en silence (calcul sur la mauvaise unité) : il y est
 * refusé avec motif (`uniteImbriquee` + `motifUniteHorsGraphe`).
 */

/** Clé réservée dans `params`. */
export const CLE_UNITE = "unite";

type Params = Readonly<Record<string, number | boolean | string>>;

/** Unité demandée par une instance, ou `null` (calcul sur l'unité du graphe). */
export function uniteDemandee(params: Params): string | null {
  const v = params[CLE_UNITE];
  return typeof v === "string" && v !== "" ? v : null;
}

/** Suffixe du libellé de légende : « [4h] », ou "" sans unité. */
export function suffixeUnite(params: Params): string {
  const unite = uniteDemandee(params);
  return unite === null ? "" : ` [${unite}]`;
}

/**
 * Première unité posée dans un `params` imbriqué (conditions d'alerte, composites, règles
 * du backtest), ou `null`. Toute valeur présente compte, même vide : elle ne serait pas
 * appliquée hors du graphe. Profondeur bornée (les structures réelles ont 3 niveaux).
 */
export function uniteImbriquee(valeur: unknown, profondeur = 0): string | null {
  if (profondeur > 8 || typeof valeur !== "object" || valeur === null) return null;
  const enfants = Array.isArray(valeur) ? valeur : Object.values(valeur);
  if (!Array.isArray(valeur)) {
    const params = (valeur as { params?: unknown }).params;
    if (typeof params === "object" && params !== null) {
      const unite = (params as Record<string, unknown>)[CLE_UNITE];
      if (unite !== undefined) return String(unite);
    }
  }
  for (const enfant of enfants) {
    const unite = uniteImbriquee(enfant, profondeur + 1);
    if (unite !== null) return unite;
  }
  return null;
}

/** Motif du refus hors du graphe, affiché ou journalisé tel quel. */
export function motifUniteHorsGraphe(unite: string, cible: "alerte" | "backtest"): string {
  const qui = cible === "alerte" ? "l'alerte" : "le backtest";
  return `Paramètre « unité » [${unite}] réservé au graphe : ${qui} calculerait sur ses propres bougies, sans unité supérieure. Retire ce paramètre.`;
}
