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
 */
import type { Chart } from "klinecharts";
import { ActionType, DomPosition } from "klinecharts";
import { getIndicator } from "@axiom/indicators";
import { indicatorsStore, formatInstanceLabel, type ActiveIndicator } from "../store/indicators";
import { indicatorMenuUiStore } from "../store/indicator-menu-ui";
import {
  creerBoutonFermer,
  creerBoutonReglages,
  creerLibelle,
  creerPastille,
  majEtiquettes,
  majLibelle,
  majPastille,
} from "./legendeControles";

const CANDLE_PANE_ID = "candle_pane";
/** Espace vertical entre deux lignes empilées (px). */
const ROW_GAP = 2;

interface EntreeLegende {
  instanceId: string;
  label: string;
  couleurIdx: number;
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
    });
  }
  return result;
}

export class OverlayLegend {
  private readonly chart: Chart;
  private readonly container: HTMLElement;
  private readonly els = new Map<string, HTMLDivElement>();
  private readonly onPaneDrag = (): void => this.repositionnerTout();
  private readonly onDataReady = (): void => this.repositionnerTout();

  constructor(chart: Chart, container: HTMLElement) {
    this.chart = chart;
    this.container = container;
    this.chart.subscribeAction(ActionType.OnPaneDrag, this.onPaneDrag);
    this.chart.subscribeAction(ActionType.OnDataReady, this.onDataReady);
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
        this.container.appendChild(el);
      } else {
        majPastille(el, entry.couleurIdx);
        majLibelle(el, entry.label);
        majEtiquettes(el, entry.label);
      }
    }
    this.repositionnerTout();
  }

  private creerElement(entry: EntreeLegende): HTMLDivElement {
    const el = document.createElement("div");
    el.className =
      "pointer-events-auto absolute z-10 flex items-center gap-1.5 rounded bg-surface/90 px-1.5 py-0.5 text-[10px] text-text-dim shadow-sm";

    el.append(
      creerPastille(entry.couleurIdx),
      creerLibelle(entry.label),
      creerBoutonReglages(entry.label, () =>
        indicatorMenuUiStore.getState().ouvrirSurInstance(entry.instanceId)
      ),
      creerBoutonFermer(entry.label, () => indicatorsStore.getState().remove(entry.instanceId))
    );
    return el;
  }

  private repositionnerTout(): void {
    const main = this.chart.getSize(CANDLE_PANE_ID, DomPosition.Main);
    if (!main) {
      for (const el of this.els.values()) el.style.display = "none";
      return;
    }
    let y = main.top + 2;
    for (const entry of overlayIndicators(indicatorsStore.getState().indicators)) {
      const el = this.els.get(entry.instanceId);
      if (!el) continue;
      el.style.display = "";
      el.style.top = `${y}px`;
      el.style.left = `${Math.max(2, main.left + main.width - el.offsetWidth - 4)}px`;
      y += el.offsetHeight + ROW_GAP;
    }
  }

  dispose(): void {
    this.chart.unsubscribeAction(ActionType.OnPaneDrag, this.onPaneDrag);
    this.chart.unsubscribeAction(ActionType.OnDataReady, this.onDataReady);
    for (const el of this.els.values()) el.remove();
    this.els.clear();
  }
}
