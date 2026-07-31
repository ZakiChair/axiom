/**
 * SECT — mapping CURÉ coin → secteur + agrégats PURS (Lot 3, spec 3.2).
 *
 * POURQUOI un mapping curé : les catégories CoinGecko (/coins/categories) sont un
 * agrégat inerte (onglet Secteurs de MAP) — aucune jointure coin→secteur n'existait.
 * Ce module fixe ~10 groupes × 10-20 membres, choisis à la main (même patron que
 * `TOKEN_TO_PROTOCOL` de protocolRevenue.ts) : id CoinGecko (jointure avec le top 250
 * de marketOverview) + ticker + paire Binance ÉVENTUELLE (absente si non cotée — la
 * fenêtre vérifie de toute façon la paire contre le catalogue Binance avant de
 * naviguer, « sinon rien », comme MAP).
 *
 * MULTI-APPARTENANCE ASSUMÉE : un coin peut vivre dans plusieurs groupes quand sa
 * thèse le justifie — LINK (oracle de l'éco ETH ET colonne vertébrale RWA), NEAR
 * (L1 ET narrative IA), BNB (L1 ET token d'exchange), XRP/TRX (L1 ET paiements),
 * DOGE (meme ET paiements), WIF/BONK (memes ET éco Solana), DASH (paiements ET
 * privacy historique). Les agrégats sont calculés PAR groupe : aucun dédoublonnage.
 *
 * ZÉRO RÉSEAU : ce module ne fait AUCUN appel — il consomme les `CoinTile` du fetch
 * top 250 déjà budgété/caché 5 min (fetchMarketOverview). Un membre hors top 250 est
 * simplement « non couvert » : compté et affiché (« 12/15 »), jamais re-fetché.
 * Les fonctions d'agrégat sont pures et testées sur fixture (secteurs.test.ts).
 */
import type { CoinTile } from "./marketOverview";

// ─────────────────────────── Types du mapping ───────────────────────────

/** Un membre d'un secteur : jointure CoinGecko + ticker + paire Binance éventuelle. */
export interface MembreSecteur {
  /** Identifiant CoinGecko (ex. "bitcoin") — clé de jointure avec `CoinTile.id`. */
  readonly id: string;
  /** Ticker en MAJUSCULES (affichage). */
  readonly ticker: string;
  /** Paire spot Binance si cotée (ex. "LINKUSDT", "BEAMXUSDT" — le ticker Binance
   *  peut différer du ticker CoinGecko, d'où le champ explicite). Absente sinon.
   *  Vérifiée contre le catalogue réel avant navigation : une paire périmée
   *  (délistage) est inoffensive. */
  readonly paireBinance?: string;
}

/** Un secteur curé : identifiant stable + nom affiché + membres. */
export interface Secteur {
  readonly id: string;
  readonly nom: string;
  readonly membres: readonly MembreSecteur[];
}

// ─────────────────────────── Mapping curé ───────────────────────────

export const SECTEURS: readonly Secteur[] = [
  {
    id: "l1-majors",
    nom: "L1 majors",
    membres: [
      { id: "bitcoin", ticker: "BTC", paireBinance: "BTCUSDT" },
      { id: "ethereum", ticker: "ETH", paireBinance: "ETHUSDT" },
      { id: "binancecoin", ticker: "BNB", paireBinance: "BNBUSDT" },
      { id: "solana", ticker: "SOL", paireBinance: "SOLUSDT" },
      { id: "ripple", ticker: "XRP", paireBinance: "XRPUSDT" },
      { id: "cardano", ticker: "ADA", paireBinance: "ADAUSDT" },
      { id: "avalanche-2", ticker: "AVAX", paireBinance: "AVAXUSDT" },
      { id: "the-open-network", ticker: "TON", paireBinance: "TONUSDT" },
      { id: "tron", ticker: "TRX", paireBinance: "TRXUSDT" },
      { id: "polkadot", ticker: "DOT", paireBinance: "DOTUSDT" },
      { id: "near", ticker: "NEAR", paireBinance: "NEARUSDT" },
      { id: "aptos", ticker: "APT", paireBinance: "APTUSDT" },
      { id: "sui", ticker: "SUI", paireBinance: "SUIUSDT" },
      { id: "cosmos", ticker: "ATOM", paireBinance: "ATOMUSDT" },
      { id: "internet-computer", ticker: "ICP", paireBinance: "ICPUSDT" },
    ],
  },
  {
    id: "eco-ethereum",
    nom: "Éco Ethereum",
    membres: [
      { id: "arbitrum", ticker: "ARB", paireBinance: "ARBUSDT" },
      { id: "optimism", ticker: "OP", paireBinance: "OPUSDT" },
      { id: "polygon-ecosystem-token", ticker: "POL", paireBinance: "POLUSDT" },
      { id: "starknet", ticker: "STRK", paireBinance: "STRKUSDT" },
      { id: "zksync", ticker: "ZK", paireBinance: "ZKUSDT" },
      { id: "mantle", ticker: "MNT" }, // L2 non cotée Binance
      { id: "lido-dao", ticker: "LDO", paireBinance: "LDOUSDT" },
      { id: "rocket-pool", ticker: "RPL", paireBinance: "RPLUSDT" },
      { id: "ether-fi", ticker: "ETHFI", paireBinance: "ETHFIUSDT" },
      { id: "uniswap", ticker: "UNI", paireBinance: "UNIUSDT" },
      { id: "aave", ticker: "AAVE", paireBinance: "AAVEUSDT" },
      { id: "curve-dao-token", ticker: "CRV", paireBinance: "CRVUSDT" },
      { id: "chainlink", ticker: "LINK", paireBinance: "LINKUSDT" }, // aussi RWA
      { id: "ethena", ticker: "ENA", paireBinance: "ENAUSDT" },
      { id: "pendle", ticker: "PENDLE", paireBinance: "PENDLEUSDT" },
    ],
  },
  {
    id: "eco-solana",
    nom: "Éco Solana",
    membres: [
      { id: "jupiter-exchange-solana", ticker: "JUP", paireBinance: "JUPUSDT" },
      { id: "jito-governance-token", ticker: "JTO", paireBinance: "JTOUSDT" },
      { id: "raydium", ticker: "RAY", paireBinance: "RAYUSDT" },
      { id: "pyth-network", ticker: "PYTH", paireBinance: "PYTHUSDT" },
      { id: "wormhole", ticker: "W", paireBinance: "WUSDT" },
      { id: "tensor", ticker: "TNSR", paireBinance: "TNSRUSDT" },
      { id: "drift-protocol", ticker: "DRIFT", paireBinance: "DRIFTUSDT" },
      { id: "kamino", ticker: "KMNO", paireBinance: "KMNOUSDT" },
      { id: "helium", ticker: "HNT" }, // non cotée Binance
      { id: "marinade", ticker: "MNDE" }, // non cotée Binance
      { id: "bonk", ticker: "BONK", paireBinance: "BONKUSDT" }, // aussi Memes
      { id: "dogwifcoin", ticker: "WIF", paireBinance: "WIFUSDT" }, // aussi Memes
    ],
  },
  {
    id: "rwa",
    nom: "RWA",
    membres: [
      { id: "chainlink", ticker: "LINK", paireBinance: "LINKUSDT" }, // aussi éco ETH
      { id: "ondo-finance", ticker: "ONDO", paireBinance: "ONDOUSDT" },
      { id: "mantra", ticker: "OM", paireBinance: "OMUSDT" },
      { id: "polymesh", ticker: "POLYX", paireBinance: "POLYXUSDT" },
      { id: "algorand", ticker: "ALGO", paireBinance: "ALGOUSDT" },
      { id: "hedera-hashgraph", ticker: "HBAR", paireBinance: "HBARUSDT" },
      { id: "xdce-crowd-sale", ticker: "XDC" }, // non cotée Binance
      { id: "centrifuge", ticker: "CFG" }, // non cotée Binance
      { id: "clearpool", ticker: "CPOOL" }, // non cotée Binance
      { id: "usual", ticker: "USUAL", paireBinance: "USUALUSDT" },
    ],
  },
  {
    id: "ia",
    nom: "IA",
    membres: [
      { id: "artificial-superintelligence-alliance", ticker: "FET", paireBinance: "FETUSDT" },
      { id: "render-token", ticker: "RENDER", paireBinance: "RENDERUSDT" },
      { id: "bittensor", ticker: "TAO", paireBinance: "TAOUSDT" },
      { id: "the-graph", ticker: "GRT", paireBinance: "GRTUSDT" },
      { id: "worldcoin-wld", ticker: "WLD", paireBinance: "WLDUSDT" },
      { id: "io", ticker: "IO", paireBinance: "IOUSDT" },
      { id: "arkham", ticker: "ARKM", paireBinance: "ARKMUSDT" },
      { id: "virtual-protocol", ticker: "VIRTUAL", paireBinance: "VIRTUALUSDT" },
      { id: "akash-network", ticker: "AKT" }, // non cotée Binance
      { id: "near", ticker: "NEAR", paireBinance: "NEARUSDT" }, // aussi L1 majors
    ],
  },
  {
    id: "memes",
    nom: "Memes",
    membres: [
      { id: "dogecoin", ticker: "DOGE", paireBinance: "DOGEUSDT" }, // aussi Paiements
      { id: "shiba-inu", ticker: "SHIB", paireBinance: "SHIBUSDT" },
      { id: "pepe", ticker: "PEPE", paireBinance: "PEPEUSDT" },
      { id: "dogwifcoin", ticker: "WIF", paireBinance: "WIFUSDT" }, // aussi éco Solana
      { id: "bonk", ticker: "BONK", paireBinance: "BONKUSDT" }, // aussi éco Solana
      { id: "floki", ticker: "FLOKI", paireBinance: "FLOKIUSDT" },
      { id: "official-trump", ticker: "TRUMP", paireBinance: "TRUMPUSDT" },
      { id: "peanut-the-squirrel", ticker: "PNUT", paireBinance: "PNUTUSDT" },
      { id: "turbo", ticker: "TURBO", paireBinance: "TURBOUSDT" },
      { id: "book-of-meme", ticker: "BOME", paireBinance: "BOMEUSDT" },
    ],
  },
  {
    id: "paiements",
    nom: "Paiements",
    membres: [
      { id: "ripple", ticker: "XRP", paireBinance: "XRPUSDT" }, // aussi L1 majors
      { id: "stellar", ticker: "XLM", paireBinance: "XLMUSDT" },
      { id: "litecoin", ticker: "LTC", paireBinance: "LTCUSDT" },
      { id: "bitcoin-cash", ticker: "BCH", paireBinance: "BCHUSDT" },
      { id: "tron", ticker: "TRX", paireBinance: "TRXUSDT" }, // aussi L1 majors (rails stablecoins)
      { id: "dash", ticker: "DASH", paireBinance: "DASHUSDT" }, // aussi Privacy
      { id: "coti", ticker: "COTI", paireBinance: "COTIUSDT" },
      { id: "celo", ticker: "CELO", paireBinance: "CELOUSDT" },
      { id: "ecash", ticker: "XEC", paireBinance: "XECUSDT" },
      { id: "dogecoin", ticker: "DOGE", paireBinance: "DOGEUSDT" }, // aussi Memes
    ],
  },
  {
    id: "exchange-tokens",
    nom: "Exchange tokens",
    membres: [
      { id: "binancecoin", ticker: "BNB", paireBinance: "BNBUSDT" }, // aussi L1 majors
      { id: "okb", ticker: "OKB" }, // tokens concurrents : non cotés Binance
      { id: "bitget-token", ticker: "BGB" },
      { id: "kucoin-shares", ticker: "KCS" },
      { id: "gatechain-token", ticker: "GT" },
      { id: "leo-token", ticker: "LEO" },
      { id: "crypto-com-chain", ticker: "CRO" },
      { id: "hyperliquid", ticker: "HYPE" },
      { id: "dydx-chain", ticker: "DYDX", paireBinance: "DYDXUSDT" },
      { id: "woo-network", ticker: "WOO", paireBinance: "WOOUSDT" },
    ],
  },
  {
    id: "gaming-metaverse",
    nom: "Gaming / Metaverse",
    membres: [
      { id: "immutable-x", ticker: "IMX", paireBinance: "IMXUSDT" },
      { id: "the-sandbox", ticker: "SAND", paireBinance: "SANDUSDT" },
      { id: "decentraland", ticker: "MANA", paireBinance: "MANAUSDT" },
      { id: "axie-infinity", ticker: "AXS", paireBinance: "AXSUSDT" },
      { id: "gala", ticker: "GALA", paireBinance: "GALAUSDT" },
      { id: "apecoin", ticker: "APE", paireBinance: "APEUSDT" },
      { id: "ronin", ticker: "RON", paireBinance: "RONUSDT" },
      // Ticker Binance ≠ ticker CoinGecko : la raison d'être du champ `paireBinance`.
      { id: "beam-2", ticker: "BEAM", paireBinance: "BEAMXUSDT" },
      { id: "notcoin", ticker: "NOT", paireBinance: "NOTUSDT" },
      { id: "enjincoin", ticker: "ENJ", paireBinance: "ENJUSDT" },
      { id: "stepn", ticker: "GMT", paireBinance: "GMTUSDT" },
      { id: "pixels", ticker: "PIXEL", paireBinance: "PIXELUSDT" },
    ],
  },
  {
    id: "privacy",
    nom: "Privacy",
    membres: [
      { id: "monero", ticker: "XMR" }, // délistée de Binance (2024)
      { id: "zcash", ticker: "ZEC", paireBinance: "ZECUSDT" },
      { id: "dash", ticker: "DASH", paireBinance: "DASHUSDT" }, // aussi Paiements
      { id: "oasis-network", ticker: "ROSE", paireBinance: "ROSEUSDT" },
      { id: "secret", ticker: "SCRT" }, // non cotée Binance
      { id: "decred", ticker: "DCR" }, // non cotée Binance
      { id: "horizen", ticker: "ZEN", paireBinance: "ZENUSDT" },
      { id: "dusk-network", ticker: "DUSK", paireBinance: "DUSKUSDT" },
      { id: "railgun", ticker: "RAIL" }, // non cotée Binance
      { id: "zano", ticker: "ZANO" }, // non cotée Binance
    ],
  },
];

// ─────────────────────────── Agrégats PURS ───────────────────────────

/** Un membre valorisé par le top 250 (ou non couvert : toutes les valeurs à null). */
export interface MembreValorise {
  membre: MembreSecteur;
  /** true si le membre figure dans le top 250 chargé. */
  couvert: boolean;
  nom: string | null;
  mcapUsd: number | null;
  prixUsd: number | null;
  changePct24h: number | null;
  changePct7j: number | null;
  changePct30j: number | null;
  /** Poids dans le groupe : part (0-100) de la cap COUVERTE du groupe. */
  poidsPct: number | null;
}

/** Agrégat d'un secteur : perfs pondérées par capitalisation + couverture. */
export interface AgregatSecteur {
  id: string;
  nom: string;
  /** Cap totale des membres couverts (USD). */
  mcapUsd: number;
  /** Moyenne pondérée par cap — null si aucune valeur exploitable. */
  changePct24h: number | null;
  changePct7j: number | null;
  changePct30j: number | null;
  /** Membres trouvés dans le top 250 / total du groupe (« 12/15 »). */
  couverts: number;
  total: number;
  membres: MembreValorise[];
}

/** Nombre fini → lui-même, sinon null (null CoinGecko « pièce trop récente » PRÉSERVÉ
 *  par parseMarkets depuis la revue Lot 3 ; undefined = vieux cache sans 7 j/30 j). */
function fini(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Moyenne pondérée par capitalisation sur les couples (poids, valeur) dont la valeur
 * est non-null. PURE. Renvoie null si aucun couple exploitable (couverture nulle).
 */
function moyennePonderee(couples: ReadonlyArray<{ poids: number; valeur: number | null }>): number | null {
  let somme = 0;
  let sommePoids = 0;
  for (const { poids, valeur } of couples) {
    if (valeur === null || poids <= 0) continue;
    somme += poids * valeur;
    sommePoids += poids;
  }
  return sommePoids > 0 ? somme / sommePoids : null;
}

/** Index id CoinGecko → tuile, pour la jointure mapping × top 250. PURE. */
export function indexerTuiles(tuiles: readonly CoinTile[]): Map<string, CoinTile> {
  const parId = new Map<string, CoinTile>();
  for (const t of tuiles) parId.set(t.id, t);
  return parId;
}

/** Agrège UN secteur contre l'index du top 250. PURE, testée sur fixture. */
export function agregerSecteur(secteur: Secteur, parId: ReadonlyMap<string, CoinTile>): AgregatSecteur {
  const membres: MembreValorise[] = secteur.membres.map((membre) => {
    const tuile = parId.get(membre.id);
    if (tuile === undefined) {
      return {
        membre,
        couvert: false,
        nom: null,
        mcapUsd: null,
        prixUsd: null,
        changePct24h: null,
        changePct7j: null,
        changePct30j: null,
        poidsPct: null,
      };
    }
    return {
      membre,
      couvert: true,
      nom: tuile.name,
      mcapUsd: tuile.mcapUsd,
      prixUsd: tuile.price,
      changePct24h: fini(tuile.changePct24h),
      changePct7j: fini(tuile.changePct7j),
      changePct30j: fini(tuile.changePct30j),
      poidsPct: null, // rempli ci-dessous, une fois la cap totale connue
    };
  });

  const capTotale = membres.reduce((acc, m) => acc + (m.mcapUsd ?? 0), 0);
  for (const m of membres) {
    if (m.mcapUsd !== null && capTotale > 0) m.poidsPct = (m.mcapUsd / capTotale) * 100;
  }

  const couples = (extraire: (m: MembreValorise) => number | null) =>
    membres.map((m) => ({ poids: m.mcapUsd ?? 0, valeur: extraire(m) }));

  return {
    id: secteur.id,
    nom: secteur.nom,
    mcapUsd: capTotale,
    changePct24h: moyennePonderee(couples((m) => m.changePct24h)),
    changePct7j: moyennePonderee(couples((m) => m.changePct7j)),
    changePct30j: moyennePonderee(couples((m) => m.changePct30j)),
    couverts: membres.filter((m) => m.couvert).length,
    total: membres.length,
    membres,
  };
}

/** Agrège TOUS les secteurs curés (ou une liste injectée en test). PURE. */
export function agregerSecteurs(
  tuiles: readonly CoinTile[],
  secteurs: readonly Secteur[] = SECTEURS,
): AgregatSecteur[] {
  const parId = indexerTuiles(tuiles);
  return secteurs.map((s) => agregerSecteur(s, parId));
}
