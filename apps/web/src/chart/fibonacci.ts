/**
 * Overlays Fibonacci CUSTOM — retracement thémé/paramétrable + projection « selon tendance ».
 *
 * POURQUOI custom : le `fibonacciLine` intégré de KLineChart a des niveaux FIGÉS
 * (0/0.236/0.382/0.5/0.618/0.786/1) et des couleurs par défaut non thémées. Ici on
 * enregistre deux overlays via `registerOverlay` dont le rendu :
 *   1. lit les COULEURS du thème actif (variables CSS --accent/--up/--down/--text-dim)
 *      à chaque frame → cohérent avec tous les thèmes, sans recréer l'overlay ;
 *   2. lit les NIVEAUX depuis `fibStore` (persisté) → l'utilisateur ajoute des ratios
 *      (ex. 0.666) et active des ZONES (bandes translucides entre niveaux).
 *
 * Convention REPRISE du natif (pour ne pas dérouter) : pour un retracement à 2 points,
 *   y(percent) = coord[1].y + (coord[0].y − coord[1].y)·percent
 * soit 0 % au 2ᵉ point (clic final / extrême) et 100 % au 1ᵉʳ (origine).
 *
 * « fibTrend » ajoute des niveaux de PROJECTION au-delà de l'extrême, dans le sens de
 * la tendance (percent négatif → labellisé 127.2 % / 161.8 % …), colorés up/down selon
 * que le prix a monté ou baissé entre les deux points.
 */
import { registerOverlay } from "klinecharts";
import type {
  OverlayCreateFiguresCallbackParams,
  OverlayFigure,
  OverlayFigureIgnoreEventType,
} from "klinecharts";
import { createStore } from "zustand/vanilla";
import { lireTokenCanvas } from "../lib/canvasTokens";

/**
 * Les figures du fib ignorent UNIQUEMENT le survol (crosshair/pan fluides), mais
 * répondent au clic / clic droit → le tracé est sélectionnable (clic puis Suppr) et
 * supprimable (clic droit), comme les autres dessins. Sans ça (ignoreEvent: true),
 * les lignes laissaient passer TOUS les événements et le fib était ineffaçable.
 */
const FIB_IGNORE_MOVE: OverlayFigureIgnoreEventType[] = ["mouseMoveEvent", "touchMoveEvent"];

export const FIB_RETRACEMENT = "fibCustom";
export const FIB_TREND = "fibTrend";

/** Ratios de retracement proposés dans le panneau de réglages (cases à cocher). */
export const COMMON_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.666, 0.786, 0.886, 1] as const;
/** Ratios de projection (>1) appliqués par l'outil « selon tendance ». */
export const COMMON_EXTENSIONS = [1.272, 1.414, 1.618, 2, 2.618] as const;

const STORAGE_KEY = "axiom:fib:config:v1";
const DEFAULT_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.666, 0.786, 1];
const DEFAULT_EXTENSIONS = [1.272, 1.618, 2.618];

interface FibConfig {
  levels: number[];
  extensions: number[];
  showZones: boolean;
}

/** Lecture tolérante de la config persistée (fusionnée avec les défauts). */
function read(): FibConfig {
  const base: FibConfig = {
    levels: [...DEFAULT_LEVELS],
    extensions: [...DEFAULT_EXTENSIONS],
    showZones: true,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<FibConfig>;
    return {
      levels: Array.isArray(p.levels) ? p.levels.filter((n) => Number.isFinite(n)) : base.levels,
      extensions: Array.isArray(p.extensions)
        ? p.extensions.filter((n) => Number.isFinite(n))
        : base.extensions,
      showZones: typeof p.showZones === "boolean" ? p.showZones : base.showZones,
    };
  } catch {
    return base;
  }
}

function write(cfg: FibConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    /* best-effort */
  }
}

export interface FibState extends FibConfig {
  /** Incrémenté à chaque changement : sert à forcer le redraw des overlays (cf. Chart.tsx). */
  rev: number;
  /** Active/désactive un ratio (route vers levels si ≤1, sinon extensions). */
  toggleRatio: (r: number) => void;
  /** Ajoute un ratio libre saisi par l'utilisateur. */
  addRatio: (r: number) => void;
  setShowZones: (v: boolean) => void;
  reset: () => void;
}

const initial = read();

export const fibStore = createStore<FibState>((set, get) => ({
  ...initial,
  rev: 0,

  toggleRatio: (r) => {
    if (!Number.isFinite(r)) return;
    const s = get();
    const key = r <= 1 ? "levels" : "extensions";
    const arr = s[key];
    const next = arr.includes(r) ? arr.filter((x) => x !== r) : [...arr, r].sort((a, b) => a - b);
    const cfg = { levels: s.levels, extensions: s.extensions, showZones: s.showZones, [key]: next };
    write(cfg);
    set({ ...cfg, rev: s.rev + 1 });
  },

  addRatio: (r) => {
    if (!Number.isFinite(r) || r < 0) return;
    const s = get();
    const key = r <= 1 ? "levels" : "extensions";
    if (s[key].includes(r)) return;
    const next = [...s[key], r].sort((a, b) => a - b);
    const cfg = { levels: s.levels, extensions: s.extensions, showZones: s.showZones, [key]: next };
    write(cfg);
    set({ ...cfg, rev: s.rev + 1 });
  },

  setShowZones: (v) => {
    const s = get();
    const cfg = { levels: s.levels, extensions: s.extensions, showZones: v };
    write(cfg);
    set({ showZones: v, rev: s.rev + 1 });
  },

  reset: () => {
    const cfg: FibConfig = {
      levels: [...DEFAULT_LEVELS],
      extensions: [...DEFAULT_EXTENSIONS],
      showZones: true,
    };
    write(cfg);
    set({ ...cfg, rev: get().rev + 1 });
  },
}));

// ---------- Rendu thémé ----------

/** Ajoute un canal alpha à une couleur hex #rrggbb (sinon renvoie tel quel). */
function withAlpha(hex: string, alpha: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? `${hex}${alpha}` : hex;
}

interface ThemeColors {
  accent: string;
  up: string;
  down: string;
  textDim: string;
}

function themeColors(): ThemeColors {
  return {
    accent: lireTokenCanvas("--accent", "#38bdf8"),
    up: lireTokenCanvas("--up", "#2dc08e"),
    down: lireTokenCanvas("--down", "#f92855"),
    textDim: lireTokenCanvas("--text-dim", "#9ca3af"),
  };
}

/** Un niveau à tracer : ratio interne (convention native) + libellé affiché + couleur. */
export interface FibEntry {
  percent: number;
  label: string;
  color: string;
  emphasize: boolean;
}

/** Niveaux du retracement standard (ratios ≤ 1), colorés accent. */
export function retracementEntries(levels: number[], accent: string): FibEntry[] {
  return [...new Set(levels)]
    .filter((r) => Number.isFinite(r))
    .map((r) => ({
      percent: r,
      label: `${(r * 100).toFixed(1)}%`,
      color: accent,
      emphasize: r === 0.5 || r === 0.618 || r === 0.666,
    }));
}

/**
 * Niveaux de projection « selon tendance » : au-delà de l'extrême (percent négatif),
 * labellisés par leur nom conventionnel (ex. 1.618 → « 161.8% »), colorés up/down.
 */
export function extensionEntries(extensions: number[], trendColor: string): FibEntry[] {
  return [...new Set(extensions)]
    .filter((e) => Number.isFinite(e) && e > 1)
    .map((e) => ({
      percent: -(e - 1), // au-delà du 0 % (extrême), dans le sens de la tendance
      label: `${(e * 100).toFixed(1)}%`,
      color: trendColor,
      emphasize: false,
    }));
}

/** Niveau résolu : FibEntry + coordonnée y (pixels) et valeur (prix) interpolées. */
export interface ResolvedFibEntry extends FibEntry {
  y: number;
  value: number;
}

/**
 * Résout chaque niveau en (y, value) par interpolation linéaire entre les 2 points
 * de l'overlay, triés par y (haut -> bas). PURE & testée (fibonacci.test.ts) — fige
 * la convention « 0 % au 2ᵉ point, 100 % au 1ᵉʳ » et le signe des projections (cf.
 * en-tête du fichier).
 */
export function resolveEntries(
  entries: FibEntry[],
  c0: { x: number; y: number },
  c1: { x: number; y: number },
  v0: number,
  v1: number
): ResolvedFibEntry[] {
  const yDif = c0.y - c1.y;
  const valDif = v0 - v1;
  return entries
    .map((e) => ({ ...e, y: c1.y + yDif * e.percent, value: v1 + valDif * e.percent }))
    .sort((a, b) => a.y - b.y);
}

/** Construit les figures (zones + lignes + labels) pour un jeu de niveaux. */
function buildFigures(
  params: OverlayCreateFiguresCallbackParams,
  entries: FibEntry[],
  zoneColor: string,
  showZones: boolean
): OverlayFigure[] {
  const { coordinates, overlay, precision } = params;
  const points = overlay.points;
  const p0 = points[0];
  const p1 = points[1];
  const c0 = coordinates[0];
  const c1 = coordinates[1];
  if (p0 === undefined || p1 === undefined || c0 === undefined || c1 === undefined) return [];
  const v0 = p0.value;
  const v1 = p1.value;
  if (!Number.isFinite(v0) || !Number.isFinite(v1)) return [];

  // Étendue horizontale = la ZONE tracée (entre les 2 points), pas toute la largeur
  // du graphe : le retracement épouse l'intervalle de temps sélectionné.
  const startX = Math.min(c0.x, c1.x);
  const endX = Math.max(c0.x, c1.x);
  const pricePrecision = Number.isFinite(precision.price) ? precision.price : 2;

  // Niveaux résolus en y + valeur, triés par y (haut -> bas) pour le bandage des zones.
  const resolved = resolveEntries(entries, c0, c1, v0 as number, v1 as number);

  const figures: OverlayFigure[] = [];

  // 1) Zones : bandes translucides alternées entre niveaux consécutifs.
  if (showZones) {
    for (let i = 0; i < resolved.length - 1; i++) {
      if (i % 2 !== 0) continue; // une bande sur deux (lisibilité)
      const top = resolved[i];
      const bot = resolved[i + 1];
      if (top === undefined || bot === undefined) continue;
      figures.push({
        type: "polygon",
        ignoreEvent: FIB_IGNORE_MOVE, // zone cliquable = grande cible pour sélectionner/supprimer
        attrs: {
          coordinates: [
            { x: startX, y: top.y },
            { x: endX, y: top.y },
            { x: endX, y: bot.y },
            { x: startX, y: bot.y },
          ],
        },
        styles: { style: "fill", color: withAlpha(zoneColor, "1f") },
      });
    }
  }

  // 2) Lignes + 3) labels.
  for (const r of resolved) {
    figures.push({
      type: "line",
      ignoreEvent: FIB_IGNORE_MOVE, // ligne cliquable → clic/clic droit sélectionne/supprime le fib
      attrs: { coordinates: [{ x: startX, y: r.y }, { x: endX, y: r.y }] },
      styles: { style: "solid", size: r.emphasize ? 1.6 : 1, color: r.color, dashedValue: [] },
    });
    figures.push({
      type: "text",
      ignoreEvent: true,
      attrs: {
        x: startX + 4,
        y: r.y,
        text: `${r.label} · ${r.value.toFixed(pricePrecision)}`,
        baseline: "bottom",
        align: "left",
      },
      styles: { color: r.color, size: 10 },
    });
  }

  return figures;
}

let registered = false;

/** Enregistre les deux overlays Fibonacci custom (idempotent). */
export function registerFibOverlays(): void {
  if (registered) return;
  registered = true;

  // Retracement thémé + paramétrable (zones).
  registerOverlay({
    name: FIB_RETRACEMENT,
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: (params) => {
      const { accent } = themeColors();
      const { levels, showZones } = fibStore.getState();
      return buildFigures(params, retracementEntries(levels, accent), accent, showZones);
    },
  });

  // Retracement + projection « selon tendance » (extensions colorées up/down).
  registerOverlay({
    name: FIB_TREND,
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: (params) => {
      const colors = themeColors();
      const { levels, extensions, showZones } = fibStore.getState();
      const points = params.overlay.points;
      const v0 = points[0]?.value;
      const v1 = points[1]?.value;
      // Tendance : le prix a-t-il monté entre le 1ᵉʳ et le 2ᵉ point ?
      const up = Number.isFinite(v0) && Number.isFinite(v1) ? (v1 as number) >= (v0 as number) : true;
      const trendColor = up ? colors.up : colors.down;
      const entries = [
        ...retracementEntries(levels, colors.accent),
        ...extensionEntries(extensions, trendColor),
      ];
      return buildFigures(params, entries, colors.accent, showZones);
    },
  });
}

// Auto-enregistrement à l'import (drawing.ts importe ce module).
registerFibOverlays();
