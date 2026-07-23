/**
 * @axiom/indicators — orderflow/cvdSpotPerp.ts
 *
 * CVD spot vs perp — compare le flux agresseur cumulé du spot (champs taker des
 * bougies) à celui du perp (série auxiliaire `perpDelta`, delta agresseur perp
 * par bougie, déjà alignée sur les bougies). Chaque jambe est cumulée depuis la
 * première bougie chargée (convention CVD) puis NORMALISÉE par l'écart-type
 * roulant de SES propres deltas lissés : les deux courbes deviennent comparables
 * quelle que soit l'échelle de volume de chaque marché. L'histogramme
 * `divergence` est leur différence signée (spot − perp).
 *
 * Moteur PUR : aucun fetch. Lecture défensive de `ctx.aux.perpDelta` (modèle
 * `fundingRate`) — perp absent/vide ⇒ `cvdPerp`/`divergence` undefined, `cvdSpot`
 * seul tracé ; bougies sans taker ⇒ tout undefined. Jamais de throw, jamais de NaN.
 *
 * Normalisation : fenêtre positionnelle des `fenetre` dernières bougies ;
 * `undefined` tant que moins de 20 deltas lissés définis y figurent, ou si leur
 * écart-type est nul (évite la division par zéro). Le plancher de 20 est fixe,
 * indépendant de `fenetre` (warm-up minimal), cf. spec.
 */

import type { IndicatorDef } from "@axiom/types";
import { stdev } from "../utils";

/** Plancher fixe d'échantillons requis pour un écart-type exploitable. */
const MIN_POINTS_STDEV = 20;

/** Borne un entier de paramètre dans [min, max], repli sur `def` si non fini. */
function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/**
 * Lisse une série de deltas par EMA de longueur `lissage` (1 = deltas bruts).
 * Un trou (`undefined`) ne produit JAMAIS de valeur : `prev` est gelé en interne
 * et repris à la prochaine bougie définie, mais la sortie reste `undefined` sur
 * le trou — pas de flux fantôme injecté dans le cumul.
 */
function lisserDeltas(
  deltas: Array<number | undefined>,
  lissage: number
): Array<number | undefined> {
  const n = deltas.length;
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  if (lissage <= 1) {
    for (let i = 0; i < n; i++) out[i] = deltas[i];
    return out;
  }
  const k = 2 / (lissage + 1);
  let prev = 0;
  let seedSum = 0;
  let seedCount = 0;
  let seeded = false;
  for (let i = 0; i < n; i++) {
    const v = deltas[i];
    if (v === undefined) continue; // trou → undefined, prev gelé
    if (!seeded) {
      seedSum += v;
      seedCount++;
      if (seedCount === lissage) {
        prev = seedSum / lissage;
        seeded = true;
        out[i] = prev;
      }
    } else {
      prev = v * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

/**
 * Cumule puis normalise une jambe. Retourne la série normalisée
 * (CVD / écart-type roulant des deltas lissés) ou `undefined` par bougie.
 */
function normaliserJambe(
  deltas: Array<number | undefined>,
  fenetre: number,
  lissage: number
): Array<number | undefined> {
  const n = deltas.length;
  const lisses = lisserDeltas(deltas, lissage);

  // Cumul depuis la 1re bougie chargée (undefined avant le 1er delta défini).
  const cvd: Array<number | undefined> = new Array(n).fill(undefined);
  let acc = 0;
  let demarre = false;
  for (let i = 0; i < n; i++) {
    const s = lisses[i];
    if (s !== undefined) {
      acc += s;
      demarre = true;
    }
    if (demarre) cvd[i] = acc;
  }

  // Normalisation par l'écart-type roulant des deltas lissés (fenêtre positionnelle).
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  for (let i = 0; i < n; i++) {
    const c = cvd[i];
    if (c === undefined) continue;
    const win: number[] = [];
    for (let j = i; j > i - fenetre && j >= 0; j--) {
      const v = lisses[j];
      if (v !== undefined) win.push(v);
    }
    if (win.length < MIN_POINTS_STDEV) continue;
    const sd = stdev(win, win.length)[win.length - 1];
    if (sd === undefined || sd === 0) continue;
    out[i] = c / sd;
  }
  return out;
}

export const cvdSpotPerp: IndicatorDef = {
  id: "cvdSpotPerp",
  name: "CVD Spot vs Perp",
  category: "orderflow",
  pane: "separate",
  aux: ["perpDelta"],
  inputs: [
    { key: "fenetre", name: "Fenêtre", type: "number", default: 100, min: 20, max: 500 },
    { key: "lissage", name: "Lissage EMA", type: "number", default: 3, min: 1, max: 50 },
  ],
  outputs: [
    { key: "cvdSpot", name: "CVD Spot", style: "line", color: "#26a69a" },
    { key: "cvdPerp", name: "CVD Perp", style: "line", color: "#ef5350" },
    { key: "divergence", name: "Divergence", style: "histogram", color: "rgba(120, 123, 134, 0.5)" },
  ],
  precision: 2,
  calc(candles, params, ctx) {
    const n = candles.length;
    const fenetre = clampInt(params.fenetre, 100, 20, 500);
    const lissage = clampInt(params.lissage, 3, 1, 50);

    // Jambe spot : delta agresseur des bougies (buy − sell) ; undefined si champs
    // absents ou non finis (aucun NaN ne fuit en sortie).
    const deltaSpot: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      if (c === undefined) continue;
      const buy = c.buyVolume;
      const sell = c.sellVolume;
      if (buy === undefined || sell === undefined) continue;
      if (!Number.isFinite(buy) || !Number.isFinite(sell)) continue;
      deltaSpot[i] = buy - sell;
    }

    // Jambe perp : série auxiliaire perpDelta (déjà alignée), lecture défensive.
    const perp = ctx.aux?.perpDelta;
    const cvdSpot = normaliserJambe(deltaSpot, fenetre, lissage);

    let cvdPerp: Array<number | undefined>;
    if (perp) {
      const deltaPerp: Array<number | undefined> = new Array(n).fill(undefined);
      for (let i = 0; i < n; i++) {
        const v = perp[i];
        if (v !== undefined && Number.isFinite(v)) deltaPerp[i] = v;
      }
      cvdPerp = normaliserJambe(deltaPerp, fenetre, lissage);
    } else {
      cvdPerp = new Array<number | undefined>(n).fill(undefined);
    }

    const divergence: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const s = cvdSpot[i];
      const p = cvdPerp[i];
      if (s !== undefined && p !== undefined) divergence[i] = s - p;
    }

    return { series: { cvdSpot, cvdPerp, divergence } };
  },
};
