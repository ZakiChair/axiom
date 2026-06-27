/**
 * App — layout sombre plein écran : toolbar en haut, graphe sur le reste.
 */
import { useStore } from "zustand";
import { Toolbar } from "./components/Toolbar";
import { DrawingToolbar } from "./components/DrawingToolbar";
import { Chart } from "./chart/Chart";
import { Watchlist } from "./components/Watchlist";
import { CompareControl } from "./components/CompareControl";
import { DerivativesPanel } from "./components/DerivativesPanel";
import { MacroPanel } from "./components/MacroPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { settingsUiStore } from "./store/settings-ui";

export function App() {
  const openSettings = useStore(settingsUiStore, (s) => s.openSettings);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg text-text">
      <Toolbar />
      {/* min-h-0 indispensable pour que le graphe (flex-1) prenne une hauteur réelle. */}
      <main className="flex min-h-0 flex-1">
        {/* Barre d'outils de dessin verticale, à gauche du graphe. */}
        <DrawingToolbar />
        {/* min-w-0 : le graphe peut rétrécir face aux panneaux latéraux. */}
        <div className="min-w-0 flex-1">
          <Chart />
        </div>
        {/* Colonne droite : en-tête (accès Réglages) + panneaux empilés, tous harmonisés
            via SidebarSection (watchlist défilable en haut, puis comparer / dérivés / macro). */}
        <aside className="flex w-60 shrink-0 flex-col border-l border-border bg-neutral-950">
          <div className="flex shrink-0 items-center justify-between px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-dim">
              Panneaux
            </span>
            <button
              type="button"
              onClick={openSettings}
              aria-label="Ouvrir les réglages"
              title="Réglages"
              className="rounded p-1 text-text-dim transition hover:bg-surface hover:text-text"
            >
              <span aria-hidden className="text-sm leading-none">
                ⚙
              </span>
            </button>
          </div>
          <Watchlist />
          <CompareControl />
          <DerivativesPanel />
          <MacroPanel />
        </aside>
      </main>

      {/* Panneau Réglages (slide-over) monté au niveau racine, au-dessus du reste. */}
      <SettingsPanel />
    </div>
  );
}
