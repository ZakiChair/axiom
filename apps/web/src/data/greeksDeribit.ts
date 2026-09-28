/** Greeks des options inverses Deribit, selon « Inverse Options » (Deribit).
 * X = index, F = forward propre à l’échéance, r implicite = ln(F/X)/T.
 * Le profil simulé garde F/X constant ; le taux API ne remplace pas cette base.
 */
import { bsGreeks, normCdf, normPdf, type BsGreeks } from "./blackScholes";

const MS_PAR_AN = 365 * 86_400_000;

export interface OptionCryptoModele {
  strike: number;
  markIv: number;
  interestRate: number;
  expiryMs: number;
  underlying?: number;
  indexPrice?: number;
}

/** Sans données enrichies, conserve le contrat historique des fonctions pures BS(S,r). */
export function greeksOptionCrypto(p: OptionCryptoModele, spot: number, nowMs: number): BsGreeks | null {
  const t = (p.expiryMs - nowMs) / MS_PAR_AN;
  const sigma = p.markIv / 100;
  if (![spot, p.strike, t, sigma].every((v) => Number.isFinite(v) && v > 0)) return null;
  if (p.underlying === undefined && p.indexPrice === undefined) {
    const greeks = bsGreeks(spot, p.strike, t, sigma, p.interestRate);
    return Number.isFinite(greeks.gamma) && Number.isFinite(greeks.deltaCall) ? greeks : null;
  }
  const forward = p.underlying;
  const index = p.indexPrice;
  if (forward === undefined || index === undefined || !Number.isFinite(forward) || forward <= 0 || !Number.isFinite(index) || index <= 0) return null;
  const volT = sigma * Math.sqrt(t);
  const forwardSimule = forward * (spot / index);
  const d1 = (Math.log(forwardSimule / p.strike) + sigma * sigma * t / 2) / volT;
  const deltaCall = normCdf(d1);
  const gamma = normPdf(d1) / (spot * volT);
  if (!Number.isFinite(gamma) || !Number.isFinite(deltaCall)) return null;
  return { d1, d2: d1 - volT, deltaCall, deltaPut: deltaCall - 1, gamma };
}

/** Même univers pour les expositions et la couverture affichée (OI absent ≠ zéro). */
export function estOptionCryptoExploitable(p: OptionCryptoModele & { openInterest: number }, spot: number, nowMs: number): boolean {
  return Number.isFinite(p.openInterest) && p.openInterest >= 0 && greeksOptionCrypto(p, spot, nowMs) !== null;
}
