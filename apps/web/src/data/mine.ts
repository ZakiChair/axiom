/**
 * MINE — économie du minage BTC : calculs PURS séparés de l'I/O (spec lot v1.8, §1).
 *
 * Modèle PARAMÉTRIQUE (parc moyen supposé), pas une mesure : le plancher électrique et
 * le coût all-in dépendent d'hypothèses d'efficacité / prix de l'électricité réglables.
 * Toutes les fonctions sont NaN-safe (toute entrée non finie, ou un diviseur nul, →
 * NaN ; l'UI affiche « — »). Repères externes (Capriole, mars 2026) : plancher élec
 * 46,4 k$ / all-in 58 k$ (soit un multiplicateur ≈ 1,25).
 *
 * NB honnêteté : aux défauts (30 J/TH), le modèle rend un plancher ~64,8 k$/BTC (formule
 * dimensionnellement juste), au-dessus du repère Capriole — Capriole implique une
 * efficacité EFFECTIVE de parc ~21,5 J/TH. Le curseur d'efficacité laisse l'utilisateur
 * ajuster ; la note d'honnêteté de la fenêtre l'explicite.
 */

/** Paramètres réglables du modèle (persistés `axiom:mine:v1`, défauts affichés comme tels). */
export interface ParametresMine {
  /** Efficacité du parc en joules par térahash (J/TH). Défaut 30 (parc moyen). */
  efficaciteJParTh: number;
  /** Prix de l'électricité en $/kWh. Défaut 0,045. */
  prixKwhUsd: number;
  /** Multiplicateur all-in (élec → coût total : amortissement, opex…). Défaut 1,25. */
  multiplicateurAllIn: number;
}

/** Défauts de la spec (Capriole mars 2026 : 58 032 / 46 426 ≈ 1,25). */
export const PARAMS_MINE_DEFAUT: ParametresMine = {
  efficaciteJParTh: 30,
  prixKwhUsd: 0.045,
  multiplicateurAllIn: 1.25,
};

/** Nombre de blocs par jour à la cadence cible (~10 min/bloc). */
const BLOCS_PAR_JOUR = 144;

/** Coerce en nombre fini strictement positif, sinon NaN (garde de division). */
function finiPositif(x: number): number {
  return Number.isFinite(x) && x > 0 ? x : NaN;
}

/** Coerce en nombre fini, sinon NaN. */
function fini(x: number): number {
  return Number.isFinite(x) ? x : NaN;
}

/** Émission quotidienne de BTC = 144 × subsidy (post-halving 2024 : 3,125 → 450). PURE. */
export function emissionBtcParJour(subsidyBtc: number): number {
  return BLOCS_PAR_JOUR * fini(subsidyBtc);
}

/**
 * Coût électrique par BTC miné ($). PURE.
 *   puissance W = (hashrate H/s ÷ 1e12) × efficacité J/TH
 *   énergie kWh/j = W × 24 / 1000
 *   coût $/BTC = énergie × prixKwh ÷ émission quotidienne (BTC/j)
 * Émission nulle ou entrée non finie → NaN.
 */
export function coutElectriqueParBtc(
  hashrateHs: number,
  effJParTh: number,
  prixKwh: number,
  emissionJour: number,
): number {
  const h = fini(hashrateHs);
  const eff = fini(effJParTh);
  const p = fini(prixKwh);
  const emission = finiPositif(emissionJour);
  const puissanceW = (h / 1e12) * eff;
  const energieKwhJour = (puissanceW * 24) / 1000;
  return (energieKwhJour * p) / emission;
}

/** Coût all-in par BTC = plancher électrique × multiplicateur. PURE, NaN-safe. */
export function coutAllInParBtc(coutElectrique: number, multiplicateurAllIn: number): number {
  return fini(coutElectrique) * fini(multiplicateurAllIn);
}

/**
 * Hashprice ($/PH/j) = revenu quotidien du réseau par pétahash de puissance. PURE.
 *   144 × (subsidy + fees/bloc) × prixBtc ÷ (hashrate H/s ÷ 1e15)
 * Hashrate nul ou entrée non finie → NaN.
 */
export function hashpriceUsdParPhJour(
  prixBtc: number,
  subsidyBtc: number,
  feesBtcParBloc: number,
  hashrateHs: number,
): number {
  const prix = fini(prixBtc);
  const subsidy = fini(subsidyBtc);
  const fees = fini(feesBtcParBloc);
  const hashPh = finiPositif(hashrateHs) / 1e15;
  const revenuJour = BLOCS_PAR_JOUR * (subsidy + fees) * prix;
  return revenuJour / finiPositif(hashPh);
}

/** Ratio prix / coût (NaN-safe : coût nul ou entrée non finie → NaN). PURE. */
export function ratioPrixCout(prixBtc: number, cout: number): number {
  return fini(prixBtc) / finiPositif(cout);
}
