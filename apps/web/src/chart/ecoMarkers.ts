/**
 * Marqueurs ECO sur le chart — lignes verticales + label aux évènements à FORT impact.
 *
 * Overlay CUSTOM « ecoMarker » (registerOverlay, comme fibonacci.ts) : une ligne
 * verticale pointillée pleine hauteur au timestamp de l'évènement + un court label en
 * haut. `lock: true` → informatif, ne capture aucun clic (le graphe reste pilotable).
 *
 * Le contrôleur est un SINGLETON (le chart est recréé par Chart.tsx à chaque changement
 * symbole/TF, hors de notre périmètre). On atteint l'instance vivante via
 * `getActiveChart()` (drawing.ts) et on REJOUE les marqueurs :
 *   - au changement d'instance (nouveau symbole/TF) — détecté via marketStore ;
 *   - à tout changement des évènements ou de la bascule des marqueurs (ecoStore).
 * Pattern « rejeu des dessins » : on efface (`removeOverlay({ name })`) puis on recrée.
 *
 * Les marqueurs ne visent QUE l'impact « high » (les filtres d'affichage de la fenêtre
 * ECO concernent la liste, pas le chart). Aucune donnée haute fréquence : le redraw
 * n'a lieu qu'au changement d'instance, pas sur tick.
 */
import { registerOverlay } from "klinecharts";
import type { OverlayCreate } from "klinecharts";
import { getActiveChart } from "./drawing";
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
          styles: { color, size: 10 },
        },
      ];
    },
  });
}

// ─────────────────────────── Contrôleur singleton ───────────────────────────

/** Dernière instance sur laquelle on a dessiné (détecte la recréation symbole/TF). */
let boundChart: ReturnType<typeof getActiveChart> = null;

/** Sélectionne les évènements à marquer : fort impact, bornés en nombre. */
function marqueurs(events: EcoEvent[]): EcoEvent[] {
  return events.filter((e) => e.impact === "high").slice(0, MAX_MARKERS);
}

/**
 * (Re)pose les marqueurs sur l'instance vivante. Efface d'abord les anciens (ciblé par
 * nom) puis recrée si la bascule est active ET qu'il y a des bougies (axe temps prêt).
 */
function redraw(): void {
  const chart = getActiveChart();
  boundChart = chart;
  if (chart === null) return;

  // Efface les marqueurs éco existants (no-op si l'instance vient d'être recréée).
  chart.removeOverlay({ name: ECO_MARKER });

  const { markersEnabled, events } = ecoStore.getState();
  if (!markersEnabled) return;
  if (marketStore.getState().candles.length === 0) return; // axe temps pas encore prêt

  const statsParType = evtsUiStore.getState().statsParType;
  for (const ev of marqueurs(events)) {
    const base = tronquer(`${ev.country} ${ev.title}`, 18);
    // Suffixe la stat d'étude d'évènements si elle est disponible pour ce type. La base est
    // tronquée à 18 (comme un label nu) PUIS la stat est ajoutée EN ENTIER : la stat PRIME
    // sur la fin du titre. Sur un titre FRED verbeux (« Consumer Price Index ») le suffixe
    // reste ainsi toujours lisible, au lieu d'être rogné par une troncature commune.
    const type = typeEvenementDe(ev.title);
    const stat = type ? statsParType[type] : undefined;
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
    chart.createOverlay(overlay);
  }
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

  // Rejeu au changement d'INSTANCE (nouveau symbole/TF → chart recréé par Chart.tsx).
  // marketStore émet aussi sur tick : on ne redessine QUE si l'instance a changé.
  marketStore.subscribe(() => {
    const chart = getActiveChart();
    if (chart !== null && chart !== boundChart) redraw();
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
