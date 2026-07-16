/**
 * Toasts — pile de notifications éphémères en bas à droite (feedback des actions :
 * export PNG, workspace enregistré, playbook appliqué, sauvegarde…). Lit le store
 * vanilla `toastsStore` ; l'empilement (max 3) et l'auto-retrait (2500 ms) vivent dans
 * le store. Clic sur un toast = fermeture immédiate. `aria-live="polite"` pour les
 * lecteurs d'écran ; apparition discrète (fade-in opacity, keyframe `axiom-toast-in`).
 */
import { useStore } from "zustand";
import { retirerToast, toastsStore } from "../store/toasts";

export function Toasts() {
  const toasts = useStore(toastsStore, (s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2"
    >
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          onClick={() => retirerToast(toast.id)}
          style={{ animation: "axiom-toast-in 160ms ease-out" }}
          className="pointer-events-auto max-w-xs rounded-md border border-border bg-surface px-3 py-2 text-left text-xs text-text shadow-lg"
        >
          {toast.texte}
        </button>
      ))}
    </div>
  );
}
