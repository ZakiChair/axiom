/** Commandes chargées à l'ouverture de la multivue ; aucune donnée de navigation en React. */
import { useStore } from "zustand";
import { chartLayoutStore, visibleSlotCount, type ChartSyncOption } from "../store/chart-layout";
import { marketStore } from "../store/market";
import { replayStore } from "../store/replay";

const BUTTONS: { option: ChartSyncOption; label: string; title: string }[] = [
  { option: "syncTimeframe", label: "UT", title: "Synchroniser les unités de temps" },
  { option: "syncViewport", label: "Zoom", title: "Synchroniser le zoom et le défilement" },
  { option: "syncCrosshair", label: "Rét.", title: "Synchroniser le réticule" },
];

export default function ChartSyncControls() {
  const layout = useStore(chartLayoutStore, (s) => s.layout);
  const syncTimeframe = useStore(chartLayoutStore, (s) => s.syncTimeframe);
  const syncViewport = useStore(chartLayoutStore, (s) => s.syncViewport);
  const syncCrosshair = useStore(chartLayoutStore, (s) => s.syncCrosshair);
  const slots = useStore(chartLayoutStore, (s) => s.slots);
  const masterTimeframe = useStore(marketStore, (s) => s.timeframe);
  const replaySlot = useStore(replayStore, (s) => s.active || s.identityTransition ? s.slot : -1);
  const options = { syncTimeframe, syncViewport, syncCrosshair };
  const timeframes = [masterTimeframe, ...slots.map((s) => s.timeframe)]
    .slice(0, visibleSlotCount(layout))
    .flatMap((timeframe, slot) => slot === replaySlot ? [] : [{ slot, timeframe }]);
  const differents = syncTimeframe && new Set(timeframes.map((s) => s.timeframe)).size > 1;

  return <>
    {differents && (
      <div role="status" className="pointer-events-none absolute bottom-8 right-0 w-72 max-w-[90vw] rounded border border-border bg-surface/95 px-2 py-1 text-[10px] text-warn">
        Unités différentes : {timeframes.map((s) => `vue ${s.slot + 1} ${s.timeframe}`).join(" · ")}.
        {" "}Certaines sources peuvent ne pas accepter l’unité choisie.
      </div>
    )}
    <span className="mx-0.5 h-3 w-px bg-border" aria-hidden />
    {BUTTONS.map((b) => (
      <button key={b.option} type="button" title={b.title} aria-label={b.title}
        aria-pressed={options[b.option]}
        onClick={() => chartLayoutStore.getState().setSyncOption(b.option, !options[b.option])}
        className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition ${
          options[b.option] ? "bg-accent/25 text-text" : "text-text-dim hover:bg-bg hover:text-text"
        }`}
      >{b.label}</button>
    ))}
  </>;
}
