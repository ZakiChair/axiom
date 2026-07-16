/**
 * Chrome générique d'une fenêtre flottante (Launchpad) — enveloppe le contenu de
 * chacune des 15 fenêtres Bloomberg (ECO, NEWS, CORR…). Gère position/taille/z-order/
 * minimize/fermeture/groupe de couleur via `windowManagerStore` (source de vérité
 * unique). Le contenu métier de chaque fenêtre reste inchangé (monté en enfant).
 *
 * Drag/resize en pointer events maison (aucune nouvelle dépendance). Écritures
 * DOM impératives pendant le drag/resize (pas de state React à 60fps) : seule la
 * position FINALE (pointerup) déclenche un `set()` Zustand — les déplacements
 * intermédiaires manipulent `style.left/top/width/height` directement.
 */
import { useRef, useState } from "react";
import { useStore } from "zustand";
import {
  windowManagerStore,
  clampPosition,
  clampSize,
  detectSnapZone,
  snapGeometry,
  MIN_WIDTH,
  MIN_HEIGHT,
  GROUP_PALETTE,
  type SnapZone,
} from "../store/windowManager";

export interface FloatingWindowProps {
  id: string;
  title: string;
  mnemonic: string;
  children: React.ReactNode;
}

type PoigneeResize = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const POIGNEES: { id: PoigneeResize; className: string; dw: number; dh: number; dx: number; dy: number }[] = [
  { id: "e", className: "right-0 top-2 bottom-2 w-3 cursor-ew-resize", dw: 1, dh: 0, dx: 0, dy: 0 },
  { id: "w", className: "left-0 top-2 bottom-2 w-3 cursor-ew-resize", dw: -1, dh: 0, dx: 1, dy: 0 },
  { id: "s", className: "bottom-0 left-2 right-2 h-3 cursor-ns-resize", dw: 0, dh: 1, dx: 0, dy: 0 },
  { id: "n", className: "top-0 left-2 right-2 h-3 cursor-ns-resize", dw: 0, dh: -1, dx: 0, dy: 1 },
  { id: "se", className: "right-0 bottom-0 h-3 w-3 cursor-nwse-resize", dw: 1, dh: 1, dx: 0, dy: 0 },
  { id: "sw", className: "left-0 bottom-0 h-3 w-3 cursor-nesw-resize", dw: -1, dh: 1, dx: 1, dy: 0 },
  { id: "ne", className: "right-0 top-0 h-3 w-3 cursor-nesw-resize", dw: 1, dh: -1, dx: 0, dy: 1 },
  { id: "nw", className: "left-0 top-0 h-3 w-3 cursor-nwse-resize", dw: -1, dh: -1, dx: 1, dy: 1 },
];

export function FloatingWindow({ id, title, mnemonic, children }: FloatingWindowProps) {
  const etat = useStore(windowManagerStore, (s) => s.windows[id]);
  const rootRef = useRef<HTMLDivElement>(null);
  const [menuGroupeOuvert, setMenuGroupeOuvert] = useState(false);

  if (!etat || !etat.open || etat.minimized) return null;

  const focus = (): void => windowManagerStore.getState().focusWindow(id);

  /** Bascule maximiser ↔ restaurer en RÉUTILISANT le mécanisme de snap Aero existant :
   * si la fenêtre est actuellement issue d'un snap/maximisation (`preSnapGeometry` non
   * nul), on restaure la géométrie mémorisée ; sinon on maximise plein workspace
   * (`snapGeometry("top")`), `snapWindow` sauvegardant la géométrie courante au passage. */
  const basculerMaximiser = (): void => {
    const store = windowManagerStore.getState();
    const courant = store.windows[id];
    if (!courant) return;
    const preSnap = courant.preSnapGeometry;
    if (preSnap) {
      store.moveWindow(id, preSnap.x, preSnap.y);
      store.resizeWindow(id, preSnap.width, preSnap.height);
      store.setPreSnapGeometry(id, null);
    } else {
      store.snapWindow(id, snapGeometry("top", store.workspace));
    }
  };

  /** Double-clic sur l'en-tête = maximiser/restaurer, comme Windows/macOS. Ignoré sur la
   * zone des boutons (`data-no-drag`) pour ne pas se déclencher lors d'un double-clic
   * rapide sur —/▢/✕ ou le sélecteur de couleur. */
  const doubleClicEntete = (e: React.MouseEvent): void => {
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    basculerMaximiser();
  };

  const demarrerDrag = (e: React.PointerEvent): void => {
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    e.preventDefault();
    focus();
    // Si la fenêtre est actuellement issue d'un snap (maximisée/ancrée), le PREMIER
    // pointermove la restaure immédiatement à sa taille d'avant, le curseur restant au
    // même point relatif dans l'en-tête (comportement Windows/macOS standard) — sinon
    // une fenêtre plein-workspace n'a AUCUNE position valide autre que la sienne
    // (confinement strict) et le drag serait un no-op perpétuel.
    const preSnap = etat.preSnapGeometry;
    const depart = { x: e.clientX, y: e.clientY, wx: etat.x, wy: etat.y, w: etat.width, h: etat.height };
    let refX = depart.wx;
    let refY = depart.wy;
    let refCursorX = depart.x;
    let refCursorY = depart.y;
    let largeurCourante = depart.w;
    let hauteurCourante = depart.h;
    let dernierePosition = { x: depart.wx, y: depart.wy };
    let derniereZone: SnapZone | null = null;
    let aRestaure = false;
    const onMove = (ev: PointerEvent): void => {
      const workspace = windowManagerStore.getState().workspace;
      if (preSnap && !aRestaure) {
        aRestaure = true;
        const relX = (depart.x - depart.wx) / depart.w;
        const relY = (depart.y - depart.wy) / depart.h;
        largeurCourante = preSnap.width;
        hauteurCourante = preSnap.height;
        refX = ev.clientX - relX * largeurCourante;
        refY = ev.clientY - relY * hauteurCourante;
        refCursorX = ev.clientX;
        refCursorY = ev.clientY;
        if (rootRef.current) {
          rootRef.current.style.width = `${largeurCourante}px`;
          rootRef.current.style.height = `${hauteurCourante}px`;
        }
      }
      const dx = ev.clientX - refCursorX;
      const dy = ev.clientY - refCursorY;
      const { x, y } = clampPosition(refX + dx, refY + dy, largeurCourante, hauteurCourante, workspace);
      dernierePosition = { x, y };
      if (rootRef.current) {
        rootRef.current.style.left = `${x}px`;
        rootRef.current.style.top = `${y}px`;
      }
      const zone = detectSnapZone(ev.clientX, ev.clientY, workspace);
      if (zone !== derniereZone) {
        derniereZone = zone;
        windowManagerStore.getState().setDragPreview(zone ? snapGeometry(zone, workspace) : null);
      }
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (derniereZone) {
        const geo = snapGeometry(derniereZone, windowManagerStore.getState().workspace);
        windowManagerStore.getState().snapWindow(id, geo);
      } else {
        windowManagerStore.getState().moveWindow(id, dernierePosition.x, dernierePosition.y);
        if (aRestaure) {
          windowManagerStore.getState().resizeWindow(id, largeurCourante, hauteurCourante);
          windowManagerStore.getState().setPreSnapGeometry(id, null);
        }
      }
      windowManagerStore.getState().setDragPreview(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const demarrerResize = (poignee: (typeof POIGNEES)[number]): ((e: React.PointerEvent) => void) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    focus();
    const depart = { x: e.clientX, y: e.clientY, w: etat.width, h: etat.height, wx: etat.x, wy: etat.y };
    let dernierEtat = { width: depart.w, height: depart.h, x: depart.wx, y: depart.wy };
    const onMove = (ev: PointerEvent): void => {
      const workspace = windowManagerStore.getState().workspace;
      const dx = ev.clientX - depart.x;
      const dy = ev.clientY - depart.y;
      const largeurBrute = depart.w + poignee.dw * dx;
      const hauteurBrute = depart.h + poignee.dh * dy;
      const { width, height } = clampSize(largeurBrute, hauteurBrute, MIN_WIDTH, MIN_HEIGHT, workspace);
      const xBrut = poignee.dx ? depart.wx + (depart.w - width) : depart.wx;
      const yBrut = poignee.dy ? depart.wy + (depart.h - height) : depart.wy;
      // Confinement strict : la poignée "w"/"n"/"nw"… peut recalculer x/y au-delà du
      // bord du workspace quand la taille brute demandée dépasse ce qui est disponible
      // de ce côté — clampPosition (appliqué à width/height déjà cohérents) referme
      // systématiquement l'écart, quelle que soit la poignée utilisée.
      const { x, y } = clampPosition(xBrut, yBrut, width, height, workspace);
      dernierEtat = { width, height, x, y };
      if (rootRef.current) {
        rootRef.current.style.width = `${width}px`;
        rootRef.current.style.height = `${height}px`;
        rootRef.current.style.left = `${x}px`;
        rootRef.current.style.top = `${y}px`;
      }
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      windowManagerStore.getState().resizeWindow(id, dernierEtat.width, dernierEtat.height);
      windowManagerStore.getState().moveWindow(id, dernierEtat.x, dernierEtat.y);
      windowManagerStore.getState().setPreSnapGeometry(id, null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      ref={rootRef}
      role="complementary"
      aria-label={title}
      onPointerDownCapture={focus}
      style={{
        position: "fixed",
        left: etat.x,
        top: etat.y,
        width: etat.width,
        height: etat.height,
        zIndex: etat.z,
      }}
      className="flex flex-col rounded border border-border bg-surface shadow-2xl"
    >
      <header
        onPointerDown={demarrerDrag}
        onDoubleClick={doubleClicEntete}
        className="flex shrink-0 cursor-move items-center justify-between gap-2 rounded-t border-b border-border bg-bg px-2 py-1.5"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="w-14 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-text-dim">
            {mnemonic}
          </span>
          <span className="truncate text-xs font-medium text-text">{title}</span>
        </div>
        <div className="relative flex shrink-0 items-center gap-1" data-no-drag>
          <button
            type="button"
            title="Couleur de groupe"
            onClick={() => setMenuGroupeOuvert((o) => !o)}
            className="h-3.5 w-3.5 rounded-full border border-border"
            style={{ backgroundColor: etat.groupColor ?? "transparent" }}
          />
          {menuGroupeOuvert && (
            <div className="absolute right-0 top-5 z-10 flex gap-1 rounded border border-border bg-surface p-1 shadow-xl">
              <button
                type="button"
                title="Aucun groupe"
                onClick={() => {
                  windowManagerStore.getState().setGroup(id, null);
                  setMenuGroupeOuvert(false);
                }}
                className="h-4 w-4 rounded-full border border-border"
              />
              {GROUP_PALETTE.map((couleur) => (
                <button
                  key={couleur}
                  type="button"
                  title={couleur}
                  onClick={() => {
                    windowManagerStore.getState().setGroup(id, couleur);
                    setMenuGroupeOuvert(false);
                  }}
                  className="h-4 w-4 rounded-full"
                  style={{ backgroundColor: couleur }}
                />
              ))}
            </div>
          )}
          <button
            type="button"
            title="Réduire"
            onClick={() => windowManagerStore.getState().minimizeWindow(id)}
            className="rounded px-1 text-xs leading-none text-text-dim hover:bg-bg hover:text-text"
          >
            —
          </button>
          <button
            type="button"
            title="Maximiser / Restaurer"
            onClick={basculerMaximiser}
            className="rounded px-1 text-xs leading-none text-text-dim hover:bg-bg hover:text-text"
          >
            ▢
          </button>
          <button
            type="button"
            title="Fermer"
            onClick={() => windowManagerStore.getState().closeWindow(id)}
            className="rounded px-1 text-xs leading-none text-text-dim hover:bg-bg hover:text-text"
          >
            ✕
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {POIGNEES.map((p) => (
        <div key={p.id} onPointerDown={demarrerResize(p)} className={`absolute ${p.className}`} />
      ))}
    </div>
  );
}
