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

/**
 * Ouverture de la bougie que le moteur met sous un réticule resté au pixel d'indice `indice` (rendu
 * par `convertFromPixel`). L'indice est borné aux données, comme le fait KLineChart 9.8.12
 * (`TooltipStore.setCrosshair`) : au-delà de la dernière bougie, dans la marge droite, c'est la
 * dernière ; avant la première, la première. `undefined` sans indice ou sans donnée. PURE.
 */
export function bougieSousReticule(indice: number | undefined, donnees: ReadonlyArray<Pick<KLineData, "timestamp">>): number | undefined {
  if (indice === undefined || !Number.isFinite(indice)) return undefined;
  return donnees[Math.max(0, Math.min(indice, donnees.length - 1))]?.timestamp;
}

/**
 * Offre facultative de l'encart du téléphone, rendue en bouton sous le texte : l'alerte de prix au
 * bord de la zone forte sous le doigt (`alerteZone.ts`). L'encart ne sait rien des alertes : il
 * rend un état, un texte, et prévient au toucher.
 */
export interface OffreEncart {
  /** « offre » : bouton actif. Tout autre état : même emplacement, grisé, sans effet. */
  etat: string;
  libelle: string;
  /** Appelé au toucher du bouton actif. */
  executer: () => void;
}

/**
 * Bloc de texte de l'encart (et son bouton) : toute la largeur de la grille, renvoyé à la ligne.
 * Police du graphe, celle des rangées du canvas. iOS n'agrandit pas ce texte en paysage :
 * `-webkit-text-size-adjust: 100%` est hérité de `html` (préflight Tailwind).
 */
const STYLE_TEXTE = "grid-column:1/-1;white-space:normal;margin-top:4px;font:11px/1.4 var(--font-display)";

/** Fond de l'encart des prix seuls : légèrement translucide, il laisse deviner les bougies. */
const FOND = "color-mix(in srgb, var(--surface) 92%, transparent)";

/** Contrôleur impératif de l'encart, attaché à UNE instance de graphe. */
export class CandleReadout {
  private readonly box: HTMLDivElement;
  /** Arguments du dernier `montrer`, tant que l'encart est affiché (cf. `relire`). */
  private dernier: Parameters<CandleReadout["montrer"]> | null = null;
  /** Texte de l'offre lue au dernier `montrer` (cf. `offreChangee`). */
  private libelle: string | undefined;

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
    this.dernier = null;
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
   * `offre` (téléphone seulement, jamais appelée au bureau) : lue à chaque affichage, elle rend un
   * bouton sous le texte (`[data-alerte-zone]`), ou rien. Le bouton allonge l'encart de 48 px et,
   * seul de l'encart, capte les touchers : il n'est rendu que si l'encart, bouton compris, tient
   * dans la zone libre du pane. Sinon l'encart reste celui du texte, là où il tenait sans lui.
   */
  montrer(c: KLineData, x: number, y: number, texte?: string, offre?: () => OffreEncart | undefined): void {
    const mobile = this.container.dataset.mobile === "true";
    this.dernier = [c, x, y, texte, offre];
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
    const bouton = mobile && offre ? offre() : undefined;
    this.libelle = bouton && bouton.libelle;
    // « Large » : toute la largeur et un fond opaque, dès qu'un texte ou un bouton est à lire.
    const avecTexte = mobile && (texte !== undefined || bouton !== undefined);
    if (mobile && texte !== undefined) {
      const bloc = document.createElement("div");
      bloc.setAttribute("data-candle-readout-texte", "");
      bloc.style.cssText = STYLE_TEXTE;
      bloc.textContent = texteEncart(texte);
      this.box.appendChild(bloc);
    }
    const elBouton = bouton && this.box.appendChild(this.boutonOffre(bouton));
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
    let bh = this.box.offsetHeight;
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
        // bornes : celle du haut d'abord, l'encart dépasse vers le bas. C'est le cas en paysage
        // dès qu'un pane d'indicateur ou « Détails » raccourcit la zone libre : il déborde sur le
        // pane voisin et, sur les écrans les plus courts, sur le bouton (mesures au contrat,
        // section du 12 novembre 2026, « Encart en paysage »).
        haut += this.chart.getStyles().candle.tooltip.offsetTop;
        // Panneau « Indicateurs (n) » déplié : il monte depuis ces 80 px, l'encart s'arrête à son
        // haut (replié ou au bureau, sa hauteur est nulle). Sans place au-dessus, le panneau passe
        // DEVANT l'encart (`overlayLegend.ts`) : l'encart ne capte pas les touchers, un bouton
        // caché dessous resterait actif.
        const panneau = this.container.querySelector<HTMLElement>("[data-overlay-legend]");
        bas = Math.min(bas, this.container.clientHeight - 80 - (panneau ? panneau.offsetHeight : 0));
        // Pile d'avis (`Toasts.tsx`) : un avis d'alerte reste jusqu'au toucher, par-dessus le
        // graphe. L'encart s'arrête 4 px au-dessus d'elle. Il se replace à l'image qui suit un
        // changement des alertes (pose, « Annuler », déclenchement : `relire`, appelé par
        // `ChartInstance`). LIMITES : un avis paru sans changement d'alertes ne le replace pas (le
        // toucher suivant le replace) ; pile plus haute que la zone libre
        // (deux avis à 320 × 568 ; deux avis en paysage, où la pile n'occupe pourtant que les
        // 320 px de droite), il passe en partie dessous, fermer un avis le découvre. En portrait,
        // à 360 px de large et plus, il tient au-dessus de trois avis (mesures au contrat).
        const pile = document.querySelector("[data-pile-avis]");
        const boitePile = pile && pile.getBoundingClientRect();
        if (boitePile && boitePile.height) bas = Math.min(bas, boitePile.top - this.container.getBoundingClientRect().top - 4);
        // Bouton d'offre : il capte les touchers, il ne sort donc JAMAIS de la zone libre. Toutes
        // les bornes sont connues ici (bas du pane, bouton « Indicateurs (n) », panneau déplié,
        // pile d'avis) : si l'encart, bouton compris, n'y tient pas, le bouton n'est pas rendu.
        // Avant : l'encart débordait vers le bas avec lui, et un toucher sur « Indicateurs (n) »
        // ou sur l'en-tête d'un pane d'indicateur posait une alerte (paysage 844 × 390 ; 320 × 568
        // avec « Détails » ou un pane d'indicateur). LIMITE : sur ces écrans, pas d'offre dans
        // l'encart. Un avis fermé ou la place revenue, le toucher suivant sur la bande le rend.
        if (elBouton && haut + bh > bas) {
          elBouton.remove();
          bh = this.box.offsetHeight;
        }
      }
      if (left + bw > bound.left + bound.width) left = x - OFFSET - bw;
      if (top + bh > bas) top = y - OFFSET - bh;
      left = Math.max(bound.left, Math.min(left, bound.left + bound.width - bw));
      top = Math.max(haut, Math.min(top, bas - bh));
    }
    this.box.style.left = `${left}px`;
    this.box.style.top = `${top}px`;
  }

  /**
   * Bouton de l'offre, sous le texte. Lui seul capte le toucher : le reste de l'encart reste
   * traversable. Il n'est pas dans le DOM du graphe : le toucher ne déplace ni n'efface le
   * réticule, et l'encart reste. Hors de l'état « offre » il est grisé et sans effet, mais capte
   * encore le toucher : traversable, celui-ci irait au graphe, qui effacerait son réticule.
   */
  private boutonOffre(offre: OffreEncart): HTMLButtonElement {
    const actif = offre.etat === "offre";
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.setAttribute("data-alerte-zone", offre.etat);
    if (!actif) bouton.setAttribute("aria-disabled", "true");
    bouton.textContent = offre.libelle;
    // Même police et même retour à la ligne que le texte ; 44 px : cible tactile.
    bouton.style.cssText =
      `${STYLE_TEXTE};min-height:44px;padding:4px 8px;pointer-events:auto;text-align:left;border-radius:4px;` +
      `border:1px solid var(--border);background:var(--bg);color:var(${actif ? "--accent" : "--text-dim"})`;
    if (actif) {
      bouton.addEventListener("click", () => {
        // Au moment du geste l'offre est relue : si elle n'est plus celle du bouton (zone qui n'est
        // plus tracée, bord déplacé ou franchi, alerte déjà posée), rien n'est exécuté.
        if (!this.offreChangee()) offre.executer();
        // L'état a pu changer sans qu'aucune alerte soit créée (bord franchi entre-temps).
        this.relire();
      });
    }
    return bouton;
  }

  /**
   * Réaffiche l'encart tel qu'il est montré, offre relue : une alerte posée, annulée ou déclenchée
   * change son bouton. À l'image SUIVANTE : l'avis qui accompagne ce changement (pose,
   * déclenchement) est alors à l'écran, et l'encart se replace au-dessus de la pile d'avis. Sans
   * effet si l'encart est masqué d'ici là.
   */
  relire(): void {
    requestAnimationFrame(() => {
      if (this.dernier) this.montrer(...this.dernier);
    });
  }

  /**
   * L'offre, relue, n'est plus celle du dernier affichage : la zone n'est plus tracée (indicateur
   * fermé), son bord a bougé, le cours l'a franchi, ou l'alerte existe. Comparée par son texte, qui
   * porte l'état, le sens et le niveau. Deux usages. `ChartInstance` la demande après chaque
   * recalcul des indicateurs, encart affiché, et le réaffiche alors : sans cela le bouton d'une
   * zone disparue restait sous un texte inchangé (signal d'AXIS dans une bande forte, AXIS S/R
   * fermé). Et le bouton la demande au toucher, avant d'agir. L'encart n'est PAS réaffiché à
   * chaque recalcul (toutes les 500 ms en direct) : remplacer le bouton sous le doigt peut faire
   * perdre le toucher. Jamais lue au bureau, ni encart masqué.
   */
  offreChangee(): boolean {
    const lire = this.container.dataset.mobile === "true" && this.dernier && this.dernier[4];
    if (!lire) return false;
    const offre = lire();
    return (offre && offre.libelle) !== this.libelle;
  }

  cacher(): void {
    this.box.style.display = "none";
    this.dernier = null;
  }
}
