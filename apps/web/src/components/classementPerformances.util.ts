/**
 * Classement des actifs les plus performants (onglet « Classement » de MAP, à la manière de
 * l'accueil CoinGlass) — calculs PURS sur les tuiles CoinGecko déjà chargées par la vue marché
 * (aucune requête supplémentaire). Un actif sans variation connue sur la période sort du
 * classement : jamais de 0 inventé.
 */
import type { CoinTile } from "../data/marketOverview";

export type PeriodeClassement = "1h" | "24h" | "7j" | "30j";
export type SensClassement = "hausses" | "baisses";

export const PERIODES_CLASSEMENT: ReadonlyArray<{ id: PeriodeClassement; label: string }> = [
  { id: "1h", label: "1 h" },
  { id: "24h", label: "24 h" },
  { id: "7j", label: "7 j" },
  { id: "30j", label: "30 j" },
];

export interface OptionsClassement {
  periode: PeriodeClassement;
  sens: SensClassement;
  /** Nombre de premiers actifs par capitalisation mis en concurrence. */
  univers: number;
  sansStables: boolean;
}

export interface LigneClassement extends CoinTile {
  /** Rang dans le classement de performance. */
  rang: number;
  /** Rang par capitalisation. */
  rangCap: number;
}

/** Stablecoins et équivalents trésorerie courants (les jetons or, eux, suivent l'or). */
const STABLES = new Set([
  "USDT", "USDC", "DAI", "FDUSD", "TUSD", "USDE", "USDS", "PYUSD", "USD1", "USDD", "FRAX", "GUSD", "USDP",
  "LUSD", "BUSD", "RLUSD", "USDG", "USD0", "EURC", "EURS", "SUSDE", "SUSDS", "USDY", "USDTB", "BFUSD", "USDF",
  "CRVUSD", "GHO", "DOLA", "USDL", "USDB", "USDX", "USDO", "BUIDL", "USYC", "OUSG",
]);

/** Stablecoin : liste connue, ou prix ancré à 1 $ sans mouvement sur 24 h et 7 j. */
export function estStablecoin(c: CoinTile): boolean {
  if (STABLES.has(c.symbol)) return true;
  const calme = (v: number | null) => v !== null && Math.abs(v) < 0.5;
  return Math.abs(c.price - 1) < 0.02 && calme(c.changePct24h) && calme(c.changePct7j);
}

/** Variation (%) de la période ; null si CoinGecko ne la fournit pas. */
export function valeurPeriode(c: CoinTile, periode: PeriodeClassement): number | null {
  const v = periode === "1h" ? c.changePct1h : periode === "24h" ? c.changePct24h : periode === "7j" ? c.changePct7j : c.changePct30j;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Classement : univers par capitalisation, stablecoins écartés au besoin, tri par variation. */
export function classerPerformances(coins: readonly CoinTile[], o: OptionsClassement): LigneClassement[] {
  const parCap = [...coins].sort((a, b) => b.mcapUsd - a.mcapUsd);
  const sens = o.sens === "hausses" ? 1 : -1; // hausses : décroissant ; baisses : croissant
  return parCap
    .slice(0, o.univers)
    .map((c, i) => ({ ...c, rang: 0, rangCap: i + 1 }))
    .filter((c) => valeurPeriode(c, o.periode) !== null && !(o.sansStables && estStablecoin(c)))
    .sort((a, b) => sens * (valeurPeriode(b, o.periode)! - valeurPeriode(a, o.periode)!))
    .map((c, i) => ({ ...c, rang: i + 1 }));
}

/** Nombre d'actifs en hausse / en baisse et variation médiane sur la période. */
export function resumePerformances(lignes: readonly CoinTile[], periode: PeriodeClassement): { hausses: number; baisses: number; mediane: number | null } {
  const v = lignes.map((l) => valeurPeriode(l, periode)).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const m = v.length >> 1;
  return {
    hausses: v.filter((x) => x > 0).length,
    baisses: v.filter((x) => x < 0).length,
    mediane: v.length === 0 ? null : v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2,
  };
}
