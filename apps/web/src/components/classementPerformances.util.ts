/**
 * Classement des actifs les plus performants (onglet « Classement » de MAP, à la manière de
 * l'accueil CoinGlass) — calculs PURS sur les tuiles CoinGecko déjà chargées par la vue marché
 * (aucune requête supplémentaire). Un actif sans variation connue sur la période sort du
 * classement : jamais de 0 inventé.
 */
import type { ExchangeId } from "@axiom/types";
import type { CoinTile } from "../data/marketOverview";
import { formatPrice } from "../lib/format";

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
  // Ancrages non USD et jetons de trésorerie à rendement (relevé CoinGecko du 26/09/2026).
  "EURCV", "A7A5", "JPYSC", "EUTBL", "USTB", "USTBL", "JTRSY", "JAAA", "SAFO", "EURSAFO", "REUSD",
  "APXUSD", "APYUSD", "SDAI", "SYRUPUSDC", "YLDS", "USX", "USDAI", "USAT", "AUSD",
]);

/** Stablecoin : liste connue, ou prix ancré à 1 $ sans mouvement sur 24 h et 7 j. */
export function estStablecoin(c: CoinTile): boolean {
  if (STABLES.has(c.symbol)) return true;
  const calme = (v: number | null) => v !== null && Math.abs(v) < 0.5;
  return Math.abs(c.price - 1) < 0.02 && calme(c.changePct24hConnu) && calme(c.changePct7j);
}

/** Variation (%) de la période ; null si CoinGecko ne la fournit pas. */
export function valeurPeriode(c: CoinTile, periode: PeriodeClassement): number | null {
  const v = periode === "1h" ? c.changePct1h : periode === "24h" ? c.changePct24hConnu : periode === "7j" ? c.changePct7j : c.changePct30j;
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

/** Nom lisible d'une place (message du garde). */
const NOM_PLACE: Record<string, string> = { binance: "Binance", bybit: "Bybit", okx: "OKX", mexc: "MEXC", kraken: "Kraken", coinbase: "Coinbase" };

export type VerdictPaire =
  | { ok: true; paire: string; exchange: ExchangeId }
  | { ok: false; paire: string; motif: "identite" | "indisponible"; raison: string };

/**
 * Garde du clic : un ticker CoinGecko n'est pas unique (AIUSDT est Sleepless AI, pas Artificial
 * Inu). `premiere` est la place que le graphe essaiera d'abord (premier candidat confirmé du
 * résolveur commun, jamais un ordre réimplémenté ici). Refus d'IDENTITÉ, collant, dès qu'une
 * place au prix connu sort de ×0,8 – ×1,25 du prix CoinGecko. Vérification INCOMPLÈTE, non
 * collante, si la première place n'a pas de prix (le graphe l'ouvrirait sans contrôle).
 */
export function verifierPaire(
  ligne: { symbol: string; name: string; price: number },
  cotations: ReadonlyArray<{ exchange: ExchangeId; prix: number | undefined }>,
  premiere: ExchangeId | undefined,
): VerdictPaire {
  const paire = `${ligne.symbol}USDT`;
  const connu = (p: number | undefined): p is number => typeof p === "number" && Number.isFinite(p) && p > 0;
  const ecart = ligne.price > 0 ? cotations.find((c) => connu(c.prix) && (c.prix < ligne.price * 0.8 || c.prix > ligne.price * 1.25)) : undefined;
  if (ecart) {
    return { ok: false, paire, motif: "identite", raison: `${paire} (${NOM_PLACE[ecart.exchange] ?? ecart.exchange}) cote ${formatPrice(ecart.prix)} $ contre ${formatPrice(ligne.price)} $ pour ${ligne.name} : ce ticker désigne un autre actif. Ouverture annulée.` };
  }
  if (premiere === undefined || !(ligne.price > 0) || !connu(cotations.find((c) => c.exchange === premiere)?.prix)) {
    const place = premiere ? ` sur ${NOM_PLACE[premiere] ?? premiere}` : "";
    return { ok: false, paire, motif: "indisponible", raison: `${paire} : prix indisponible${place}, vérification incomplète (${ligne.name}). Réessayez.` };
  }
  return { ok: true, paire, exchange: premiere };
}

/** Dépendances d'un clic (injectées : adaptateurs, mesure de profondeur, résolveur du graphe). */
export interface DepsClic {
  prix: (exchange: ExchangeId, paire: string) => Promise<number | undefined>;
  mesurer: (places: ExchangeId[], paire: string) => void;
  premiere: (paire: string) => Promise<ExchangeId | undefined>;
  /** Faux si un clic plus récent ou le démontage a dépassé celui-ci. */
  courant: () => boolean;
}

/**
 * Clic sur une ligne : les mesures de profondeur partent dès le clic, en parallèle des prix ;
 * un refus d'identité (prix connu hors bande) tombe AVANT le résolveur, qui ne sert qu'à
 * désigner la place que le graphe essaiera d'abord. `null` : clic dépassé.
 */
export async function verifierClic(
  ligne: { symbol: string; name: string; price: number },
  places: ExchangeId[],
  deps: DepsClic,
): Promise<VerdictPaire | null> {
  const paire = `${ligne.symbol}USDT`;
  deps.mesurer(places, paire);
  const cotations = await Promise.all(places.map(async (exchange) => ({ exchange, prix: await deps.prix(exchange, paire) })));
  if (!deps.courant()) return null;
  const identite = verifierPaire(ligne, cotations, undefined);
  if (!identite.ok && identite.motif === "identite") return identite;
  const premiere = await deps.premiere(paire);
  return deps.courant() ? verifierPaire(ligne, cotations, premiere) : null;
}

/** Refus mémorisés après un verdict : seul un refus d'identité désactive la ligne. */
export function refusesApres(refusees: ReadonlyMap<string, string>, id: string, verdict: VerdictPaire): ReadonlyMap<string, string> {
  return verdict.ok || verdict.motif !== "identite" ? refusees : new Map(refusees).set(id, verdict.raison);
}
