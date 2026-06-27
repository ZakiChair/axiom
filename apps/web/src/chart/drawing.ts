/**
 * Outils de dessin — pont impératif entre la barre d'outils (React) et
 * l'instance KLineChart (hors render-loop, comme le reste du Chart).
 *
 * KLineChart fournit nativement TOUS les overlays requis (vérifié sur la v9.8.12
 * via `getSupportedOverlays` / `index.d.ts` + docs context7 v9) :
 *  - 'segment'                -> droite de tendance (2 points) ;
 *  - 'horizontalStraightLine' -> ligne horizontale (1 point) ;
 *  - 'rect'                   -> rectangle (2 points) ;
 *  - 'fibonacciLine'          -> retracement de Fibonacci (2 points).
 * Le rectangle étant INTÉGRÉ, AUCUN `registerOverlay` custom n'est nécessaire.
 *
 * Cycle de vie : Chart.tsx (re)crée l'instance à chaque changement symbole/TF et
 * appelle `bindChart` / `unbindChart`. La barre d'outils lit l'outil courant via
 * le `drawingStore` (Zustand vanilla) pour la surbrillance et déclenche
 * `createOverlay` sur l'instance liée.
 */
import { createStore } from "zustand/vanilla";
import type { Chart as KLineChartInstance } from "klinecharts";

/** Identifiants d'outils exposés par la barre (cursor = aucun overlay). */
export type DrawingToolId =
  | "cursor"
  | "trendLine"
  | "ray"
  | "extended"
  | "horizontalLine"
  | "horizontalRay"
  | "verticalLine"
  | "priceLine"
  | "parallelChannel"
  | "priceChannel"
  | "rect"
  | "fib";

/**
 * Outil -> nom de l'overlay INTÉGRÉ KLineChart à dessiner (null pour le curseur).
 * Tous ces templates sont natifs de klinecharts 9.8.12 (vérifié dans le bundle) :
 * aucun `registerOverlay` custom requis.
 */
const TOOL_OVERLAY: Record<DrawingToolId, string | null> = {
  cursor: null,
  trendLine: "segment", // droite de tendance (2 points)
  ray: "rayLine", // demi-droite (rayon) depuis un point
  extended: "straightLine", // droite infinie (2 points)
  horizontalLine: "horizontalStraightLine", // horizontale (1 point)
  horizontalRay: "horizontalRayLine", // rayon horizontal (support/résistance directionnel)
  verticalLine: "verticalStraightLine", // verticale (marqueur temporel)
  priceLine: "priceLine", // ligne de prix annotée
  parallelChannel: "parallelStraightLine", // canal parallèle (3 points)
  priceChannel: "priceChannelLine", // canal de prix
  rect: "rect", // rectangle (zone)
  fib: "fibonacciLine", // retracement de Fibonacci
};

export interface DrawingState {
  /** Outil courant (sert à la surbrillance du bouton actif). */
  tool: DrawingToolId;
  setTool: (tool: DrawingToolId) => void;
}

export const drawingStore = createStore<DrawingState>((set) => ({
  tool: "cursor",
  setTool: (tool) => set({ tool }),
}));

/**
 * Référence module-scope vers l'instance KLineChart courante. Volontairement HORS
 * du store React : aucune donnée du moteur de rendu ne doit transiter par le state.
 */
let activeChart: KLineChartInstance | null = null;

/** Lie l'instance courante (appelé par Chart.tsx juste après `init`). */
export function bindChart(chart: KLineChartInstance): void {
  activeChart = chart;
}

/**
 * Délie une instance. Garde `chart === activeChart` : si une nouvelle instance a
 * déjà été liée (recréation symbole/TF), on n'écrase pas la référence à jour.
 */
export function unbindChart(chart: KLineChartInstance): void {
  if (activeChart === chart) activeChart = null;
}

/**
 * Sélectionne un outil : met à jour la surbrillance puis, pour un outil de dessin,
 * lance `createOverlay` sur l'instance liée. KLineChart prend alors la main sur
 * l'interaction (placement des points). À la fin du tracé (`onDrawEnd`), on
 * repasse au curseur pour que la surbrillance reflète l'action réellement active.
 */
export function selectTool(tool: DrawingToolId): void {
  drawingStore.getState().setTool(tool);
  const name = TOOL_OVERLAY[tool];
  if (name === null || activeChart === null) return;
  activeChart.createOverlay({
    name,
    onDrawEnd: () => {
      drawingStore.getState().setTool("cursor");
      return false; // ne pas surcharger le comportement de fin de tracé KLineChart.
    },
  });
}

/** « Effacer tout » : retire TOUS les overlays de dessin et repasse au curseur. */
export function clearAllOverlays(): void {
  // Sans argument, removeOverlay supprime tous les overlays. Sûr ici : les
  // indicateurs @axiom et le CVD orderflow passent par `createIndicator` (système
  // distinct), jamais par `createOverlay` — ils ne sont donc pas affectés.
  activeChart?.removeOverlay();
  drawingStore.getState().setTool("cursor");
}
