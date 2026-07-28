/**
 * @axiom/indicators — orderflow/cvdSpotPerp.ts
 *
 * CVD spot vs perp — compare le flux agresseur cumulé du spot (champs taker des
 * bougies) à celui du perp (série auxiliaire `perpDelta`, delta agresseur perp
 * par bougie, déjà alignée sur les bougies). Les deux jambes sont cumulées depuis
 * un ANCRAGE COMMUN — le 1er index où les deux deltas sont définis quand le perp est
 * présent (sinon spot seul depuis son 1er delta) — puis NORMALISÉES par l'écart-type
 * roulant de LEURS propres deltas lissés : les deux courbes deviennent comparables
 * quelle que soit l'échelle de volume de chaque marché, sans offset parasite dans
 * `divergence` (différence signée spot − perp) dû à l'histoire pré-perp du spot.
 *
 * Moteur PUR : aucun fetch. Lecture défensive de `ctx.aux.perpDelta` (modèle
 * `fundingRate`) — perp absent/vide ⇒ `cvdPerp`/`divergence` undefined, `cvdSpot`
 * seul tracé ; bougies sans taker ⇒ tout undefined. Jamais de throw, jamais de NaN.
 *
 * Normalisation : fenêtre positionnelle des `fenetre` dernières bougies ;
 * `undefined` tant que moins de 20 deltas lissés définis y figurent, ou si leur
 * écart-type est nul (évite la division par zéro). Le plancher de 20 est fixe,
 * indépendant de `fenetre` (warm-up minimal), cf. spec.
 *
 * v2.1 — MARQUEURS DE DIVERGENCE : en plus des trois séries, le calc pose des
 * `annotations.marqueurs` (cible `"pane"`, triangle haut `--up` / bas `--down`)
 * aux bougies où les jambes NORMALISÉES divergent de signe sur `fenetreDiv`
 * bougies (détecteur pur `detecterDivergencesSpotPerp`, filtre médiane
 * anti-bruit). `fenetreDiv` (défaut 14) est le LOOKBACK de divergence — à ne pas
 * confondre avec `fenetre` (défaut 100), la fenêtre de normalisation. Aucune
 * divergence ⇒ pas de champ `annotations` du tout.
 *
 * LECTURE (utilisateur) : jambe perp disponible sur les timeframes 1m-1M
 * (Binance USDT-M) ; ailleurs (autre exchange, autre marché), CVD spot seul.
 * Séries normalisées en écarts-types de flux — lire croisements et signe de
 * l'histogramme, pas les niveaux.
 *
 * NB : aucun canal UI n'expose de description de def aujourd'hui (`IndicatorDef`
 * n'a pas de champ `description`) — cette note vit ici jusqu'à ce qu'un tel
 * canal existe (hors périmètre, cf. rapport de tâche).
 */

import type { AnnotationsIndicateur, IndicatorDef, MarqueurAnnotation } from "@axiom/types";
import { stdev } from "../utils";
import { detecterDivergencesSpotPerp } from "./divergenceSpotPerp";

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
  category: "strategy",
  pane: "separate",
  aux: ["perpDelta"],
  inputs: [
    { key: "fenetre", name: "Fenêtre", type: "number", default: 100, min: 20, max: 500 },
    { key: "lissage", name: "Lissage EMA", type: "number", default: 3, min: 1, max: 50 },
    { key: "fenetreDiv", name: "Fenêtre divergence", type: "number", default: 14, min: 2, max: 100 },
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

    let cvdSpot: Array<number | undefined>;
    let cvdPerp: Array<number | undefined>;
    if (perp) {
      const deltaPerp: Array<number | undefined> = new Array(n).fill(undefined);
      for (let i = 0; i < n; i++) {
        const v = perp[i];
        if (v !== undefined && Number.isFinite(v)) deltaPerp[i] = v;
      }
      // Ancrage COMMUN : les deux cumuls démarrent au 1er index où les DEUX deltas
      // sont définis. Sans ça, si le perp ne couvre pas tout le chart (lookback), le
      // cumul spot embarque son histoire pré-perp → offset arbitraire dans `divergence`.
      // Conséquence assumée : quand le perp est présent, la LIGNE cvdSpot est aussi
      // rebasée sur ce point commun (sa portion pré-ancrage disparaît).
      let ancre = -1;
      for (let i = 0; i < n; i++) {
        if (deltaSpot[i] !== undefined && deltaPerp[i] !== undefined) {
          ancre = i;
          break;
        }
      }
      // Aucun index commun (perp entièrement absent après alignement) → pas de masquage :
      // cvdSpot garde son comportement seul, cvdPerp restera undefined partout.
      if (ancre >= 0) {
        for (let j = 0; j < ancre; j++) {
          deltaSpot[j] = undefined;
          deltaPerp[j] = undefined;
        }
      }
      cvdSpot = normaliserJambe(deltaSpot, fenetre, lissage);
      cvdPerp = normaliserJambe(deltaPerp, fenetre, lissage);
    } else {
      // Perp totalement absente : cumul spot depuis son 1er delta défini (comportement seul).
      cvdSpot = normaliserJambe(deltaSpot, fenetre, lissage);
      cvdPerp = new Array<number | undefined>(n).fill(undefined);
    }

    const divergence: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const s = cvdSpot[i];
      const p = cvdPerp[i];
      if (s !== undefined && p !== undefined) divergence[i] = s - p;
    }

    // Marqueurs de divergence spot/perp (v2.1) : mismatch de signe soutenu des
    // jambes NORMALISÉES sur `fenetreDiv` bougies (défaut 14 = constante du
    // module WS historique — PAS `fenetre`, qui est la fenêtre de normalisation).
    const fenetreDiv = clampInt(params.fenetreDiv, 14, 2, 100);
    const fmtSigne = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
    const marqueurs: MarqueurAnnotation[] = detecterDivergencesSpotPerp(cvdSpot, cvdPerp, fenetreDiv).map((d) => ({
      idx: d.idx,
      valeur: cvdSpot[d.idx] ?? 0, // ancré sur la jambe spot (définie par construction du Δ)
      forme: d.sens === "spotHaussier" ? "triangleHaut" : "triangleBas",
      couleur: d.sens === "spotHaussier" ? "--up" : "--down",
      cible: "pane",
      info:
        `Divergence spot/perp (${fenetreDiv} bougies) — ` +
        `Δspot ${fmtSigne(d.dSpot)} σ / Δperp ${fmtSigne(d.dPerp)} σ`,
    }));
    const annotations: AnnotationsIndicateur | undefined =
      marqueurs.length > 0 ? { marqueurs } : undefined;

    return annotations !== undefined
      ? { series: { cvdSpot, cvdPerp, divergence }, annotations }
      : { series: { cvdSpot, cvdPerp, divergence } };
  },
};
