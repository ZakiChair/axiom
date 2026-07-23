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
