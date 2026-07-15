/** Liaison atomique source + symbole entre les slots de la grille multi-chart. */
import { supportedTimeframesFor } from "../data/adapters";
import { chartLayoutStore, linkedTargets } from "./chart-layout";
import {
  marketIdentity,
  marketStore,
  normalizeMarketSymbol,
  type MarketIdentity,
} from "./market";

/** Identité à propager lors de l'activation de la liaison depuis le slot maître. */
export function masterLinkSource(
  current: MarketIdentity,
  replay: { active: boolean; slot: number; returnMarket: MarketIdentity | null },
): MarketIdentity {
  return replay.active && replay.slot === 0 && replay.returnMarket !== null
    ? replay.returnMarket
    : current;
}

function linkedIdentity(current: MarketIdentity, source: MarketIdentity): MarketIdentity {
  const symbol = normalizeMarketSymbol(source.symbol);
  const supported = supportedTimeframesFor(source.exchange, symbol);
  const timeframe = supported.includes(current.timeframe)
    ? current.timeframe
    : supported.includes(source.timeframe)
      ? source.timeframe
      : (supported[0] ?? source.timeframe);
  return { exchange: source.exchange, symbol, timeframe };
}

/**
 * Aligne source + symbole sur les autres slots visibles. Un symbole synthétique n'est
 * valide qu'avec sa source `synthetic` et conserve la casse des ids encodés. La TF de
 * chaque cible reste inchangée quand la nouvelle source la supporte.
 */
export function propagerMarche(sourceSlot: number, source: MarketIdentity): void {
  const { linked, layout } = chartLayoutStore.getState();
  if (!linked || source.symbol.trim().length === 0) return;
  for (const targetSlot of linkedTargets(sourceSlot, layout)) {
    if (targetSlot === 0) {
      const master = marketStore.getState();
      master.setMarket(linkedIdentity(marketIdentity(master), source));
      continue;
    }
    const config = chartLayoutStore.getState().slots[targetSlot - 1];
    if (config) {
      chartLayoutStore.getState().setSlotMarket(targetSlot, linkedIdentity(config, source));
    }
  }
}
