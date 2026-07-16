// apps/web/src/components/TaskbarMinimized.tsx
/**
 * Barre de tâches des fenêtres réduites — une pastille par fenêtre `minimized`,
 * clic = restaure + passe au premier plan. Vide (donc invisible) si aucune fenêtre
 * n'est réduite.
 */
import { useStore } from "zustand";
import { windowManagerStore, WINDOW_REGISTRY } from "../store/windowManager";

export function TaskbarMinimized() {
  const windows = useStore(windowManagerStore, (s) => s.windows);
  const reduites = Object.values(windows).filter((w) => w.open && w.minimized);

  if (reduites.length === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 flex gap-1 border-t border-border bg-surface px-2 py-1">
      <button
        type="button"
        title="Restaurer toutes les fenêtres réduites"
        onClick={() => windowManagerStore.getState().restoreAll()}
        className="rounded border border-border bg-bg px-2 py-1 text-[11px] font-medium text-text-dim hover:text-text"
      >
        Tout restaurer
      </button>
      <button
        type="button"
        title="Disposer les fenêtres ouvertes en mosaïque"
        onClick={() => windowManagerStore.getState().tileOpenWindows()}
        className="rounded border border-border bg-bg px-2 py-1 text-[11px] font-medium text-text-dim hover:text-text"
      >
        Mosaïque
      </button>
      {reduites.map((w) => {
        const entry = WINDOW_REGISTRY.find((r) => r.id === w.id);
        return (
          <button
            key={w.id}
            type="button"
            onClick={() => {
              windowManagerStore.getState().restoreWindow(w.id);
            }}
            className="flex items-center gap-1.5 rounded border border-border bg-bg px-2 py-1 text-[11px] text-text-dim hover:text-text"
          >
            <span className="font-semibold uppercase tracking-wider">{entry?.mnemonic ?? w.id}</span>
            <span className="max-w-[140px] truncate">{entry?.title ?? w.id}</span>
          </button>
        );
      })}
    </div>
  );
}
