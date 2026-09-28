/**
 * Encart de lecture de bougie — suit le crosshair et affiche O / H / L / C, la
 * variation % (clôture vs ouverture) et l'amplitude (haut−bas) de la bougie pointée.
 *
 * Alimenté par l'action OnCrosshairChange (kLineData + x/y pixel du curseur). Rendu
 * IMPÉRATIF (un <div> muté, hors render-loop React), positionné près du curseur et
 * basculé/clampé pour rester DANS le pane prix près des bords.
 */
import type { Chart as KLineChartInstance, KLineData } from "klinecharts";
import { formatPct, formatPrice } from "../lib/format";

const CANDLE_PANE_ID = "candle_pane";

/** Lecture d'une bougie : variation % (clôture vs ouverture), amplitude, sens. */
export interface LectureBougie {
  variationPct: number;
  amplitude: number;
  hausse: boolean;
}

/** Calcule variation % (clôture vs ouverture), amplitude (haut−bas) et sens. PURE. */
export function lectureBougie(
  c: Pick<KLineData, "open" | "high" | "low" | "close">,
): LectureBougie {
  const variationPct =
    c.open !== 0 && Number.isFinite(c.open) ? ((c.close - c.open) / c.open) * 100 : Number.NaN;
  return { variationPct, amplitude: c.high - c.low, hausse: c.close >= c.open };
}

/** Contrôleur impératif de l'encart, attaché à UNE instance de graphe. */
export class CandleReadout {
  private readonly box: HTMLDivElement;

  constructor(
    private readonly chart: KLineChartInstance,
    private readonly container: HTMLElement,
  ) {
    this.box = document.createElement("div");
    this.box.setAttribute("data-candle-readout", "");
    this.box.style.cssText =
      "position:absolute;pointer-events:none;z-index:29;display:none;white-space:nowrap;" +
      "font-family:ui-sans-serif,system-ui,sans-serif;font-size:12px;line-height:1.45;padding:6px 8px;" +
      "border-radius:6px;background:var(--surface);" +
      "border:1px solid var(--border);color:var(--text);box-shadow:0 2px 8px rgba(0,0,0,0.25);";
    container.appendChild(this.box);
  }

  dispose(): void {
    this.box.remove();
  }

  /** Ajoute une ligne « clé  valeur » à l'encart (valeur éventuellement teintée). */
  private ligne(cle: string, valeur: string, couleur?: string): void {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;justify-content:space-between;gap:12px;";
    const k = document.createElement("span");
    k.style.color = "var(--text-dim)";
    k.textContent = cle;
    const v = document.createElement("span");
    v.style.fontVariantNumeric = "tabular-nums";
    if (couleur) v.style.color = couleur;
    v.textContent = valeur;
    row.append(k, v);
    this.box.appendChild(row);
  }

  /** Affiche l'encart pour la bougie `c` au pixel (x,y) du crosshair. */
  montrer(c: KLineData, x: number, y: number): void {
    const mobile = this.container.dataset.mobile === "true";
    const r = lectureBougie(c);
    const teinte = r.hausse ? "var(--up)" : "var(--down)";
    this.box.replaceChildren();
    this.ligne("O", formatPrice(c.open));
    this.ligne("H", formatPrice(c.high));
    this.ligne("L", formatPrice(c.low));
    this.ligne("C", formatPrice(c.close), teinte);
    this.ligne("Δ", formatPct(r.variationPct), teinte);
    this.ligne("ampl", formatPrice(r.amplitude));
    // Sur téléphone, trois lignes et une largeur bornée libèrent le point inspecté.
    this.box.style.display = mobile ? "grid" : "block";
    this.box.style.gridTemplateColumns = mobile ? "repeat(2, minmax(0, 1fr))" : "";
    this.box.style.columnGap = mobile ? "12px" : "";
    this.box.style.maxWidth = `${Math.max(0, this.container.clientWidth - 8)}px`;
    this.box.style.overflow = "hidden";

    // Positionnement : décalé du curseur, basculé à gauche/haut près des bords du pane.
    const bound = this.chart.getSize(CANDLE_PANE_ID);
    const OFFSET = 14;
    const bw = this.box.offsetWidth;
    const bh = this.box.offsetHeight;
    let left = x + OFFSET;
    let top = y + OFFSET;
    if (bound) {
      if (left + bw > bound.left + bound.width) left = x - OFFSET - bw;
      if (top + bh > bound.top + bound.height) top = y - OFFSET - bh;
      left = Math.max(bound.left, Math.min(left, bound.left + bound.width - bw));
      top = Math.max(bound.top, Math.min(top, bound.top + bound.height - bh));
    }
    this.box.style.left = `${left}px`;
    this.box.style.top = `${top}px`;
  }

  cacher(): void {
    this.box.style.display = "none";
  }
}
