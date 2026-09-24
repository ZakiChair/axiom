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
 *
 * Statut : un pane qui ne trace rien affiche POURQUOI (« UNUSABLE », « indisponible » ou
 * « chargement » + raison, title complet) — le suffixe « (UNUSABLE) » du shortName reste
 * invisible (légende native `showName: false`). La raison vient du canal de statuts du
 * graphe (`abonnerStatutsIndicateurs`), notifié à chaque CHANGEMENT de statut.
 */
import type { Chart } from "klinecharts";
import { ActionType, DomPosition } from "klinecharts";
import { getIndicator } from "@axiom/indicators";
import { indicatorsStore, formatInstanceLabel } from "../store/indicators";
import { indicatorMenuUiStore } from "../store/indicator-menu-ui";
import { abonnerStatutsIndicateurs, axiomPaneId, statutIndicateur, type StatutIndicateur } from "./indicators";
import { estReglable } from "./legendeReglable";
import {
  creerBoutonFermer,
  creerBoutonReglages,
  creerLibelle,
  creerPastille,
  majEtiquettes,
  majLibelle,
  majPastille,
} from "./legendeControles";
import { computeDropOrder } from "./paneOrder";

interface EnTetePane {
  instanceId: string;
  paneId: string;
  label: string;
  couleurIdx: number;
  /** Le ⚙ mène-t-il à un éditeur réel ? (cf. legendeReglable.ts) */
  reglable: boolean;
}

/** Libellé court du badge, par état. */
const BADGE_STATUT: Record<StatutIndicateur["etat"], string> = {
  unusable: "UNUSABLE",
  vide: "indisponible",
  chargement: "chargement",
};

/** Couleur du badge : rouge = panne, ambre = rien à tracer, neutre = attente d'une source. */
const COULEUR_STATUT: Record<StatutIndicateur["etat"], string> = {
  unusable: "bg-down/15 text-down",
  vide: "bg-warn/15 text-warn",
  chargement: "bg-text-dim/15 text-text-dim",
};

/** Présentation PURE d'un statut d'indicateur : `null` = valeurs tracées, pas de badge. */
export function presentationStatut(statut: StatutIndicateur | null): { badge: string; raison: string } | null {
  if (statut === null) return null;
  return { badge: BADGE_STATUT[statut.etat], raison: statut.raison };
}

/**
 * Pose, met à jour ou retire le badge de statut d'une ligne de légende, juste après le
 * libellé. Exportée : la légende des overlays (overlayLegend.ts) porte le même badge.
 */
export function majBadgeStatut(ligne: HTMLElement, statut: StatutIndicateur | null): void {
  const existant = ligne.querySelector<HTMLSpanElement>("[data-role=statut]");
  const vue = presentationStatut(statut);
  if (vue === null) {
    existant?.remove();
    return;
  }
  let conteneur = existant;
  if (conteneur === null) {
    conteneur = document.createElement("span");
    conteneur.setAttribute("data-role", "statut");
    conteneur.className = "flex min-w-0 items-center gap-1";
    const badge = document.createElement("span");
    badge.setAttribute("data-role", "statut-badge");
    const raison = document.createElement("span");
    raison.setAttribute("data-role", "statut-raison");
    raison.className = "max-w-[280px] truncate text-text-dim";
    conteneur.append(badge, raison);
    const libelle = ligne.querySelector<HTMLSpanElement>("[data-role=label]");
    if (libelle) libelle.after(conteneur);
    else ligne.append(conteneur);
  }
  // Texte court visible (le pane est vide, la place est libre) ; raison complète au survol.
  conteneur.title = vue.raison;
  conteneur.setAttribute("aria-label", `${vue.badge} : ${vue.raison}`);
  const badge = conteneur.querySelector<HTMLSpanElement>("[data-role=statut-badge]");
  if (badge) {
    badge.textContent = vue.badge;
    badge.className = `shrink-0 rounded px-1 text-[9px] tracking-wider ${statut ? COULEUR_STATUT[statut.etat] : ""}`;
  }
  const raison = conteneur.querySelector<HTMLSpanElement>("[data-role=statut-raison]");
  if (raison) raison.textContent = vue.raison;
}

/** Panes séparés (hors overlay) VOULUS, dans l'ordre courant du store. */
function panesSepares(): EnTetePane[] {
  const result: EnTetePane[] = [];
  for (const inst of indicatorsStore.getState().indicators) {
    const def = getIndicator(inst.defId);
    if (!def || def.pane === "overlay") continue;
    result.push({
      instanceId: inst.instanceId,
      paneId: axiomPaneId(inst.instanceId),
      label: formatInstanceLabel(def, inst.params),
      couleurIdx: inst.couleurIdx,
      reglable: estReglable(def),
    });
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
  private readonly desabonnerStatuts: () => void;

  constructor(chart: Chart, container: HTMLElement) {
    this.chart = chart;
    this.container = container;
    this.chart.subscribeAction(ActionType.OnPaneDrag, this.onPaneDrag);
    this.chart.subscribeAction(ActionType.OnDataReady, this.onDataReady);
    // Statut republié par ChartIndicators à chaque recalcul, notifié seulement s'il change.
    this.desabonnerStatuts = abonnerStatutsIndicateurs(chart, (instanceId) => {
      const el = this.els.get(instanceId);
      if (!el) return;
      majBadgeStatut(el, statutIndicateur(this.chart, instanceId));
      this.repositionnerTout(); // la largeur de l'en-tête a changé
    });
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
        majPastille(el, pane.couleurIdx);
        majLibelle(el, pane.label);
        majEtiquettes(el, pane.label);
      }
      majBadgeStatut(el, statutIndicateur(this.chart, pane.instanceId));
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
    // Ancré en haut à DROITE du pane (position calculée dans `positionner`) : la légende
    // native (nom + valeur) occupe le coin haut-GAUCHE, on décale donc les contrôles pour
    // ne pas la chevaucher. La PASTILLE de couleur y est reprise pour relier l'en-tête à
    // sa courbe, et le ⚙ ouvre les réglages sans passer par le menu latéral.
    el.className =
      "pointer-events-auto absolute z-10 flex items-center gap-1.5 rounded bg-surface/90 px-1.5 py-0.5 text-[10px] text-text-dim shadow-sm";

    const poignee = document.createElement("span");
    poignee.textContent = "⠿";
    poignee.className = "cursor-grab select-none";
    poignee.setAttribute("aria-hidden", "true"); // affordance visuelle de drag (souris)
    poignee.addEventListener("pointerdown", (e) => this.demarrerDrag(e, pane.instanceId));

    el.append(poignee, creerPastille(pane.couleurIdx), creerLibelle(pane.label));
    if (pane.reglable) {
      el.append(
        creerBoutonReglages(pane.label, () =>
          indicatorMenuUiStore.getState().ouvrirSurInstance(pane.instanceId)
        )
      );
    }
    el.append(
      creerBoutonFermer(pane.label, () => indicatorsStore.getState().remove(pane.instanceId))
    );
    return el;
  }

  private positionner(paneId: string, el: HTMLDivElement): void {
    // `top` depuis le pane complet ; `right` depuis l'aire de tracé (main, hors axe Y) pour
    // poser les contrôles juste avant l'axe Y, à droite de la légende native (coin gauche).
    const bounding = this.chart.getSize(paneId);
    const main = this.chart.getSize(paneId, DomPosition.Main);
    if (!bounding || !main) {
      el.style.display = "none";
      return;
    }
    el.style.display = "";
    el.style.top = `${bounding.top + 2}px`;
    // Bord droit de l'aire de tracé = `left + width` (le champ `right` de Bounding n'est PAS
    // la coordonnée du bord droit en klinecharts@9.8.12 ; cf. ChartInstance crosshair sync).
    el.style.left = `${Math.max(2, main.left + main.width - el.offsetWidth - 4)}px`;
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
    this.desabonnerStatuts();
    for (const el of this.els.values()) el.remove();
    this.els.clear();
  }
}
