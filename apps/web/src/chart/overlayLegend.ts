/**
 * Légende des indicateurs « overlay » (EMA, BOLL, VWAP ancré…) sur le pane prix : une
 * ligne empilée par instance, croix ✕ = suppression instantanée. Pattern contrôleur
 * identique à `PaneHeaders` (panes séparés RSI/MACD), sans poignée de drag — l'ordre des
 * indicateurs overlay n'a pas d'utilité fonctionnelle (ils partagent tous `candle_pane`,
 * contrairement aux panes séparés empilés en hauteur).
 *
 * Positionné en haut à DROITE du pane prix pour ne pas chevaucher la légende native
 * (nom + valeur) de klinecharts, ancrée en haut-gauche — même convention que
 * `PaneHeaders` pour les panes séparés.
 *
 * Chaque ligne porte « ▪ Nom (params)  ⚙  ✕ ». La pastille relie visuellement la ligne
 * à sa courbe (couleur d'instance, cf. store/indicators.ts) ; le libellé porte
 * l'identité, que la couleur ne peut pas porter seule ; le ⚙ ouvre les réglages sans
 * quitter le graphe. Avant, la ligne ne contenait QU'une croix ✕ : trois EMA actives
 * donnaient trois croix identiques, et cliquer la mauvaise retirait la mauvaise courbe
 * sans annulation possible (revue du 2026-08-01 § 3.2).
 *
 * Un overlay qui ne trace rien porte le même badge de statut que les en-têtes de panes
 * (`majBadgeStatut`, raison lue sur le canal de statuts du graphe).
 */
import type { Chart } from "klinecharts";
import { ActionType, DomPosition } from "klinecharts";
import { getIndicator } from "@axiom/indicators";
import { indicatorsStore, formatInstanceLabel, type ActiveIndicator } from "../store/indicators";
import { indicatorMenuUiStore } from "../store/indicator-menu-ui";
import { estReglable } from "./legendeReglable";
import {
  creerBoutonFermer,
  creerBoutonReglages,
  creerLibelle,
  creerPastille,
  majEtiquettes,
  majLibelle,
  majPastille,
  adapterCiblesTactiles,
} from "./legendeControles";
import { abonnerStatutsIndicateurs, statutIndicateur } from "./indicators";
import { majBadgeStatut } from "./paneHeaders";

const CANDLE_PANE_ID = "candle_pane";
/** Espace vertical entre deux lignes empilées (px). */
const ROW_GAP = 2;

interface EntreeLegende {
  instanceId: string;
  label: string;
  couleurIdx: number;
  /** Le ⚙ mène-t-il à un éditeur réel ? (cf. legendeReglable.ts) */
  reglable: boolean;
}

/** Filtre les instances actives à `def.pane === "overlay"` (EMA/BOLL/VWAP…). PURE. */
export function overlayIndicators(indicators: readonly ActiveIndicator[]): EntreeLegende[] {
  const result: EntreeLegende[] = [];
  for (const inst of indicators) {
    const def = getIndicator(inst.defId);
    if (!def || def.pane !== "overlay") continue;
    result.push({
      instanceId: inst.instanceId,
      label: formatInstanceLabel(def, inst.params),
      couleurIdx: inst.couleurIdx,
      reglable: estReglable(def),
    });
  }
  return result;
}

export class OverlayLegend {
  private readonly chart: Chart;
  private readonly container: HTMLElement;
  private readonly els = new Map<string, HTMLDivElement>();
  private readonly panel: HTMLDivElement;
  private readonly toggle: HTMLButtonElement;
  private expanded = false;
  private readonly onPaneDrag = (): void => this.repositionnerTout();
  private readonly onDataReady = (): void => this.repositionnerTout();
  private readonly desabonnerStatuts: () => void;

  constructor(chart: Chart, container: HTMLElement, private readonly host: HTMLElement = container) {
    this.chart = chart;
    this.container = container;
    this.expanded = container.dataset["mobile"] !== "true";
    this.panel = document.createElement("div");
    this.panel.setAttribute("data-overlay-legend", "");
    this.toggle = document.createElement("button");
    this.toggle.type = "button";
    this.toggle.className = "pointer-events-auto absolute z-20 min-h-11 rounded border border-border bg-surface/95 px-3 text-xs text-text";
    this.toggle.addEventListener("click", () => {
      this.expanded = !this.expanded;
      this.repositionnerTout();
    });
    this.panel.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      this.expanded = false;
      this.repositionnerTout();
      this.toggle.focus();
    });
    this.host.append(this.toggle, this.panel);
    this.chart.subscribeAction(ActionType.OnPaneDrag, this.onPaneDrag);
    this.chart.subscribeAction(ActionType.OnDataReady, this.onDataReady);
    this.desabonnerStatuts = abonnerStatutsIndicateurs(chart, (instanceId) => {
      const el = this.els.get(instanceId);
      if (!el) return;
      majBadgeStatut(el, statutIndicateur(this.chart, instanceId));
      this.repositionnerTout(); // largeur et hauteur de la ligne ont pu changer
    });
  }

  /** Réconcilie la légende avec la liste courante d'indicateurs overlay. */
  sync(): void {
    const entries = overlayIndicators(indicatorsStore.getState().indicators);
    const wanted = new Set(entries.map((e) => e.instanceId));
    for (const [id, el] of this.els) {
      if (!wanted.has(id)) {
        el.remove();
        this.els.delete(id);
      }
    }
    for (const entry of entries) {
      let el = this.els.get(entry.instanceId);
      if (!el) {
        el = this.creerElement(entry);
        this.els.set(entry.instanceId, el);
        this.panel.appendChild(el);
      } else {
        majPastille(el, entry.couleurIdx);
        majLibelle(el, entry.label);
        majEtiquettes(el, entry.label);
      }
      majBadgeStatut(el, statutIndicateur(this.chart, entry.instanceId));
    }
    this.repositionnerTout();
  }

  private creerElement(entry: EntreeLegende): HTMLDivElement {
    const el = document.createElement("div");
    el.className =
      "pointer-events-auto absolute z-10 flex items-center gap-1.5 rounded bg-surface/90 px-1.5 py-0.5 text-[10px] text-text-dim shadow-sm";

    el.append(creerPastille(entry.couleurIdx), creerLibelle(entry.label));
    if (entry.reglable) {
      el.append(
        creerBoutonReglages(entry.label, () =>
          indicatorMenuUiStore.getState().ouvrirSurInstance(entry.instanceId)
        )
      );
    }
    el.append(
      creerBoutonFermer(entry.label, () => indicatorsStore.getState().remove(entry.instanceId))
    );
    return el;
  }

  private repositionnerTout(): void {
    const main = this.chart.getSize(CANDLE_PANE_ID, DomPosition.Main);
    const mobile = this.container.dataset.mobile === "true";
    const entries = overlayIndicators(indicatorsStore.getState().indicators);
    if (this.host !== this.container) {
      this.host.hidden = entries.length === 0;
      this.toggle.className = "axiom-chart-legend-toggle";
      this.toggle.textContent = `Indicateurs (${entries.length}) ${this.expanded ? "▴" : "▾"}`;
      this.toggle.setAttribute("aria-expanded", String(this.expanded));
      this.panel.className = "axiom-chart-legend-list";
      this.panel.hidden = !this.expanded;
      for (const el of this.els.values()) {
        el.className = "axiom-chart-legend-item";
        adapterCiblesTactiles(el, mobile);
      }
      return;
    }
    this.toggle.style.display = mobile && main && entries.length > 0 ? "" : "none";
    this.toggle.textContent = `Indicateurs (${entries.length}) ${this.expanded ? "▾" : "▴"}`;
    this.toggle.setAttribute("aria-expanded", String(this.expanded));
    this.toggle.style.left = "4px";
    this.toggle.style.bottom = "32px";
    this.panel.style.cssText = mobile
      ? `position:absolute;z-index:21;left:4px;bottom:80px;width:${Math.max(0, (main?.width ?? 0) - 8)}px;max-height:45%;overflow-y:auto;overscroll-behavior:contain;display:${this.expanded ? "flex" : "none"};flex-direction:column;gap:2px;pointer-events:auto;`
      : "display:contents";
    if (!main) {
      for (const el of this.els.values()) el.style.display = "none";
      return;
    }
    let y = main.top + 2;
    for (const entry of entries) {
      const el = this.els.get(entry.instanceId);
      if (!el) continue;
      el.style.display = "";
      el.style.position = mobile ? "relative" : "absolute";
      adapterCiblesTactiles(el, mobile);
      if (mobile) {
        el.style.top = "";
        el.style.left = "";
        el.style.flexShrink = "0";
        continue;
      }
      el.style.top = `${y}px`;
      el.style.left = `${Math.max(2, main.left + main.width - el.offsetWidth - 4)}px`;
      y += el.offsetHeight + ROW_GAP;
    }
  }

  dispose(): void {
    this.chart.unsubscribeAction(ActionType.OnPaneDrag, this.onPaneDrag);
    this.chart.unsubscribeAction(ActionType.OnDataReady, this.onDataReady);
    this.desabonnerStatuts();
    for (const el of this.els.values()) el.remove();
    this.els.clear();
    this.panel.remove();
    this.toggle.remove();
  }
}
