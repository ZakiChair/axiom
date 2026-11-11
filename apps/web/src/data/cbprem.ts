/**
 * Premium Coinbase/Binance (CBPREM) — logique PURE, testable hors navigateur.
 *
 * POURQUOI : le gap % entre le spot Coinbase et le spot Binance est un proxy de
 * la demande institutionnelle US (Coinbase = plateforme dominante côté US) —
 * premium positif = Coinbase paie plus cher (demande US) ; négatif = décote.
 * NB : Coinbase cote en USD, Binance en USDT — le signal BRUT (`serieCbprem`) est donc
 * USD vs USDT et inclut l'écart de peg USDT (pas un pur écart Coinbase/Binance en devise
 * identique). `serieCbpremAjustee` neutralise ce peg avec un taux USDT/USD de référence
 * (doc 02 § B7) ; le store expose les deux et affiche l'ajustée par défaut.
 * Aucun fetch ici : les effets réseau vivent dans store/cbprem.ts (Task 2).
 */

const JOUR_MS = 24 * 3_600_000;
const FENETRE_7J_MS = 7 * JOUR_MS;
/**
 * Fenêtre des statistiques GLISSANTES (bandes ±2σ, z) : 168 h, soit 7 jours de bougies 1h
 * (même durée que « Moy 7j », bornes (t − 7 j, t] ici contre [t − 7 j, t] pour la moyenne).
 * Chaque point n'est jugé qu'avec son passé et lui-même, jamais avec la suite de la série.
 */
export const FENETRE_Z_MS = FENETRE_7J_MS;
/** Nombre minimal de points DANS la fenêtre pour qu'un z-score soit porteur de sens. */
export const MIN_POINTS_Z = 30;

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
 * Variante de `serieCbprem` NEUTRALISANT le peg USDT (doc 02 § B7) : la jambe Binance
 * (cotée USDT) est convertie en USD par le taux de référence k = close USDT/USD au même
 * openTime, avant le calcul du premium. Pour chaque openTime commun aux TROIS séries :
 *   premium = (cb − bn × k) / (bn × k) × 100.
 * Dénominateur bn × k (les DEUX jambes en USD) plutôt que bn seul comme dans la formule
 * B7 : les deux résultats diffèrent d'un facteur k exactement (nôtre = B7 / k), soit un
 * écart relatif 1/k − 1 SUR LA VALEUR DU PREMIUM (~0,1 % du premium pour k = 0,999 ;
 * ~0,08 % pour le 0,99924 observé le 2026-09-16) —
 * négligeable ; notre forme est un vrai écart relatif en USD, homogène avec `serieCbprem`
 * (avec k = 1 partout la sortie lui est identique). Gardes de `serieCbprem` (cb/bn finis,
 * bn > 0) PLUS : point OMIS si k manque à ce t, n'est pas fini, ou est ≤ 0 — jamais
 * d'interpolation. Sortie triée par t croissant. PURE.
 */
export function serieCbpremAjustee(
  klinesCb: readonly { t: number; close: number }[],
  klinesBn: readonly { t: number; close: number }[],
  klinesUsdt: readonly { t: number; close: number }[],
): PointPremium[] {
  const bnParT = new Map<number, number>();
  for (const k of klinesBn) bnParT.set(k.t, k.close);
  const usdtParT = new Map<number, number>();
  for (const k of klinesUsdt) usdtParT.set(k.t, k.close);

  const out: PointPremium[] = [];
  for (const cb of klinesCb) {
    const bnClose = bnParT.get(cb.t);
    const k = usdtParT.get(cb.t);
    if (bnClose === undefined || k === undefined) continue;
    if (!Number.isFinite(cb.close) || !Number.isFinite(bnClose) || bnClose <= 0) continue;
    if (!Number.isFinite(k) || k <= 0) continue;
    const bnUsd = bnClose * k;
    out.push({ t: cb.t, premiumPct: ((cb.close - bnUsd) / bnUsd) * 100 });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/**
 * Écart de peg USDT/USD (en %) au DERNIER point de la série ajustée : `(k − 1) × 100`
 * avec k = close USDT/USD à ce même openTime (k = 0,99924 → −0,076 %). Null si la série
 * est vide ou si aucune close USDT n'existe à ce t (entrées incohérentes : la série
 * ajustée n'a de point qu'aux t où k est valide). En cas d'openTime dupliqué, la DERNIÈRE
 * close l'emporte — même k que `serieCbpremAjustee` (Map.set), sinon l'écart affiché ne
 * correspondrait pas au premium tracé. Précondition : série triée chrono (garantie par
 * `serieCbpremAjustee`). PURE.
 */
export function ecartPegDernierPoint(
  serieAjustee: readonly PointPremium[],
  klinesUsdt: readonly { t: number; close: number }[],
): number | null {
  const dernier = serieAjustee[serieAjustee.length - 1];
  if (dernier === undefined) return null;
  let k: number | undefined;
  for (const u of klinesUsdt) {
    if (u.t === dernier.t) k = u.close; // pas de sortie anticipée : dernière occurrence retenue
  }
  return k === undefined ? null : (k - 1) * 100;
}

/**
 * Statistiques glissantes d'un point : moyenne et écart-type POPULATION du premium sur
 * la fenêtre causale de ce point, et nombre de points qui la composent.
 */
export interface BandeGlissante {
  moyenne: number;
  sigma: number;
  /** Points présents dans la fenêtre : 168 au plus en 1h, moins en début de série ou s'il y a des trous. */
  n: number;
}

/**
 * Bande CAUSALE au point d'indice `i` : moyenne et σ population des points j ≤ i tels que
 * t_j > t_i − 168 h, soit le passé des 7 derniers jours PLUS le point courant, jamais un
 * point postérieur. La fenêtre est temporelle : un trou (heure sans bougie Coinbase, point
 * omis faute de k) réduit `n` au lieu d'aller chercher plus loin dans le passé.
 * `null` (« indisponible ») si `i` est hors série, si la fenêtre compte moins de
 * MIN_POINTS_Z points (début de série, trous) ou si σ est nul (premium constant).
 * Les écarts sont pris par rapport au point courant puis recentrés (deux passes) : une
 * fenêtre constante donne un σ EXACTEMENT nul, sans résidu d'arrondi qui fabriquerait un
 * z géant. Précondition : série triée chrono (garantie par `serieCbprem`). PURE.
 */
export function bandeGlissante(serie: readonly PointPremium[], i: number): BandeGlissante | null {
  const courant = serie[i];
  if (courant === undefined) return null;
  const debutT = courant.t - FENETRE_Z_MS;
  const ref = courant.premiumPct;

  let debut = i + 1;
  let sommeEcarts = 0;
  for (let j = i; j >= 0; j--) {
    const p = serie[j] as PointPremium;
    if (p.t <= debutT) break; // série triée : tout ce qui précède est hors fenêtre
    sommeEcarts += p.premiumPct - ref;
    debut = j;
  }
  const n = i + 1 - debut;
  if (n < MIN_POINTS_Z) return null;

  const moyenneEcarts = sommeEcarts / n;
  let variance = 0;
  for (let j = debut; j <= i; j++) {
    variance += ((serie[j] as PointPremium).premiumPct - ref - moyenneEcarts) ** 2;
  }
  const sigma = Math.sqrt(variance / n);
  if (!(sigma > 0)) return null;
  return { moyenne: ref + moyenneEcarts, sigma, n };
}

/**
 * Bandes causales de TOUTE la série, point par point (même longueur, même ordre) : la
 * bande du point i ne dépend que des points 0..i, donc ajouter des points à la fin ne
 * modifie aucune bande déjà calculée (pas de repeinture). Support du tracé ±2σ et du z
 * de survol. `null` aux points indisponibles. PURE.
 */
export function bandesGlissantes(serie: readonly PointPremium[]): (BandeGlissante | null)[] {
  return serie.map((_, i) => bandeGlissante(serie, i));
}

/** z-score d'un premium `p` relatif à une bande (moyenne/σ population). PURE. */
export function zPoint(p: number, bande: { moyenne: number; sigma: number }): number {
  return (p - bande.moyenne) / bande.sigma;
}

/**
 * Stats dérivées de la série (déjà triée chrono — précondition garantie par
 * `serieCbprem`) : courant (dernier point), moyenne des 7 jours relatifs au
 * DERNIER point (pas « maintenant »), z glissant 7 j du courant contre SA bande causale
 * (`bandeGlissante` au dernier point, donc les mêmes conditions que le tracé : au moins
 * MIN_POINTS_Z points sur 168 h et σ non nul, sinon null). Tout est null si la série est
 * vide. PURE.
 */
export function statsPremium(
  serie: readonly PointPremium[],
): { courant: number | null; moyenne7j: number | null; zGlissant7j: number | null } {
  if (serie.length === 0) return { courant: null, moyenne7j: null, zGlissant7j: null };

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

  // Même bande que le tracé au dernier point : le z affiché coïncide avec celui du survol.
  const bande = bandeGlissante(serie, serie.length - 1);
  const zGlissant7j = bande === null ? null : zPoint(courant, bande);

  return { courant, moyenne7j, zGlissant7j };
}
