import { createStore } from "zustand/vanilla";
import { WINDOW_REGISTRY, windowManagerStore, subscribeWindowNavigation, type WindowId } from "./windowManager";

export const RUBRIQUES = [
  { id: "marches", label: "Marchés", outils: ["brief", "marketMap", "mcap", "sect", "news", "fund"] },
  { id: "derives", label: "Dérivés", outils: ["derivatives", "fundingMatrix", "termStructure", "dom", "squeeze", "cbprem"] },
  { id: "liquidations", label: "Liquidations", outils: ["liquidations"] },
  { id: "options", label: "Options", outils: ["options", "vol"] },
  { id: "macro", label: "Macro", outils: ["eco", "macroRates", "cot", "globe", "netliq"] },
  { id: "onchain", label: "On-chain", outils: ["onchain", "stablecoins", "mine", "whales", "cycle", "btcPowerLaw"] },
  { id: "strategies", label: "Analyse & stratégies", outils: ["screener", "corr", "seasonality", "dist", "evts", "backtest"] },
  { id: "portefeuille", label: "Portefeuille", outils: ["portfolio", "paper", "expy", "notes", "scen"] },
  { id: "outils", label: "Outils", outils: ["replay", "data"] },
] as const satisfies readonly { id: string; label: string; outils: readonly WindowId[] }[];
export type Destination = WindowId | "chart";
export type PresentationMode = "pages" | "windows";
export type RubriqueId = typeof RUBRIQUES[number]["id"];
export function rubriqueDestination(active: Destination) {
  return RUBRIQUES.find((r) => (r.outils as readonly string[]).includes(active)) ?? RUBRIQUES[0];
}
export function outilsRubrique(id: RubriqueId) {
  const rubrique = RUBRIQUES.find((r) => r.id === id)!;
  return rubrique.outils.map((id) => WINDOW_REGISTRY.find((w) => w.id === id)!);
}
export function routeDestination(active: Destination): string {
  return `#/${rubriqueDestination(active).id}/${active}`;
}
export function parseDestination(hash: string): Destination | null {
  const active = hash.split("/")[2];
  if (active !== "chart" && !WINDOW_REGISTRY.some((w) => w.id === active)) return null;
  return routeDestination(active as Destination) === hash ? active as Destination : null;
}
export const navigationStore = createStore<{ active: Destination; mode: PresentationMode; derniers: Partial<Record<RubriqueId, WindowId>> }>(() => ({ active: "chart", mode: "pages", derniers: {} }));
function memoriser(active: Destination): void {
  navigationStore.setState(active === "chart" ? { active } : { active, derniers: { ...navigationStore.getState().derniers, [rubriqueDestination(active).id]: active } });
}
export function navigateRubrique(id: RubriqueId): void {
  navigateTool(navigationStore.getState().derniers[id] ?? outilsRubrique(id)[0]!.id);
}
function choisir(active: Destination, remplacer = false): void {
  if (navigationStore.getState().active === active) return;
  memoriser(active);
  if (typeof window !== "undefined" && window.location.hash !== "#spike") {
    window.history[remplacer ? "replaceState" : "pushState"](null, "", routeDestination(active));
  }
}
let generation = 0;
export function navigateTool(active: Destination): void {
  generation++;
  const previous = navigationStore.getState().active;
  choisir(active);
  if (active !== "chart" && (previous !== active || !windowManagerStore.getState().windows[active]?.open)) {
    windowManagerStore.getState().openWindow(active);
  }
}
export function setPresentationMode(mode: PresentationMode): void {
  windowManagerStore.getState().preserverGeometrie(mode === "pages");
  navigationStore.setState({ mode });
}
/** Restauration et historique ne produisent pas de nouvelles entrées. Les actions
 * synchrones d'un playbook sont regroupées en une seule destination finale. */
export function startNavigation(): () => void {
  setPresentationMode(navigationStore.getState().mode);
  let disposed = false;
  let pending: { id: string; fermer?: boolean; restaurer?: boolean } | undefined;
  const stop = subscribeWindowNavigation((event) => {
    pending = event;
    const origine = generation;
    queueMicrotask(() => {
      if (disposed || pending !== event || origine !== generation) return;
      pending = undefined;
      if (event.id === "chart" && event.restaurer) { choisir("chart", true); return; }
      if (!WINDOW_REGISTRY.some((w) => w.id === event.id)) return;
      if (event.fermer) {
        if (navigationStore.getState().active === event.id) choisir("chart", true);
      } else if (windowManagerStore.getState().windows[event.id]?.open) choisir(event.id as WindowId, event.restaurer);
    });
  });
  const restaurer = () => {
    generation++;
    if (window.location.hash === "#spike") return;
    const active = parseDestination(window.location.hash) ?? "chart";
    memoriser(active);
    if (active !== "chart") windowManagerStore.getState().openWindow(active);
    if (!parseDestination(window.location.hash)) window.history.replaceState(null, "", routeDestination(active));
  };
  if (typeof window !== "undefined") {
    restaurer();
    window.addEventListener("popstate", restaurer);
    window.addEventListener("hashchange", restaurer);
  }
  return () => {
    disposed = true;
    stop();
    if (typeof window !== "undefined") {
      window.removeEventListener("popstate", restaurer);
      window.removeEventListener("hashchange", restaurer);
    }
  };
}
