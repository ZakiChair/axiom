/**
 * Couche « LIGNES DE NIVEAUX » — contrôleur canvas GÉNÉRIQUE qui peint des lignes de prix
 * HORIZONTALES étiquetées sur le pane prix du chart maître. Plomberie PARTAGÉE par deux
 * overlays de backlog (DIST — bandes VaR, PAPER — ordres/positions simulés) : même canvas
 * superposé, mêmes actions viewport, même thème/resize/DPR/clip que les autres contrôleurs
 * (patron `LiquidationHeatController` / `VolumeProfileController`).
 *
 * SÉPARATION DES RESPONSABILITÉS : le contrôleur ne connaît QUE des `LigneNiveau` (prix +
 * étiquette + token de couleur + emphase) ; la DONNÉE et sa RÉACTIVITÉ sont déléguées à un
 * `FournisseurLignes` (getLignes() PUR côté appelant + subscribe() qui signale un changement).
 * DIST calcule ses lignes depuis les bougies (data/distVar), PAPER depuis le store paper —
 * chacun dans son module ; ici on ne fait QUE du rendu.
 *
 * PERF : `getLignes()` peut être coûteux (DIST parcourt le buffer). Il n'est rappelé QUE
 * lorsque le fournisseur signale un changement (données/symbole/toggle) — JAMAIS à chaque
 * frame ; un simple scroll/zoom REPOSITIONNE les lignes mémoïsées via `convertToPixel`
 * (même dissociation `obsolete` / `dirty` que la grille de liquidations). Aucun re-render React.
 */
import { ActionType, DomPosition } from "klinecharts";
import type { Bounding, Chart, Point } from "klinecharts";
import type { Unsubscribe } from "@axiom/types";
import { themeStore } from "../store/theme";
import { lireTokenCanvas, rgbaTokenCanvas } from "../lib/canvasTokens";

/** Une ligne de prix horizontale à peindre (donnée pure, indépendante de KLineChart). */
export interface LigneNiveau {
  /** Prix (ancre Y) — attendu fini et > 0 (les lignes invalides sont écartées au rendu). */
  price: number;
  /** Étiquette affichée à droite de la ligne. */
  label: string;
  /** Token CSS de couleur (`--up` / `--down` / `--text-dim`…), résolu au moment du dessin. */
  couleur: string;
  /** Emphase du trait : « forte » (plein, opaque) vs « faible » (pointillé, atténué). */
  emphase: "forte" | "faible";
}

/**
 * Source de lignes pour le contrôleur : `getLignes()` renvoie l'instantané courant (PUR,
 * calculé par le module métier) ; `subscribe(onChange)` notifie quand cet instantané a
 * changé (nouvelles données / symbole / toggle) et renvoie le désabonnement.
 */
export interface FournisseurLignes {
  getLignes(): LigneNiveau[];
  subscribe(onChange: () => void): Unsubscribe;
}

/** Pane prix (id par défaut KLineChart). */
const CANDLE_PANE_ID = "candle_pane";
/** Alpha du trait selon l'emphase (forte = repère net, faible = contexte discret). */
const ALPHA_FORTE = 0.9;
const ALPHA_FAIBLE = 0.4;
/** Replis RVB (thème dark) des tokens de couleur employés — contexte sans DOM / token absent. */
const UP_REPLI = "#10b981";
const DOWN_REPLI = "#ef4444";
const DIM_REPLI = "#9ca3af";

/** Repli hex pour un token de couleur (les tokens du thème sont en hex — cf. index.css). */
function repliPour(token: string): string {
  if (token === "--up") return UP_REPLI;
  if (token === "--down") return DOWN_REPLI;
  return DIM_REPLI;
}

interface PixelXY {
  x?: number;
  y?: number;
}

/**
 * Contrôleur canvas des lignes de niveaux (overlay superposé au pane prix, `pointer-events:none`).
 * Piloté par `setEnabled` (comme les autres contrôleurs maîtres) ; tant qu'il tourne il suit son
 * `FournisseurLignes` (obsolescence des lignes) + le viewport (repositionnement) + le thème.
 */
export class NiveauxLignesController {
  private readonly chart: Chart;
  private readonly container: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly fournisseur: FournisseurLignes;

  private running = false;
  private raf = 0;
  /** Repeindre au prochain tour de boucle (viewport/thème/resize) sans forcément recalculer. */
  private dirty = true;
  /** Les lignes mémoïsées sont périmées : `getLignes()` sera rappelé au prochain rendu. */
  private obsolete = true;
  private lignes: LigneNiveau[] = [];

  private unsubFournisseur: Unsubscribe | null = null;
  private unsubTheme: Unsubscribe | null = null;
  private resizeObserver: ResizeObserver | null = null;

  /** Le fournisseur signale un changement de données → invalider les lignes + repeindre. */
  private readonly onDonnees = (): void => {
    this.obsolete = true;
    this.dirty = true;
  };

  /** Le viewport bouge : les lignes ne changent pas, seul leur Y se recalcule → repeindre. */
  private readonly onViewport = (): void => {
    this.dirty = true;
    this.render();
  };

  constructor(chart: Chart, container: HTMLElement, canvas: HTMLCanvasElement, fournisseur: FournisseurLignes) {
    this.chart = chart;
    this.container = container;
    this.canvas = canvas;
    this.fournisseur = fournisseur;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Contexte 2D du canvas lignes-de-niveaux indisponible");
    this.ctx = ctx;
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.running) return;
    if (enabled) this.start();
    else this.stop();
  }

  dispose(): void {
    this.stop();
  }

  private start(): void {
    this.running = true;
    this.dirty = true;
    this.obsolete = true;
    this.canvas.style.display = "block";
    this.chart.subscribeAction(ActionType.OnScroll, this.onViewport);
    this.chart.subscribeAction(ActionType.OnZoom, this.onViewport);
    this.chart.subscribeAction(ActionType.OnVisibleRangeChange, this.onViewport);
    this.unsubFournisseur = this.fournisseur.subscribe(this.onDonnees);
    // Thème : les couleurs sont résolues au dessin → repeindre pour adopter la nouvelle palette.
    this.unsubTheme = themeStore.subscribe(() => {
      this.dirty = true;
    });
    // Redimensionnement du conteneur (resize fenêtre, toggle sidebar…) : aucun scroll/zoom ne
    // le signale autrement, d'où l'observer dédié (patron des autres contrôleurs canvas).
    this.resizeObserver = new ResizeObserver(() => {
      this.dirty = true;
    });
    this.resizeObserver.observe(this.container);
    this.loop();
  }

  private stop(): void {
    this.running = false;
    this.canvas.style.display = "none";
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.chart.unsubscribeAction(ActionType.OnScroll, this.onViewport);
    this.chart.unsubscribeAction(ActionType.OnZoom, this.onViewport);
    this.chart.unsubscribeAction(ActionType.OnVisibleRangeChange, this.onViewport);
    this.unsubFournisseur?.();
    this.unsubFournisseur = null;
    this.unsubTheme?.();
    this.unsubTheme = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.lignes = [];
    this.obsolete = true;
    this.clearCanvas();
  }

  private readonly loop = (): void => {
    if (this.dirty) this.render();
    this.raf = requestAnimationFrame(this.loop);
  };

  private toPx(p: Partial<Point>): PixelXY {
    return this.chart.convertToPixel(p, { paneId: CANDLE_PANE_ID, absolute: true }) as PixelXY;
  }

  private clearCanvas(): void {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, this.container.clientWidth, this.container.clientHeight);
  }

  private render(): void {
    if (!this.running) return;
    this.dirty = false;
    const ctx = this.ctx;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssW = this.container.clientWidth;
    const cssH = this.container.clientHeight;
    const bw = Math.round(cssW * dpr);
    const bh = Math.round(cssH * dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
      this.canvas.style.width = `${cssW}px`;
      this.canvas.style.height = `${cssH}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const main = this.chart.getSize(CANDLE_PANE_ID, DomPosition.Main);
    if (!main) return;

    // Recalcul MÉMOÏSÉ : seulement si les données ont changé (le viewport se contente de
    // repositionner les lignes déjà connues au nouveau Y).
    if (this.obsolete) {
      this.lignes = this.fournisseur.getLignes();
      this.obsolete = false;
    }
    if (this.lignes.length === 0) return;

    this.dessiner(main);
  }

  private dessiner(main: Bounding): void {
    const ctx = this.ctx;
    const { left, top, width, height } = main;
    const xRight = left + width;

    // Couleurs résolues au dessin (thème-aware) : token → rgba selon l'emphase.
    const couleurRgba = (token: string, alpha: number): string =>
      rgbaTokenCanvas(token, alpha, repliPour(token));
    const surface = lireTokenCanvas("--surface", "#171717");

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    ctx.font = "10px ui-monospace, SFMono-Regular, monospace";
    ctx.textBaseline = "middle";

    for (const ligne of this.lignes) {
      if (!(ligne.price > 0)) continue;
      const y = this.toPx({ value: ligne.price }).y;
      if (y === undefined || !Number.isFinite(y)) continue;
      const yLigne = Math.round(y) + 0.5;
      const alpha = ligne.emphase === "forte" ? ALPHA_FORTE : ALPHA_FAIBLE;
      const couleurTrait = couleurRgba(ligne.couleur, alpha);
      const couleurTexte = couleurRgba(ligne.couleur, ALPHA_FORTE);

      // Trait : plein en emphase forte, pointillé en emphase faible (contexte secondaire).
      ctx.strokeStyle = couleurTrait;
      ctx.lineWidth = 1;
      ctx.setLineDash(ligne.emphase === "forte" ? [] : [4, 3]);
      ctx.beginPath();
      ctx.moveTo(left, yLigne);
      ctx.lineTo(xRight, yLigne);
      ctx.stroke();
      ctx.setLineDash([]);

      // Étiquette à DROITE du prix : pilule fond `--surface` bord + texte couleur de la ligne.
      const texte = ligne.label;
      const tw = ctx.measureText(texte).width;
      const padX = 4;
      const pilW = tw + padX * 2;
      const pilH = 14;
      const pilX = xRight - pilW - 2;
      const pilY = Math.round(y) - pilH / 2;
      ctx.fillStyle = surface;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(pilX, pilY, pilW, pilH);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = couleurTexte;
      ctx.strokeRect(pilX + 0.5, pilY + 0.5, pilW - 1, pilH - 1);
      ctx.fillStyle = couleurTexte;
      ctx.textAlign = "left";
      ctx.fillText(texte, pilX + padX, Math.round(y));
    }

    ctx.restore();
  }
}
