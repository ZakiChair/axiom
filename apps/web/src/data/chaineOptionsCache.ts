/**
 * Chaîne d'options Deribit BTC/ETH partagée hors fenêtre OMON (chunk paresseux : niveaux
 * d'options et bandes implicites du chart maître).
 *
 * Cache module par devise, TTL 10 min (même TTL que data/gammaRegime.ts), promesses en vol
 * partagées : plusieurs consommateurs ne déclenchent qu'un appel (≈ 400 Ko). Seul un SUCCÈS
 * non vide est mis en cache ; un échec ou une chaîne vide renvoie null et sera retenté.
 * La santé de la source « deribit » est déjà signalée par `fetchDeribitOptionChain`.
 */
import type { ExchangeId } from "@axiom/types";
import { fetchDeribitOptionChain, type OptionPoint } from "./deribit";
import { basePerp, COTATIONS_USD, splitSymbol } from "./symbol";

export const TTL_CHAINE_MS = 600_000;

export type DeviseDeribit = "BTC" | "ETH";

export interface ChaineOptionsChargee {
  chaine: OptionPoint[];
  /** Instant de réception de la chaîne (ou horloge injectée des anciens fetchers) ; conservé en cache. */
  recupereLe: number;
}

const cache = new Map<DeviseDeribit, ChaineOptionsChargee>();
const enVol = new Map<DeviseDeribit, Promise<ChaineOptionsChargee | null>>();

export function chargerChaineOptions(
  devise: DeviseDeribit,
  nowMs: number,
  fetcher: (devise: DeviseDeribit) => Promise<OptionPoint[]> = fetchDeribitOptionChain,
): Promise<ChaineOptionsChargee | null> {
  const memo = cache.get(devise);
  if (memo !== undefined && nowMs >= memo.recupereLe && nowMs < limiteChaineOptions(memo)) {
    return Promise.resolve(memo);
  }
  const existante = enVol.get(devise);
  if (existante !== undefined) return existante;
  const promesse = fetcher(devise)
    .then((chaine) => {
      const recupereLe = Math.max(nowMs, ...chaine.map((p) => Number.isFinite(p.receivedAt) ? p.receivedAt! : nowMs));
      const actives = chaine.filter((p) => Number.isFinite(p.expiryMs) && p.expiryMs > recupereLe);
      if (actives.length === 0) return null;
      const res = { chaine: actives, recupereLe };
      cache.set(devise, res);
      return res;
    })
    .catch(() => null)
    .finally(() => enVol.delete(devise));
  enVol.set(devise, promesse);
  return promesse;
}

/** Première expiration de la chaîne, bornée par son TTL : jamais de cache au-delà de 08:00 UTC. */
export function limiteChaineOptions({ chaine, recupereLe }: ChaineOptionsChargee): number {
  return chaine.reduce((fin, p) => Number.isFinite(p.expiryMs) && p.expiryMs > recupereLe ? Math.min(fin, p.expiryMs) : fin, recupereLe + TTL_CHAINE_MS);
}

/** Index réel commun ; un forward d’échéance ne permet pas de reconstituer le spot. */
export function spotDeChaine(chaine: readonly { underlying?: number; indexPrice?: number }[]): number {
  const indices = chaine.map((p) => p.indexPrice).filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
  const index = indices[0];
  return index !== undefined && indices.every((v) => v === index) ? index : NaN;
}

/** Cotations assimilées au dollar des chaînes Deribit (index BTC-USD / ETH-USD). */
const COTATIONS_DOLLAR = COTATIONS_USD; // constante unique de data/symbol.ts

/**
 * Devise Deribit d'un marché du chart : BTC (alias Kraken XBT) ou ETH coté en dollar sur une
 * source crypto réelle ; null sinon (ETHBTC, BTCEUR, séries synthétiques, Twelve Data). PURE.
 */
export function actifDeribit(exchange: ExchangeId, symbol: string): DeviseDeribit | null {
  if (exchange === "synthetic" || exchange === "twelvedata") return null;
  // Les perps natifs HL sont valorisés en dollar ; conserver les gardes de cotation du spot.
  if (exchange === "hyperliquid" && symbol.trim().toUpperCase().endsWith("-PERP")) {
    const actif = basePerp(symbol);
    return actif === "BTC" || actif === "ETH" ? actif : null;
  }
  try {
    const { base, quote } = splitSymbol(symbol.trim().toUpperCase().replace("-", "/"), exchange);
    const devise = base === "XBT" ? "BTC" : base;
    return (devise === "BTC" || devise === "ETH") && COTATIONS_DOLLAR.includes(quote) ? devise : null;
  } catch {
    return null;
  }
}

export function _viderCacheChaineOptions(): void {
  cache.clear();
  enVol.clear();
}
