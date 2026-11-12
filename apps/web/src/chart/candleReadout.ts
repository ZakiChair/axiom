/**
 * Encart de lecture de bougie — suit le crosshair et affiche O / H / L / C, la
 * variation % (clôture vs ouverture) et l'amplitude (haut−bas) de la bougie pointée.
 *
 * Alimenté par l'action OnCrosshairChange (kLineData + x/y pixel du curseur). Rendu
 * IMPÉRATIF (un <div> muté, hors render-loop React), positionné près du curseur et
 * basculé/clampé pour rester DANS le pane prix près des bords.
 */
import type { Chart as KLineChartInstance, KLineData } from "klinecharts";
import { formatPct, formatPourcentage, formatPrice, VALEUR_ABSENTE } from "../lib/format";

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

/**
 * Écart d'une série en % (dominance STABLE.D) en points de pourcentage : « +0.12 pt » (Δ signé)
 * ou « 0.23 pt » (amplitude) — une variation RELATIVE d'un pourcentage serait ambiguë. PURE.
 */
export function enPoints(valeur: number, signe = false): string {
  if (!Number.isFinite(valeur)) return VALEUR_ABSENTE;
  return `${signe && valeur >= 0 ? "+" : ""}${valeur.toFixed(2)} pt`;
}

/**
 * Texte du bloc de l'encart : `info` entier s'il tient en `max` caractères ou s'il compte quatre
 * parties au plus (séparées par « — ») ; sinon ses TROIS premières parties (tête, statut, détail),
 * suivies de « … ». `max` est donc le seuil sous lequel un texte est rendu entier, pas un maximum :
 * le détail d'un signal confirmé porte un rendu à 369 caractères avec l'OI, 530 au plus quand tous
 * les réglages hors test et la mention d'amorce courte s'y ajoutent (`candleReadout.test.ts`).
 *
 * Un signal confirmé d'AXIS (700 à 1 400 caractères, cinq parties ou plus) s'arrête ainsi après ses
 * votes et son flux, AVANT les phrases des campagnes, qui commencent à sa quatrième partie : ni
 * « test réussi », ni chiffre de campagne sans la réserve qui les suit. C'est une règle de
 * structure, pas de longueur : une limite en caractères seule rendait la tête sans le détail dès que
 * l'OI ou un réglage l'allongeait de dix caractères. La réserve d'un texte est sa DERNIÈRE partie :
 * on ne s'arrête jamais juste avant elle. Un fort achat en 4h (tête, flux, « +1.61 % en moyenne … »,
 * réserve : quatre parties) garde ainsi son chiffre ET sa réserve, même allongé au-delà de `max`.
 * Garde-fou : jamais plus du double de `max`, par une coupe nette. PURE.
 */
export function texteEncart(info: string, max = 360): string {
  const parties = info.split(" — ");
  const debut = (info.length > max && parties.length > 4 ? parties.slice(0, 3).join(" — ") : info).slice(0, 2 * max);
  return debut === info ? info : `${debut} …`;
}

/** Fond de l'encart des prix seuls : légèrement translucide, il laisse deviner les bougies. */
const FOND = "color-mix(in srgb, var(--surface) 92%, transparent)";

/** Contrôleur impératif de l'encart, attaché à UNE instance de graphe. */
export class CandleReadout {
  private readonly box: HTMLDivElement;

  constructor(
    private readonly chart: KLineChartInstance,
    private readonly container: HTMLElement,
  ) {
    this.box = document.createElement("div");
    this.box.setAttribute("data-candle-readout", "");
    // Colonnes et gouttière ne jouent qu'en grille (mise en page téléphone, cf. `montrer`).
    this.box.style.cssText =
      "position:absolute;pointer-events:none;z-index:29;display:none;white-space:nowrap;" +
      "font-family:ui-monospace,monospace;font-size:10px;line-height:1.35;padding:4px 6px;" +
      `border-radius:4px;background:${FOND};overflow:hidden;` +
      "grid-template-columns:repeat(2,minmax(0,1fr));column-gap:12px;" +
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

  /**
   * Affiche l'encart pour la bougie `c` au pixel (x,y) du crosshair. `texte` (mise en page
   * téléphone seulement) : texte complet de l'annotation sous le doigt, rendu sous les prix dans
   * un bloc à fond plein, renvoyé à la ligne — sur le canvas, sa rangée est coupée au bord.
   */
  montrer(c: KLineData, x: number, y: number, texte?: string): void {
    const mobile = this.container.dataset.mobile === "true";
    // Série en % (data-unite posé par ChartInstance, comme data-mobile) : O/H/L/C en %, Δ et ampl en points.
    const pct = this.container.dataset.unite === "%";
    const niveau = pct ? formatPourcentage : formatPrice;
    const r = lectureBougie(c);
    const teinte = r.hausse ? "var(--up)" : "var(--down)";
    this.box.replaceChildren();
    this.ligne("O", niveau(c.open));
    this.ligne("H", niveau(c.high));
    this.ligne("L", niveau(c.low));
    this.ligne("C", niveau(c.close), teinte);
    this.ligne("Δ", pct ? enPoints(c.close - c.open, true) : formatPct(r.variationPct), teinte);
    this.ligne("ampl", pct ? enPoints(r.amplitude) : formatPrice(r.amplitude));
    const avecTexte = mobile && texte !== undefined;
    if (avecTexte) {
      const bloc = document.createElement("div");
      bloc.setAttribute("data-candle-readout-texte", "");
      // Police du graphe, celle des rangées du canvas. iOS n'agrandit pas ce texte en paysage :
      // `-webkit-text-size-adjust: 100%` est hérité de `html` (préflight Tailwind).
      bloc.style.cssText = "grid-column:1/-1;white-space:normal;margin-top:4px;font:11px/1.4 var(--font-display)";
      bloc.textContent = texteEncart(texte);
      this.box.appendChild(bloc);
    }
    // Sur téléphone, trois lignes (grille à deux colonnes) et une largeur bornée libèrent le
    // point inspecté.
    const largeurMax = `${Math.max(0, this.container.clientWidth - 8)}px`;
    this.box.style.display = mobile ? "grid" : "block";
    this.box.style.maxWidth = largeurMax;
    // Avec un texte : toute la largeur, et un fond OPAQUE (à 92 %, bandeau, bougies et rangées du
    // canvas se lisaient au travers des lignes du texte).
    this.box.style.width = avecTexte ? largeurMax : "";
    this.box.style.background = avecTexte ? "var(--surface)" : FOND;

    // Positionnement : décalé du curseur, basculé à gauche/haut près des bords du pane.
    const bound = this.chart.getSize(CANDLE_PANE_ID);
    const OFFSET = 14;
    const bw = this.box.offsetWidth;
    const bh = this.box.offsetHeight;
    let left = x + OFFSET;
    let top = y + OFFSET;
    if (bound) {
      let haut = bound.top;
      let bas = bound.top + bound.height;
      if (avecTexte) {
        // Large et haut, l'encart reste dans la zone libre du pane. En bas : au-dessus du bouton
        // « Indicateurs (n) », toujours affiché quand un texte l'est (`overlayLegend.ts` : à 32 px
        // du bas du conteneur, haut de 2,75 rem, soit 44 px au plus et 40 px mesurés au téléphone ;
        // il reste 4 à 8 px). En haut : sous l'ordonnée de l'infobulle (`hautInfobullePrix`), qui
        // est le bas de l'en-tête tant que « Détails » est fermé, ou ouvert dans le tiers haut du
        // pane. LIMITE : panneau « Détails » plus bas que ce tiers (pane court), l'infobulle s'arrête
        // au tiers et l'encart avec elle ; il peut alors recouvrir le bas du panneau, jamais sa part
        // repliée (32 px mesurés à 320 × 568, où les 130 px libres entre le panneau et le bouton
        // sont moins que l'encart, 131 à 147 px selon le thème). Pane trop court pour les deux
        // bornes : celle du haut d'abord, l'encart dépasse vers le bas.
        haut += this.chart.getStyles().candle.tooltip.offsetTop;
        bas = Math.min(bas, this.container.clientHeight - 80);
      }
      if (left + bw > bound.left + bound.width) left = x - OFFSET - bw;
      if (top + bh > bas) top = y - OFFSET - bh;
      left = Math.max(bound.left, Math.min(left, bound.left + bound.width - bw));
      top = Math.max(haut, Math.min(top, bas - bh));
    }
    this.box.style.left = `${left}px`;
    this.box.style.top = `${top}px`;
  }

  cacher(): void {
    this.box.style.display = "none";
  }
}
