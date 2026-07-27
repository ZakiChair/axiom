/**
 * Annotations cible « prix » des indicateurs à PANE SÉPARÉ (segments de
 * divergence, labels, marqueurs), rendues sur le chart maître via un overlay
 * custom unique « axiomAnnotation » (patron WHALE/ECO : registerOverlay
 * idempotent + un createOverlay par annotation + rejeu par ids suivis).
 * `totalStep: 3` (2 points max, précédent fibonacci.ts) — les points sont
 * toujours fournis à la création, jamais saisis à la souris. `lock: true` :
 * pas de drag ; les figures restent SENSIBLES au survol (pas d'ignoreEvent)
 * pour le tooltip onMouseEnter/onMouseLeave (div flottante singleton, stylée
 * par variables CSS — le DOM résout var(...) nativement, contrairement aux canvas).
 * `lock` ne filtre QUE `pressedMouseMoveEvent` dans le bundle 9.8.12 (index.esm.js
 * ligne 8516) ; le survol passe par `_figureMouseMoveEvent`, donc les callbacks
 * onMouseEnter/onMouseLeave restent bien appelés sur un overlay verrouillé.
 *
 * Les defs pane "overlay" ne passent JAMAIS ici : leurs annotations "prix" sont
 * dessinées par le draw générique du pont sur candle_pane (annotationsPane.ts).
 */
import { registerOverlay } from "klinecharts";
import type { Chart, OverlayCreate } from "klinecharts";
import type {
  AnnotationsIndicateur,
  Candle,
  IndicatorDef,
} from "@axiom/types";
import { lireTokenCanvas } from "../lib/canvasTokens";

const ANNOTATION_OVERLAY = "axiomAnnotation";
const ANNOTATION_GROUP = "axiomAnnot";
/** Cap d'overlays par instance d'indicateur (les plus récents priment). */
const MAX_ANNOTATIONS_PAR_INSTANCE = 150;

/** Replis RVB (thème dark) des tokens des annotations — contexte sans DOM / token absent.
 * Constantes nommées `*_REPLI` (et non un objet littéral) : même convention que
 * annotationsPane.ts, seule forme d'hex admise par le garde-fou couleurs. */
const UP_REPLI = "#10b981";
const DOWN_REPLI = "#ef4444";
const DEFAUT_REPLI = "#38bdf8";

/** Repli hex pour un token de couleur (les tokens du thème sont en hex — cf. index.css). */
function repliPour(token: string): string {
  if (token === "--up") return UP_REPLI;
  if (token === "--down") return DOWN_REPLI;
  return DEFAUT_REPLI;
}

/** Données portées par chaque overlay, discriminées par genre. */
type ExtendAnnotation =
  | { genre: "segment"; trait: "plein" | "pointille"; couleur: string; info?: string }
  | { genre: "marqueur"; forme: "triangleHaut" | "triangleBas"; couleur: string; info?: string }
  | { genre: "label"; texte: string; couleur: string; dessous: boolean; info?: string };

// ── Tooltip flottant singleton (DOM, pas canvas : var(--…) résolu nativement) ──

let tooltipEl: HTMLDivElement | null = null;

function tooltip(): HTMLDivElement {
  if (tooltipEl !== null) return tooltipEl;
  const el = document.createElement("div");
  el.style.cssText =
    "position:fixed;z-index:60;display:none;max-width:320px;padding:6px 8px;" +
    "font-size:11px;line-height:1.4;pointer-events:none;border-radius:4px;" +
    "background:var(--surface);color:var(--text);border:1px solid var(--border)";
  document.body.appendChild(el);
  tooltipEl = el;
  return el;
}

export function afficherTooltipAnnotation(texte: string, pageX: number, pageY: number): void {
  const el = tooltip();
  el.textContent = texte;
  el.style.left = `${pageX + 12}px`;
  el.style.top = `${pageY + 12}px`;
  el.style.display = "block";
}

export function masquerTooltipAnnotation(): void {
  if (tooltipEl !== null) tooltipEl.style.display = "none";
}

// ── Overlay custom (idempotent, effet global klinecharts) ──

let overlayRegistered = false;

export function ensureAnnotationOverlayRegistered(): void {
  if (overlayRegistered) return;
  overlayRegistered = true;
  registerOverlay({
    name: ANNOTATION_OVERLAY,
    totalStep: 3,
    lock: true,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ overlay, coordinates }) => {
      const ext = overlay.extendData as ExtendAnnotation | undefined;
      const c0 = coordinates[0];
      if (ext === undefined || c0 === undefined) return [];
      const couleur = lireTokenCanvas(ext.couleur, repliPour(ext.couleur));
      if (ext.genre === "segment") {
        const c1 = coordinates[1];
        if (c1 === undefined) return [];
        return [
          {
            type: "line",
            attrs: { coordinates: [c0, c1] },
            styles:
              ext.trait === "pointille"
                ? { style: "dashed", dashedValue: [4, 4], size: 1.5, color: couleur }
                : { style: "solid", size: 1.5, color: couleur },
          },
        ];
      }
      if (ext.genre === "marqueur") {
        const t = 6;
        const pts =
          ext.forme === "triangleHaut"
            ? [{ x: c0.x, y: c0.y - t }, { x: c0.x - t, y: c0.y + t }, { x: c0.x + t, y: c0.y + t }]
            : [{ x: c0.x, y: c0.y + t }, { x: c0.x - t, y: c0.y - t }, { x: c0.x + t, y: c0.y - t }];
        return [{ type: "polygon", attrs: { coordinates: pts }, styles: { style: "fill", color: couleur } }];
      }
      return [
        {
          type: "text",
          attrs: {
            x: c0.x,
            y: ext.dessous ? c0.y + 8 : c0.y - 8,
            text: ext.texte,
            align: "center",
            baseline: ext.dessous ? "top" : "bottom",
          },
          styles: { color: couleur, size: 10 },
        },
      ];
    },
    onMouseEnter: (event) => {
      const ext = event.overlay.extendData as ExtendAnnotation | undefined;
      if (ext?.info !== undefined) afficherTooltipAnnotation(ext.info, event.pageX ?? 0, event.pageY ?? 0);
      return false;
    },
    onMouseLeave: () => {
      masquerTooltipAnnotation();
      return false;
    },
  });
}

// ── Contrôleur par instance de chart ──

type ChartOverlays = Pick<Chart, "createOverlay" | "removeOverlay">;

export class AnnotationsPrix {
  private readonly chart: ChartOverlays;
  /** instanceId d'indicateur -> ids d'overlays posés (rejeu ciblé, cf. whaleBubbles). */
  private readonly suivis = new Map<string, string[]>();

  constructor(chart: ChartOverlays) {
    ensureAnnotationOverlayRegistered();
    this.chart = chart;
  }

  /**
   * Rejoue les annotations cible "prix" d'une instance : retire les anciennes
   * puis pose les nouvelles (cap MAX_ANNOTATIONS_PAR_INSTANCE, les plus récentes).
   * No-op créatif pour un def overlay (rendu par le draw de candle_pane) ou sans
   * annotations — mais on retire toujours l'existant (params édités, def changé).
   * `createOverlay` sans paneId : le bundle 9.8.12 retombe sur `PaneIdConstants.CANDLE`
   * (index.esm.js ligne 13628) — les annotations atterrissent donc sur le pane prix.
   */
  appliquer(
    instanceId: string,
    def: IndicatorDef,
    annotations: AnnotationsIndicateur | undefined,
    candles: Candle[],
  ): void {
    this.retirer(instanceId);
    if (def.pane !== "separate" || annotations === undefined) return;
    const t = (idx: number): number | undefined => candles[idx]?.time;

    const creations: OverlayCreate[] = [];
    for (const s of (annotations.segments ?? []).filter((x) => x.cible === "prix")) {
      const t0 = t(s.deIdx);
      const t1 = t(s.aIdx);
      if (t0 === undefined || t1 === undefined) continue;
      creations.push({
        name: ANNOTATION_OVERLAY,
        groupId: ANNOTATION_GROUP,
        lock: true,
        points: [
          { timestamp: t0, value: s.deValeur },
          { timestamp: t1, value: s.aValeur },
        ],
        extendData: { genre: "segment", trait: s.trait, couleur: s.couleur, info: s.info } satisfies ExtendAnnotation,
      });
    }
    for (const m of (annotations.marqueurs ?? []).filter((x) => x.cible === "prix")) {
      const t0 = t(m.idx);
      if (t0 === undefined) continue;
      creations.push({
        name: ANNOTATION_OVERLAY,
        groupId: ANNOTATION_GROUP,
        lock: true,
        points: [{ timestamp: t0, value: m.valeur }],
        extendData: { genre: "marqueur", forme: m.forme, couleur: m.couleur, info: m.info } satisfies ExtendAnnotation,
      });
    }
    for (const l of (annotations.labels ?? []).filter((x) => x.cible === "prix")) {
      const t0 = t(l.idx);
      if (t0 === undefined) continue;
      creations.push({
        name: ANNOTATION_OVERLAY,
        groupId: ANNOTATION_GROUP,
        lock: true,
        points: [{ timestamp: t0, value: l.valeur }],
        extendData: {
          genre: "label",
          texte: l.texte,
          couleur: l.couleur,
          dessous: l.position === "dessous",
          info: l.info,
        } satisfies ExtendAnnotation,
      });
    }

    const ids: string[] = [];
    for (const o of creations.slice(-MAX_ANNOTATIONS_PAR_INSTANCE)) {
      const id = this.chart.createOverlay(o);
      if (typeof id === "string") ids.push(id);
    }
    if (ids.length > 0) this.suivis.set(instanceId, ids);
  }

  /** Retire les overlays d'une instance (try/catch : chart peut être détruit, cf. whaleBubbles). */
  retirer(instanceId: string): void {
    const ids = this.suivis.get(instanceId);
    if (ids === undefined) return;
    for (const id of ids) {
      try {
        this.chart.removeOverlay({ id });
      } catch {
        break;
      }
    }
    this.suivis.delete(instanceId);
  }

  retirerTout(): void {
    for (const instanceId of [...this.suivis.keys()]) this.retirer(instanceId);
  }
}
