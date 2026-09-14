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
import { splitSymbol } from "./symbol";

export const TTL_CHAINE_MS = 600_000;

export type DeviseDeribit = "BTC" | "ETH";

export interface ChaineOptionsChargee {
  chaine: OptionPoint[];
  /** Instant (nowMs de la demande) où cette chaîne a été téléchargée ; conservé en cache. */
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
  if (memo !== undefined && nowMs >= memo.recupereLe && nowMs - memo.recupereLe < TTL_CHAINE_MS) {
    return Promise.resolve(memo);
  }
  const existante = enVol.get(devise);
  if (existante !== undefined) return existante;
  const promesse = fetcher(devise)
    .then((chaine) => {
      if (chaine.length === 0) return null;
      const res = { chaine, recupereLe: nowMs };
      cache.set(devise, res);
      return res;
    })
    .catch(() => null)
    .finally(() => enVol.delete(devise));
  enVol.set(devise, promesse);
  return promesse;
}

/** Spot de la chaîne : premier `underlying` fini > 0, NaN sinon (= `spotChaine` d'OMON). */
export function spotDeChaine(chaine: readonly { underlying: number }[]): number {
  return chaine.map((p) => p.underlying).find((v) => Number.isFinite(v) && v > 0) ?? NaN;
}

/** Cotations assimilées au dollar des chaînes Deribit (index BTC-USD / ETH-USD). */
const COTATIONS_DOLLAR = ["USDT", "USDC", "USD", "USDE", "DAI", "TUSD", "USDD"];

/**
 * Devise Deribit d'un marché du chart : BTC (alias Kraken XBT) ou ETH coté en dollar sur une
 * source crypto réelle ; null sinon (ETHBTC, BTCEUR, séries synthétiques, Twelve Data). PURE.
 */
export function actifDeribit(exchange: ExchangeId, symbol: string): DeviseDeribit | null {
  if (exchange === "synthetic" || exchange === "twelvedata") return null;
  try {
    const { base, quote } = splitSymbol(symbol.trim().toUpperCase().replace("-", "/"), "Deribit");
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
