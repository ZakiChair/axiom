/**
 * Étiquetage HEURISTIQUE des adresses d'exchanges (collecteur whales.ts).
 *
 * POURQUOI : un gros transfert on-chain ne « dit » quelque chose que dirigé — VERS un
 * exchange (offre potentielle : dépôt avant vente) ou DEPUIS un exchange (retrait vers
 * cold storage : accumulation). L'attribution d'adresses est un problème d'entité
 * (clustering) que seuls des fournisseurs payants (Arkham, Nansen, Whale Alert)
 * résolvent sérieusement — HORS BUDGET par contrat (cf. anti-recommandations).
 *
 * On assume donc une LISTE CURÉE, COURTE et STATIQUE des hot/cold wallets PUBLICS les
 * plus connus (étiquetés par Etherscan/explorateurs, stables depuis des années). Tout
 * ce qui n'y figure pas est « inconnu » — l'UI porte un badge « estimation » et ce
 * module ne prétend JAMAIS à l'exhaustivité. Étendre la liste = ajouter une ligne ici.
 *
 * Conventions de casse : ETH comparées en MINUSCULES (l'checksum EIP-55 varie selon
 * les sources) ; BTC comparées TELLES QUELLES (base58 sensible à la casse, bech32
 * nativement minuscule).
 */
import type { DirectionWhale } from "@axiom/alerts";

/** Adresses ETH connues (clés en minuscules) → étiquette exchange. */
export const LABELS_ETH: Readonly<Record<string, string>> = {
  // Binance (hot wallets 14/15/16 + cold wallet 8 — étiquettes publiques Etherscan).
  "0x28c6c06298d514db089934071355e5743bf21d60": "Binance",
  "0x21a31ee1afc51d94c2efccaa2092ad1028285549": "Binance",
  "0xdfd5293d8e347dfe59e90efd55b2956a1343963d": "Binance",
  "0xf977814e90da44bfa03b6295a0616a897441acec": "Binance (cold)",
  // Coinbase (1 à 6).
  "0x71660c4005ba85c37ccec55d0c4493e66fe775d3": "Coinbase",
  "0x503828976d22510aad0201ac7ec88293211d23da": "Coinbase",
  "0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740": "Coinbase",
  "0x3cd751e6b0078be393132286c442345e5dc49699": "Coinbase",
  "0xb5d85cbf7cb3ee0d56b3bb207d5fc4b82f43f511": "Coinbase",
  "0xeb2629a2734e272bcc07bda959863f316f4bd4cf": "Coinbase",
  // Kraken (1 à 3).
  "0x2910543af39aba0cd09dbb2d50200b3e800a63d2": "Kraken",
  "0x0a869d79a7052c7f1b55a8ebabbea3420f0d1e13": "Kraken",
  "0xe853c56864a2ebe4576a807d26fdc4a0ada51919": "Kraken",
  // OKX / Bitfinex / Bybit (hot wallets principaux).
  "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b": "OKX",
  "0x1151314c646ce4e0efd76d1af4760ae66a9fe30f": "Bitfinex",
  "0xf89d7b9c864f589bbf53a82105107622b35eaa40": "Bybit",
};

/** Adresses BTC connues (casse exacte) → étiquette exchange. */
export const LABELS_BTC: Readonly<Record<string, string>> = {
  // Binance cold wallets (les plus gros soldes BTC connus, étiquetés publiquement).
  "34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo": "Binance (cold)",
  "bc1qgdjqv0av3q56jvd82tkdjpy7gdp9ut8tlqmgrpmv24sq90ecnvqqjwvw97": "Binance (cold)",
  // Bitfinex / Robinhood cold wallets.
  "3JZq4atUahhuA9rLhXLMhhTo133J9rF97j": "Bitfinex (cold)",
  "bc1ql49ydapnjafl5t2cp9zqpjwe6pdgmxy98859v2": "Robinhood",
};

/** Étiquette exchange d'une adresse, ou `null` si inconnue. Fonction PURE. */
export function etiqueterAdresse(chain: "btc" | "eth", adresse: string): string | null {
  if (chain === "eth") return LABELS_ETH[adresse.toLowerCase()] ?? null;
  return LABELS_BTC[adresse] ?? null;
}

/**
 * Direction d'un mouvement d'après les étiquettes source/destination :
 * vers un exchange = « depot » (offre potentielle), depuis un exchange = « retrait »
 * (accumulation), les deux = « interne » (rééquilibrage, peu informatif), aucune =
 * « inconnu » (wallet à wallet). Fonction PURE.
 */
export function etiqueterDirection(deLabel: string | null, versLabel: string | null): DirectionWhale {
  if (deLabel !== null && versLabel !== null) return "interne";
  if (versLabel !== null) return "depot";
  if (deLabel !== null) return "retrait";
  return "inconnu";
}
