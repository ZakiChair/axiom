/**
 * OCN (Open/Close Net) — RENDU canvas de l'overlay façon Flux.
 * Cf. spec docs/superpowers/specs/2026-07-31-open-close-net-design.md.
 *
 * Dessine sur le canvas overlay du contrôleur orderflow (même viewport) :
 *  - barres horizontales ancrées à la bougie d'OUVERTURE des positions,
 *    longueur ∝ net encore ouvert (blanc = shorts, jaune = longs), la part
 *    consommée prolongée en alpha réduit ;
 *  - ligne POC + label (niveau le plus tradé de la fenêtre) ;
 *  - profil latéral droit du net encore ouvert par niveau ;
 *  - cadre discret de la fenêtre d'analyse + légende.
 *
 * La géométrie (largeurs de barres) est extraite en helper PUR testable ;
 * le dessin lui-même est impur (Canvas 2D) et validé à l'œil/E2E, comme les
 * autres modules chart.
 */
import { lireTokenCanvas, POLICE_CANVAS_MONO } from "../lib/canvasTokens";
import type { OcnEntry, OcnProfileLevel } from "./openCloseNet.calc";

/** Largeur max (px) d'une barre ancrée à sa bougie d'ouverture. */
const MAX_BAR_PX = 140;
/** Largeur max (px) du profil latéral droit. */
const MAX_PROFILE_PX = 90;
/** Largeur (px) minimale pour qu'une barre non nulle reste visible. */
const MIN_BAR_PX = 2;

/**
 * Largeur en px d'une quantité `value` sur une échelle linéaire bornée par
 * `max` → `maxPx`. Une valeur > 0 garde au moins MIN_BAR_PX (une position
 * ouverte ne doit jamais disparaître à l'arrondi). PURE.
 */
export function largeurBarre(value: number, max: number, maxPx: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.max(MIN_BAR_PX, (value / max) * maxPx);
}

/** Palette OCN lue depuis les tokens de thème (fallbacks = teintes Flux). */
export interface OcnPalette {
  short: string; // blanc Flux
  long: string; // jaune Flux
  text: string;
  textDim: string;
}

export function lireOcnPalette(): OcnPalette {
  return {
    short: lireTokenCanvas("--ocn-short", lireTokenCanvas("--text", "#e5e7eb")),
    long: lireTokenCanvas("--ocn-long", lireTokenCanvas("--accent", "#f5c518")),
    text: lireTokenCanvas("--text", "#e5e7eb"),
    textDim: lireTokenCanvas("--text-dim", "#94a3b8"),
  };
}

export interface OcnDrawParams {
  entries: OcnEntry[];
  profile: OcnProfileLevel[];
  poc: number | null;
  bucketSize: number;
  /** x du centre d'une bougie (px absolus), undefined si hors viewport. */
  xOf: (time: number) => number | undefined;
  /** y d'un prix (px absolus). */
  yOf: (price: number) => number;
  /** Aire du pane prix (px absolus). */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Hauteur px d'un niveau (fournie par le contrôleur : yOf(0) est faux en log). */
  rowH: number;
  /** Nombre de bougies effectivement couvertes par la fenêtre d'analyse. */
  candlesUsed: number;
  /** false → l'OI n'a pas pu être chargé : mention dans la légende, rien d'autre. */
  oiOk: boolean;
}

/** Dessine l'overlay OCN complet. L'appelant a déjà posé le clip du pane prix. */
export function drawOpenCloseNet(ctx: CanvasRenderingContext2D, p: OcnDrawParams): void {
  const palette = lireOcnPalette();
  const right = p.left + p.width;

  // ── Légende (toujours affichée quand l'overlay est actif) ──
  ctx.font = POLICE_CANVAS_MONO;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = palette.textDim;
  const legende = p.oiOk
    ? `Open/Close Net · ${p.candlesUsed} bougies`
    : "Open/Close Net · OI indisponible";
  ctx.fillText(legende, p.left + 8, p.top + 20);
  if (!p.oiOk || p.candlesUsed === 0) return;

  // ── Cadre discret de la fenêtre d'analyse ──
  const firstTime = p.entries.length > 0 ? Math.min(...p.entries.map((e) => e.time)) : null;
  const xStart = firstTime !== null ? (p.xOf(firstTime) ?? p.left) : p.left;
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = palette.textDim;
  ctx.lineWidth = 1;
  ctx.strokeRect(xStart - 4, p.top + 16, right - MAX_PROFILE_PX - (xStart - 4), p.height - 32);
  ctx.globalAlpha = 1;

  // ── Barres ancrées à la bougie d'ouverture ──
  const barH = Math.max(2, Math.min(p.rowH * 0.55, 10));
  let maxOpened = 0;
  for (const e of p.entries) {
    if (e.opened > maxOpened) maxOpened = e.opened;
  }
  for (const e of p.entries) {
    const x = p.xOf(e.time);
    if (x === undefined) continue;
    const yMid = p.yOf(e.price + p.bucketSize / 2);
    if (!Number.isFinite(yMid) || yMid < p.top || yMid > p.top + p.height) continue;
    const color = e.side === "short" ? palette.short : palette.long;
    const wOpened = largeurBarre(e.opened, maxOpened, MAX_BAR_PX);
    const wRemaining = largeurBarre(e.remaining, maxOpened, MAX_BAR_PX);
    // Part consommée : trace en alpha réduit sur toute la longueur d'origine.
    if (wOpened > wRemaining) {
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = color;
      ctx.fillRect(x, yMid - barH / 2, wOpened, barH);
      ctx.globalAlpha = 1;
    }
    if (wRemaining > 0) {
      ctx.fillStyle = color;
      ctx.fillRect(x, yMid - barH / 2, wRemaining, barH);
    }
  }

  // ── Profil latéral droit (net encore ouvert par niveau) ──
  let maxNet = 0;
  for (const lvl of p.profile) {
    const t = lvl.openLong + lvl.openShort;
    if (t > maxNet) maxNet = t;
  }
  for (const lvl of p.profile) {
    const yTop = p.yOf(lvl.price + p.bucketSize);
    const yBot = p.yOf(lvl.price);
    if (!Number.isFinite(yTop) || !Number.isFinite(yBot)) continue;
    if (yBot < p.top || yTop > p.top + p.height) continue;
    const h = Math.max(1, Math.abs(yBot - yTop) - 1);
    const y = Math.min(yTop, yBot);
    // Segments empilés depuis le bord droit : shorts (blanc) puis longs (jaune).
    const wShort = largeurBarre(lvl.openShort, maxNet, MAX_PROFILE_PX);
    const wLong = largeurBarre(lvl.openLong, maxNet, MAX_PROFILE_PX);
    ctx.globalAlpha = 0.85;
    if (wShort > 0) {
      ctx.fillStyle = palette.short;
      ctx.fillRect(right - wShort, y, wShort, h);
    }
    if (wLong > 0) {
      ctx.fillStyle = palette.long;
      ctx.fillRect(right - wShort - wLong, y, wLong, h);
    }
    ctx.globalAlpha = 1;
  }

  // ── Ligne POC + label ──
  if (p.poc !== null) {
    const yPoc = p.yOf(p.poc + p.bucketSize / 2);
    if (Number.isFinite(yPoc) && yPoc >= p.top && yPoc <= p.top + p.height) {
      ctx.strokeStyle = palette.text;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(xStart - 4, yPoc);
      ctx.lineTo(right, yPoc);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.fillStyle = palette.text;
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText("POC", right - 4, yPoc - 2);
    }
  }
}
