/**
 * Premium Coinbase/Binance (CBPREM) — logique PURE, testable hors navigateur.
 *
 * POURQUOI : le gap % entre le spot Coinbase et le spot Binance est un proxy de
 * la demande institutionnelle US (Coinbase = plateforme dominante côté US) —
 * premium positif = Coinbase paie plus cher (demande US) ; négatif = décote.
 * NB : Coinbase cote en USD, Binance en USDT — le signal est donc USD vs USDT et
 * inclut l'écart de peg USDT (pas un pur écart Coinbase/Binance en devise identique).
 * Aucun fetch ici : les effets réseau vivent dans store/cbprem.ts (Task 2).
 */

const JOUR_MS = 24 * 3_600_000;
const FENETRE_7J_MS = 7 * JOUR_MS;
/** Nombre minimal de points pour qu'un z-score soit statistiquement porteur de sens. */
const MIN_POINTS_Z = 30;

export interface PointPremium {
  t: number;
  premiumPct: number;
}

/**
 * Aligne deux séries de klines (Coinbase, Binance) par openTime EXACT (Map côté
 * Binance) et calcule le premium signé `(cb − bn) / bn × 100` pour chaque openTime
 * commun. Un point sans contrepartie est OMIS (pas d'interpolation). Un point est
 * aussi omis si une des deux closes n'est pas finie (NaN/Infinity) ou si bn <= 0
 * (division invalide) — NB: la fraîcheur/clôture des bougies (candle `closed`) est
 * hors périmètre de cette fonction, gérée en amont par l'appelant (store/cbprem.ts).
 * Sortie triée par t croissant, indépendamment de l'ordre des entrées. PURE.
 */
export function serieCbprem(
  klinesCb: readonly { t: number; close: number }[],
  klinesBn: readonly { t: number; close: number }[],
): PointPremium[] {
  const bnParT = new Map<number, number>();
  for (const k of klinesBn) bnParT.set(k.t, k.close);

  const out: PointPremium[] = [];
  for (const cb of klinesCb) {
    const bnClose = bnParT.get(cb.t);
    if (bnClose === undefined) continue;
    if (!Number.isFinite(cb.close) || !Number.isFinite(bnClose) || bnClose <= 0) continue;
    out.push({ t: cb.t, premiumPct: ((cb.close - bnClose) / bnClose) * 100 });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/**
 * Moyenne et écart-type POPULATION du premium sur TOUTE la série — support des
 * bandes ±2σ du tracé et du z-score. `null` si moins de 30 points (z non porteur
 * de sens) ou si σ == 0 (série constante : bandes dégénérées, z indéfini). PURE.
 */
export function bandesPremium(
  serie: readonly PointPremium[],
): { moyenne: number; sigma: number } | null {
  if (serie.length < MIN_POINTS_Z) return null;
  let somme = 0;
  for (const p of serie) somme += p.premiumPct;
  const moyenne = somme / serie.length;
  let variance = 0;
  for (const p of serie) variance += (p.premiumPct - moyenne) ** 2;
  const sigma = Math.sqrt(variance / serie.length);
  if (sigma === 0) return null;
  return { moyenne, sigma };
}

/** z-score d'un premium `p` relatif aux bandes (moyenne/σ population). PURE. */
export function zPoint(p: number, bandes: { moyenne: number; sigma: number }): number {
  return (p - bandes.moyenne) / bandes.sigma;
}

/**
 * Stats dérivées de la série (déjà triée chrono — précondition garantie par
 * `serieCbprem`) : courant (dernier point), moyenne des 7 jours relatifs au
 * DERNIER point (pas « maintenant »), z-score du courant vs TOUTE la série
 * (écart-type population). z30j est null si la série a moins de 30 points ou si
 * l'écart-type est nul (série constante). Tout est null si la série est vide. PURE.
 */
export function statsPremium(
  serie: readonly PointPremium[],
): { courant: number | null; moyenne7j: number | null; z30j: number | null } {
  if (serie.length === 0) return { courant: null, moyenne7j: null, z30j: null };

  const dernier = serie[serie.length - 1] as PointPremium;
  const courant = dernier.premiumPct;

  const seuilT = dernier.t - FENETRE_7J_MS;
  let somme7 = 0;
  let n7 = 0;
  for (const p of serie) {
    if (p.t >= seuilT) {
      somme7 += p.premiumPct;
      n7++;
    }
  }
  const moyenne7j = n7 > 0 ? somme7 / n7 : null;

  // z30j réutilise les mêmes bandes que le tracé (mêmes conditions : ≥30 pts, σ≠0).
  const bandes = bandesPremium(serie);
  const z30j = bandes === null ? null : zPoint(courant, bandes);

  return { courant, moyenne7j, z30j };
}
