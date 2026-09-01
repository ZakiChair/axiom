/**
 * Marqueurs ECO sur le chart — lignes verticales + label aux évènements à FORT impact.
 *
 * Overlay CUSTOM « ecoMarker » (registerOverlay, comme fibonacci.ts) : une ligne
 * verticale pointillée pleine hauteur au timestamp de l'évènement + un court label en
 * haut. `lock: true` → informatif, ne capture aucun clic (le graphe reste pilotable).
 *
 * Le contrôleur reste un SINGLETON. On atteint l'instance vivante via `getActiveChart()`
 * (drawing.ts) et on REJOUE les marqueurs au changement de CONTEXTE (focus, symbole,
 * source, axe temps prêt) et retire ses overlays sur toutes les instances suivies
 * (patron tradeMarkers) :
 *   - au changement de contexte (focus/symbole/source/axe prêt) — voir `doitRejouerEco` ;
 *   - à tout changement des évènements ou de la bascule des marqueurs (ecoStore).
 * Pattern « rejeu des dessins » : on efface (`retirerMarqueursSuivis`) puis on recrée.
 *
 * Les marqueurs ne visent QUE l'impact « high » (les filtres d'affichage de la fenêtre
 * ECO concernent la liste, pas le chart). Aucune donnée haute fréquence : le redraw
 * n'a lieu qu'au changement de contexte, pas sur tick.
 */
import { registerOverlay } from "klinecharts";
import type { OverlayCreate } from "klinecharts";
import { getActiveChart } from "./drawing";
import { retirerMarqueursSuivis, type CibleMarqueurs } from "./tradeMarkers";
import { marketStore } from "../store/market";
import { ecoStore } from "../store/eco";
import { evtsUiStore } from "../store/evts";
import type { EcoEvent } from "../data/eco";
import type { TypeEvenement } from "../data/macro/eventDates";
import { lireTokenCanvas } from "../lib/canvasTokens";

/** Nom de l'overlay custom + groupe (permet un removeOverlay ciblé). */
const ECO_MARKER = "ecoMarker";
const ECO_GROUP = "axiomEco";

/** Nombre maximum de marqueurs tracés (borne défensive). */
const MAX_MARKERS = 80;

/** Données portées par chaque instance d'overlay (lues dans createPointFigures). */
interface EcoMarkerExtend {
  label: string;
}

/** Tronque un label à `n` caractères (… si coupé). */
function tronquer(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/**
 * Mappe le titre d'un évènement ECO vers le TypeEvenement d'étude (EVTS) correspondant,
 * ou `null` s'il n'est pas l'un des trois étudiés. Matching INSENSIBLE À LA CASSE sur des
 * fragments caractéristiques des libellés source (FRED « Consumer Price Index » /
 * « Employment Situation », ForexFactory « CPI m/m » / « Non-Farm Employment Change »,
 * décision statique « Décision FOMC (taux directeur) »). Fonction PURE.
 */
export function typeEvenementDe(title: string): TypeEvenement | null {
  const t = title.toLowerCase();
  if (t.includes("cpi") || t.includes("consumer price")) return "cpi";
  if (t.includes("non-farm") || t.includes("nfp") || t.includes("employment situation")) return "nfp";
  if (t.includes("minutes")) return null; // les Minutes ne sont pas une décision (« FOMC Meeting Minutes »)
  if (t.includes("fomc")) return "fomc";
  return null;
}

let overlayRegistered = false;

/** Enregistre l'overlay custom « ecoMarker » (idempotent, effet global klinecharts). */
function ensureOverlayRegistered(): void {
  if (overlayRegistered) return;
  overlayRegistered = true;
  registerOverlay({
    name: ECO_MARKER,
    totalStep: 1, // un seul point (timestamp) ; toujours créé avec points fournis
    lock: true, // informatif : ne répond à aucun évènement souris
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ overlay, coordinates, bounding }) => {
      const c = coordinates[0];
      if (c === undefined) return [];
      const ext = overlay.extendData as EcoMarkerExtend | undefined;
      const color = lireTokenCanvas("--serie-3", "#f59e0b");
      const label = ext?.label ?? "";
      return [
        {
          type: "line",
          ignoreEvent: true,
          attrs: { coordinates: [{ x: c.x, y: 0 }, { x: c.x, y: bounding.height }] },
          styles: { style: "dashed", size: 1, color, dashedValue: [4, 4] },
        },
        {
          type: "text",
          ignoreEvent: true,
          attrs: { x: c.x + 3, y: 2, text: label, align: "left", baseline: "top" },
          // Fond transparent obligatoire (pastille #1677FF par défaut, cf. annotationsPrix.ts).
          styles: { color, size: 10, backgroundColor: "transparent" },
        },
      ];
    },
  });
}

// ─────────────────────────── Contrôleur singleton ───────────────────────────

/** Instances portant ACTUELLEMENT des marqueurs éco (ids posés par instance). En grille
 *  multi-chart, le retrait doit viser TOUTES ces instances, pas le seul focus courant —
 *  patron overlaysSuivis de tradeMarkers (sinon marqueurs orphelins + duplication). */
const overlaysSuivis = new Map<CibleMarqueurs, string[]>();

/** Contexte dont TOUT changement rejoue les marqueurs. L'identité d'instance ne suffit
 *  plus : depuis le Lot D1, l'instance KLineChart SURVIT aux changements de symbole/TF. */
export interface ContexteRejeuEco {
  chart: unknown;
  symbol: string;
  exchange: string;
  ready: boolean;
}

/** PURE : vrai si le contexte a changé (focus, actif, source, axe temps prêt). */
export function doitRejouerEco(prev: ContexteRejeuEco, next: ContexteRejeuEco): boolean {
  return (
    prev.chart !== next.chart ||
    prev.symbol !== next.symbol ||
    prev.exchange !== next.exchange ||
    prev.ready !== next.ready
  );
}

/** Sélectionne les évènements à marquer : fort impact, bornés en nombre. */
function marqueurs(events: EcoEvent[]): EcoEvent[] {
  return events.filter((e) => e.impact === "high").slice(0, MAX_MARKERS);
}

/**
 * (Re)pose les marqueurs sur l'instance vivante. Efface d'abord les anciens sur TOUTES
 * les instances suivies (le focus a pu changer depuis le dernier tracé) puis recrée si
 * la bascule est active ET qu'il y a des bougies (axe temps prêt).
 */
function redraw(): void {
  // Retire d'abord les marqueurs de TOUTES les instances qui en portaient (focus ou non).
  retirerMarqueursSuivis(overlaysSuivis);

  const chart = getActiveChart();
  if (chart === null) return;

  const { markersEnabled, events } = ecoStore.getState();
  if (!markersEnabled) return;
  if (marketStore.getState().candles.length === 0) return; // axe temps pas encore prêt

  const statsParType = evtsUiStore.getState().statsParType;
  const symboleMaitre = marketStore.getState().symbol;
  const idsPoses: string[] = [];
  for (const ev of marqueurs(events)) {
    const base = tronquer(`${ev.country} ${ev.title}`, 18);
    // Suffixe la stat d'étude d'évènements — MAIS seulement si elle a été calculée sur le
    // symbole du chart maître courant (honnêteté d'échantillon : une stat calculée sur un
    // symbole de groupe ≠ maître n'est jamais affichée comme si elle valait pour le maître).
    // La base est tronquée à 18 (comme un label nu) PUIS la stat est ajoutée EN ENTIER : la
    // stat PRIME sur la fin du titre — sur un titre FRED verbeux elle reste toujours lisible.
    const type = typeEvenementDe(ev.title);
    const entree = type ? statsParType[type] : undefined;
    const stat = entree && entree.symbole === symboleMaitre ? entree.libelle : undefined;
    const extend: EcoMarkerExtend = {
      label: stat ? `${base} · ${stat}` : base,
    };
    const overlay: OverlayCreate = {
      name: ECO_MARKER,
      groupId: ECO_GROUP,
      lock: true,
      points: [{ timestamp: ev.time, value: 0 }],
      extendData: extend,
    };
    const id = chart.createOverlay(overlay);
    if (typeof id === "string") idsPoses.push(id);
  }
  // Mémorise l'instance et ses ids : ils seront retirés au prochain redraw même si le
  // focus a changé entre-temps (cf. retirerMarqueursSuivis).
  if (idsPoses.length > 0) overlaysSuivis.set(chart, idsPoses);
}

let controllerStarted = false;

/**
 * Démarre le contrôleur de marqueurs (idempotent). Enregistre l'overlay et pose les
 * abonnements de REJEU. Appelé à l'import de ce module (EcoWindow l'importe) : les
 * abonnements vivent toute la session (singleton), inertes tant que les marqueurs sont
 * désactivés (early-return dans redraw).
 */
export function demarrerEcoMarkers(): void {
  if (controllerStarted) return;
  controllerStarted = true;
  ensureOverlayRegistered();

  // Rejeu au changement de CONTEXTE (focus, symbole, source, axe prêt) — plus sur la
  // seule identité d'instance : l'instance survit au changement de symbole/TF (Lot D1),
  // et le premier redraw pendant le backfill figeait l'ancien boundChart (marqueurs
  // jamais posés en mono-chart, suffixes de stats de l'ANCIEN symbole conservés).
  let prev: ContexteRejeuEco = {
    chart: getActiveChart(),
    symbol: marketStore.getState().symbol,
    exchange: marketStore.getState().exchange,
    ready: marketStore.getState().candles.length > 0,
  };
  marketStore.subscribe(() => {
    const s = marketStore.getState();
    const next: ContexteRejeuEco = {
      chart: getActiveChart(),
      symbol: s.symbol,
      exchange: s.exchange,
      ready: s.candles.length > 0,
    };
    if (doitRejouerEco(prev, next)) {
      prev = next;
      redraw();
    }
  });

  // Rejeu au changement des évènements ou de la bascule des marqueurs.
  let prevEvents = ecoStore.getState().events;
  let prevMarkers = ecoStore.getState().markersEnabled;
  ecoStore.subscribe((s) => {
    if (s.events !== prevEvents || s.markersEnabled !== prevMarkers) {
      prevEvents = s.events;
      prevMarkers = s.markersEnabled;
      redraw();
    }
  });

  // Rejeu au changement des stats d'étude d'évènements (suffixe des labels de marqueurs).
  // `setStatParType` produit une nouvelle référence → comparaison par identité suffit.
  let prevStats = evtsUiStore.getState().statsParType;
  evtsUiStore.subscribe((s) => {
    if (s.statsParType !== prevStats) {
      prevStats = s.statsParType;
      redraw();
    }
  });
}

// Auto-démarrage à l'import (EcoWindow importe ce module).
demarrerEcoMarkers();
