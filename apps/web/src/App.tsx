/**
 * App — layout sombre plein écran : toolbar en haut, graphe sur le reste.
 *
 * Monte aussi les surfaces transverses : palette de commandes (⌘K), raccourcis
 * clavier globaux, runtime des alertes, et le mode plein écran (masque toolbars +
 * sidebar pour ne garder que le graphe).
 */
import { useEffect } from "react";
import { useStore } from "zustand";
import { Toolbar } from "./components/Toolbar";
import { DrawingToolbar } from "./components/DrawingToolbar";
import { Chart } from "./chart/Chart";
import { Watchlist } from "./components/Watchlist";
import { AlertsPanel } from "./components/AlertsPanel";
import { CompareControl } from "./components/CompareControl";
import { MacroPanel } from "./components/MacroPanel";
import { DerivativesWindow } from "./components/DerivativesWindow";
import { HealthPanel } from "./components/HealthPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { CommandPalette } from "./components/CommandPalette";
import { settingsUiStore } from "./store/settings-ui";
import { useRaccourcisGlobaux, fullscreenStore } from "./commands/hotkeys";
import { demarrerAlertes } from "./alerts/runtime";

export function App() {
  const openSettings = useStore(settingsUiStore, (s) => s.openSettings);
  const plein = useStore(fullscreenStore, (s) => s.plein);

  // Écouteur clavier global unique (TF, toggles, plein écran, palette…).
  useRaccourcisGlobaux();

  // Runtime des alertes : démarré une fois pour toute la session (idempotent,
  // compatible double montage React StrictMode). Arrêté au démontage.
  useEffect(() => {
    const stop = demarrerAlertes();
    return () => stop();
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg text-text">
      {/* Plein écran : toolbars et sidebar masquées, le graphe occupe tout l'écran. */}
      {!plein && <Toolbar />}
      {/* min-h-0 indispensable pour que le graphe (flex-1) prenne une hauteur réelle. */}
      <main className="flex min-h-0 flex-1">
        {/* Barre d'outils de dessin verticale, à gauche du graphe. */}
        {!plein && <DrawingToolbar />}
        {/* min-w-0 : le graphe peut rétrécir face aux panneaux latéraux. */}
        <div className="min-w-0 flex-1">
          <Chart />
        </div>
        {/* Colonne droite : en-tête (accès Réglages) + panneaux empilés, tous harmonisés
            via SidebarSection. Ordre : Watchlist, Alertes, Macro, Comparer, Santé. */}
        {!plein && (
          <aside className="flex w-60 shrink-0 flex-col border-l border-border bg-surface">
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
            <AlertsPanel />
            <MacroPanel />
            <CompareControl />
            <HealthPanel />
          </aside>
        )}
      </main>

      {/* Indice discret pour sortir du plein écran (aucune toolbar visible alors). */}
      {plein && (
        <div className="pointer-events-none fixed bottom-3 left-3 z-30 rounded border border-border bg-surface/80 px-2 py-1 text-[10px] text-text-dim">
          F ou Échap : quitter le plein écran
        </div>
      )}

      {/* Surfaces globales montées au niveau racine, au-dessus du reste. */}
      <DerivativesWindow />
      <SettingsPanel />
      <CommandPalette />
    </div>
  );
}
