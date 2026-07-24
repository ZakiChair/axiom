/**
 * @axiom/indicators — momentum/rsiDivergence.test.ts
 *
 * Fixtures façonnées À LA MAIN (rampe linéaire par morceaux, comme
 * utils-divergence.test.ts) produisant UNE divergence RSI connue :
 *  - haussière : deux creux de prix en plus-bas plus bas (LL) mais approche du 2ᵉ
 *    plus douce → RSI en plus-bas plus HAUT (HL) → point `divHauss` au 2ᵉ creux ;
 *  - baissière : deux sommets en plus-haut plus haut (HH), 2ᵉ montée plus douce →
 *    RSI en plus-haut plus BAS (LH) → point `divBaiss` au 2ᵉ sommet.
 *
 * Contrainte d'amorçage : le RSI est `undefined` sur les 14 premières barres, donc
 * un pivot osc (fenêtre ±5) n'existe qu'à partir de l'index 19 → les creux/sommets
 * sont placés loin dans la série (idx 24 puis 48, N=60). Les valeurs attendues ne
 * réimplémentent PAS le RSI : chaque test vérifie EN PLUS, structurellement, que la
 * divergence est authentique (prix LL/HH & RSI HL/LH), gage de non-circularité.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { rsiOf } from "./rsi";
import { rsiDivergence } from "./rsiDivergence";

/** Série linéaire par morceaux : coins aux points de contrôle, monotone entre eux. */
function rampe(n: number, points: ReadonlyArray<readonly [number, number]>): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let seg = 0;
    while (seg < points.length - 1 && points[seg + 1]![0] <= i) seg++;
    const a = points[seg]!;
    const b = points[seg + 1] ?? a;
    const t = b[0] === a[0] ? 0 : (i - a[0]) / (b[0] - a[0]);
    out.push(a[1] + t * (b[1] - a[1]));
  }
  return out;
}

/** Bougies minimales : high = close + 1, low = close − 1 (pivots de prix alignés sur les closes). */
function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    time: i * 60_000,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100,
  }));
}

/** Vérifie qu'une série ne porte de valeur qu'à `idx`, égale à `valeur`, undefined ailleurs. */
function seulPointA(serie: Array<number | undefined> | undefined, idx: number, valeur: number): void {
  expect(serie).toBeDefined();
  if (serie === undefined) return;
  for (let i = 0; i < serie.length; i++) {
    if (i === idx) expect(serie[i]).toBe(valeur);
    else expect(serie[i]).toBeUndefined();
  }
}

function toutUndefined(serie: Array<number | undefined> | undefined): void {
  expect(serie).toBeDefined();
  if (serie === undefined) return;
  expect(serie.every((v) => v === undefined)).toBe(true);
}

const N = 60;

describe("rsiDivergence", () => {
  it("divergence haussière régulière : point divHauss au 2ᵉ creux (prix low), reste vierge", () => {
    // Creux prix idx24 (close 62) puis idx48 (close 58) → LL ; approche du 2ᵉ plus
    // douce → RSI en plus-bas plus haut.
    const closes = rampe(N, [[0, 100], [10, 108], [24, 62], [36, 88], [48, 58], [59, 74]]);
    const candles = candlesFromCloses(closes);
    const { series } = computeIndicator(rsiDivergence, candles, {});

    // Point posé au idxTo=48, valeur = low du prix = close(58) − 1 = 57.
    seulPointA(series.divHauss, 48, 57);
    toutUndefined(series.divBaiss);
    toutUndefined(series.divHaussCachee);
    toutUndefined(series.divBaissCachee);

    // Non-circularité : la divergence est réellement haussière régulière.
    const osc = rsiOf(closes, 14);
    expect(candles[48]!.low).toBeLessThan(candles[24]!.low); // prix LL
    expect(osc[48]!).toBeGreaterThan(osc[24]!); // RSI HL
  });

  it("divergence baissière régulière : point divBaiss au 2ᵉ sommet (prix high), reste vierge", () => {
    // Sommet prix idx24 (close 98) puis idx48 (close 102) → HH ; 2ᵉ montée plus
    // douce → RSI en plus-haut plus bas.
    const closes = rampe(N, [[0, 60], [10, 52], [24, 98], [36, 72], [48, 102], [59, 86]]);
    const candles = candlesFromCloses(closes);
    const { series } = computeIndicator(rsiDivergence, candles, {});

    // Point posé au idxTo=48, valeur = high du prix = close(102) + 1 = 103.
    seulPointA(series.divBaiss, 48, 103);
    toutUndefined(series.divHauss);
    toutUndefined(series.divHaussCachee);
    toutUndefined(series.divBaissCachee);

    const osc = rsiOf(closes, 14);
    expect(candles[48]!.high).toBeGreaterThan(candles[24]!.high); // prix HH
    expect(osc[48]!).toBeLessThan(osc[24]!); // RSI LH
  });

  it("consomme réellement ctx.source : une source à RSI plat éteint toute détection", () => {
    // Preuve directe que `calc` lit ctx.source (et non closeOf). `close` porte la
    // divergence haussière ; `high` est une rampe linéaire STRICTE → tous les deltas
    // sont égaux, pertes nulles → RSI(high) = 100 constant → aucun pivot fractal
    // strict → aucune divergence. La comparaison de valeurs du test générique
    // engine-source ne peut pas départager ce def (valeur = prix, invariante par
    // source), d'où cette vérification dédiée.
    const closes = rampe(N, [[0, 100], [10, 108], [24, 62], [36, 88], [48, 58], [59, 74]]);
    const candles: Candle[] = closes.map((close, i) => ({
      time: i * 60_000,
      open: close,
      high: 300 + 2 * i, // rampe linéaire stricte → RSI plat = 100
      low: close - 1,
      close,
      volume: 100,
    }));

    const surClose = computeIndicator(rsiDivergence, candles, { source: "close" });
    const surHigh = computeIndicator(rsiDivergence, candles, { source: "high" });

    // source close : divergence détectée (point au 2ᵉ creux, valeur = low = 57).
    expect(surClose.series.divHauss?.[48]).toBe(candles[48]!.low);
    // source high (RSI plat) : plus aucun point sur aucune des 4 séries.
    toutUndefined(surHigh.series.divHauss);
    toutUndefined(surHigh.series.divBaiss);
    toutUndefined(surHigh.series.divHaussCachee);
    toutUndefined(surHigh.series.divBaissCachee);
  });

  it("paramètres par défaut (length 14, gauche/droite 5, maxEcart 60, source close) sans params", () => {
    // Mêmes bougies que le cas haussier, mais AUCUN param → les défauts déclarés
    // doivent reproduire exactement le point divHauss.
    const closes = rampe(N, [[0, 100], [10, 108], [24, 62], [36, 88], [48, 58], [59, 74]]);
    const candles = candlesFromCloses(closes);
    const { series } = computeIndicator(rsiDivergence, candles);
    seulPointA(series.divHauss, 48, 57);
  });
});
