/**
 * En-têtes overlay DOM des panes d'indicateurs séparés (RSI, MACD…) : croix de
 * fermeture directe (appelle `indicatorsStore.remove`) et poignée de drag pour
 * réordonner. Pattern contrôleur identique à `ChartIndicators`/`OrderflowController`
 * (constructor(chart, container) -> sync() -> dispose()).
 *
 * Les indicateurs en overlay (EMA sur les bougies, `def.pane === "overlay"`) n'ont
 * pas de pane séparé : pas d'en-tête flottant pour eux, ils restent gérés depuis le
 * menu Indicateurs.
 *
 * Positionnement : `chart.getSize(paneId)` renvoie un `Bounding { top, left, width,
 * height, ... }` (vérifié sur klinecharts@9.8.12/dist/index.d.ts) ou `null` tant que
 * le pane n'existe pas encore dans le registre interne de KLineChart. Recalculé sur
 * l'événement natif `onPaneDrag` (redimensionnement manuel d'un pane), sur
 * `onDataReady` (cf. klinecharts/dist/index.esm.js ~L.6563 : `ChartStore.addData`
 * exécute `OnDataReady` après `adjustPaneViewport` à CHAQUE `updateData`/`addData`,
 * y compris le flux de ticks live — ce n'est PAS un filet de sécurité rare, ça tourne
 * en pratique ~10×/s par instance de chart. Sans coût notable pour autant :
 * `repositionnerTout()` ne fait que `getSize` + écritures `style.top` idempotentes,
 * aucun re-render React) ET à chaque `sync()` (ajout/retrait/réordonnancement
 * d'indicateur — déclenché par `ChartInstance` après `ChartIndicators.sync()`,
 * y compris au premier montage avec des indicateurs déjà persistés).
 *
 * Réordonnancement : PaneOptions n'a pas de champ `order` en v9.8.12 — le calcul du
 * nouvel ordre (`computeDropOrder`) est appliqué à `indicatorsStore.reorder(...)`,
 * qui déclenche `ChartIndicators.sync()` (abonné à `indicatorsStore`) — c'est CE
 * contrôleur qui retire/recrée les panes dans le nouvel ordre (cf. chart/indicators.ts
 * Task 4). `PaneHeaders` ne manipule donc jamais directement l'ordre des panes.
 */
import type { Chart } from "klinecharts";
import { ActionType } from "klinecharts";
import { getIndicator } from "@axiom/indicators";
import { indicatorsStore, formatInstanceLabel } from "../store/indicators";
import { axiomPaneId } from "./indicators";
import { computeDropOrder } from "./paneOrder";

interface EnTetePane {
  instanceId: string;
  paneId: string;
  label: string;
}

/** Panes séparés (hors overlay) VOULUS, dans l'ordre courant du store. */
function panesSepares(): EnTetePane[] {
  const result: EnTetePane[] = [];
  for (const inst of indicatorsStore.getState().indicators) {
    const def = getIndicator(inst.defId);
    if (!def || def.pane === "overlay") continue;
    result.push({ instanceId: inst.instanceId, paneId: axiomPaneId(inst.instanceId), label: formatInstanceLabel(def, inst.params) });
  }
  return result;
}

export class PaneHeaders {
  private readonly chart: Chart;
  private readonly container: HTMLElement;
  private readonly els = new Map<string, HTMLDivElement>();
  private draggingId: string | null = null;
  private readonly onPaneDrag = (): void => this.repositionnerTout();
  private readonly onDataReady = (): void => this.repositionnerTout();

  constructor(chart: Chart, container: HTMLElement) {
    this.chart = chart;
    this.container = container;
    this.chart.subscribeAction(ActionType.OnPaneDrag, this.onPaneDrag);
    this.chart.subscribeAction(ActionType.OnDataReady, this.onDataReady);
  }

  /** Réconcilie les en-têtes avec la liste courante d'indicateurs à pane séparé. */
  sync(): void {
    const panes = panesSepares();
    const wanted = new Set(panes.map((p) => p.instanceId));
    for (const [id, el] of this.els) {
      if (!wanted.has(id)) {
        el.remove();
        this.els.delete(id);
      }
    }
    for (const pane of panes) {
      let el = this.els.get(pane.instanceId);
      if (!el) {
        el = this.creerElement(pane);
        this.els.set(pane.instanceId, el);
        this.container.appendChild(el);
      } else {
        const label = el.querySelector<HTMLSpanElement>("[data-role=label]");
        if (label) label.textContent = pane.label;
      }
    }
    this.repositionnerTout();
  }

  private repositionnerTout(): void {
    for (const pane of panesSepares()) {
      const el = this.els.get(pane.instanceId);
      if (el) this.positionner(pane.paneId, el);
    }
  }

  private creerElement(pane: EnTetePane): HTMLDivElement {
    const el = document.createElement("div");
    el.className =
      "pointer-events-auto absolute left-2 z-10 flex items-center gap-1.5 rounded bg-surface/90 px-1.5 py-0.5 text-[10px] text-text-dim shadow-sm";

    const poignee = document.createElement("span");
    poignee.textContent = "⠿";
    poignee.className = "cursor-grab select-none";
    poignee.addEventListener("pointerdown", (e) => this.demarrerDrag(e, pane.instanceId));

    const label = document.createElement("span");
    label.textContent = pane.label;
    label.setAttribute("data-role", "label");
    label.className = "max-w-[120px] truncate";

    const croix = document.createElement("button");
    croix.textContent = "✕";
    croix.type = "button";
    croix.className = "leading-none text-text-dim hover:text-text";
    croix.addEventListener("click", () => indicatorsStore.getState().remove(pane.instanceId));

    el.append(poignee, label, croix);
    return el;
  }

  private positionner(paneId: string, el: HTMLDivElement): void {
    const bounding = this.chart.getSize(paneId);
    if (!bounding) {
      el.style.display = "none";
      return;
    }
    el.style.display = "";
    el.style.top = `${bounding.top + 2}px`;
  }

  private demarrerDrag(e: PointerEvent, instanceId: string): void {
    e.preventDefault();
    this.draggingId = instanceId;
    const onMove = (ev: PointerEvent): void => this.pendantDrag(ev);
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      this.draggingId = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  private pendantDrag(e: PointerEvent): void {
    if (!this.draggingId) return;
    const panes = panesSepares();
    const containerRect = this.container.getBoundingClientRect();
    const relativeY = e.clientY - containerRect.top;
    let dropIndex = 0;
    for (const pane of panes) {
      if (pane.instanceId === this.draggingId) continue;
      const bounding = this.chart.getSize(pane.paneId);
      if (bounding && bounding.top + bounding.height / 2 < relativeY) dropIndex++;
    }
    const order = computeDropOrder(
      panes.map((p) => p.instanceId),
      this.draggingId,
      dropIndex
    );
    indicatorsStore.getState().reorder(order);
  }

  dispose(): void {
    this.chart.unsubscribeAction(ActionType.OnPaneDrag, this.onPaneDrag);
    this.chart.unsubscribeAction(ActionType.OnDataReady, this.onDataReady);
    for (const el of this.els.values()) el.remove();
    this.els.clear();
  }
}
