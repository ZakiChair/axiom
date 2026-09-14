/** Liaison atomique source + symbole entre les slots de la grille multi-chart. */
import { supportedTimeframesFor } from "../data/adapters";
import { chartLayoutStore, linkedTargets, visibleSlotCount } from "./chart-layout";
import {
  marketIdentity,
  marketStore,
  normalizeMarketSymbol,
  type MarketIdentity,
} from "./market";
import { replayStore } from "./replay";

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

/**
 * Liaison basse fréquence des unités, indépendante de celle des marchés. Les stores
 * locaux secondaires reçoivent ensuite leur configuration par ChartGrid. Le verrou
 * couvre les notifications synchrones Zustand pour empêcher tout rebond.
 */
export function demarrerSyncTimeframes(): () => void {
  let propagation = false;
  let derniereTimeframe: MarketIdentity["timeframe"] | null = null;

  const enReplay = (slot: number): boolean => {
    const replay = replayStore.getState();
    return replay.slot === slot && (replay.active || replay.identityTransition);
  };

  const identite = (slot: number): MarketIdentity | undefined => slot === 0
    ? marketIdentity(marketStore.getState())
    : chartLayoutStore.getState().slots[slot - 1];

  const propager = (sourceSlot: number, slotCible?: number): void => {
    const { layout, syncTimeframe } = chartLayoutStore.getState();
    if (propagation || !syncTimeframe || sourceSlot < 0 ||
      sourceSlot >= visibleSlotCount(layout) || enReplay(sourceSlot)) return;
    const source = identite(sourceSlot);
    if (!source) return;
    // Une réintégration ciblée ne redéfinit pas le dernier choix partagé.
    if (slotCible === undefined) derniereTimeframe = source.timeframe;
    propagation = true;
    try {
      for (const targetSlot of linkedTargets(sourceSlot, layout)) {
        if (slotCible !== undefined && targetSlot !== slotCible) continue;
        const target = identite(targetSlot);
        if (!target || enReplay(targetSlot) || target.timeframe === source.timeframe ||
          !supportedTimeframesFor(target.exchange, target.symbol).includes(source.timeframe)) continue;
        if (targetSlot === 0) marketStore.getState().setTimeframe(source.timeframe);
        else chartLayoutStore.getState().setSlotTimeframe(targetSlot, source.timeframe);
      }
    } finally {
      propagation = false;
    }
  };

  const alignerDepuisFocus = (focus: number, count: number): void => {
    // Un focus rejoué n'impose jamais son unité historique aux autres vues.
    if (focus >= 0 && focus < count && !enReplay(focus)) {
      propager(focus);
      return;
    }
    for (let slot = 0; slot < count; slot++) {
      if (!enReplay(slot)) {
        propager(slot);
        return;
      }
    }
  };

  const reintegrer = (slotCible: number): void => {
    const { layout, focus } = chartLayoutStore.getState();
    if (slotCible < 0 || slotCible >= visibleSlotCount(layout) || enReplay(slotCible)) return;
    const sources = linkedTargets(slotCible, layout).filter((slot) => !enReplay(slot));
    // Le focus peut être une source incompatible restée sur son ancienne unité.
    const reference = sources.find((slot) => identite(slot)?.timeframe === derniereTimeframe);
    const sourceSlot = reference ?? (sources.includes(focus) ? focus : sources[0]);
    if (sourceSlot !== undefined) propager(sourceSlot, slotCible);
  };

  const stopMaster = marketStore.subscribe((state, previous) => {
    if (state.timeframe !== previous.timeframe) propager(0);
    else if (state.exchange !== previous.exchange || state.symbol !== previous.symbol) reintegrer(0);
  });
  const stopLayout = chartLayoutStore.subscribe((state, previous) => {
    if (propagation || !state.syncTimeframe) return;
    const count = visibleSlotCount(state.layout);
    if (!previous.syncTimeframe) {
      alignerDepuisFocus(state.focus, count);
      return;
    }
    const previousCount = visibleSlotCount(previous.layout);
    if (count > previousCount) {
      // Un nouveau slot peut conserver une ancienne unité : il ne devient pas la
      // référence en s'ouvrant, même si une restauration déplace aussi le focus.
      alignerDepuisFocus(previous.focus, previousCount);
      return;
    }
    for (let slot = 1; slot < count; slot++) {
      if (state.slots[slot - 1]?.timeframe !== previous.slots[slot - 1]?.timeframe &&
        !enReplay(slot)) {
        propager(slot);
        return;
      }
    }
    // Une nouvelle source peut accepter l'unité live sans modifier l'ancienne TF.
    // Réintégrer seulement cette vue ; un changement explicite de TF reste prioritaire.
    for (let slot = 1; slot < count; slot++) {
      const current = state.slots[slot - 1];
      const before = previous.slots[slot - 1];
      if (current?.exchange !== before?.exchange || current?.symbol !== before?.symbol) reintegrer(slot);
    }
  });
  const stopReplay = replayStore.subscribe((state, previous) => {
    // Attendre la fin de la restauration : son unité capturée avant le replay ne
    // doit jamais redevenir celle des vues live. Une sélection utilisateur, elle,
    // annule returnMarket et garde la priorité via les abonnements marché/layout.
    if (state.active || state.identityTransition || !previous.identityTransition ||
      previous.returnMarket === null) return;
    reintegrer(state.slot);
  });

  const initial = chartLayoutStore.getState();
  if (initial.syncTimeframe) alignerDepuisFocus(initial.focus, visibleSlotCount(initial.layout));

  return () => {
    stopMaster();
    stopLayout();
    stopReplay();
  };
}
