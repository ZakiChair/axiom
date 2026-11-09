/**
 * Rendu canvas des annotations d'indicateur (@axiom/types AnnotationsIndicateur)
 * sur UN pane — appelé par le `draw` générique du pont (indicators.ts), qui passe
 * la cible locale du pane : "prix" pour un def overlay (candle_pane), "pane" pour
 * un def à pane séparé. Couleurs = tokens CSS résolus AU DESSIN (canvasTokens),
 * jamais au montage. Culling par visibleRange : on ne dessine que ce qui
 * intersecte [de, a) ; un ruban n'est parcouru que sur [de − 1, a].
 * Ordre : rubans (fond) → segments → marqueurs → labels centrés → labels à droite.
 * Tout trait plein remet le pointillé à zéro (`setLineDash([])`) : sur candle_pane,
 * KLineChart trace la ligne du dernier prix en pointillé [4, 4] juste avant le draw
 * du pont, sans la refermer d'un save/restore.
 */
import type { AnnotationsIndicateur, CibleAnnotation, LabelAnnotation } from "@axiom/types";
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
/** Demi-base des triangles creux (signaux précoces), plus petits que les pleins. */
const DEMI_TRIANGLE_CREUX = 4;
/** Décalage vertical des labels par rapport au pivot (px). */
const DECALAGE_LABEL = 8;
/** Décalage horizontal des labels ancrés à droite de leur bougie (px). */
const DECALAGE_LABEL_DROITE = 8;
/** Écart vertical minimal entre deux labels ancrés à droite (px). */
const ECART_LABELS_DROITE = 11;
/** Sous la rangée de légende et ses contrôles flottants du pane. */
const HAUT_LABEL_PANE = 32;

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
      // Seuls les indices visibles, plus une bougie de chaque côté pour que les bords du
      // polygone sortent de l'écran : un ruban de milliers de bougies ne coûte, à chaque
      // image, que la largeur de la fenêtre.
      const premier = Math.max(r.deIdx, fenetre.de - 1);
      const dernier = Math.min(fin, fenetre.a);
      ctx.beginPath();
      for (let i = premier; i <= dernier; i++) {
        const x = axes.convertirX(i);
        const y = axes.convertirY(r.hauts[i - r.deIdx] ?? 0);
        if (i === premier) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let i = dernier; i >= premier; i--) {
        ctx.lineTo(axes.convertirX(i), axes.convertirY(r.bas[i - r.deIdx] ?? 0));
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
    ctx.setLineDash(s.trait === "pointille" ? [4, 4] : []);
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
    const creux = m.creux === true;
    const t = creux ? DEMI_TRIANGLE_CREUX : DEMI_TRIANGLE;
    if (creux) ctx.setLineDash([]); // contour plein, même après la ligne du dernier prix
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
    if (creux) {
      // Signal précoce : contour seul. `lineWidth` et le pointillé remis à zéro restent posés,
      // comme `fillStyle` et `font` ailleurs ici : KLineChart encadre déjà le `draw` du pont
      // d'un save/restore.
      ctx.strokeStyle = couleurAnnotation(m.couleur);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = couleurAnnotation(m.couleur);
      ctx.fill();
    }
  }

  const aDroite: Array<{ label: LabelAnnotation; y: number }> = [];
  for (const l of annotations.labels ?? []) {
    if (l.cible !== cible) continue;
    if (l.idx < fenetre.de || l.idx >= fenetre.a) continue;
    if (l.ancrageX === "droite") {
      aDroite.push({ label: l, y: axes.convertirY(l.valeur) });
      continue;
    }
    const x = axes.convertirX(l.idx);
    const hautPane = cible === "pane" && l.ancrageY === "haut-pane";
    const y = hautPane ? HAUT_LABEL_PANE : axes.convertirY(l.valeur);
    const dessous = l.position === "dessous";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = hautPane || dessous ? "top" : "bottom";
    ctx.fillStyle = couleurAnnotation(l.couleur);
    ctx.fillText(l.texte, x, hautPane ? y : dessous ? y + DECALAGE_LABEL : y - DECALAGE_LABEL);
  }

  // Labels ancrés à droite (étiquettes de zone), après les centrés : de haut en bas, chacun
  // repoussé sous le précédent s'il en est à moins de ECART_LABELS_DROITE px.
  aDroite.sort((p, q) => p.y - q.y);
  let yPrecedent = Number.NEGATIVE_INFINITY;
  for (const { label, y: yValeur } of aDroite) {
    const y = yValeur < yPrecedent + ECART_LABELS_DROITE ? yPrecedent + ECART_LABELS_DROITE : yValeur;
    ctx.font = "10px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = couleurAnnotation(label.couleur);
    ctx.fillText(label.texte, axes.convertirX(label.idx) + DECALAGE_LABEL_DROITE, y);
    yPrecedent = y;
  }
}
