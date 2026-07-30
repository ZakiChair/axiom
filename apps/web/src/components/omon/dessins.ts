/**
 * Fonctions de dessin canvas de la fenêtre « Options » (OMON) — extraites d'OptionsWindow.tsx.
 *
 * POURQUOI ce fichier : OptionsWindow atteignait sa dernière marge de lisibilité (revue finale
 * v1.2) ; les quatre routines de tracé (smile IV, histogramme GEX/DEX, heatmap OI, term structure)
 * et leurs helpers/constantes propres vivent désormais ici. ZÉRO changement de comportement :
 * couper-coller à l'identique, signatures inchangées. Les constantes de padding et quelques helpers
 * (formatStrike, joursAvant, filtrerAuSeuil, SurvolHeatmap) sont partagés avec les survols/JSX du
 * composant hôte : ils sont exportés puis réimportés par OptionsWindow (imports uni-directionnels —
 * ce module NE dépend PAS d'OptionsWindow, pour éviter tout cycle).
 */
import type { OptionPoint } from "../../data/deribit";
import type { GexDexPoint } from "../../data/gexDex";
import type { PointTermIv } from "../../data/termIv";
import { intensiteCellule, type GrilleOi } from "../../data/oiHeatmap";
import { formatUsd } from "../../lib/format";
import { lireTokenCanvas, POLICE_CANVAS, rgbaTokenCanvas } from "../../lib/canvasTokens";
import { indicesVisibles, valeurVersPixel, type Domaine } from "../../lib/domaineAxe";

/** Formatte un strike de façon compacte (ex. 78 000 → 78K). */
export function formatStrike(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(0)}K`;
  return v.toFixed(v < 10 ? 1 : 0);
}

// ─────────────────────────── Dessin du smile ───────────────────────────

// Marges du plot du smile — partagées avec le curseur du composant hôte (onSurvolSmile) pour
// que la conversion pixel↔strike du survol retombe EXACTEMENT sur la zone tracée par px(s).
export const SMILE_PAD_L = 40;
export const SMILE_PAD_R = 10;

/**
 * Dessine le smile IV (axe X = strike, axe Y = IV mark %). Calls et puts en deux séries
 * (ligne + points). Repères verticaux : prix du sous-jacent et max pain.
 */
export function dessinerSmile(
  canvas: HTMLCanvasElement,
  points: OptionPoint[],
  underlying: number,
  maxPain: number | null,
  domaine: Domaine,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const cssW = canvas.clientWidth || 380;
  const cssH = canvas.clientHeight || 200;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const padL = SMILE_PAD_L;
  const padR = SMILE_PAD_R;
  const padT = 12;
  const padB = 22;
  const plotW = Math.max(1, cssW - padL - padR);
  const plotH = Math.max(1, cssH - padT - padB);

  // Couleurs du thème (lues au dessin pour suivre le thème courant).
  const couleurDim = lireTokenCanvas("--text-dim", "#9ca3af");
  const couleurBordure = lireTokenCanvas("--border", "#262626");
  const couleurSerie3 = lireTokenCanvas("--serie-3", "#f59e0b");
  const couleurUp = lireTokenCanvas("--up", "#2dc08e");
  const couleurDown = lireTokenCanvas("--down", "#f92855");
  const couleurBg = lireTokenCanvas("--bg", "#0a0a0a");

  // Triées par strike croissant : contrat requis par indicesVisibles (fenêtre de zoom).
  const finiesTri = points
    .filter((p) => Number.isFinite(p.markIv) && p.markIv > 0)
    .sort((a, b) => a.strike - b.strike);
  if (finiesTri.length === 0) {
    ctx.fillStyle = couleurDim;
    ctx.font = POLICE_CANVAS;
    ctx.fillText("Pas d'IV pour cette échéance…", padL, padT + plotH / 2);
    return;
  }
  const { debut, fin } = indicesVisibles(finiesTri, (p) => p.strike, domaine);
  const finies = finiesTri.slice(debut, fin + 1);

  const ivs = finies.map((p) => p.markIv);
  let yMin = Math.min(...ivs);
  let yMax = Math.max(...ivs);
  if (yMax === yMin) yMax = yMin + 1;
  const marge = (yMax - yMin) * 0.1;
  yMin = Math.max(0, yMin - marge);
  yMax += marge;

  const px = (s: number) => padL + valeurVersPixel(domaine, s, plotW);
  const py = (iv: number) => padT + (1 - (iv - yMin) / (yMax - yMin)) * plotH;

  // Grille + étiquettes Y (IV %).
  ctx.strokeStyle = couleurBordure;
  ctx.fillStyle = couleurDim;
  ctx.font = POLICE_CANVAS;
  ctx.lineWidth = 1;
  for (const val of [yMin, (yMin + yMax) / 2, yMax]) {
    const y = py(val);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(cssW - padR, y);
    ctx.stroke();
    ctx.fillText(`${val.toFixed(0)}%`, 4, y + 3);
  }
  // Étiquettes X (strike min / max du domaine visible).
  ctx.fillText(formatStrike(domaine.min), padL, cssH - 6);
  const txtMax = formatStrike(domaine.max);
  ctx.fillText(txtMax, cssW - padR - ctx.measureText(txtMax).width, cssH - 6);

  /**
   * Repère vertical (sous-jacent / max pain). Le trait pointillé démarre SOUS la bande
   * du libellé et un halo opaque (--bg) est peint derrière le texte : ainsi aucune
   * pointillée (la sienne ni la voisine) ne barre les glyphes (audit #6/#13). yLibelle
   * étage les deux libellés en hauteur quand ils sont proches en x.
   */
  const repere = (val: number, couleur: string, etiquette: string, yLibelle: number) => {
    if (!Number.isFinite(val) || val < domaine.min || val > domaine.max) return;
    const x = px(val);
    ctx.strokeStyle = couleur;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, yLibelle + 4);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    const lx = Math.min(x + 3, cssW - padR - 30);
    const larg = ctx.measureText(etiquette).width;
    ctx.fillStyle = couleurBg;
    ctx.fillRect(lx - 2, yLibelle - 8, larg + 4, 12);
    ctx.fillStyle = couleur;
    ctx.fillText(etiquette, lx, yLibelle);
  };
  // Étager les libellés quand max pain et sous-jacent sont proches (sinon ils se chevauchent).
  const xSj = Number.isFinite(underlying) ? px(underlying) : NaN;
  const xMp = maxPain !== null && Number.isFinite(maxPain) ? px(maxPain) : NaN;
  const proches = Number.isFinite(xSj) && Number.isFinite(xMp) && Math.abs(xSj - xMp) < 42;
  repere(underlying, couleurDim, "sj", padT + 9);
  if (maxPain !== null) repere(maxPain, couleurSerie3, "max pain", proches ? padT + 22 : padT + 9);

  /** Trace une série (calls ou puts) : ligne + points. */
  const tracer = (serie: OptionPoint[], couleur: string) => {
    const pts = serie
      .filter((p) => Number.isFinite(p.markIv) && p.markIv > 0)
      .sort((a, b) => a.strike - b.strike)
      .map((p) => ({ x: px(p.strike), y: py(p.markIv) }));
    if (pts.length === 0) return;
    ctx.strokeStyle = couleur;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    ctx.fillStyle = couleur;
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  tracer(finies.filter((p) => p.type === "call"), couleurUp);
  tracer(finies.filter((p) => p.type === "put"), couleurDown);
}

// ─────────────────────────── Dessin des barres GEX/DEX ───────────────────────────

/** Sous-ensemble des points dont l'exposition |gex ou dex| dépasse 0,5 % du max — même
 * base pour le tracé (dessinerBarres) et le domaine de l'axe (domaineActionsGexDex). */
export function filtrerAuSeuil(points: GexDexPoint[], metrique: "gex" | "dex"): GexDexPoint[] {
  const val = (p: GexDexPoint) => (metrique === "gex" ? p.gex : p.dex);
  const maxAbs = points.reduce((m, p) => Math.max(m, Math.abs(val(p))), 0);
  return maxAbs > 0 ? points.filter((p) => Math.abs(val(p)) >= maxAbs * 0.005) : [];
}

/**
 * Dessine un histogramme d'exposition par strike (axe X = strike, barres pos./nég. depuis
 * la ligne zéro, couleurs --up/--down du thème). Repère vertical sur le spot. Ne montre que
 * les strikes dont l'exposition dépasse 0,5 % du maximum (focalise sur la zone active).
 */
export function dessinerBarres(
  canvas: HTMLCanvasElement,
  points: GexDexPoint[],
  spot: number,
  metrique: "gex" | "dex",
  domaine: Domaine,
  flip: number | null,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const cssW = canvas.clientWidth || 380;
  const cssH = canvas.clientHeight || 200;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const padL = 46;
  const padR = 10;
  const padT = 12;
  const padB = 22;
  const plotW = Math.max(1, cssW - padL - padR);
  const plotH = Math.max(1, cssH - padT - padB);

  const couleurDim = lireTokenCanvas("--text-dim", "#9ca3af");
  const couleurBordure = lireTokenCanvas("--border", "#262626");
  const couleurUp = lireTokenCanvas("--up", "#2dc08e");
  const couleurDown = lireTokenCanvas("--down", "#f92855");
  const couleurAccent = lireTokenCanvas("--accent", "#38bdf8");

  // Accesseur de la métrique active — réutilisé plus bas pour l'échelle Y et le tracé des barres.
  const val = (p: GexDexPoint) => (metrique === "gex" ? p.gex : p.dex);

  // Ne garde que les strikes dont l'exposition dépasse 0,5 % du max (déjà triés par strike
  // croissant — aggregateGexDex/computeCryptoGexDex le garantissent, filter préserve l'ordre).
  const seuil = filtrerAuSeuil(points, metrique);

  if (seuil.length === 0) {
    ctx.fillStyle = couleurDim;
    ctx.font = POLICE_CANVAS;
    ctx.fillText("Pas d'exposition pour cette échéance…", padL, padT + plotH / 2);
    return;
  }

  // Fenêtre de zoom (même domaine que le smile) : rescale Y sur le sous-ensemble visible.
  const { debut, fin } = indicesVisibles(seuil, (p) => p.strike, domaine);
  const visibles = seuil.slice(debut, fin + 1);
  const vals = visibles.map(val);
  const yHi = Math.max(0, ...vals);
  const yLo = Math.min(0, ...vals);
  const yRange = yHi - yLo || 1;

  const px = (s: number) => padL + valeurVersPixel(domaine, s, plotW);
  const py = (v: number) => padT + (1 - (v - yLo) / yRange) * plotH;

  // Grille + étiquettes Y (exposition compacte).
  ctx.font = POLICE_CANVAS;
  ctx.lineWidth = 1;
  for (const v of [yHi, 0, yLo]) {
    const y = py(v);
    ctx.strokeStyle = v === 0 ? couleurDim : couleurBordure;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(cssW - padR, y);
    ctx.stroke();
    ctx.fillStyle = couleurDim;
    ctx.fillText(formatUsd(v), 2, y + 3);
  }
  // Étiquettes X (bornes du domaine visible).
  ctx.fillStyle = couleurDim;
  ctx.fillText(formatStrike(domaine.min), padL, cssH - 6);
  const txtMax = formatStrike(domaine.max);
  ctx.fillText(txtMax, cssW - padR - ctx.measureText(txtMax).width, cssH - 6);

  // Barres (largeur fixe centrée sur le strike).
  const largeur = Math.max(1.5, Math.min(14, (plotW / visibles.length) * 0.7));
  const yZero = py(0);
  for (const p of visibles) {
    const v = val(p);
    const x = px(p.strike);
    const yv = py(v);
    ctx.fillStyle = v >= 0 ? couleurUp : couleurDown;
    ctx.fillRect(x - largeur / 2, Math.min(yv, yZero), largeur, Math.abs(yv - yZero));
  }

  // Repère vertical du spot.
  if (Number.isFinite(spot) && spot >= domaine.min && spot <= domaine.max) {
    const x = px(spot);
    ctx.strokeStyle = couleurDim;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = couleurDim;
    ctx.fillText("spot", Math.min(x + 3, cssW - padR - 24), padT + 9);
  }

  // Repère vertical du gamma flip (accent) — même projection que les barres (px). Tracé
  // seulement quand le niveau tombe dans la plage de strikes affichée.
  if (flip !== null && Number.isFinite(flip) && flip >= domaine.min && flip <= domaine.max) {
    const x = px(flip);
    ctx.strokeStyle = couleurAccent;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = couleurAccent;
    ctx.fillText("γ flip", Math.min(x + 3, cssW - padR - 30), padT + 20);
  }
}

// ─────────────────────────── Dessin de la heatmap OI strike × échéance ───────────────────────────

/** Cellule survolée (repérée par échéance + strike) — pilote l'infobulle et le liseré. */
export interface SurvolHeatmap {
  expiryMs: number;
  strike: number;
}

// Marges du plot de la heatmap — partagées entre le dessin (dessinerHeatmapOi) et l'inversion
// pixel→cellule du survol (onSurvolHeatmap) : même modèle que SMILE_PAD_L/R, pour que les deux
// retombent EXACTEMENT sur la même géométrie (sinon le tooltip dérive du tracé).
export const HEATMAP_PAD_L = 46;
export const HEATMAP_PAD_R = 10;
export const HEATMAP_PAD_T = 12;
export const HEATMAP_PAD_B = 22;

/**
 * Dessine la heatmap OI/GEX : axe X ordinal = échéances (triées), axe Y ordinal = strikes de la
 * bande utile (ordonnés DÉCROISSANT, strike haut en haut, spot au milieu). Chaque cellule est un
 * `fillRect` teinté par `intensiteCellule` — métriques OI et Volume : rampe neutre → `--accent` ;
 * métrique GEX : signe porté par la teinte `--up`/`--down`, intensité = |gex|. Marqueur ◆ du max pain
 * par colonne, ligne horizontale pointillée du spot. Calqué sur `dessinerBarres` (DPR, tokens au dessin).
 */
export function dessinerHeatmapOi(
  canvas: HTMLCanvasElement,
  grille: GrilleOi,
  bandeDesc: number[],
  metrique: "oi" | "gex" | "volume",
  spot: number,
  survol: SurvolHeatmap | null,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const cssW = canvas.clientWidth || 380;
  const cssH = canvas.clientHeight || 300;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const padL = HEATMAP_PAD_L;
  const padR = HEATMAP_PAD_R;
  const padT = HEATMAP_PAD_T;
  const padB = HEATMAP_PAD_B;
  const plotW = Math.max(1, cssW - padL - padR);
  const plotH = Math.max(1, cssH - padT - padB);

  const couleurDim = lireTokenCanvas("--text-dim", "#9ca3af");
  const couleurAccent = lireTokenCanvas("--accent", "#38bdf8");

  ctx.font = POLICE_CANVAS;

  const echeances = grille.echeances;
  // bandeDesc arrive déjà triée décroissant (strike haut en haut) — hoistée dans le useMemo
  // du composant hôte, partagée avec onSurvolHeatmap.
  if (echeances.length === 0 || bandeDesc.length === 0) {
    ctx.fillStyle = couleurDim;
    ctx.font = POLICE_CANVAS;
    ctx.fillText("Pas d'open interest à afficher…", padL, padT + plotH / 2);
    return;
  }

  const colW = plotW / echeances.length;
  const rowH = plotH / bandeDesc.length;
  const indexEcheance = new Map(echeances.map((e, i) => [e, i]));
  const indexBande = new Map(bandeDesc.map((s, i) => [s, i]));

  const vMax =
    metrique === "oi" ? grille.oiMax : metrique === "gex" ? grille.gexAbsMax : grille.volumeMax;

  // Cellules teintées par intensité.
  for (const c of grille.cellules) {
    const ci = indexEcheance.get(c.expiryMs);
    const ri = indexBande.get(c.strike);
    if (ci === undefined || ri === undefined) continue;
    const valeur = metrique === "oi" ? c.oiTotal : metrique === "gex" ? Math.abs(c.gex) : c.volume24h;
    const intensite = intensiteCellule(valeur, vMax);
    if (intensite <= 0) continue;
    const alpha = 0.1 + 0.85 * intensite; // plancher visible pour les petites tailles.
    // GEX : teinte selon le signe. OI et Volume : rampe accent.
    const token = metrique === "gex" ? (c.gex >= 0 ? "--up" : "--down") : "--accent";
    const repli = metrique === "gex" ? (c.gex >= 0 ? "#2dc08e" : "#f92855") : "#38bdf8";
    ctx.fillStyle = rgbaTokenCanvas(token, alpha, repli);
    ctx.fillRect(padL + ci * colW, padT + ri * rowH, colW, rowH);
  }

  // Marqueur ◆ du max pain par colonne (strike de bande le plus proche du max pain de l'échéance).
  ctx.fillStyle = couleurAccent;
  for (let ci = 0; ci < echeances.length; ci++) {
    const exp = echeances[ci];
    if (exp === undefined) continue;
    const mp = grille.maxPainParEcheance.get(exp);
    if (mp === undefined || !Number.isFinite(mp)) continue;
    let ri = 0;
    let best = Infinity;
    for (let i = 0; i < bandeDesc.length; i++) {
      const s = bandeDesc[i];
      if (s === undefined) continue;
      const d = Math.abs(s - mp);
      if (d < best) {
        best = d;
        ri = i;
      }
    }
    const cx = padL + (ci + 0.5) * colW;
    const cy = padT + (ri + 0.5) * rowH;
    const r = Math.min(4, colW / 3, rowH / 2);
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fill();
  }

  // Ligne horizontale pointillée du spot (interpolée sur l'axe ordinal des strikes).
  if (Number.isFinite(spot)) {
    const premier = bandeDesc[0] ?? NaN;
    const dernier = bandeDesc[bandeDesc.length - 1] ?? NaN;
    let ySpot: number | null = null;
    if (spot >= premier) ySpot = padT + 0.5 * rowH;
    else if (spot <= dernier) ySpot = padT + (bandeDesc.length - 0.5) * rowH;
    else {
      for (let i = 0; i < bandeDesc.length - 1; i++) {
        const hi = bandeDesc[i];
        const lo = bandeDesc[i + 1];
        if (hi === undefined || lo === undefined) continue;
        if (spot <= hi && spot >= lo) {
          const frac = hi === lo ? 0 : (hi - spot) / (hi - lo);
          ySpot = padT + (i + 0.5) * rowH + frac * rowH;
          break;
        }
      }
    }
    if (ySpot !== null) {
      ctx.strokeStyle = couleurDim;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(padL, ySpot);
      ctx.lineTo(cssW - padR, ySpot);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = couleurDim;
      ctx.fillText("spot", cssW - padR - 24, Math.max(padT + 8, ySpot - 2));
    }
  }

  // Liseré de la cellule survolée.
  if (survol) {
    const ci = indexEcheance.get(survol.expiryMs);
    const ri = indexBande.get(survol.strike);
    if (ci !== undefined && ri !== undefined) {
      ctx.strokeStyle = couleurAccent;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(padL + ci * colW + 0.5, padT + ri * rowH + 0.5, colW - 1, rowH - 1);
    }
  }

  // Étiquettes Y (strikes) — sous-échantillonnées pour rester lisibles.
  ctx.fillStyle = couleurDim;
  const pasY = Math.max(1, Math.ceil(bandeDesc.length / 12));
  for (let i = 0; i < bandeDesc.length; i += pasY) {
    const s = bandeDesc[i];
    if (s === undefined) continue;
    ctx.fillText(formatStrike(s), 2, padT + (i + 0.5) * rowH + 3);
  }

  // Étiquettes X (échéances, jours restants) — sous-échantillonnées si les colonnes sont étroites.
  const pasX = colW < 34 ? 2 : 1;
  for (let ci = 0; ci < echeances.length; ci += pasX) {
    const exp = echeances[ci];
    if (exp === undefined) continue;
    const txt = joursAvant(exp);
    const cx = padL + (ci + 0.5) * colW - ctx.measureText(txt).width / 2;
    ctx.fillText(txt, Math.max(padL, cx), cssH - 6);
  }
}

// ─────────────────────────── Dessin de la term structure IV ───────────────────────────

// Marges du plot de la term structure — axe IV à gauche, axe RR25 à droite (d'où padR large) ;
// partagées entre le dessin (dessinerTermIv), l'inversion pixel→échéance du survol (onSurvolTermIv)
// et le positionnement de l'infobulle (leçon HEATMAP_PAD : même géométrie des deux côtés).
export const TERMIV_PAD_L = 40;
export const TERMIV_PAD_R = 42;
export const TERMIV_PAD_T = 14;
export const TERMIV_PAD_B = 22;

/**
 * Dessine la term structure IV : axe X ordinal = échéances (étiquettes « j »/« h » courtes),
 * ligne IV ATM (accent) sur l'échelle de gauche, ligne RR25 (segments/points up si ≥ 0, down
 * sinon) sur une échelle PROPRE à droite, ligne horizontale pointillée du DVOL (sur l'échelle IV,
 * libellée) et annotation de pente contango/backwardation (premier vs dernier point). DPR, tokens
 * lus au dessin. `survol` = index du point survolé (anneau d'emphase), ou null.
 */
export function dessinerTermIv(
  canvas: HTMLCanvasElement,
  points: PointTermIv[],
  dvol: number | null,
  survol: number | null,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const cssW = canvas.clientWidth || 380;
  const cssH = canvas.clientHeight || 200;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const padL = TERMIV_PAD_L;
  const padR = TERMIV_PAD_R;
  const padT = TERMIV_PAD_T;
  const padB = TERMIV_PAD_B;
  const plotW = Math.max(1, cssW - padL - padR);
  const plotH = Math.max(1, cssH - padT - padB);

  const couleurDim = lireTokenCanvas("--text-dim", "#9ca3af");
  const couleurBordure = lireTokenCanvas("--border", "#262626");
  const couleurAccent = lireTokenCanvas("--accent", "#38bdf8");
  const couleurUp = lireTokenCanvas("--up", "#2dc08e");
  const couleurDown = lireTokenCanvas("--down", "#f92855");
  const couleurBg = lireTokenCanvas("--bg", "#0a0a0a");

  ctx.font = POLICE_CANVAS;

  if (points.length === 0) {
    ctx.fillStyle = couleurDim;
    ctx.font = POLICE_CANVAS;
    ctx.fillText("Pas de données de term structure…", padL, padT + plotH / 2);
    return;
  }

  // Échelle IV (gauche) : bornes = ATM de tous les points (toujours finies, garanties par
  // termStructureIv), ÉLARGIES au DVOL seulement si fini (sinon NaN empoisonnerait la plage).
  const ivs = points.map((p) => p.ivAtm);
  let ivMin = Math.min(...ivs);
  let ivMax = Math.max(...ivs);
  if (Number.isFinite(dvol)) {
    ivMin = Math.min(ivMin, dvol as number);
    ivMax = Math.max(ivMax, dvol as number);
  }
  if (ivMax === ivMin) ivMax = ivMin + 1;
  const margeIv = (ivMax - ivMin) * 0.1;
  ivMin = Math.max(0, ivMin - margeIv);
  ivMax += margeIv;

  // Échelle RR25 (droite) : bornes sur les rr25 FINIS uniquement, 0 inclus (repère du signe).
  // Si AUCUN rr25 fini (chaîne illiquide/début de session), l'axe droit ne s'affiche pas.
  const rrs = points.map((p) => p.rr25).filter((v): v is number => Number.isFinite(v));
  const aRr25 = rrs.length > 0;
  let rrMin = 0;
  let rrMax = 0;
  if (aRr25) {
    rrMin = Math.min(0, ...rrs);
    rrMax = Math.max(0, ...rrs);
    if (rrMax === rrMin) rrMax = rrMin + 1;
    const margeRr = (rrMax - rrMin) * 0.1;
    rrMin -= margeRr;
    rrMax += margeRr;
  }

  const n = points.length;
  const colW = plotW / n;
  const px = (i: number) => padL + (i + 0.5) * colW;
  const pyIv = (v: number) => padT + (1 - (v - ivMin) / (ivMax - ivMin)) * plotH;
  const pyRr = (v: number) => padT + (1 - (v - rrMin) / (rrMax - rrMin)) * plotH;

  // Grille + étiquettes Y : IV (%) à gauche, RR25 (pts, signés) à droite aux mêmes 3 hauteurs.
  ctx.lineWidth = 1;
  const niveaux = [
    { frac: 0, iv: ivMax, rr: rrMax },
    { frac: 0.5, iv: (ivMin + ivMax) / 2, rr: (rrMin + rrMax) / 2 },
    { frac: 1, iv: ivMin, rr: rrMin },
  ];
  for (const niv of niveaux) {
    const y = padT + niv.frac * plotH;
    ctx.strokeStyle = couleurBordure;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(cssW - padR, y);
    ctx.stroke();
    ctx.fillStyle = couleurDim;
    ctx.fillText(`${niv.iv.toFixed(0)}%`, 4, y + 3);
    if (aRr25) {
      const txt = `${niv.rr >= 0 ? "+" : ""}${niv.rr.toFixed(1)}`;
      ctx.fillStyle = niv.rr >= 0 ? couleurUp : couleurDown;
      ctx.fillText(txt, cssW - padR + 3, y + 3);
    }
  }

  // Ligne horizontale pointillée du DVOL (sur l'échelle IV), libellée. Rien si DVOL non fini.
  if (Number.isFinite(dvol)) {
    const y = pyIv(dvol as number);
    ctx.strokeStyle = couleurDim;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(cssW - padR, y);
    ctx.stroke();
    ctx.setLineDash([]);
    const etiquette = `DVOL ${(dvol as number).toFixed(0)}%`;
    const larg = ctx.measureText(etiquette).width;
    const lx = padL + 4;
    ctx.fillStyle = couleurBg;
    ctx.fillRect(lx - 2, y - 10, larg + 4, 11);
    ctx.fillStyle = couleurDim;
    ctx.fillText(etiquette, lx, y - 2);
  }

  // Ligne RR25 (échelle droite) : segments et points colorés par le signe (up si ≥ 0, down sinon).
  // Les points null coupent la ligne (segment tracé seulement entre voisins finis consécutifs).
  if (aRr25) {
    for (let i = 0; i < n - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (!a || !b || a.rr25 === null || b.rr25 === null) continue;
      ctx.strokeStyle = a.rr25 >= 0 ? couleurUp : couleurDown;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(px(i), pyRr(a.rr25));
      ctx.lineTo(px(i + 1), pyRr(b.rr25));
      ctx.stroke();
    }
    for (let i = 0; i < n; i++) {
      const p = points[i];
      if (!p || p.rr25 === null) continue;
      ctx.fillStyle = p.rr25 >= 0 ? couleurUp : couleurDown;
      ctx.beginPath();
      ctx.arc(px(i), pyRr(p.rr25), 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Ligne IV ATM (échelle gauche, accent) : ligne pleine + points. Anneau d'emphase sur le survol.
  ctx.strokeStyle = couleurAccent;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(px(i), pyIv(p.ivAtm)) : ctx.lineTo(px(i), pyIv(p.ivAtm))));
  ctx.stroke();
  for (let i = 0; i < n; i++) {
    const p = points[i];
    if (!p) continue;
    ctx.fillStyle = couleurAccent;
    ctx.beginPath();
    ctx.arc(px(i), pyIv(p.ivAtm), 2.2, 0, Math.PI * 2);
    ctx.fill();
    if (survol === i) {
      ctx.strokeStyle = couleurAccent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px(i), pyIv(p.ivAtm), 4.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Annotation de pente : premier vs dernier ATM (contango si l'IV monte avec l'échéance).
  if (n >= 2) {
    const premier = points[0]?.ivAtm ?? NaN;
    const dernier = points[n - 1]?.ivAtm ?? NaN;
    if (Number.isFinite(premier) && Number.isFinite(dernier)) {
      const txt = dernier >= premier ? "contango IV" : "backwardation IV";
      ctx.fillStyle = couleurDim;
      ctx.fillText(txt, padL, padT - 2);
    }
  }

  // Étiquettes X (échéances) — sous-échantillonnées si les colonnes sont étroites.
  ctx.fillStyle = couleurDim;
  const pasX = colW < 34 ? 2 : 1;
  for (let i = 0; i < n; i += pasX) {
    const p = points[i];
    if (!p) continue;
    const txt = joursAvant(p.expiryMs);
    const cx = px(i) - ctx.measureText(txt).width / 2;
    ctx.fillText(txt, Math.max(padL, Math.min(cx, cssW - padR - ctx.measureText(txt).width)), cssH - 6);
  }
}

// ─────────────────────────── Format utilitaire ───────────────────────────

export function joursAvant(expiryMs: number): string {
  const j = (expiryMs - Date.now()) / 86_400_000;
  if (j < 1) return `${(j * 24).toFixed(0)} h`;
  return `${j.toFixed(0)} j`;
}
