/**
 * @axiom/alerts — comparer.ts
 *
 * Comparaison d'une valeur à un seuil. Module à part, sans dépendance : le moteur
 * (engine.ts) et les libellés (libelles.ts) la lisent tous deux, et le moteur importe
 * les libellés. PURE.
 */
import type { Comparateur } from "./types";

/** Comparaison d'une valeur à un seuil selon un comparateur. */
export function comparer(v: number, op: Comparateur, seuil: number): boolean {
  switch (op) {
    case ">":
      return v > seuil;
    case ">=":
      return v >= seuil;
    case "<":
      return v < seuil;
    case "<=":
      return v <= seuil;
  }
}
