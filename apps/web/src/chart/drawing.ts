/**
 * Outils de dessin — pont impératif entre la barre d'outils (React) et les instances
 * KLineChart (hors render-loop, comme le reste du Chart).
 *
 * MULTI-CHART (Phase 4) : plusieurs graphes coexistent (grille 1/2h/2v/2×2). Le
 * singleton `activeChart` d'origine devient un REGISTRE `chart → état de dessin`
 * (overlays vivants + méta actif/symbole propres à CHAQUE instance). Les outils
 * (tracer, supprimer, effacer, export PNG) s'appliquent au chart FOCUS ; un clic dans
 * un slot le met au focus (`setFocusChart`). Chaque instance persiste ses propres
 * dessins sous « exchange:symbole » — les slots ne se marchent pas dessus.
 *
 * KLineChart fournit nativement TOUS les overlays requis (vérifié sur la v9.8.12
 * via `getSupportedOverlays` / `index.d.ts` + docs context7 v9) :
 *  - 'segment'                -> droite de tendance (2 points) ;
 *  - 'horizontalStraightLine' -> ligne horizontale (1 point) ;
 *  - 'rect'                   -> rectangle (2 points) ;
 *  - 'fibonacciLine'          -> retracement de Fibonacci (2 points).
 * Le rectangle étant INTÉGRÉ, AUCUN `registerOverlay` custom n'est nécessaire.
 *
 * Cycle de vie : chaque ChartInstance (re)crée son instance à chaque changement
 * symbole/TF et appelle `bindChart` / `unbindChart`. La barre d'outils lit l'outil
 * courant via le `drawingStore` (Zustand vanilla) pour la surbrillance et déclenche
 * `createOverlay` sur l'instance FOCUS.
 */
import { createStore } from "zustand/vanilla";
import type { Chart as KLineChartInstance, OverlayEvent } from "klinecharts";
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

// ───────────────────────── Registre multi-chart ─────────────────────────

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

/**
 * État de dessin d'UNE instance KLineChart. Volontairement HORS du store React :
 * aucune donnée du moteur de rendu ne doit transiter par le state.
 */
interface ChartEntry {
  chart: KLineChartInstance;
  slot: number;
  exchange: string;
  symbol: string;
  /** Overlays vivants par id (source de vérité de la session pour cette instance). */
  liveOverlays: Map<string, SavedOverlay>;
  /** Id de l'overlay SÉLECTIONNÉ (clic gauche) — cible de la touche Suppr. */
  selectedOverlayId: string | null;
  /**
   * Garde de teardown : `dispose()` déclenche `onRemoved` sur chaque overlay. Sans
   * garde, on persisterait une liste VIDE et on effacerait les dessins sauvegardés.
   * Posé à true à `unbindChart`, false à `bindChart`.
   */
  suppressPersist: boolean;
}

/** Registre chart → état de dessin (une entrée par slot monté). */
const registry = new Map<KLineChartInstance, ChartEntry>();

/**
 * Instance FOCUS (cible des outils). Reste HORS du store React. `null` si aucune
 * instance liée. Mise à jour par `setFocusChart` (clic dans un slot) et par bind/unbind.
 */
let activeChart: KLineChartInstance | null = null;

/** Lie une instance (appelé par ChartInstance juste après `init`), avec sa méta actif + slot. */
export function bindChart(
  chart: KLineChartInstance,
  meta: { exchange: string; symbol: string },
  slot: number,
): void {
  registry.set(chart, {
    chart,
    slot,
    exchange: meta.exchange,
    symbol: meta.symbol,
    liveOverlays: new Map(),
    selectedOverlayId: null,
    suppressPersist: false,
  });
  // Première instance liée → devient le focus par défaut (typiquement le slot maître).
  if (activeChart === null) activeChart = chart;
}

/**
 * Renvoie l'instance KLineChart FOCUS (liée par ChartInstance), ou null si aucune.
 * Utilisée par les marqueurs éco (chart/ecoMarkers.ts) pour poser leurs overlays sur
 * l'instance active SANS que ChartInstance ait à les connaître.
 */
export function getActiveChart(): KLineChartInstance | null {
  return activeChart;
}

/**
 * Met une instance au focus par son SLOT (clic utilisateur, via ChartGrid). Si aucun
 * chart lié n'occupe ce slot (montage en cours), l'ancien focus est conservé.
 */
export function setFocusChart(slot: number): void {
  for (const entry of registry.values()) {
    if (entry.slot === slot) {
      activeChart = entry.chart;
      return;
    }
  }
}

/**
 * Délie une instance. Pose `suppressPersist` : le `dispose()` qui suit ne doit pas
 * vider le stockage. L'entrée est retirée du registre. Si c'était le focus, on
 * bascule sur une autre instance liée (best-effort) ou null.
 */
export function unbindChart(chart: KLineChartInstance): void {
  const entry = registry.get(chart);
  if (entry) entry.suppressPersist = true;
  registry.delete(chart);
  if (activeChart === chart) {
    const next = registry.values().next();
    activeChart = next.done ? null : next.value.chart;
  }
}

// ───────────────────────── Persistance des dessins ─────────────────────────
//
// PROBLÈME : ChartInstance recrée l'instance (donc détruit les overlays) à chaque
// changement de symbole/TF, et klinecharts n'expose pas d'énumération globale des
// overlays. On TRACE donc nous-mêmes chaque dessin (id → {name, points}) et on le
// REJOUE après le backfill via `restoreDrawings`. Stockage par « EXCHANGE:SYMBOLE »
// (localStorage) → les dessins survivent au changement de TF, au changement d'actif
// et au rechargement, SANS collision entre sources NI entre slots.

const DRAWINGS_KEY = "axiom:drawings:v1";

/** Clé de stockage composite d'un actif : « exchange:symbole ». */
function storageKey(exchange: string, symbol: string): string {
  return `${exchange}:${symbol}`;
}

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

/** Persiste les overlays vivants d'UNE instance sous sa clé « exchange:symbole ». */
function persistEntry(entry: ChartEntry): void {
  if (entry.suppressPersist) return; // teardown en cours : ne pas écraser le stockage.
  try {
    const all = readAll();
    all[storageKey(entry.exchange, entry.symbol)] = Array.from(entry.liveOverlays.values());
    writeAll(all);
  } catch {
    /* best-effort : la persistance des dessins n'est pas bloquante */
  }
}

/** Ne garde que {timestamp, value} (ancrage stable, stockage léger). */
function normalizePoints(points: ReadonlyArray<SavedPoint>): SavedPoint[] {
  return points.map((p) => ({ timestamp: p.timestamp, value: p.value }));
}

/**
 * Crée un overlay TRACÉ sur `chart` : mêmes callbacks pour tous (dessin interactif ET
 * dessins restaurés). Les callbacks sont clos sur `chart` → ils retrouvent la bonne
 * entrée du registre (multi-chart). `points` fourni => overlay rejoué (pas de tracé
 * interactif, `onDrawEnd` ne se déclenche pas).
 */
function createTrackedOverlay(chart: KLineChartInstance, name: string, points?: SavedPoint[]): string | null {
  const capture = (id: string, ovPoints: ReadonlyArray<SavedPoint>): void => {
    const entry = registry.get(chart);
    if (!entry) return;
    entry.liveOverlays.set(id, { name, points: normalizePoints(ovPoints) });
    persistEntry(entry);
  };
  const created = chart.createOverlay({
    name,
    ...(points ? { points } : {}),
    onDrawEnd: (event: OverlayEvent) => {
      capture(event.overlay.id, event.overlay.points);
      drawingStore.getState().setTool("cursor"); // revient au curseur en fin de tracé.
      return false;
    },
    onPressedMoveEnd: (event: OverlayEvent) => {
      capture(event.overlay.id, event.overlay.points); // points édités (drag).
      return false;
    },
    onRemoved: (event: OverlayEvent) => {
      const entry = registry.get(chart);
      if (entry) {
        entry.liveOverlays.delete(event.overlay.id);
        if (entry.selectedOverlayId === event.overlay.id) entry.selectedOverlayId = null;
        persistEntry(entry);
      }
      return false;
    },
    onSelected: (event: OverlayEvent) => {
      const entry = registry.get(chart);
      if (entry) entry.selectedOverlayId = event.overlay.id; // cible de la touche Suppr.
      return false;
    },
    onDeselected: (event: OverlayEvent) => {
      const entry = registry.get(chart);
      if (entry && entry.selectedOverlayId === event.overlay.id) entry.selectedOverlayId = null;
      return false;
    },
    onRightClick: (event: OverlayEvent) => {
      // Clic droit sur un dessin = le supprimer (déclenche onRemoved → stockage).
      chart.removeOverlay({ id: event.overlay.id });
      return true; // consomme l'événement (pas de menu contextuel natif).
    },
  });
  return typeof created === "string" ? created : null;
}

/**
 * Supprime le dessin SÉLECTIONNÉ sur l'instance FOCUS. Renvoie true si une suppression
 * a eu lieu. Appelé par l'écouteur clavier (Suppr/Backspace) de la barre d'outils.
 */
export function deleteSelectedDrawing(): boolean {
  if (activeChart === null) return false;
  const entry = registry.get(activeChart);
  if (!entry || entry.selectedOverlayId === null) return false;
  activeChart.removeOverlay({ id: entry.selectedOverlayId });
  return true;
}

/**
 * Rejoue les dessins sauvegardés de `symbol` (sous `exchange`) sur l'instance `chart`.
 * Appelé par ChartInstance APRÈS le backfill (les bougies sont posées : l'ancrage
 * temporel est valide). Met à jour la méta actif de l'entrée (source de la persistance).
 */
export function restoreDrawings(chart: KLineChartInstance, exchange: string, symbol: string): void {
  const entry = registry.get(chart);
  if (!entry) return;
  entry.exchange = exchange;
  entry.symbol = symbol;
  entry.liveOverlays.clear();

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
    const id = createTrackedOverlay(chart, ov.name, ov.points);
    if (id) entry.liveOverlays.set(id, ov);
  }
}

/**
 * Sélectionne un outil : met à jour la surbrillance puis, pour un outil de dessin,
 * lance `createOverlay` sur l'instance FOCUS. KLineChart prend alors la main sur
 * l'interaction (placement des points). À la fin du tracé (`onDrawEnd`), on repasse
 * au curseur pour que la surbrillance reflète l'action réellement active.
 */
export function selectTool(tool: DrawingToolId): void {
  drawingStore.getState().setTool(tool);
  const name = TOOL_OVERLAY[tool];
  if (name === null || activeChart === null) return;
  // Overlay TRACÉ : persisté par symbole (survit aux changements de TF/actif) et
  // supprimable au clic droit (cf. createTrackedOverlay).
  createTrackedOverlay(activeChart, name);
}

/**
 * Force le re-rendu des overlays Fibonacci déjà tracés sur TOUTES les instances liées
 * (appelé quand la config `fibStore` change : niveaux/zones). `overrideOverlay` par nom
 * retouche les instances existantes ; `createPointFigures` relit alors le store et le
 * thème. Le `rev` (qui change) garantit une modification effective déclenchant le redraw.
 */
export function redrawFibOverlays(rev: number): void {
  for (const entry of registry.values()) {
    entry.chart.overrideOverlay({ name: FIB_RETRACEMENT, extendData: rev });
    entry.chart.overrideOverlay({ name: FIB_TREND, extendData: rev });
  }
}

/**
 * Exporte l'instance FOCUS en PNG et déclenche son téléchargement (`getConvertPictureUrl`,
 * API v9.8 : includeOverlay/type/backgroundColor). Le canvas KLineChart étant transparent,
 * on passe la couleur de fond du thème (--bg). Nom : « SYMBOLE-TF-AAAA-MM-JJ.png ».
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

/** « Effacer tout » : retire TOUS les overlays de dessin de l'instance FOCUS. */
export function clearAllOverlays(): void {
  if (activeChart === null) return;
  // Sans argument, removeOverlay supprime tous les overlays. Sûr ici : les
  // indicateurs @axiom et le CVD orderflow passent par `createIndicator` (système
  // distinct), jamais par `createOverlay` — ils ne sont donc pas affectés.
  activeChart.removeOverlay();
  // Vide aussi la map vivante + le stockage de l'instance (au cas où des overlays
  // n'auraient pas déclenché onRemoved).
  const entry = registry.get(activeChart);
  if (entry) {
    entry.liveOverlays.clear();
    persistEntry(entry);
  }
  drawingStore.getState().setTool("cursor");
}
