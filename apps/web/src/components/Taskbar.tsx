// apps/web/src/components/Taskbar.tsx
/**
 * Taskbar permanente des fenêtres OUVERTES — une pastille par fenêtre `open` (réduite ou
 * non), dans l'ordre stable du registre. Visible dès qu'au moins une fenêtre est ouverte.
 *
 * Intégrée au FLUX du layout racine (dernier enfant du flex-col d'App) : quand elle est
 * rendue, elle réserve sa hauteur et le workspace (mesuré par `chartAreaRef`) se rétrécit
 * d'autant via le ResizeObserver — l'axe temporel du chart n'est donc plus masqué. Les
 * fenêtres flottantes (position `fixed`) passeront visuellement AU-DESSUS si elles la
 * chevauchent, comme pour la toolbar.
 *
 * Clic sur une pastille = toggle standard (`toggleFocusMinimize`, testé côté store) :
 * réduite → restaure au premier plan ; focalisée → réduit ; sinon → passe au premier plan.
 * Croix ✕ au survol = ferme la fenêtre. Deux actions globales en tête (« Tout restaurer »,
 * « Mosaïque »). L'état visuel (focus/atténuée) dérive de `etatPastille` (pur, testé).
 */
import { useStore } from "zustand";
import {
  windowManagerStore,
  WINDOW_REGISTRY,
  etatPastille,
  zFenetreFocalisee,
} from "../store/windowManager";
import { couleurAffichable } from "../store/compare";
import { BTN_SECONDAIRE } from "./ui";

/** Classes d'une pastille selon son état visuel. `opacity-60` en utilitaire d'élément
 *  (PAS de slash `/60` sur un token de thème — non fiable avec ces couleurs pilotées par
 *  variables CSS). */
function classesPastille(etat: "focus" | "minimisee" | "normale"): string {
  const base =
    "flex items-center gap-1.5 rounded border bg-bg px-2 py-1 text-[11px] transition-colors";
  if (etat === "focus") return `${base} border-accent text-accent`;
  if (etat === "minimisee") return `${base} border-border text-text-dim opacity-60 hover:text-text`;
  return `${base} border-border text-text-dim hover:text-text`;
}

/** Info-bulle décrivant l'action du clic selon l'état de la pastille. */
function titrePastille(etat: "focus" | "minimisee" | "normale", titre: string): string {
  if (etat === "minimisee") return `Restaurer ${titre}`;
  if (etat === "focus") return `Réduire ${titre}`;
  return `Passer ${titre} au premier plan`;
}

export function Taskbar() {
  const windows = useStore(windowManagerStore, (s) => s.windows);
  // Ordre stable = ordre du registre, filtré aux fenêtres ouvertes.
  const ouvertes = WINDOW_REGISTRY.filter((r) => windows[r.id]?.open);

  if (ouvertes.length === 0) return null;

  const zFocus = zFenetreFocalisee(windows);

  return (
    <div className="flex shrink-0 flex-wrap gap-1 border-t border-border bg-surface px-2 py-1">
      <button
        type="button"
        title="Restaurer toutes les fenêtres réduites"
        onClick={() => windowManagerStore.getState().restoreAll()}
        className={BTN_SECONDAIRE}
      >
        Tout restaurer
      </button>
      <button
        type="button"
        title="Disposer les fenêtres ouvertes en mosaïque"
        onClick={() => windowManagerStore.getState().tileOpenWindows()}
        className={BTN_SECONDAIRE}
      >
        Mosaïque
      </button>
      {ouvertes.map((entry) => {
        const w = windows[entry.id];
        if (!w) return null;
        const etat = etatPastille(w, zFocus);
        return (
          <div key={entry.id} className="group relative">
            <button
              type="button"
              title={titrePastille(etat, entry.title)}
              onClick={() => windowManagerStore.getState().toggleFocusMinimize(entry.id)}
              className={classesPastille(etat)}
            >
              {w.groupColor !== null && (
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: couleurAffichable(w.groupColor) }}
                />
              )}
              <span className="font-semibold uppercase tracking-wider">{entry.mnemonic}</span>
              <span className="max-w-[140px] truncate">{entry.title}</span>
            </button>
            {/* Fermeture — visible au survol de la pastille (bouton frère superposé). */}
            <button
              type="button"
              title="Fermer"
              onClick={() => windowManagerStore.getState().closeWindow(entry.id)}
              className="absolute right-0.5 top-1/2 z-10 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-sm bg-surface text-[10px] leading-none text-text-dim opacity-0 transition hover:text-down focus-visible:opacity-100 group-hover:opacity-100"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
