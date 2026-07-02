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
import type { Chart as KLineChartInstance, OverlayEvent } from "klinecharts";
import { marketStore } from "../store/market";
// Effet de bord : enregistre les overlays Fibonacci custom (fibCustom / fibTrend).
import { FIB_RETRACEMENT, FIB_TREND } from "./fibonacci";

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
  | "fib"
  | "fibTrend";

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
  fib: FIB_RETRACEMENT, // retracement de Fibonacci (custom thémé + paramétrable)
  fibTrend: FIB_TREND, // retracement + projection selon la tendance
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

/**
 * Drapeau de teardown : `dispose()` (changement symbole/TF) déclenche `onRemoved`
 * sur chaque overlay. Sans garde, on persisterait une liste VIDE et on effacerait
 * les dessins sauvegardés. Posé à true à `unbindChart`, remis à false à `bindChart`.
 */
let suppressPersist = false;

/** Lie l'instance courante (appelé par Chart.tsx juste après `init`). */
export function bindChart(chart: KLineChartInstance): void {
  activeChart = chart;
  suppressPersist = false; // nouvelle instance vivante : la persistance reprend.
}

/**
 * Renvoie l'instance KLineChart courante (liée par Chart.tsx), ou null si aucune.
 * Ajout ADDITIF (Phase 3) : permet aux marqueurs éco (chart/ecoMarkers.ts) de poser
 * leurs overlays sur l'instance active SANS que Chart.tsx ait à les connaître.
 */
export function getActiveChart(): KLineChartInstance | null {
  return activeChart;
}

/**
 * Délie une instance. Garde `chart === activeChart` : si une nouvelle instance a
 * déjà été liée (recréation symbole/TF), on n'écrase pas la référence à jour.
 * Pose `suppressPersist` : le `dispose()` qui suit ne doit pas vider le stockage.
 */
export function unbindChart(chart: KLineChartInstance): void {
  if (activeChart === chart) {
    activeChart = null;
    suppressPersist = true;
  }
}

// ───────────────────────── Persistance des dessins ─────────────────────────
//
// PROBLÈME : Chart.tsx recrée l'instance (donc détruit les overlays) à chaque
// changement de symbole/TF, et klinecharts n'expose pas d'énumération globale des
// overlays. On TRACE donc nous-mêmes chaque dessin (id → {name, points}) et on le
// REJOUE après le backfill via `restoreDrawings`. Stockage par « EXCHANGE:SYMBOLE »
// (localStorage) → les dessins survivent au changement de TF, au changement d'actif
// et au rechargement, SANS collision entre sources (un BTCUSDT Binance et un BTCUSDT
// Coinbase ont désormais des jeux de dessins distincts).

const DRAWINGS_KEY = "axiom:drawings:v1";

/** Clé de stockage composite d'un actif : « exchange:symbole ». */
function storageKey(exchange: string, symbol: string): string {
  return `${exchange}:${symbol}`;
}

/** Point d'un overlay, ancré dans le temps (stable d'un TF à l'autre) + prix. */
interface SavedPoint {
  timestamp?: number;
  value?: number;
}
/** Dessin persistable : nom d'overlay klinecharts + ses points. */
interface SavedOverlay {
  name: string;
  points: SavedPoint[];
}

/** Overlays du graphe COURANT, par id d'overlay (source de vérité de la session). */
const liveOverlays = new Map<string, SavedOverlay>();

/** Id de l'overlay actuellement SÉLECTIONNÉ (clic gauche) — cible de la touche Suppr. */
let selectedOverlayId: string | null = null;

/** Lecture tolérante de la map symbole → dessins. */
function readAll(): Record<string, SavedOverlay[]> {
  try {
    const raw = localStorage.getItem(DRAWINGS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, SavedOverlay[]>) : {};
  } catch {
    return {};
  }
}

/** Écriture brute de la map complète (best-effort géré par l'appelant). */
function writeAll(all: Record<string, SavedOverlay[]>): void {
  localStorage.setItem(DRAWINGS_KEY, JSON.stringify(all));
}

/** Persiste les overlays vivants sous la clé « exchange:symbole » courante (best-effort). */
function persist(): void {
  if (suppressPersist) return; // teardown en cours : ne pas écraser le stockage.
  try {
    const { exchange, symbol } = marketStore.getState();
    const all = readAll();
    all[storageKey(exchange, symbol)] = Array.from(liveOverlays.values());
    writeAll(all);
  } catch {
    /* best-effort : la persistance des dessins n'est pas bloquante */
  }
}

/** Ne garde que {timestamp, value} (ancrage stable, stockage léger). */
function normalizePoints(points: ReadonlyArray<SavedPoint>): SavedPoint[] {
  return points.map((p) => ({ timestamp: p.timestamp, value: p.value }));
}

/** Enregistre/maj un overlay dans la map vivante + persiste. */
function captureOverlay(id: string, name: string, points: ReadonlyArray<SavedPoint>): void {
  liveOverlays.set(id, { name, points: normalizePoints(points) });
  persist();
}

/**
 * Crée un overlay TRACÉ : mêmes callbacks pour tous (dessin interactif ET dessins
 * restaurés). `onDrawEnd`/`onPressedMoveEnd` capturent les points ; `onRightClick`
 * supprime le dessin visé ; `onRemoved` met à jour le stockage. `points` fourni =>
 * overlay rejoué (pas de tracé interactif, `onDrawEnd` ne se déclenche pas).
 */
function createTrackedOverlay(name: string, points?: SavedPoint[]): string | null {
  if (activeChart === null) return null;
  const created = activeChart.createOverlay({
    name,
    ...(points ? { points } : {}),
    onDrawEnd: (event: OverlayEvent) => {
      captureOverlay(event.overlay.id, name, event.overlay.points);
      drawingStore.getState().setTool("cursor"); // revient au curseur en fin de tracé.
      return false;
    },
    onPressedMoveEnd: (event: OverlayEvent) => {
      captureOverlay(event.overlay.id, name, event.overlay.points); // points édités (drag).
      return false;
    },
    onRemoved: (event: OverlayEvent) => {
      liveOverlays.delete(event.overlay.id);
      if (selectedOverlayId === event.overlay.id) selectedOverlayId = null;
      persist();
      return false;
    },
    onSelected: (event: OverlayEvent) => {
      selectedOverlayId = event.overlay.id; // cible de la touche Suppr.
      return false;
    },
    onDeselected: (event: OverlayEvent) => {
      if (selectedOverlayId === event.overlay.id) selectedOverlayId = null;
      return false;
    },
    onRightClick: (event: OverlayEvent) => {
      // Clic droit sur un dessin = le supprimer (déclenche onRemoved → stockage).
      activeChart?.removeOverlay({ id: event.overlay.id });
      return true; // consomme l'événement (pas de menu contextuel natif).
    },
  });
  return typeof created === "string" ? created : null;
}

/**
 * Supprime le dessin actuellement SÉLECTIONNÉ (clic gauche). Renvoie true si une
 * suppression a eu lieu. Appelé par l'écouteur clavier (Suppr/Backspace) de la
 * barre d'outils. La suppression déclenche `onRemoved` → nettoyage map + stockage.
 */
export function deleteSelectedDrawing(): boolean {
  if (selectedOverlayId === null || activeChart === null) return false;
  activeChart.removeOverlay({ id: selectedOverlayId });
  return true;
}

/**
 * Rejoue les dessins sauvegardés du `symbol` sur l'instance courante. Appelé par
 * Chart.tsx APRÈS le backfill (les bougies sont posées : l'ancrage temporel est valide).
 */
export function restoreDrawings(symbol: string): void {
  liveOverlays.clear();
  const exchange = marketStore.getState().exchange;
  const all = readAll();
  const key = storageKey(exchange, symbol);
  let list = all[key];

  // Migration douce du schéma v1 : l'ancien stockage indexait par SYMBOLE seul
  // (implicitement Binance, seule source de dessins à l'époque). On REPREND UNE FOIS
  // ces dessins vers la clé composite « binance:<symbol> », puis on retire l'entrée
  // héritée. Un symbole ne contient jamais « : » → aucune ambiguïté avec une clé composite.
  if (list === undefined && exchange === "binance") {
    const legacy = all[symbol];
    if (legacy !== undefined) {
      list = legacy;
      all[key] = legacy;
      delete all[symbol];
      try {
        writeAll(all);
      } catch {
        /* best-effort : si l'écriture de reprise échoue, on rejoue quand même les dessins */
      }
    }
  }

  for (const ov of list ?? []) {
    const id = createTrackedOverlay(ov.name, ov.points);
    if (id) liveOverlays.set(id, ov);
  }
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
  // Overlay TRACÉ : persisté par symbole (survit aux changements de TF/actif) et
  // supprimable au clic droit (cf. createTrackedOverlay).
  createTrackedOverlay(name);
}

/**
 * Force le re-rendu des overlays Fibonacci déjà tracés (appelé quand la config
 * `fibStore` change : niveaux/zones). `overrideOverlay` par nom retouche les
 * instances existantes ; `createPointFigures` relit alors le store et le thème.
 * Le `rev` (qui change) garantit une modification effective déclenchant le redraw.
 */
export function redrawFibOverlays(rev: number): void {
  activeChart?.overrideOverlay({ name: FIB_RETRACEMENT, extendData: rev });
  activeChart?.overrideOverlay({ name: FIB_TREND, extendData: rev });
}

/**
 * Exporte le graphe courant en PNG et déclenche son téléchargement. Utilise l'instance
 * KLineChart liée (`getConvertPictureUrl`, API v9.8 : includeOverlay/type/backgroundColor).
 * Le canvas KLineChart étant transparent, on passe la couleur de fond du thème (--bg)
 * pour que l'image ne soit pas sur fond blanc. Nom de fichier : « SYMBOLE-TF-AAAA-MM-JJ.png ».
 */
export function exportChartImage(symbol: string, tf: string): void {
  if (activeChart === null) return;
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#000000";
  const url = activeChart.getConvertPictureUrl(true, "png", bg);
  const date = new Date().toISOString().slice(0, 10); // AAAA-MM-JJ
  const a = document.createElement("a");
  a.href = url;
  a.download = `${symbol}-${tf}-${date}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** « Effacer tout » : retire TOUS les overlays de dessin et repasse au curseur. */
export function clearAllOverlays(): void {
  // Sans argument, removeOverlay supprime tous les overlays. Sûr ici : les
  // indicateurs @axiom et le CVD orderflow passent par `createIndicator` (système
  // distinct), jamais par `createOverlay` — ils ne sont donc pas affectés.
  activeChart?.removeOverlay();
  // Vide aussi la map vivante + le stockage du symbole courant (au cas où des
  // overlays n'auraient pas déclenché onRemoved).
  liveOverlays.clear();
  persist();
  drawingStore.getState().setTool("cursor");
}
