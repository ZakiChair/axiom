/**
 * Rendu canvas des annotations d'indicateur (@axiom/types AnnotationsIndicateur)
 * sur UN pane — appelé par le `draw` générique du pont (indicators.ts), qui passe
 * la cible locale du pane : "prix" pour un def overlay (candle_pane), "pane" pour
 * un def à pane séparé. Couleurs = tokens CSS résolus AU DESSIN (canvasTokens),
 * jamais au montage. Culling par visibleRange : on ne dessine que ce qui
 * intersecte [de, a). Ordre : rubans (fond) → segments → marqueurs → labels.
 */
import type { AnnotationsIndicateur, CibleAnnotation } from "@axiom/types";
import { lireTokenCanvas, rgbaTokenCanvas } from "../lib/canvasTokens";

/** Replis RVB (thème dark) des tokens usuels des annotations — contexte sans DOM / token absent.
 * Constantes nommées `*_REPLI` (et non un objet littéral) : convention de niveauxLignes.ts,
 * seule forme d'hex admise par le garde-fou couleurs (lib/gardeFous.test.ts). */
const UP_REPLI = "#10b981";
const DOWN_REPLI = "#ef4444";
const ACCENT_REPLI = "#f5c518";
const DEFAUT_REPLI = "#38bdf8";

/** Repli hex pour un token de couleur (les tokens du thème sont en hex — cf. index.css). */
function repliPour(token: string): string {
  if (token === "--up") return UP_REPLI;
  if (token === "--down") return DOWN_REPLI;
  if (token === "--accent") return ACCENT_REPLI;
  return DEFAUT_REPLI;
}

/** Couleur pleine d'une annotation : token du thème courant, résolu au dessin. */
function couleurAnnotation(token: string): string {
  return lireTokenCanvas(token, repliPour(token));
}

export interface AxesPane {
  convertirX: (idx: number) => number;
  convertirY: (valeur: number) => number;
}

/** Demi-base des triangles (même taille que les triangles CVD S/P d'orderflow.ts). */
const DEMI_TRIANGLE = 6;
/** Décalage vertical des labels par rapport au pivot (px). */
const DECALAGE_LABEL = 8;

export function dessinerAnnotationsPane(
  ctx: CanvasRenderingContext2D,
  annotations: AnnotationsIndicateur,
  cible: CibleAnnotation,
  axes: AxesPane,
  fenetre: { de: number; a: number },
): void {
  // Rubans d'abord (fond) — chart maître uniquement.
  if (cible === "prix") {
    for (const r of annotations.rubans ?? []) {
      const fin = r.deIdx + r.hauts.length - 1;
      if (fin < fenetre.de || r.deIdx >= fenetre.a) continue;
      ctx.beginPath();
      for (let k = 0; k < r.hauts.length; k++) {
        const x = axes.convertirX(r.deIdx + k);
        const y = axes.convertirY(r.hauts[k] ?? 0);
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let k = r.bas.length - 1; k >= 0; k--) {
        ctx.lineTo(axes.convertirX(r.deIdx + k), axes.convertirY(r.bas[k] ?? 0));
      }
      ctx.closePath();
      ctx.fillStyle = rgbaTokenCanvas(r.couleur, r.alpha, repliPour(r.couleur));
      ctx.fill();
    }
  }

  for (const s of annotations.segments ?? []) {
    if (s.cible !== cible) continue;
    if (s.aIdx < fenetre.de || s.deIdx >= fenetre.a) continue;
    ctx.save();
    if (s.trait === "pointille") ctx.setLineDash([4, 4]);
    ctx.strokeStyle = couleurAnnotation(s.couleur);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(axes.convertirX(s.deIdx), axes.convertirY(s.deValeur));
    ctx.lineTo(axes.convertirX(s.aIdx), axes.convertirY(s.aValeur));
    ctx.stroke();
    ctx.restore();
  }

  for (const m of annotations.marqueurs ?? []) {
    if (m.cible !== cible) continue;
    if (m.idx < fenetre.de || m.idx >= fenetre.a) continue;
    const x = axes.convertirX(m.idx);
    const y = axes.convertirY(m.valeur);
    const t = DEMI_TRIANGLE;
    ctx.beginPath();
    if (m.forme === "triangleHaut") {
      ctx.moveTo(x, y - t);
      ctx.lineTo(x - t, y + t);
      ctx.lineTo(x + t, y + t);
    } else {
      ctx.moveTo(x, y + t);
      ctx.lineTo(x - t, y - t);
      ctx.lineTo(x + t, y - t);
    }
    ctx.closePath();
    ctx.fillStyle = couleurAnnotation(m.couleur);
    ctx.fill();
  }

  for (const l of annotations.labels ?? []) {
    if (l.cible !== cible) continue;
    if (l.idx < fenetre.de || l.idx >= fenetre.a) continue;
    const x = axes.convertirX(l.idx);
    const y = axes.convertirY(l.valeur);
    const dessous = l.position === "dessous";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = dessous ? "top" : "bottom";
    ctx.fillStyle = couleurAnnotation(l.couleur);
    ctx.fillText(l.texte, x, dessous ? y + DECALAGE_LABEL : y - DECALAGE_LABEL);
  }
}
