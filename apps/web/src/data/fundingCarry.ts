/** Calcul pur du carry long spot / short perp linéaire, même quantité de base. */
export interface FraisCarry { spotEntree: number; perpEntree: number; spotSortie: number; perpSortie: number }
export interface EntreeCarry {
  symbol: "BTCUSDT" | "ETHUSDT"; base: "BTC" | "ETH"; quote: string; reglement: string;
  venue: "binance"; type: "linear" | "inverse"; quantite: number;
  /** VWAP exécutables d'entrée : achat spot ask, vente perp bid. */
  spotEntree: number; perpEntree: number;
  /** Hypothèses de sortie : spot et basis terminale, jamais cotation future observée. */
  spotSortie: number; basisSortie: number;
  /** Slippage de sortie hypothétique par jambe, en bps, sur les références projetées. */
  slippageSortieSpotBps: number; slippageSortiePerpBps: number;
  frais: FraisCarry;
  /** Fraction décimale signée par règlement (0,0001 = 0,01 %). */
  tauxFunding: number; notionnelReglement: number; cadenceHeures: number;
  /** Convention de détention (entrée, sortie], timestamps de règlements futurs supposés. */
  entreeTs: number; prochainReglementTs: number; horizonJours: 1 | 7 | 30;
  executionNonIncluse: number; financement: number;
  provenance: "live" | "hypothese";
}
export type ResultatCarry = { statut: "indisponible"; raison: string } | {
  statut: "ok"; devise: "USDT"; quantite: number; prix: number; basisEntree: number; basisSortie: number;
  frais: number; slippageSortie: number; funding: number; fundingNul: number; fundingInverse: number; financement: number; executionNonIncluse: number;
  net: number; rendementSpotPct: number; seuilFunding: number | null; reglements: number;
  spotSortie: number; perpSortie: number; spotSortieReference: number; perpSortieReference: number; provenance: "live" | "hypothese";
};
export function calculerCarryNet(e: EntreeCarry): ResultatCarry {
  const refus = (raison: string): ResultatCarry => ({ statut: "indisponible", raison });
  if (!(["BTCUSDT", "ETHUSDT"] as string[]).includes(e.symbol) || e.symbol !== `${e.base}USDT` || e.quote !== "USDT" || e.reglement !== "USDT" || e.venue !== "binance" || e.type !== "linear") return refus("identité spot/perp incompatible");
  const valeurs = [e.quantite, e.spotEntree, e.perpEntree, e.spotSortie, e.cadenceHeures, e.notionnelReglement];
  if (valeurs.some((v) => !Number.isFinite(v) || v <= 0) || ![e.basisSortie, e.tauxFunding, e.entreeTs, e.executionNonIncluse, e.financement].every(Number.isFinite)) return refus("quantité, prix ou hypothèse invalide");
  if (![1, 7, 30].includes(e.horizonJours) || e.cadenceHeures > 24 || e.executionNonIncluse < 0 || e.financement < 0 || !Number.isFinite(e.prochainReglementTs) || e.prochainReglementTs <= e.entreeTs || ![e.slippageSortieSpotBps, e.slippageSortiePerpBps].every((v) => Number.isFinite(v) && v >= 0 && v < 10_000)) return refus("horizon, cadence ou slippage invalide");
  const tarifs = [e.frais.spotEntree, e.frais.perpEntree, e.frais.spotSortie, e.frais.perpSortie];
  if (tarifs.some((v) => !Number.isFinite(v) || v < 0 || v >= 1)) return refus("quatre frais requis");
  const perpSortieReference = e.spotSortie + e.basisSortie;
  const spotSortie = e.spotSortie * (1 - e.slippageSortieSpotBps / 10_000);
  const perpSortie = perpSortieReference * (1 + e.slippageSortiePerpBps / 10_000);
  if (!(perpSortieReference > 0 && spotSortie > 0 && perpSortie > 0) || ![perpSortieReference, spotSortie, perpSortie].every(Number.isFinite)) return refus("prix final invalide");
  const cadenceMs = e.cadenceHeures * 3_600_000;
  const sortieTs = e.entreeTs + e.horizonJours * 86_400_000;
  const reglements = e.prochainReglementTs > sortieTs ? 0 : 1 + Math.floor((sortieTs - e.prochainReglementTs) / cadenceMs);
  const prix = e.quantite * ((spotSortie - e.spotEntree) + (e.perpEntree - perpSortie));
  const slippageSortie = e.quantite * ((e.spotSortie - spotSortie) + (perpSortie - perpSortieReference));
  const frais = e.quantite * (e.spotEntree * e.frais.spotEntree + e.perpEntree * e.frais.perpEntree + spotSortie * e.frais.spotSortie + perpSortie * e.frais.perpSortie);
  const funding = reglements * e.notionnelReglement * e.tauxFunding;
  const horsFunding = prix - frais - e.executionNonIncluse - e.financement;
  const net = horsFunding + funding;
  const rendementSpotPct = net / (e.quantite * e.spotEntree) * 100;
  const seuilFunding = reglements > 0 ? -horsFunding / (reglements * e.notionnelReglement) : null;
  if (![prix, frais, slippageSortie, funding, horsFunding, net, rendementSpotPct, seuilFunding ?? 0].every(Number.isFinite)) return refus("résultat non fini");
  return { statut: "ok", devise: "USDT", quantite: e.quantite, prix, basisEntree: e.perpEntree - e.spotEntree, basisSortie: e.basisSortie,
    frais, slippageSortie, funding, fundingNul: horsFunding, fundingInverse: horsFunding - funding, financement: e.financement, executionNonIncluse: e.executionNonIncluse,
    net, rendementSpotPct, seuilFunding, reglements, spotSortie, perpSortie, spotSortieReference: e.spotSortie, perpSortieReference, provenance: e.provenance };
}
