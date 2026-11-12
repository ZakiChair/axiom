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
 *
 * ACCROCHE (lot A) : un clic à ±6 px d'une ligne de niveau (overlays du chart maître)
 * propose l'alerte au prix EXACT de cette ligne, étiquette en en-tête et en message.
 *
 * ZONE FORTE (phase 2 d'AXIS, lot 2) : un clic dans la bande d'une zone forte d'AXIS S/R, ou à
 * 6 px, ajoute sous l'en-tête l'alerte de prix au BORD de cette zone (`alerteZone.ts`), à niveau
 * fixe ; les trois entrées au prix du clic restent dessous, inchangées.
 */
import type { Chart as KLineChartInstance } from "klinecharts";
import type { SensCroisement } from "@axiom/alerts";
import type { ExchangeId, Timeframe } from "@axiom/types";
import {
  alertePrixAuNiveau,
  alertsStore,
  arrondirNiveauAlerte,
  SECTION_ALERTES,
} from "../store/alerts";
import { uiSectionsStore } from "../store/ui-sections";
import { formatPrice } from "../lib/format";
import { offreAuClic } from "./alerteZone";
import type { OffreEncart } from "./candleReadout";

/** Pane prix (id par défaut KLineChart). */
const CANDLE_PANE_ID = "candle_pane";

/** Id DOM unique du menu flottant (un seul à la fois dans le document). */
const MENU_DOM_ID = "axiom-price-alert-menu";

/** Source marché lue au moment du clic (symbole/source du slot hôte). */
export interface PriceAlertMarket {
  symbol: string;
  source: ExchangeId;
  /** Unité du graphe : celle des zones d'AXIS S/R qu'il trace (message de l'alerte de zone). */
  timeframe?: Timeframe;
  /** Le graphe rejoue un jour passé : aucune alerte de zone n'y est proposée. */
  rejeu?: boolean;
}

/** Entrée du menu (libellé + sens de croisement). */
export interface ItemMenuAlertePrix {
  sens: SensCroisement;
  label: string;
}

/** Ligne de niveau accrochable par le clic droit. */
export interface LigneAccrochable {
  price: number;
  label: string;
}

/**
 * PURE — ligne dont le Y est le plus proche de `yClic` à `tolerancePx` près (la première
 * en cas d'égalité), sinon null.
 */
export function ligneAccrochee(
  yClic: number,
  candidats: readonly { y: number; ligne: LigneAccrochable }[],
  tolerancePx = 6,
): LigneAccrochable | null {
  let meilleure: LigneAccrochable | null = null;
  let ecartMin = Infinity;
  for (const { y, ligne } of candidats) {
    const ecart = Math.abs(y - yClic);
    if (ecart <= tolerancePx && ecart < ecartMin) {
      meilleure = ligne;
      ecartMin = ecart;
    }
  }
  return meilleure;
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

/** PURE — niveau de prix au format standard du terminal (délègue à lib/format).
 * En échelle percentage un niveau ≤ 0 est légitime (backlog lot A) : formatPrice le
 * traiterait en « valeur absente » (—) — on formate donc localement, signé. */
export function formaterNiveauCourt(niveau: number): string {
  if (!Number.isFinite(niveau)) return String(niveau);
  if (niveau > 0) return formatPrice(niveau);
  const abs = Math.abs(niveau);
  // Mêmes paliers de décimales que formatPrice (2/4/6) ; zéro → 2.
  const decimals = abs >= 1 || abs === 0 ? 2 : abs >= 0.01 ? 4 : 6;
  const txt = abs.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return niveau < 0 ? `−${txt}` : txt;
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
  message?: string,
): void {
  const nouvelle = alertePrixAuNiveau(market.symbol, market.source, niveau, sens, message);
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

/** Entrée active du menu : un bouton au style commun, qui agit puis ferme le menu. */
function entreeMenu(label: string, agir: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute("role", "menuitem");
  btn.textContent = label;
  btn.style.cssText =
    "display:block;width:100%;text-align:left;padding:0.35rem 0.6rem;background:transparent;border:0;color:inherit;cursor:pointer;font:inherit";
  btn.addEventListener("mouseenter", () => {
    btn.style.background = "var(--bg)";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.background = "transparent";
  });
  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    agir();
    fermerMenu(); // retire DOM + listeners window
  });
  return btn;
}

/**
 * Affiche le menu flottant près du curseur (coordonnées viewport).
 * Remplace tout menu précédent (DOM + listeners). `offre` : alerte de prix au bord de la zone
 * forte sous le clic, placée entre l'en-tête et les trois entrées au prix du clic.
 */
function afficherMenu(
  clientX: number,
  clientY: number,
  niveau: number,
  market: PriceAlertMarket,
  libelle?: string,
  offre?: OffreEncart,
): void {
  fermerMenu();

  const menu = document.createElement("div");
  menu.id = MENU_DOM_ID;
  menu.setAttribute("role", "menu");
  // `max-width` borne la ligne de l'offre de zone, plus longue que les trois autres : au-delà
  // (résistance, prix à six chiffres) elle revient à la ligne.
  menu.style.cssText =
    `position:fixed;left:${Math.round(clientX)}px;top:${Math.round(clientY)}px;z-index:80;min-width:11rem;max-width:26rem;` +
    "padding:0.25rem 0;border-radius:0.375rem;border:1px solid var(--border);background:var(--surface);" +
    "box-shadow:0 8px 24px rgba(0,0,0,0.35);font-size:11px;color:var(--text)";

  // En-tête discret (ligne accrochée éventuelle + niveau).
  const header = document.createElement("div");
  header.textContent = `${libelle ? `${libelle} · ` : ""}Prix ${formaterNiveauCourt(niveau)}`;
  header.style.cssText =
    "padding:0.25rem 0.6rem 0.35rem;font-size:10px;color:var(--text-dim);border-bottom:1px solid var(--border);margin-bottom:0.15rem";
  menu.appendChild(header);

  if (offre) {
    // Bord d'une zone forte : entrée active pour l'état « offre » ; sinon (déjà posée, bord déjà
    // franchi) la même ligne, grisée et sans effet, qui dit pourquoi. Un filet la sépare des
    // trois entrées au prix du clic.
    const actif = offre.etat === "offre";
    const entree = actif ? entreeMenu(offre.libelle, offre.executer) : document.createElement("div");
    if (!actif) {
      entree.textContent = offre.libelle;
      entree.setAttribute("aria-disabled", "true");
      entree.style.cssText = "padding:0.35rem 0.6rem;color:var(--text-dim)";
    }
    entree.setAttribute("data-alerte-zone", offre.etat);
    entree.style.cssText += ";white-space:normal;border-bottom:1px solid var(--border)";
    menu.appendChild(entree);
  }

  for (const item of itemsMenuAlertePrix(niveau)) {
    menu.appendChild(entreeMenu(item.label, () => creerAlerteDepuisMenu(market, niveau, item.sens, libelle && `${libelle} ${market.symbol}`)));
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
 * `getMarket` et `getLignes` sont relus à chaque clic (symbole/source et lignes du slot
 * peuvent changer sans remonter l'instance KLineChart — effet DONNÉES).
 */
export function bindPriceAlertMenu(
  chart: KLineChartInstance,
  chartDom: HTMLElement,
  getMarket: () => PriceAlertMarket,
  getLignes: () => readonly LigneAccrochable[] = () => [],
): () => void {
  const onContextMenu = (e: MouseEvent): void => {
    const niveau = prixAuClic(chart, chartDom, e.clientX, e.clientY);
    if (niveau === null) {
      fermerMenu();
      return; // hors pane prix : laisser le comportement existant
    }
    e.preventDefault();
    e.stopPropagation();
    // Même conversion que le rendu des lignes (niveauxLignes.ts) et même origine que prixAuClic.
    const candidats = getLignes().map((ligne) => ({
      y: (chart.convertToPixel({ value: ligne.price }, { paneId: CANDLE_PANE_ID, absolute: true }) as { y?: number }).y ?? NaN,
      ligne,
    }));
    const racine = chartDom.getBoundingClientRect();
    const ligne = ligneAccrochee(e.clientY - racine.top, candidats);
    const market = getMarket();
    afficherMenu(e.clientX, e.clientY, ligne ? ligne.price : niveau, market, ligne ? ligne.label : undefined, offreAuClic(chart, market, e.clientX - racine.left, e.clientY - racine.top));
  };

  chartDom.addEventListener("contextmenu", onContextMenu);
  return () => {
    chartDom.removeEventListener("contextmenu", onContextMenu);
    fermerMenu();
  };
}
