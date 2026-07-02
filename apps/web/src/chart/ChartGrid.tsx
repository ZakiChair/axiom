/**
 * ChartGrid — grille multi-chart (Phase 4) : 1 / 2 côte-à-côte / 2 empilés / 2×2.
 *
 * Compose le slot MAÎTRE (`<Chart/>`, store global) et jusqu'à 3 slots SECONDAIRES
 * (`<ChartInstance/>`, chacun son `createMarketStore()` local). Responsabilités :
 *  - choix de disposition + bouton « lier les symboles » (barre flottante) ;
 *  - synchro config déclarative (chart-layout) → store local de chaque secondaire ;
 *  - propagation du symbole aux slots LIÉS (depuis le maître via la toolbar, ou depuis
 *    l'en-tête d'un secondaire) ;
 *  - focus (le clic sur un slot est géré dans ChartInstance ; ici on garde le registre
 *    de dessin aligné sur le focus, y compris après un bornage de layout) ;
 *  - démarrage de la synchro MULTI-FENÊTRES (BroadcastChannel).
 *
 * Les stores locaux vivent dans un ref (créés une fois) : changer de layout MONTE/DÉMONTE
 * les ChartInstance secondaires (dispose rigoureux) mais préserve leur config.
 */
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import type { ExchangeId, Timeframe } from "@axiom/types";
import { createMarketStore, marketStore, type MarketStore } from "../store/market";
import {
  chartLayoutStore,
  linkedTargets,
  visibleSlotCount,
  type ChartLayoutMode,
} from "../store/chart-layout";
import { demarrerSyncFenetres } from "../store/sync";
import { setFocusChart } from "./drawing";
import { Chart } from "./Chart";
import { ChartInstance } from "./ChartInstance";

/** Classes Tailwind de grille par mode (littérales → scannées par le JIT). */
const GRID_CLASS: Record<ChartLayoutMode, string> = {
  "1": "grid-cols-1 grid-rows-1",
  "2h": "grid-cols-2 grid-rows-1",
  "2v": "grid-cols-1 grid-rows-2",
  "2x2": "grid-cols-2 grid-rows-2",
};

/** Libellés courts des boutons de disposition. */
const LAYOUT_BUTTONS: { mode: ChartLayoutMode; label: string; title: string }[] = [
  { mode: "1", label: "1", title: "Un seul graphe" },
  { mode: "2h", label: "1|1", title: "Deux côte à côte" },
  { mode: "2v", label: "1—1", title: "Deux empilés" },
  { mode: "2x2", label: "2×2", title: "Grille 2×2" },
];

/**
 * Propage un symbole aux AUTRES slots visibles quand la liaison est active. Cible 0 =
 * store global (maître) ; cibles 1..3 = config des secondaires. Garde « ne (re)pose que
 * si différent » → aucune boucle même quand la mise à jour d'un maître re-notifie.
 */
function propagerSymbole(source: number, symbol: string): void {
  const { linked, layout } = chartLayoutStore.getState();
  if (!linked) return;
  const up = symbol.trim().toUpperCase();
  if (up.length === 0) return;
  for (const t of linkedTargets(source, layout)) {
    if (t === 0) {
      if (marketStore.getState().symbol !== up) marketStore.getState().setSymbol(up);
    } else {
      const cfg = chartLayoutStore.getState().slots[t - 1];
      if (cfg && cfg.symbol !== up) chartLayoutStore.getState().setSlotSymbol(t, up);
    }
  }
}

export function ChartGrid() {
  const layout = useStore(chartLayoutStore, (s) => s.layout);
  const linked = useStore(chartLayoutStore, (s) => s.linked);
  const count = visibleSlotCount(layout);

  // Stores locaux des 3 slots secondaires (créés UNE fois, config initiale = chart-layout).
  const storesRef = useRef<MarketStore[] | null>(null);
  if (storesRef.current === null) {
    const s = chartLayoutStore.getState().slots;
    storesRef.current = [createMarketStore(s[0]), createMarketStore(s[1]), createMarketStore(s[2])];
  }
  const stores = storesRef.current;

  // Config déclarative (chart-layout) → store local de chaque secondaire (ne pousse que
  // les champs modifiés → n'induit une ré-init de ChartInstance que si nécessaire).
  useEffect(() => {
    const sync = (): void => {
      const slots = chartLayoutStore.getState().slots;
      for (let i = 0; i < 3; i++) {
        const cfg = slots[i];
        const st = stores[i];
        if (!cfg || !st) continue;
        const cur = st.getState();
        if (cur.exchange !== cfg.exchange) cur.setExchange(cfg.exchange);
        if (cur.symbol !== cfg.symbol) cur.setSymbol(cfg.symbol);
        if (cur.timeframe !== cfg.timeframe) cur.setTimeframe(cfg.timeframe);
      }
    };
    sync();
    return chartLayoutStore.subscribe(sync);
  }, [stores]);

  // Registre de dessin aligné sur le focus (couvre les changements programmatiques :
  // bornage au rétrécissement du layout, etc. ; le clic direct est géré dans ChartInstance).
  useEffect(() => {
    const apply = (): void => setFocusChart(chartLayoutStore.getState().focus);
    apply();
    return chartLayoutStore.subscribe(apply);
  }, []);

  // Liaison : le symbole du MAÎTRE (piloté par la toolbar/palette/watchlist) propagé aux
  // secondaires liés. La propagation depuis un secondaire passe par ses handlers d'en-tête.
  useEffect(() => {
    return marketStore.subscribe((state, prev) => {
      if (state.symbol !== prev.symbol) propagerSymbole(0, state.symbol);
    });
  }, []);

  // Synchro multi-fenêtres (BroadcastChannel) : symbole + thème entre fenêtres.
  useEffect(() => demarrerSyncFenetres(), []);

  const makeHandlers = (slot: number) => ({
    onChangeSymbol: (symbol: string) => {
      chartLayoutStore.getState().setSlotSymbol(slot, symbol);
      propagerSymbole(slot, symbol);
    },
    onChangeTimeframe: (tf: Timeframe) => chartLayoutStore.getState().setSlotTimeframe(slot, tf),
    onChangeExchange: (ex: ExchangeId) => chartLayoutStore.getState().setSlotExchange(slot, ex),
  });

  const onToggleLink = (): void => {
    chartLayoutStore.getState().toggleLinked();
    // En activant la liaison, on aligne les secondaires sur le symbole du maître.
    if (chartLayoutStore.getState().linked) propagerSymbole(0, marketStore.getState().symbol);
  };

  return (
    <div className="relative h-full w-full">
      {/* Barre flottante : disposition + liaison. */}
      <div className="pointer-events-auto absolute right-2 top-2 z-20 flex items-center gap-1 rounded border border-border bg-surface/85 px-1 py-0.5 backdrop-blur">
        {LAYOUT_BUTTONS.map((b) => (
          <button
            key={b.mode}
            type="button"
            title={b.title}
            aria-label={b.title}
            aria-pressed={layout === b.mode}
            onClick={() => chartLayoutStore.getState().setLayout(b.mode)}
            className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition ${
              layout === b.mode ? "bg-accent/25 text-text" : "text-text-dim hover:bg-bg hover:text-text"
            }`}
          >
            {b.label}
          </button>
        ))}
        <span className="mx-0.5 h-3 w-px bg-border" aria-hidden />
        <button
          type="button"
          title="Lier les symboles des slots"
          aria-label="Lier les symboles des slots"
          aria-pressed={linked}
          onClick={onToggleLink}
          className={`rounded px-1.5 py-0.5 text-[11px] leading-none transition ${
            linked ? "bg-accent/25 text-text" : "text-text-dim hover:bg-bg hover:text-text"
          }`}
        >
          ⛓
        </button>
      </div>

      <div className={`grid h-full w-full gap-px bg-border ${GRID_CLASS[layout]}`}>
        {/* Slot 0 : maître (store global, jeu complet de contrôleurs). */}
        <div className="relative min-h-0 min-w-0 overflow-hidden bg-bg">
          <Chart />
        </div>
        {/* Slots secondaires visibles selon le mode. */}
        {count >= 2 && stores[0] && (
          <div className="relative min-h-0 min-w-0 overflow-hidden bg-bg">
            <ChartInstance store={stores[0]} slot={1} role="secondary" {...makeHandlers(1)} />
          </div>
        )}
        {count >= 4 && stores[1] && (
          <div className="relative min-h-0 min-w-0 overflow-hidden bg-bg">
            <ChartInstance store={stores[1]} slot={2} role="secondary" {...makeHandlers(2)} />
          </div>
        )}
        {count >= 4 && stores[2] && (
          <div className="relative min-h-0 min-w-0 overflow-hidden bg-bg">
            <ChartInstance store={stores[2]} slot={3} role="secondary" {...makeHandlers(3)} />
          </div>
        )}
      </div>
    </div>
  );
}
