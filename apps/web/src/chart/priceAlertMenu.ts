/**
 * Menu contextuel clic-droit sur le pane prix → alerte prix-croise (lot B4).
 *
 * BRANCHE sur le DOM du chart (événement `contextmenu`) : KLineChart appelle déjà
 * `preventDefault` sur ce event (bloque le menu navigateur) et route le clic droit
 * des overlays vers `onRightClick` (suppression dessin dans drawing.ts). Sur la zone
 * vide du pane bougies, on affiche un menu minimal (↑ / ↓ / les deux) qui crée une
 * `AlertDef` via `alertePrixAuNiveau` et ouvre la section sidebar « Alertes ».
 *
 * Coordonnées : client → relatives au chart (absolute) → `convertFromPixel` pane
 * `candle_pane` pour obtenir le prix Y de l'échelle courante (linéaire / log / %).
 */
import type { Chart as KLineChartInstance } from "klinecharts";
import type { SensCroisement } from "@axiom/alerts";
import type { ExchangeId } from "@axiom/types";
import {
  alertePrixAuNiveau,
  alertsStore,
  arrondirNiveauAlerte,
  SECTION_ALERTES,
} from "../store/alerts";
import { uiSectionsStore } from "../store/ui-sections";
import { formatPrice } from "../lib/format";

/** Pane prix (id par défaut KLineChart). */
const CANDLE_PANE_ID = "candle_pane";

/** Id DOM unique du menu flottant (un seul à la fois dans le document). */
const MENU_DOM_ID = "axiom-price-alert-menu";

/** Source marché lue au moment du clic (symbole/source du slot hôte). */
export interface PriceAlertMarket {
  symbol: string;
  source: ExchangeId;
}

/** Entrée du menu (libellé + sens de croisement). */
export interface ItemMenuAlertePrix {
  sens: SensCroisement;
  label: string;
}

/**
 * PURE — extrait un prix valide depuis un point `convertFromPixel`.
 * Renvoie null si absent / non fini.
 */
export function extrairePrixPixel(point: { value?: number } | null | undefined): number | null {
  const v = point?.value;
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

/**
 * PURE — libellés du menu pour un niveau déjà arrondi.
 * Ordre : hausse, baisse, les deux.
 */
export function itemsMenuAlertePrix(niveau: number): ItemMenuAlertePrix[] {
  const n = formaterNiveauCourt(niveau);
  return [
    { sens: "hausse", label: `Alerte croisement ↑ ${n}` },
    { sens: "baisse", label: `Alerte croisement ↓ ${n}` },
    { sens: "les-deux", label: `Alerte croisement ↕ ${n}` },
  ];
}

/** PURE — niveau de prix au format standard du terminal (délègue à lib/format). */
export function formaterNiveauCourt(niveau: number): string {
  if (!Number.isFinite(niveau)) return String(niveau);
  return formatPrice(niveau);
}

/**
 * Convertit des coordonnées client (souris) en prix sur le pane bougies.
 * Renvoie null si hors pane / conversion impossible.
 *
 * Échelle : `convertFromPixel` sur `candle_pane` uniquement (pas le pane volume).
 * KLineChart renvoie la valeur de l'axe Y courant — en linéaire c'est le prix ;
 * en log / % le `value` exposé suit l'échelle du pane (API KLineChart). On
 * s'appuie dessus sans conversion manuelle supplémentaire.
 */
export function prixAuClic(
  chart: KLineChartInstance,
  chartDom: HTMLElement,
  clientX: number,
  clientY: number,
): number | null {
  const rect = chartDom.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  // Hors du bounding du pane prix (volume / sous-panes exclus).
  const bound = chart.getSize(CANDLE_PANE_ID);
  if (!bound) return null;
  if (y < bound.top || y > bound.top + bound.height) return null;
  if (x < bound.left || x > bound.left + bound.width) return null;

  // absolute:true → y relatif à la racine du chart (comme convertToPixel croisé).
  // Pane candle only : l'échelle prix (lin / log / %) est celle de ce pane.
  const raw = chart.convertFromPixel([{ x, y }], {
    paneId: CANDLE_PANE_ID,
    absolute: true,
  });
  const point = Array.isArray(raw) ? raw[0] : raw;
  const prix = extrairePrixPixel(point as { value?: number } | undefined);
  if (prix === null) return null;
  return arrondirNiveauAlerte(prix);
}

/**
 * Crée l'alerte prix-croise et ouvre la section sidebar « Alertes ».
 * Effet de bord (store) — appelé depuis le menu.
 */
export function creerAlerteDepuisMenu(
  market: PriceAlertMarket,
  niveau: number,
  sens: SensCroisement,
): void {
  const nouvelle = alertePrixAuNiveau(market.symbol, market.source, niveau, sens);
  alertsStore.getState().ajouter(nouvelle);
  uiSectionsStore.getState().setOpen(SECTION_ALERTES, true);
}

/**
 * Teardown des listeners window du menu ouvert (mousedown / keydown / scroll).
 * Module-level : `fermerMenu` doit toujours les retirer, y compris au choix d'item
 * ou à l'unbind — sinon fuites de handlers orphelins.
 */
let detacherListenersMenu: (() => void) | null = null;

/** Retire le menu s'il est monté + ses listeners window. */
function fermerMenu(): void {
  detacherListenersMenu?.();
  detacherListenersMenu = null;
  document.getElementById(MENU_DOM_ID)?.remove();
}

/**
 * Affiche le menu flottant près du curseur (coordonnées viewport).
 * Remplace tout menu précédent (DOM + listeners).
 */
function afficherMenu(
  clientX: number,
  clientY: number,
  niveau: number,
  market: PriceAlertMarket,
): void {
  fermerMenu();

  const menu = document.createElement("div");
  menu.id = MENU_DOM_ID;
  menu.setAttribute("role", "menu");
  menu.style.cssText = [
    "position:fixed",
    `left:${Math.round(clientX)}px`,
    `top:${Math.round(clientY)}px`,
    "z-index:80",
    "min-width:11rem",
    "padding:0.25rem 0",
    "border-radius:0.375rem",
    "border:1px solid var(--border)",
    "background:var(--surface)",
    "box-shadow:0 8px 24px rgba(0,0,0,0.35)",
    "font-size:11px",
    "color:var(--text)",
  ].join(";");

  // En-tête discret (niveau).
  const header = document.createElement("div");
  header.textContent = `Prix ${formaterNiveauCourt(niveau)}`;
  header.style.cssText =
    "padding:0.25rem 0.6rem 0.35rem;font-size:10px;color:var(--text-dim);border-bottom:1px solid var(--border);margin-bottom:0.15rem";
  menu.appendChild(header);

  for (const item of itemsMenuAlertePrix(niveau)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("role", "menuitem");
    btn.textContent = item.label;
    btn.style.cssText = [
      "display:block",
      "width:100%",
      "text-align:left",
      "padding:0.35rem 0.6rem",
      "background:transparent",
      "border:0",
      "color:inherit",
      "cursor:pointer",
      "font:inherit",
    ].join(";");
    btn.addEventListener("mouseenter", () => {
      btn.style.background = "var(--bg)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = "transparent";
    });
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      creerAlerteDepuisMenu(market, niveau, item.sens);
      fermerMenu(); // retire DOM + listeners window
    });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);

  // Clamp si déborde à droite / bas du viewport.
  const r = menu.getBoundingClientRect();
  let left = clientX;
  let top = clientY;
  if (r.right > window.innerWidth - 4) left = Math.max(4, window.innerWidth - r.width - 4);
  if (r.bottom > window.innerHeight - 4) top = Math.max(4, window.innerHeight - r.height - 4);
  if (left !== clientX || top !== clientY) {
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  }

  // Fermeture : clic extérieur, Escape, scroll — toujours via fermerMenu (cleanup unifié).
  const onDown = (e: MouseEvent): void => {
    if (menu.contains(e.target as Node)) return;
    fermerMenu();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") fermerMenu();
  };
  const onScroll = (): void => {
    fermerMenu();
  };

  // rAF : évite de fermer immédiatement sur le même contextmenu/mousedown.
  let attached = false;
  const rafId = requestAnimationFrame(() => {
    // Menu déjà fermé avant le rAF (unbind rapide / re-open) → ne pas attacher.
    if (!document.getElementById(MENU_DOM_ID)) return;
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    attached = true;
  });

  detacherListenersMenu = () => {
    cancelAnimationFrame(rafId);
    if (attached) {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      attached = false;
    }
  };
}

/**
 * Attache le gestionnaire clic-droit sur le DOM chart. Renvoie un teardown.
 * `getMarket` est relu à chaque clic (symbole/source du slot peuvent changer
 * sans remonter l'instance KLineChart — effet DONNÉES).
 */
export function bindPriceAlertMenu(
  chart: KLineChartInstance,
  chartDom: HTMLElement,
  getMarket: () => PriceAlertMarket,
): () => void {
  const onContextMenu = (e: MouseEvent): void => {
    const niveau = prixAuClic(chart, chartDom, e.clientX, e.clientY);
    if (niveau === null) {
      fermerMenu();
      return; // hors pane prix : laisser le comportement existant
    }
    e.preventDefault();
    e.stopPropagation();
    afficherMenu(e.clientX, e.clientY, niveau, getMarket());
  };

  chartDom.addEventListener("contextmenu", onContextMenu);
  return () => {
    chartDom.removeEventListener("contextmenu", onContextMenu);
    fermerMenu();
  };
}
