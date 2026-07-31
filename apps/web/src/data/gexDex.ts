/**
 * GEX / DEX — agrégation de l'exposition gamma / delta par strike (fonctions PURES).
 *
 * Convention retail standard (identique à l'implémentation open-source de référence
 * `jensolson/SPX-Gamma-Exposure` citée dans docs/research/04-…) :
 *
 *   GEX(strike) = (gamma_call·OI_call − gamma_put·OI_put) · S² · 0,01 · multiplicateur
 *   DEX(strike) = (delta_call·OI_call + delta_put·OI_put) · S       · multiplicateur
 *
 * où le delta_put est DÉJÀ signé négatif (parité N(d1)−1 côté BS, delta négatif côté CBOE),
 * et gamma est identique et positif pour calls et puts (le signe call/put est appliqué ici).
 *
 * Deux sources alimentent la même agrégation :
 *   - crypto (Deribit) : greeks calculés côté client par Black-Scholes, multiplicateur = 1 ;
 *   - indices actions (CBOE) : greeks PRÉ-calculés dans la réponse, multiplicateur = 100.
 *
 * Toutes les fonctions ici sont pures et testées (gexDex.test.ts).
 */
import { bsGreeks } from "./blackScholes";

/** Millisecondes dans une année (base 365 j — convention du dépôt). */
const MS_PAR_AN = 365 * 24 * 60 * 60 * 1000;

/** Une « jambe » d'option porteuse de greeks, prête à agréger (source-agnostique). */
export interface OptionGreekLeg {
  strike: number;
  type: "call" | "put";
  openInterest: number;
  /** Delta SIGNÉ : call ∈ [0, 1], put ∈ [−1, 0]. */
  delta: number;
  /** Gamma ≥ 0, identique calls/puts (le signe call/put est appliqué à l'agrégation). */
  gamma: number;
}

/** Exposition gamma / delta agrégée à un strike (en USD notionnels). */
export interface GexDexPoint {
  strike: number;
  /** Gamma exposure (USD par mouvement de 1 % du sous-jacent). */
  gex: number;
  /** Delta exposure (USD notionnels). */
  dex: number;
}

/**
 * Agrège GEX/DEX par strike à partir de jambes porteuses de greeks. Fonction PURE.
 * Ignore les jambes/valeurs non finies (dégradation gracieuse). Renvoie une liste triée
 * par strike croissant ; liste vide si le spot est invalide.
 */
export function aggregateGexDex(
  legs: OptionGreekLeg[],
  spot: number,
  contractMultiplier: number,
): GexDexPoint[] {
  if (!Number.isFinite(spot) || spot <= 0) return [];
  const parStrike = new Map<number, { gammaSigne: number; deltaSigne: number }>();
  for (const l of legs) {
    if (!Number.isFinite(l.strike) || l.strike <= 0) continue;
    const oi = Number.isFinite(l.openInterest) ? l.openInterest : 0;
    const g = Number.isFinite(l.gamma) ? l.gamma : 0;
    const d = Number.isFinite(l.delta) ? l.delta : 0;
    const cur = parStrike.get(l.strike) ?? { gammaSigne: 0, deltaSigne: 0 };
    cur.gammaSigne += (l.type === "call" ? g : -g) * oi; // gamma_call − gamma_put
    cur.deltaSigne += d * oi; // delta déjà signé (put négatif)
    parStrike.set(l.strike, cur);
  }
  const facteurGamma = spot * spot * 0.01 * contractMultiplier;
  const facteurDelta = spot * contractMultiplier;
  return [...parStrike.entries()]
    .map(([strike, v]) => ({
      strike,
      gex: v.gammaSigne * facteurGamma,
      dex: v.deltaSigne * facteurDelta,
    }))
    .sort((a, b) => a.strike - b.strike);
}

/** Input minimal d'une option crypto pour le calcul GEX/DEX (compatible OptionPoint). */
export interface CryptoOptionInput {
  strike: number;
  type: "call" | "put";
  /** Volatilité implicite mark en POURCENTAGE (Deribit renvoie déjà en %). */
  markIv: number;
  openInterest: number;
  /** Taux sans risque en fraction (Deribit `interest_rate`, ex. 0). */
  interestRate: number;
  /** Échéance (ms epoch). */
  expiryMs: number;
}

/**
 * GEX/DEX crypto (Deribit) : calcule delta/gamma par Black-Scholes puis agrège par strike.
 * Multiplicateur de contrat = 1 (les options BTC/ETH Deribit valent 1 sous-jacent chacune).
 * `nowMs` est injecté par l'appelant (fonction PURE — convention du dépôt). Les options déjà
 * expirées (T ≤ 0) ou à IV invalide produisent des greeks NaN et sont ignorées à l'agrégation.
 */
export function computeCryptoGexDex(
  points: CryptoOptionInput[],
  spot: number,
  nowMs: number,
): GexDexPoint[] {
  const legs: OptionGreekLeg[] = points.map((p) => {
    const t = (p.expiryMs - nowMs) / MS_PAR_AN;
    const g = bsGreeks(spot, p.strike, t, p.markIv / 100, p.interestRate);
    return {
      strike: p.strike,
      type: p.type,
      openInterest: p.openInterest,
      delta: p.type === "call" ? g.deltaCall : g.deltaPut,
      gamma: g.gamma,
    };
  });
  return aggregateGexDex(legs, spot, 1);
}

/**
 * GEX/DEX crypto agrégé sur TOUTES les échéances de la chaîne. Fonction PURE.
 * Délègue à `computeCryptoGexDex` échéance par échéance (chaque échéance a son propre T,
 * donc ses propres greeks Black-Scholes) puis fusionne par strike en SOMMANT gex et dex —
 * même convention que `computeCryptoGexDex`, sans en recopier la formule.
 * Renvoie une liste triée par strike croissant ; liste vide si le spot est invalide.
 */
export function gexParStrikeToutesEcheances(
  chain: CryptoOptionInput[],
  spot: number,
  nowMs: number,
): GexDexPoint[] {
  if (!Number.isFinite(spot) || spot <= 0) return [];
  // Regroupe les points par échéance (chaque groupe → un appel délégué).
  const parEcheance = new Map<number, CryptoOptionInput[]>();
  for (const p of chain) {
    const grp = parEcheance.get(p.expiryMs);
    if (grp) grp.push(p);
    else parEcheance.set(p.expiryMs, [p]);
  }
  // Fusionne par strike en sommant les contributions de chaque échéance.
  const parStrike = new Map<number, { gex: number; dex: number }>();
  for (const points of parEcheance.values()) {
    for (const pt of computeCryptoGexDex(points, spot, nowMs)) {
      const cur = parStrike.get(pt.strike) ?? { gex: 0, dex: 0 };
      cur.gex += pt.gex;
      cur.dex += pt.dex;
      parStrike.set(pt.strike, cur);
    }
  }
  return [...parStrike.entries()]
    .map(([strike, v]) => ({ strike, gex: v.gex, dex: v.dex }))
    .sort((a, b) => a.strike - b.strike);
}

/**
 * Niveau de « gamma flip » : le strike où le GEX cumulé (strikes parcourus en ordre croissant)
 * change de signe, obtenu par interpolation linéaire entre les deux strikes encadrants.
 * Renvoie le PREMIER passage si le cumul change de signe plusieurs fois, `null` si aucun
 * changement de signe (ou moins de deux strikes). Fonction PURE.
 */
export function gammaFlip(gexParStrike: { strike: number; gex: number }[]): number | null {
  // Copie triée par strike croissant (l'entrée n'est pas garantie triée par le type).
  const tri = [...gexParStrike].sort((a, b) => a.strike - b.strike);
  let cumPrec = 0; // cumul jusqu'au strike i−1
  for (let i = 0; i < tri.length; i++) {
    const cum = cumPrec + tri[i]!.gex;
    // Changement de signe strict entre deux cumuls consécutifs (i ≥ 1).
    if (i > 0 && cumPrec * cum < 0) {
      const s0 = tri[i - 1]!.strike;
      const s1 = tri[i]!.strike;
      // Point où le cumul linéaire s'annule entre (s0, cumPrec) et (s1, cum).
      return s0 + (-cumPrec / (cum - cumPrec)) * (s1 - s0);
    }
    cumPrec = cum;
  }
  return null;
}

/** Multiplicateur standard d'une option sur indice actions (1 contrat = 100 sous-jacents). */
export const EQUITY_CONTRACT_MULTIPLIER = 100;

// ─────────────────────────── Verdict market maker (gamma) ───────────────────────────

/**
 * Seuil relatif d'indétermination du verdict gamma : le GEX net est jugé trop faible pour
 * trancher quand |gexNet| < 2 % de Σ|GEX| par strike — le net est alors un résidu marginal
 * des expositions brutes, dont le signe peut basculer au moindre flux. Constante documentée
 * ici (unique) pour que tests et UI partagent la même valeur.
 */
export const SEUIL_INDETERMINATION_GEX = 0.02;

/** Régime gamma des dealers (convention retail : dealers long les calls, short les puts). */
export type RegimeGamma = "long-gamma" | "short-gamma" | "indetermine";

/** Verdict market maker dérivé du GEX net — régime + phrase d'action mécanique. */
export interface VerdictGamma {
  regime: RegimeGamma;
  /** Phrase d'action mécanique du dealer (ce qu'il FAIT pour rester delta-neutre). */
  action: string;
  /** Qualificatif court du régime de marché induit (« amorti » / « amplifié » / « neutre »). */
  qualificatif: string;
  /** Distance spot↔flip = (spot − flip)/spot × 100 (%), null si flip absent ou spot invalide. */
  distanceFlipPct: number | null;
}

/**
 * Verdict market maker (gamma). Fonction PURE.
 *
 * GEX net > 0 → dealers long gamma : pour rester delta-neutres ils VENDENT le sous-jacent
 * quand ça monte et l'ACHÈTENT quand ça baisse → mouvements amortis, aimantation vers les
 * murs. GEX net < 0 → short gamma : ils ACHÈTENT les hausses et VENDENT les baisses →
 * mouvements amplifiés (carburant de squeeze/cascade).
 *
 * « indetermine » quand |gexNet| < SEUIL_INDETERMINATION_GEX × sommeAbs, quand gexNet vaut 0,
 * ou quand gexNet n'est pas fini (dégradation gracieuse Number.isFinite — jamais d'exception).
 * Si `sommeAbs` n'est pas exploitable (non fini ou ≤ 0), le seuil relatif est ignoré et le
 * verdict retombe sur le seul signe du net. `flip` null → verdict fondé sur le seul signe du
 * net, distance null. La distance au flip est calculée indépendamment du régime.
 *
 * @param gexNet    GEX net (USD par 1 % de mouvement) sur le périmètre choisi par l'appelant.
 * @param spot      Spot du MÊME périmètre (sert uniquement à la distance au flip).
 * @param flip      Gamma flip (strike interpolé, cf. gammaFlip), ou null si aucun.
 * @param sommeAbs  Σ|GEX| par strike du même périmètre (échelle du seuil relatif).
 */
export function verdictGamma(
  gexNet: number,
  spot: number,
  flip: number | null,
  sommeAbs: number,
): VerdictGamma {
  const distanceFlipPct =
    flip !== null && Number.isFinite(flip) && Number.isFinite(spot) && spot > 0
      ? ((spot - flip) / spot) * 100
      : null;
  const sousSeuilRelatif =
    Number.isFinite(sommeAbs) && sommeAbs > 0
      ? Math.abs(gexNet) < SEUIL_INDETERMINATION_GEX * sommeAbs
      : false;
  if (!Number.isFinite(gexNet) || gexNet === 0 || sousSeuilRelatif) {
    return {
      regime: "indetermine",
      action: "GEX net trop faible pour trancher — pas de pression dominante des dealers.",
      qualificatif: "neutre",
      distanceFlipPct,
    };
  }
  if (gexNet > 0) {
    return {
      regime: "long-gamma",
      action:
        "Les dealers vendent le sous-jacent quand ça monte, l'achètent quand ça baisse — mouvements amortis, aimantation vers les murs.",
      qualificatif: "amorti",
      distanceFlipPct,
    };
  }
  return {
    regime: "short-gamma",
    action:
      "Les dealers achètent les hausses, vendent les baisses — mouvements amplifiés (carburant de squeeze/cascade).",
    qualificatif: "amplifié",
    distanceFlipPct,
  };
}

/** Murs de gamma nommés sur un profil GEX par strike. */
export interface MursGamma {
  /** Strike du GEX POSITIF maximal (aimantation côté calls), null si aucun GEX > 0. */
  callWall: number | null;
  /** Strike du GEX NÉGATIF maximal en valeur absolue, null si aucun GEX < 0. */
  putWall: number | null;
}

/**
 * Call wall / put wall sur le profil GEX par strike fourni — toutes échéances côté crypto,
 * échéance sélectionnée côté actions : le choix du périmètre appartient à l'APPELANT.
 * Les valeurs non finies sont ignorées (convention Number.isFinite). Fonction PURE.
 */
export function mursGamma(points: { strike: number; gex: number }[]): MursGamma {
  let callWall: number | null = null;
  let putWall: number | null = null;
  let maxPos = 0; // GEX positif maximal rencontré (strictement > 0 pour compter).
  let maxNeg = 0; // GEX négatif maximal en valeur absolue (strictement < 0 pour compter).
  for (const p of points) {
    if (!Number.isFinite(p.strike) || !Number.isFinite(p.gex)) continue;
    if (p.gex > maxPos) {
      maxPos = p.gex;
      callWall = p.strike;
    }
    if (p.gex < maxNeg) {
      maxNeg = p.gex;
      putWall = p.strike;
    }
  }
  return { callWall, putWall };
}

// ─────────────────────────── Profil GEX(spot simulé) ───────────────────────────

/** Un point du profil GEX(S) : GEX net total recalculé au spot simulé. */
export interface PointProfilGex {
  spot: number;
  gexNet: number;
}

/** Profil GEX(S) complet + zéro du profil (« flip réel »). */
export interface ProfilGexSpot {
  /** Courbe [{spot, gexNet}] triée par spot croissant. */
  points: PointProfilGex[];
  /** Spot où le GEX net recalculé s'annule (interpolation linéaire, premier passage), null si aucun. */
  flipReel: number | null;
}

/**
 * Profil GEX(spot simulé) — crypto uniquement. Pour chaque spot de `spots`, le GEX net TOTAL
 * de la chaîne est recalculé par Black-Scholes au spot simulé, IV mark et échéance de chaque
 * instrument INCHANGÉES : T dérivé d'expiryMs et nowMs, markIv en % ÷ 100, OI en unités de
 * base, multiplicateur 1, GEX en USD via ×S²×0,01 — exactement la convention de
 * computeCryptoGexDex, à qui le calcul est DÉLÉGUÉ (chaque point y reçoit son propre T ;
 * la formule n'est pas recopiée) puis sommé par spot.
 *
 * Le « flip réel » est le zéro du profil : premier changement de signe STRICT entre deux
 * spots consécutifs, interpolé linéairement (même convention que gammaFlip, mais sur le
 * profil en spot — pas sur le cumul en strike). Null si le profil ne change jamais de signe
 * (chaîne vide → gexNet 0 partout → null aussi). Les spots non finis ou ≤ 0 sont ignorés,
 * l'entrée est triée par spot croissant. Fonction PURE (nowMs injecté, jamais Date.now()).
 */
export function profilGexSpot(
  chaine: CryptoOptionInput[],
  spots: number[],
  nowMs: number,
): ProfilGexSpot {
  const tri = spots.filter((s) => Number.isFinite(s) && s > 0).sort((a, b) => a - b);
  const points: PointProfilGex[] = tri.map((s) => ({
    spot: s,
    gexNet: computeCryptoGexDex(chaine, s, nowMs).reduce((somme, p) => somme + p.gex, 0),
  }));
  let flipReel: number | null = null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (a.gexNet * b.gexNet < 0) {
      // Point où le profil linéaire s'annule entre (spotA, gexA) et (spotB, gexB).
      flipReel = a.spot + (-a.gexNet / (b.gexNet - a.gexNet)) * (b.spot - a.spot);
      break;
    }
  }
  return { points, flipReel };
}
