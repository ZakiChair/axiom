/**
 * Term structure IV — IV ATM et RR25 par échéance (fonctions PURES) — 4e vue d'OMON.
 *
 * POURQUOI : la vue smile ne montre qu'UNE échéance à la fois. La term structure donne la
 * lecture transversale : comment l'IV ATM et le skew 25Δ évoluent d'une échéance à l'autre
 * (contango/backwardation d'IV), sans nouveau fetch.
 *
 * MODÈLE : généralisation multi-échéances des agrégations déjà en place —
 *   - regroupement par échéance : même logique qu'`echeancesDispo`/`construireGrilleOi` ;
 *   - RR25 par échéance : délégué à `calculerSkew25d` (skew.ts), pas de recopie.
 *
 * ZÉRO fetch : consomme la `chain` (`OptionPoint[]`) déjà pollée 60 s par OMON. `nowMs` est
 * injecté par l'appelant (convention du dépôt — jamais `Date.now()` dans la logique testée).
 */
import type { OptionPoint } from "./deribit";
import { calculerSkew25d } from "./skew";

/** Un point de la term structure IV : ATM + RR25 d'une échéance. */
export interface PointTermIv {
  expiryMs: number;
  /** IV ATM (%) — moyenne call/put du strike le plus proche du spot, ou le seul côté dispo. */
  ivAtm: number;
  /** RR25 (points d'IV) délégué à `calculerSkew25d` ; null si non calculable. */
  rr25: number | null;
  /** Nombre de strikes distincts de l'échéance (profondeur de la chaîne). */
  nbStrikes: number;
}

/**
 * Term structure IV : un point par échéance future, triés croissant. Fonction PURE.
 * Le strike ATM est celui dont la distance au spot est minimale (pas d'interpolation, même
 * convention que skew.ts) ; son IV est la moyenne call/put si les deux existent, sinon le seul
 * côté disponible. Une échéance dont l'ATM n'a aucune IV finie (des deux côtés) est OMISE.
 */
export function termStructureIv(chain: OptionPoint[], spot: number, nowMs: number): PointTermIv[] {
  if (!Number.isFinite(spot)) return [];

  const parEcheance = new Map<number, OptionPoint[]>();
  for (const p of chain) {
    if (p.expiryMs <= nowMs) continue;
    const arr = parEcheance.get(p.expiryMs);
    if (arr) arr.push(p);
    else parEcheance.set(p.expiryMs, [p]);
  }
  const echeances = [...parEcheance.keys()].sort((a, b) => a - b);

  const out: PointTermIv[] = [];
  for (const exp of echeances) {
    const points = parEcheance.get(exp) ?? [];

    // Strike ATM : distance minimale au spot (strike RÉEL, pas d'interpolation).
    let strikeAtm: number | null = null;
    let ecartMin = Infinity;
    const strikesSet = new Set<number>();
    for (const p of points) {
      strikesSet.add(p.strike);
      const ecart = Math.abs(p.strike - spot);
      if (ecart < ecartMin) {
        ecartMin = ecart;
        strikeAtm = p.strike;
      }
    }
    if (strikeAtm === null) continue;

    // IV à l'ATM : moyenne call/put si les deux existent (finies), sinon le seul côté fini.
    let ivCall = NaN;
    let ivPut = NaN;
    for (const p of points) {
      if (p.strike !== strikeAtm) continue;
      if (!Number.isFinite(p.markIv)) continue;
      if (p.type === "call") ivCall = p.markIv;
      else ivPut = p.markIv;
    }
    let ivAtm: number;
    if (Number.isFinite(ivCall) && Number.isFinite(ivPut)) ivAtm = (ivCall + ivPut) / 2;
    else if (Number.isFinite(ivCall)) ivAtm = ivCall;
    else if (Number.isFinite(ivPut)) ivAtm = ivPut;
    else continue; // aucune IV finie à l'ATM → point omis.

    const skew = calculerSkew25d(points, spot, nowMs);
    out.push({ expiryMs: exp, ivAtm, rr25: skew?.rr25 ?? null, nbStrikes: strikesSet.size });
  }

  return out;
}
