/**
 * Découverte des perpétuels par ACTIF (demande du 5 octobre 2026).
 *
 * Jusqu'ici, la fenêtre DES n'interrogeait Coinalyze que pour le perpétuel Binance
 * (`<BASE>USDT_PERP.A`) quand la source du graphe était Binance — donc aucune donnée
 * dérivée pour un actif charté ailleurs (ex. PUMP sur OKX, la place la plus profonde).
 * Le marché perp est désormais résolu par l'ACTIF (base) parmi les quatre places
 * perp d'AXIOM (Binance, Bybit, OKX, Hyperliquid), indépendamment de la place spot
 * affichée au graphe.
 *
 * La découverte s'appuie sur le catalogue Coinalyze `GET /v1/future-markets` (UN
 * appel, ~1,6 Mo) : il normalise `base_asset` entre les places (PUMP coté
 * « PUMPFUNUSDT » chez Bybit, « kPEPE » chez Hyperliquid) et indique pour chaque
 * ligne `has_long_short_ratio_data`, `margined`, `quote_asset`…
 *
 * Sans clé Coinalyze ou quand le catalogue est injoignable, on replie sur
 * l'hypothèse historique : le perpétuel Binance `<ACTIF>USDT_PERP.A`.
 */
import type { ExchangeId } from "@axiom/types";
import { fetchFutureMarkets } from "./coinalyze";
import { isTradfiMarketSymbol } from "./pairs";
import { basePerp } from "./symbol";
import { coinalyzeKeyStore } from "../store/coinalyze";

/** Places de perpétuels couvertes par la découverte (dans l'ordre par défaut). */
export type PlacePerp = Extract<ExchangeId, "binance" | "bybit" | "okx" | "hyperliquid">;
export const PLACES_PERP: readonly PlacePerp[] = ["binance", "bybit", "okx", "hyperliquid"];

/** Libellés d'affichage des places perp. */
export const LIBELLE_PLACE_PERP: Readonly<Record<PlacePerp, string>> = {
  binance: "Binance",
  bybit: "Bybit",
  okx: "OKX",
  hyperliquid: "Hyperliquid",
};

/** Codes `exchange` du catalogue Coinalyze → place AXIOM (vérifiés en réel le 5/10/2026). */
const CODE_PLACE: Readonly<Record<string, PlacePerp>> = {
  A: "binance",
  "6": "bybit",
  "3": "okx",
  H: "hyperliquid",
};

/** Un marché perpétuel retenu pour l'actif : une ligne par place au plus. */
export interface MarchePerp {
  /** Place AXIOM du perpétuel. */
  place: PlacePerp;
  /** Identifiant Coinalyze du marché (ex. « PUMPFUNUSDT.6 ») — CASSE CONSERVÉE. */
  symbole: string;
  /** Symbole du contrat sur la place (ex. « PUMP-USDT-SWAP », « PUMP » pour HL). */
  symboleSurPlace: string;
  /** Multiplicateur de contrat : 1, 1000, 10000 ou 1000000 (1000PEPE, kPEPE…). */
  multiplicateur: number;
  /** true si Coinalyze publie un ratio long/short pour ce marché. */
  aLongShort: boolean;
  /**
   * true si Coinalyze publie des liquidations pour ce marché. Hyperliquid est
   * exclu : Coinalyze ne remonte JAMAIS de série de liquidations pour cette
   * place (vérifié en réel le 5/10/2026 — BTC.H et PUMP.H vides sur 48 h).
   */
  aLiquidations: boolean;
}

/** Résultat de la résolution du perpétuel d'un symbole de graphe. */
export type ResolutionPerp =
  | { etat: "inexploitable" }
  /** `marches` vide = aucun perp de l'actif sur les quatre places. */
  | { etat: "catalogue"; actif: string; marches: MarchePerp[] }
  | { etat: "repli"; actif: string; marches: [MarchePerp]; cause: "sans-cle" | "catalogue-indisponible" };

/**
 * Base perpétuelle (actif) d'un symbole de graphe, ou `null` quand l'instrument
 * n'a pas de sous-jacent crypto exploitable : actif TradFi (action, forex, indice)
 * ou symbole synthétique à deux jambes. PURE.
 */
export function actifPerpDe(symbol: string): string | null {
  if (isTradfiMarketSymbol(symbol)) return null;
  return basePerp(symbol);
}

/** Ligne de catalogue validée : seuls les champs exploités sont retenus. */
interface LignePerp {
  symbole: string;
  place: PlacePerp;
  symboleSurPlace: string;
  base: string;
  quote: string;
  margined: string;
  aLongShort: boolean;
}

/**
 * Ne garde qu'une ligne de catalogue si c'est un PERPÉTUEL d'une des quatre places
 * avec les champs requis en chaîne. Toute autre ligne (non perp, place hors
 * périmètre, champs absents) est ignorée. PURE.
 */
function validerLignePerp(brut: unknown): LignePerp | null {
  if (brut === null || typeof brut !== "object") return null;
  const o = brut as Record<string, unknown>;
  const place = typeof o.exchange === "string" ? CODE_PLACE[o.exchange] : undefined;
  if (
    place === undefined ||
    typeof o.symbol !== "string" ||
    typeof o.symbol_on_exchange !== "string" ||
    typeof o.base_asset !== "string" ||
    typeof o.quote_asset !== "string" ||
    typeof o.margined !== "string" ||
    o.is_perpetual !== true
  ) {
    return null;
  }
  return {
    symbole: o.symbol,
    place,
    symboleSurPlace: o.symbol_on_exchange,
    base: o.base_asset,
    quote: o.quote_asset,
    margined: o.margined,
    aLongShort: o.has_long_short_ratio_data === true,
  };
}

/**
 * Multiplicateur de contrat si la ligne cote l'actif recherché, sinon `null`.
 *  - base exacte → 1 (comparaison en majuscules : `base_asset` est en majuscules
 *    chez les CEX) ;
 *  - CEX (A/6/3) : préfixes de contrat fractionné « 1000 » / « 10000 » /
 *    « 1000000 » / « 1M » collés à la base (ex. `1000PEPE` → ×1000) ;
 *  - Hyperliquid (H) : préfixe « k » BAS DE CASSE (ex. `kPEPE` → ×1000 ; une ligne
 *    `KAITO` ne matche PAS l'actif `AITO` — la casse est discriminante) ;
 *  - tout le reste ne matche pas (`PUMPBTC` n'est pas `PUMP`).
 * PURE.
 */
function multiplicateurLigne(ligne: LignePerp, actif: string): number | null {
  if (ligne.base.toUpperCase() === actif) return 1;
  if (ligne.place === "hyperliquid") {
    return ligne.base === `k${actif}` ? 1000 : null;
  }
  if (ligne.base === `1000${actif}`) return 1000;
  if (ligne.base === `10000${actif}`) return 10000;
  if (ligne.base === `1000000${actif}` || ligne.base === `1M${actif}`) return 1_000_000;
  return null;
}

/** Rang de cotation pour le départage : USDT d'abord, puis USDC, USD, autres. */
function rangQuote(quote: string): number {
  if (quote === "USDT") return 0;
  if (quote === "USDC") return 1;
  if (quote === "USD") return 2;
  return 3;
}

/**
 * Choisit UNE ligne par place parmi les candidates de l'actif. Départage :
 *  1. `margined === "STABLE"` d'abord (référence stable, la plus lisible) ;
 *  2. multiplicateur 1 d'abord (contrat « plein » préféré au fractionné) ;
 *  3. cotation USDT < USDC < USD < autres ;
 *  4. `symbol` croissant (stabilité déterministe).
 * Renvoie les marchés dans l'ordre `PLACES_PERP`. PURE.
 */
export function marchesPerpPourActif(
  catalogue: readonly unknown[],
  actif: string,
): MarchePerp[] {
  const lignes: LignePerp[] = [];
  for (const brut of catalogue) {
    const ligne = validerLignePerp(brut);
    if (ligne !== null) lignes.push(ligne);
  }
  return marchesDepuisLignes(lignes, actif);
}

/** Cœur de `marchesPerpPourActif` sur des lignes DÉJÀ validées (cache catalogue). */
function marchesDepuisLignes(lignes: readonly LignePerp[], actif: string): MarchePerp[] {
  interface Candidate {
    ligne: LignePerp;
    multiplicateur: number;
  }
  const parPlace = new Map<PlacePerp, Candidate[]>();
  for (const ligne of lignes) {
    const multiplicateur = multiplicateurLigne(ligne, actif);
    if (multiplicateur === null) continue;
    const liste = parPlace.get(ligne.place);
    const cand: Candidate = { ligne, multiplicateur };
    if (liste === undefined) parPlace.set(ligne.place, [cand]);
    else liste.push(cand);
  }

  const marches: MarchePerp[] = [];
  for (const place of PLACES_PERP) {
    const candidates = parPlace.get(place);
    if (candidates === undefined || candidates.length === 0) continue;
    const [top] = [...candidates].sort((a, b) => {
      const s = Number(b.ligne.margined === "STABLE") - Number(a.ligne.margined === "STABLE");
      if (s !== 0) return s;
      const m = Number(b.multiplicateur === 1) - Number(a.multiplicateur === 1);
      if (m !== 0) return m;
      const q = rangQuote(a.ligne.quote) - rangQuote(b.ligne.quote);
      if (q !== 0) return q;
      return a.ligne.symbole.localeCompare(b.ligne.symbole);
    });
    if (top === undefined) continue;
    marches.push({
      place,
      symbole: top.ligne.symbole,
      symboleSurPlace: top.ligne.symboleSurPlace,
      multiplicateur: top.multiplicateur,
      aLongShort: top.ligne.aLongShort,
      aLiquidations: place !== "hyperliquid",
    });
  }
  return marches;
}

/**
 * Ordonne les marchés pour l'affichage : `prioritaire` en tête si présent (perp
 * Hyperliquid charté → sa place passe devant), le reste dans l'ordre `PLACES_PERP`.
 * PURE (ne modifie pas l'entrée).
 */
export function ordonnerMarchesPerp(
  marches: readonly MarchePerp[],
  prioritaire: PlacePerp | null,
): MarchePerp[] {
  if (prioritaire === null) return [...marches].sort(triPlaces);
  return [...marches].sort((a, b) => {
    if (a.place === prioritaire) return b.place === prioritaire ? 0 : -1;
    if (b.place === prioritaire) return 1;
    return triPlaces(a, b);
  });
}

function triPlaces(a: MarchePerp, b: MarchePerp): number {
  return PLACES_PERP.indexOf(a.place) - PLACES_PERP.indexOf(b.place);
}

/**
 * Marché affiché : le choix utilisateur (`choix`) s'il est encore dans la liste,
 * sinon le premier de l'ordre affiché (`prioritaire` éventuel en tête). `null`
 * si aucune place ne cote l'actif. PURE.
 */
export function marchePerpRetenu(
  marches: readonly MarchePerp[],
  choix: PlacePerp | undefined,
  prioritaire: PlacePerp | null,
): MarchePerp | null {
  if (choix !== undefined) {
    const prefere = marches.find((m) => m.place === choix);
    if (prefere !== undefined) return prefere;
  }
  return ordonnerMarchesPerp(marches, prioritaire)[0] ?? null;
}

/**
 * Marché qui fournit la métrique : le marché affiché s'il la publie, sinon le
 * premier de `marches` (ordre PLACES_PERP) qui la publie ; `null` si aucun.
 * Sert au complément L/S et liquidations quand la place affichée n'y a pas
 * droit (demande du 5 octobre 2026, complétée le jour même). PURE.
 */
export function marcheComplement(
  marches: readonly MarchePerp[],
  marche: MarchePerp,
  critere: "aLongShort" | "aLiquidations",
): MarchePerp | null {
  if (marche[critere]) return marche;
  return [...marches].sort(triPlaces).find((m) => m[critere]) ?? null;
}

// ---------- Catalogue en mémoire (1 appel, TTL 12 h, repli borné) ----------

/** Durée de validité du catalogue chargé : 12 h (les listings perp bougent lentement). */
const TTL_CATALOGUE_MS = 12 * 60 * 60 * 1000;
/** Mémo d'échec : aucune nouvelle tentative pendant 60 s après une panne. */
const MEMO_ECHEC_MS = 60_000;

let lignesCatalogue: LignePerp[] | null = null;
let catalogueAt = 0;
let echecAt = 0;
let chargementEnCours: Promise<LignePerp[] | null> | null = null;

/**
 * Charge le catalogue perp (lignes validées des quatre places), depuis le cache
 * mémoire si frais, sinon via `fetchFutureMarkets`. Une seule requête en vol
 * (single-flight) ; en échec, mémo de 60 s sans nouvelle tentative. `null` =
 * catalogue indisponible.
 */
async function chargerCataloguePerp(): Promise<LignePerp[] | null> {
  const now = Date.now();
  if (lignesCatalogue !== null && now - catalogueAt < TTL_CATALOGUE_MS) return lignesCatalogue;
  if (now - echecAt < MEMO_ECHEC_MS) return null;
  if (chargementEnCours !== null) return chargementEnCours;
  chargementEnCours = (async () => {
    try {
      const brut = await fetchFutureMarkets();
      lignesCatalogue = brut
        .map(validerLignePerp)
        .filter((l): l is LignePerp => l !== null);
      catalogueAt = Date.now();
      return lignesCatalogue;
    } catch {
      echecAt = Date.now();
      return null;
    } finally {
      chargementEnCours = null;
    }
  })();
  return chargementEnCours;
}

/**
 * Résout les perpétuels d'un symbole de graphe :
 *  - `inexploitable` : pas d'actif crypto sous-jacent (TradFi, synthétique) ;
 *  - `repli` « sans-cle » : aucune clé Coinalyze → ZÉRO requête réseau, perp
 *    Binance supposé ;
 *  - `repli` « catalogue-indisponible » : même marché supposé, cause distincte ;
 *  - `catalogue` : marchés trouvés (éventuellement vide = aucun perp de l'actif).
 */
export async function resoudreMarchesPerp(symbol: string): Promise<ResolutionPerp> {
  const actif = actifPerpDe(symbol);
  if (actif === null) return { etat: "inexploitable" };
  const repli: ResolutionPerp = {
    etat: "repli",
    actif,
    marches: [
      {
        place: "binance",
        symbole: `${actif}USDT_PERP.A`,
        symboleSurPlace: `${actif}USDT`,
        multiplicateur: 1,
        aLongShort: true,
        aLiquidations: true,
      },
    ],
    cause: "sans-cle",
  };
  if (!coinalyzeKeyStore.getState().hasKey) return repli;
  const catalogue = await chargerCataloguePerp();
  if (catalogue === null) {
    return { ...repli, cause: "catalogue-indisponible" };
  }
  return { etat: "catalogue", actif, marches: marchesDepuisLignes(catalogue, actif) };
}

/** Vide le cache catalogue et les mémos d'échec — réservé aux tests. */
export function _reinitialiserCatalogueMarchesPerp(): void {
  lignesCatalogue = null;
  catalogueAt = 0;
  echecAt = 0;
  chargementEnCours = null;
}
