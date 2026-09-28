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
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { Timeframe } from "@axiom/types";
import {
  createMarketStore,
  marketIdentity,
  marketStore,
  type MarketStore,
} from "../store/market";
import {
  chartLayoutStore,
  visibleSlotCount,
  type ChartLayoutMode,
} from "../store/chart-layout";
import { replayStore } from "../store/replay";
import { masterLinkSource, propagerMarche } from "../store/chart-linking";
import { demarrerSyncFenetres } from "../store/sync";
import { setFocusChart } from "./drawing";
import { Chart } from "./Chart";
import { ChartInstance } from "./ChartInstance";
import { useMobileLayout } from "../hooks/useMobileLayout";

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

const ChartSyncControls = lazy(() => import("./ChartSyncControls"));

export function ChartGrid() {
  const mobile = useMobileLayout();
  const [controlsOpen, setControlsOpen] = useState(false);
  const layout = useStore(chartLayoutStore, (s) => s.layout);
  const focus = useStore(chartLayoutStore, (s) => s.focus);
  const linked = useStore(chartLayoutStore, (s) => s.linked);
  const slots = useStore(chartLayoutStore, (s) => s.slots);
  const masterSymbol = useStore(marketStore, (s) => s.symbol);
  const count = visibleSlotCount(layout);
  const controlsRef = useRef<HTMLDivElement>(null);
  const controlsButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!controlsOpen) return;
    const outside = (event: PointerEvent): void => {
      if (!controlsRef.current?.contains(event.target as Node)) setControlsOpen(false);
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setControlsOpen(false);
      controlsButtonRef.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [controlsOpen]);

  // Stores locaux des 3 slots secondaires (créés UNE fois, config initiale = chart-layout).
  const storesRef = useRef<MarketStore[] | null>(null);
  if (storesRef.current === null) {
    const s = chartLayoutStore.getState().slots;
    storesRef.current = [createMarketStore(s[0]), createMarketStore(s[1]), createMarketStore(s[2])];
  }
  const stores = storesRef.current;

  // Liaison des unités chargée à la demande : hors du chargement initial (budget JS
  // d'entrée) ; l'alignement depuis le focus se fait dès l'arrivée du module.
  useEffect(() => {
    let arreter: (() => void) | null = null;
    let demonte = false;
    void import("../store/chart-sync-timeframes").then(({ demarrerSyncTimeframes }) => {
      if (demonte) return;
      arreter = demarrerSyncTimeframes();
    });
    return () => {
      demonte = true;
      arreter?.();
    };
  }, []);

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
        if (
          cur.exchange !== cfg.exchange ||
          cur.symbol !== cfg.symbol ||
          cur.timeframe !== cfg.timeframe
        ) cur.setMarket(cfg);
      }
    };
    sync();
    return chartLayoutStore.subscribe(sync);
  }, [stores]);

  // Le chargement automatique peut retenir un autre fournisseur ou normaliser le TF.
  // Sauvegarder cette identité effective évite qu'un focus/layout réinjecte l'ancienne.
  useEffect(() => {
    const unsubs = stores.map((store, index) => store.subscribe((state) => {
      const slot = index + 1;
      const replay = replayStore.getState();
      if (state.dataLoad.status !== "ready" || ((replay.active || replay.identityTransition) && replay.slot === slot)) return;
      const cfg = chartLayoutStore.getState().slots[index];
      if (!cfg || (cfg.exchange === state.exchange && cfg.symbol === state.symbol && cfg.timeframe === state.timeframe)) return;
      chartLayoutStore.getState().setSlotMarket(slot, marketIdentity(state));
    }));
    return () => { for (const unsub of unsubs) unsub(); };
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
      if (
        (state.exchange !== prev.exchange || state.symbol !== prev.symbol) &&
        !(replayStore.getState().identityTransition && replayStore.getState().slot === 0)
      ) propagerMarche(0, marketIdentity(state));
    });
  }, []);

  // Synchro multi-fenêtres (BroadcastChannel) : symbole + thème entre fenêtres.
  useEffect(() => demarrerSyncFenetres(), []);

  const makeHandlers = (slot: number) => ({
    onChangeSymbol: (symbol: string) => {
      const cfg = chartLayoutStore.getState().slots[slot - 1];
      if (!cfg) return;
      chartLayoutStore.getState().setSlotSymbol(slot, symbol);
      const next = chartLayoutStore.getState().slots[slot - 1];
      if (next) propagerMarche(slot, next);
    },
    onChangeTimeframe: (tf: Timeframe) => chartLayoutStore.getState().setSlotTimeframe(slot, tf),

  });

  const onToggleLink = (): void => {
    chartLayoutStore.getState().toggleLinked();
    if (chartLayoutStore.getState().linked) {
      const replay = replayStore.getState();
      // Pendant un replay du maître, les autres slots s'alignent sur son identité LIVE
      // capturée. À la sortie, le maître restauré reste ainsi cohérent avec la liaison.
      const source = masterLinkSource(marketIdentity(marketStore.getState()), replay);
      propagerMarche(0, source);
    }
  };

  const slotClass = (slot: number): string => `min-h-0 min-w-0 overflow-hidden bg-bg ${
    mobile ? `absolute inset-0 ${focus === slot ? "visible" : "invisible pointer-events-none"}` : "relative"
  }`;
  const commandSize = mobile ? "min-h-11 min-w-11 px-2 text-xs" : "px-1.5 py-0.5 text-[10px]";

  return (
    <div className="relative flex h-full w-full min-w-0 flex-col">
      {mobile && (
        <div className="flex shrink-0 items-center gap-1 border-b border-border bg-surface px-1">
          <nav aria-label="Vues du graphique" className="flex min-w-0 flex-1 gap-1">
            {Array.from({ length: count }, (_, slot) => (
              <button key={slot} type="button"
                aria-label={`Vue ${slot + 1} : ${slot === 0 ? masterSymbol : slots[slot - 1]?.symbol}`}
                aria-pressed={focus === slot}
                aria-controls={`chart-slot-${slot}`}
                onClick={() => {
                  chartLayoutStore.getState().setFocus(slot);
                  setFocusChart(slot);
                  setControlsOpen(false);
                }}
                className={`min-h-11 min-w-11 flex-1 truncate rounded px-2 text-xs ${focus === slot ? "bg-accent/20 text-accent" : "text-text-dim"}`}
              >{count === 1 ? "Graphique" : `Vue ${slot + 1}`}</button>
            ))}
          </nav>
          <div ref={controlsRef} className="relative shrink-0">
            <button ref={controlsButtonRef} type="button" aria-expanded={controlsOpen}
              aria-controls="chart-grid-controls" onClick={() => setControlsOpen((open) => !open)}
              className="min-h-11 rounded px-3 text-xs text-text"
            >Vues ▾</button>
          </div>
        </div>
      )}
      {/* Barre flottante : disposition + liaison. Ancrée en BAS à droite — en haut, elle
          occupait le pixel de départ de la légende d'indicateurs overlay
          (chart/overlayLegend.ts, z-10) et la recouvrait, avec un z supérieur. */}
      <div id="chart-grid-controls"
        onPointerDown={(event) => event.stopPropagation()}
        className={mobile
          ? `${controlsOpen ? "flex" : "hidden"} pointer-events-auto absolute right-1 top-12 z-30 max-h-[65dvh] w-[min(23rem,calc(100%-0.5rem))] flex-wrap items-center gap-1 overflow-y-auto rounded border border-border bg-surface p-2 shadow-xl`
          : "pointer-events-auto absolute bottom-2 right-2 z-20 flex items-center gap-1 rounded border border-border bg-surface/85 px-1 py-0.5 backdrop-blur"}
      >
        {LAYOUT_BUTTONS.map((b) => (
          <button
            key={b.mode}
            type="button"
            title={b.title}
            aria-label={b.title}
            aria-pressed={layout === b.mode}
            onClick={() => chartLayoutStore.getState().setLayout(b.mode)}
            className={`rounded ${commandSize} font-mono transition ${
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
          className={`rounded ${commandSize} leading-none transition ${
            linked ? "bg-accent/25 text-text" : "text-text-dim hover:bg-bg hover:text-text"
          }`}
        >
          {mobile ? "⛓ Symboles liés" : "⛓"}
        </button>
        {count > 1 && (
          <Suspense fallback={null}>
            <ChartSyncControls mobile={mobile} />
          </Suspense>
        )}
      </div>

      <div className={mobile ? "relative min-h-0 w-full flex-1" : `grid min-h-0 w-full flex-1 gap-px bg-border ${GRID_CLASS[layout]}`}>
        {/* Slot 0 : maître (store global, jeu complet de contrôleurs). */}
        <div id="chart-slot-0" data-chart-slot="0" aria-hidden={mobile && focus !== 0} className={slotClass(0)}>
          <Chart />
        </div>
        {/* Slots secondaires visibles selon le mode. */}
        {count >= 2 && stores[0] && (
          <div id="chart-slot-1" data-chart-slot="1" aria-hidden={mobile && focus !== 1} className={slotClass(1)}>
            <ChartInstance store={stores[0]} slot={1} role="secondary" {...makeHandlers(1)} />
          </div>
        )}
        {count >= 4 && stores[1] && (
          <div id="chart-slot-2" data-chart-slot="2" aria-hidden={mobile && focus !== 2} className={slotClass(2)}>
            <ChartInstance store={stores[1]} slot={2} role="secondary" {...makeHandlers(2)} />
          </div>
        )}
        {count >= 4 && stores[2] && (
          <div id="chart-slot-3" data-chart-slot="3" aria-hidden={mobile && focus !== 3} className={slotClass(3)}>
            <ChartInstance store={stores[2]} slot={3} role="secondary" {...makeHandlers(3)} />
          </div>
        )}
      </div>
    </div>
  );
}
