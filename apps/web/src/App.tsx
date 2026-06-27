/**
 * App — layout sombre plein écran : toolbar en haut, graphe sur le reste.
 */
import { Toolbar } from "./components/Toolbar";
import { DrawingToolbar } from "./components/DrawingToolbar";
import { Chart } from "./chart/Chart";
import { Watchlist } from "./components/Watchlist";
import { DerivativesPanel } from "./components/DerivativesPanel";
import { MacroPanel } from "./components/MacroPanel";

export function App() {
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
        {/* Colonne droite : watchlist (haut, défilable) + panneaux Dérivés & Macro (bas). */}
        <aside className="flex w-60 shrink-0 flex-col border-l border-neutral-800 bg-neutral-950">
          <Watchlist />
          <DerivativesPanel />
          <MacroPanel />
        </aside>
      </main>
    </div>
  );
}
