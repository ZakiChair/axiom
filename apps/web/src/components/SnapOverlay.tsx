/**
 * Aperçu semi-transparent affiché pendant le drag d'une fenêtre vers un bord (snap
 * façon Aero). Rendu CENTRALISÉ (monté une fois dans App.tsx, pas dans FloatingWindow)
 * pour garantir un z-index au-dessus de TOUTES les fenêtres quelle que soit celle en
 * cours de drag. Piloté par `windowManagerStore.dragPreview` (éphémère, non persisté).
 */
import { useStore } from "zustand";
import { windowManagerStore } from "../store/windowManager";

export function SnapOverlay() {
  const preview = useStore(windowManagerStore, (s) => s.dragPreview);
  if (!preview) return null;
  return (
    <div
      className="pointer-events-none fixed z-[9999] rounded border-2 border-accent bg-accent/20"
      style={{ left: preview.x, top: preview.y, width: preview.width, height: preview.height }}
    />
  );
}
