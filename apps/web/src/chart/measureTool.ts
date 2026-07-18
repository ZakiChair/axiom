/**
 * Outil de mesure « Shift + glisser » — règle TRANSITOIRE sur le pane prix.
 *
 * Maintenir Shift et glisser trace un rectangle (vert hausse / rouge baisse) du
 * point de départ au curseur, avec une étiquette : écart %, Δ prix signé, nombre
 * de bougies et durée. Relâcher (ou Échap / perte de focus) efface tout. Répétable.
 *
 * Rendu IMPÉRATIF (deux <div> mutés au mousemove, hors render-loop React) — même
 * esprit que PaneHeaders / liquidationHeat.
 *
 * Événements : KLineChart pane via `mousedown`/`mousemove` (pas les pointer events).
 * On écoute donc `mousedown` sur `window` en phase CAPTURE (se déclenche AVANT tout
 * le reste) et, sur Shift + curseur dans le pane bougies, on `stopPropagation` +
 * `preventDefault` → KLineChart ne reçoit jamais le mousedown et ne pane pas pendant
 * la mesure. Le glissement est suivi via mousemove/mouseup sur window.
 *
 * Conversion pixel→prix identique à priceAlertMenu : `convertFromPixel` sur le pane
 * bougies (absolute:true), l'échelle Y (lin/log/%) étant celle de ce pane.
 */
import type { Chart as KLineChartInstance } from "klinecharts";
import { formatPct, formatPrice } from "../lib/format";

const CANDLE_PANE_ID = "candle_pane";

/** Un point de mesure : prix + repères temporel et d'index (issus de convertFromPixel). */
export interface PointMesure {
  prix: number;
  timestamp: number;
  dataIndex: number;
}

/** Résultat d'une mesure : écart SIGNÉ (pct/Δ prix), comptages ABSOLUS (bougies/durée). */
export interface Mesure {
  pct: number;
  deltaPrix: number;
  nBougies: number;
  dureeMs: number;
  hausse: boolean;
}

/** Calcule l'écart entre deux points. PURE. */
export function calculerMesure(debut: PointMesure, fin: PointMesure): Mesure {
  const deltaPrix = fin.prix - debut.prix;
  const base = debut.prix;
  const pct = base !== 0 && Number.isFinite(base) ? (deltaPrix / base) * 100 : Number.NaN;
  return {
    pct,
    deltaPrix,
    nBougies: Math.abs(fin.dataIndex - debut.dataIndex),
    dureeMs: Math.abs(fin.timestamp - debut.timestamp),
    hausse: fin.prix >= debut.prix,
  };
}

/** Durée compacte : « 45s », « 2h 15m », « 3j 4h » (deux unités max). PURE. */
export function formaterDuree(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) {
    const rm = m % 60;
    return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
  }
  const j = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${j}j ${rh}h` : `${j}j`;
}

/** Δ prix signé au format terminal : « +1,234.50 » / « −56.00 ». PURE. */
function formaterDeltaPrix(delta: number): string {
  if (!Number.isFinite(delta)) return "—";
  const signe = delta >= 0 ? "+" : "−";
  return `${signe}${formatPrice(Math.abs(delta))}`;
}

interface DragEnCours {
  debut: PointMesure;
  startRelX: number;
  startRelY: number;
}

/** Contrôleur impératif de l'outil de mesure, attaché à UNE instance de graphe. */
export class MeasureTool {
  private readonly rect: HTMLDivElement;
  private readonly label: HTMLDivElement;
  private drag: DragEnCours | null = null;

  constructor(
    private readonly chart: KLineChartInstance,
    private readonly chartDom: HTMLElement,
    private readonly container: HTMLElement,
  ) {
    this.rect = document.createElement("div");
    this.rect.style.cssText =
      "position:absolute;pointer-events:none;z-index:30;display:none;box-sizing:border-box;" +
      "border-width:1px;border-style:solid;border-radius:2px;";
    this.label = document.createElement("div");
    this.label.style.cssText =
      "position:absolute;pointer-events:none;z-index:31;display:none;white-space:nowrap;" +
      "font-family:ui-monospace,monospace;font-size:10px;font-weight:600;padding:2px 5px;" +
      "border-radius:3px;border:1px solid;transform:translate(8px,8px);";
    container.appendChild(this.rect);
    container.appendChild(this.label);
    // Capture sur window : fiable même si un ancêtre stoppe la propagation plus bas,
    // et permet de bloquer le mousedown AVANT que KLineChart ne l'intercepte.
    window.addEventListener("mousedown", this.onMouseDown, { capture: true });
  }

  dispose(): void {
    window.removeEventListener("mousedown", this.onMouseDown, {
      capture: true,
    } as EventListenerOptions);
    this.annuler();
    this.rect.remove();
    this.label.remove();
  }

  private relatif(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.chartDom.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  private pointDepuisPixel(x: number, y: number): PointMesure | null {
    const raw = this.chart.convertFromPixel([{ x, y }], {
      paneId: CANDLE_PANE_ID,
      absolute: true,
    });
    const p = (Array.isArray(raw) ? raw[0] : raw) as
      | Partial<{ value: number; timestamp: number; dataIndex: number }>
      | undefined;
    if (!p || typeof p.value !== "number" || !Number.isFinite(p.value)) return null;
    return {
      prix: p.value,
      timestamp: typeof p.timestamp === "number" ? p.timestamp : 0,
      dataIndex: typeof p.dataIndex === "number" ? p.dataIndex : 0,
    };
  }

  private onMouseDown = (e: MouseEvent): void => {
    // Seulement Shift + clic gauche, et uniquement sur CE graphe (target dans chartDom).
    if (!e.shiftKey || e.button !== 0) return;
    if (!(e.target instanceof Node) || !this.chartDom.contains(e.target)) return;
    const bound = this.chart.getSize(CANDLE_PANE_ID);
    if (!bound) return;
    const { x, y } = this.relatif(e.clientX, e.clientY);
    if (x < bound.left || x > bound.left + bound.width) return;
    if (y < bound.top || y > bound.top + bound.height) return;
    const debut = this.pointDepuisPixel(x, y);
    if (!debut) return;
    // Capture window + stopPropagation → KLineChart ne reçoit pas le mousedown et ne
    // démarre aucun pan pendant que l'on mesure.
    e.preventDefault();
    e.stopPropagation();
    this.drag = { debut, startRelX: x, startRelY: y };
    this.container.style.userSelect = "none";
    window.addEventListener("mousemove", this.onMouseMove, { capture: true });
    window.addEventListener("mouseup", this.onMouseUp, { capture: true });
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("blur", this.onBlur);
    this.dessiner(x, y); // rectangle dégénéré au clic (écart 0)
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.drag) return;
    // On bloque aussi le mousemove pendant la mesure (KLineChart ne doit ni paner ni
    // bouger son crosshair sous la règle).
    e.stopPropagation();
    const bound = this.chart.getSize(CANDLE_PANE_ID);
    if (!bound) return;
    const rel = this.relatif(e.clientX, e.clientY);
    const x = Math.min(Math.max(rel.x, bound.left), bound.left + bound.width);
    const y = Math.min(Math.max(rel.y, bound.top), bound.top + bound.height);
    this.dessiner(x, y);
  };

  private onMouseUp = (): void => this.annuler();

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") this.annuler();
  };

  private onBlur = (): void => this.annuler();

  private dessiner(curX: number, curY: number): void {
    const d = this.drag;
    if (!d) return;
    const fin = this.pointDepuisPixel(curX, curY);
    if (!fin) return;
    const m = calculerMesure(d.debut, fin);
    const teinte = m.hausse ? "var(--up)" : "var(--down)";

    this.rect.style.display = "block";
    this.rect.style.left = `${Math.min(d.startRelX, curX)}px`;
    this.rect.style.top = `${Math.min(d.startRelY, curY)}px`;
    this.rect.style.width = `${Math.abs(curX - d.startRelX)}px`;
    this.rect.style.height = `${Math.abs(curY - d.startRelY)}px`;
    this.rect.style.borderColor = teinte;
    this.rect.style.backgroundColor = `color-mix(in srgb, ${teinte} 12%, transparent)`;

    this.label.style.display = "block";
    this.label.style.left = `${curX}px`;
    this.label.style.top = `${curY}px`;
    this.label.style.color = "var(--bg)";
    this.label.style.backgroundColor = teinte;
    this.label.style.borderColor = teinte;
    this.label.textContent =
      `${formatPct(m.pct)}  ${formaterDeltaPrix(m.deltaPrix)}  ` +
      `${m.nBougies} b · ${formaterDuree(m.dureeMs)}`;
  }

  private annuler(): void {
    if (this.drag) {
      window.removeEventListener("mousemove", this.onMouseMove, { capture: true } as EventListenerOptions);
      window.removeEventListener("mouseup", this.onMouseUp, { capture: true } as EventListenerOptions);
      window.removeEventListener("keydown", this.onKeyDown);
      window.removeEventListener("blur", this.onBlur);
      this.container.style.userSelect = "";
      this.drag = null;
    }
    this.rect.style.display = "none";
    this.label.style.display = "none";
  }
}
