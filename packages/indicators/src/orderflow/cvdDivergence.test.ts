/**
 * @axiom/indicators — orderflow/cvdDivergence.test.ts
 *
 * Fixtures façonnées À LA MAIN. Le CVD étant un cumul direct (buy − sell) SANS
 * amorçage, on fabrique les bougies pour que `cvdOf` reconstruise EXACTEMENT une
 * série cible en rampe : delta par barre = dérivée discrète de la cible, réalisée
 * par (buyVolume, sellVolume). On peut ainsi placer les pivots CVD aux index voulus.
 *
 * Deux divergences CACHÉES connues (couvrent les sorties `divHaussCachee` /
 * `divBaissCachee`, complémentaires des régulières couvertes côté RSI) plus la
 * dégradation propre d'une source sans champs taker buy/sell.
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { cvdOf } from "./cvd";
import { cvdDivergence } from "./cvdDivergence";

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

/**
 * Bougies dont le CVD reconstruit exactement `cvdCible` : delta[i] = cvdCible[i] −
 * cvdCible[i−1] (delta[0] = cvdCible[0]), réalisé par buy/sell. high/low = close ± 1.
 */
function candlesFromCvd(closes: number[], cvdCible: number[]): Candle[] {
  return closes.map((close, i) => {
    const delta = i === 0 ? cvdCible[0]! : cvdCible[i]! - cvdCible[i - 1]!;
    return {
      time: i * 60_000,
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 100,
      buyVolume: delta > 0 ? delta : 0,
      sellVolume: delta < 0 ? -delta : 0,
    };
  });
}

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

const N = 42;

describe("cvdDivergence", () => {
  it("divergence haussière CACHÉE : prix plus-bas plus haut, CVD plus-bas plus bas → divHaussCachee", () => {
    // Prix : creux idx12 (close 48) puis idx30 (close 52) → HL (higher low).
    const closes = rampe(N, [[0, 60], [12, 48], [21, 58], [30, 52], [39, 60]]);
    // CVD : creux idx12 (30) puis idx30 (24) → LL (lower low).
    const cvdCible = rampe(N, [[0, 40], [12, 30], [21, 42], [30, 24], [39, 40]]);
    const candles = candlesFromCvd(closes, cvdCible);
    const { series } = computeIndicator(cvdDivergence, candles, {});

    // Point au idxTo=30, valeur = low = close(52) − 1 = 51.
    seulPointA(series.divHaussCachee, 30, 51);
    toutUndefined(series.divHauss);
    toutUndefined(series.divBaiss);
    toutUndefined(series.divBaissCachee);

    // Non-circularité + preuve que cvdOf reconstruit la cible.
    const osc = cvdOf(candles);
    expect(osc[12]).toBe(30);
    expect(osc[30]).toBe(24);
    expect(candles[30]!.low).toBeGreaterThan(candles[12]!.low); // prix HL
    expect(osc[30]!).toBeLessThan(osc[12]!); // CVD LL
  });

  it("divergence baissière CACHÉE : prix plus-haut plus bas, CVD plus-haut plus haut → divBaissCachee", () => {
    // Prix : sommet idx12 (close 64) puis idx30 (close 58) → LH (lower high).
    const closes = rampe(N, [[0, 40], [12, 64], [21, 50], [30, 58], [39, 44]]);
    // CVD : sommet idx12 (50) puis idx30 (56) → HH (higher high).
    const cvdCible = rampe(N, [[0, 30], [12, 50], [21, 40], [30, 56], [39, 42]]);
    const candles = candlesFromCvd(closes, cvdCible);
    const { series } = computeIndicator(cvdDivergence, candles, {});

    // Point au idxTo=30, valeur = high = close(58) + 1 = 59.
    seulPointA(series.divBaissCachee, 30, 59);
    toutUndefined(series.divHauss);
    toutUndefined(series.divBaiss);
    toutUndefined(series.divHaussCachee);

    const osc = cvdOf(candles);
    expect(candles[30]!.high).toBeLessThan(candles[12]!.high); // prix LH
    expect(osc[30]!).toBeGreaterThan(osc[12]!); // CVD HH
  });

  it("source sans buy/sell : CVD plat → aucun pivot → aucun point (dégradation propre)", () => {
    // Prix avec des creux/sommets nets (pivots de prix bien présents), mais AUCUN
    // champ taker buy/sell → CVD plat à 0 → aucune divergence, aucune erreur.
    const closes = rampe(N, [[0, 60], [12, 48], [21, 58], [30, 52], [39, 60]]);
    const candles: Candle[] = closes.map((close, i) => ({
      time: i * 60_000,
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 100,
    }));
    const { series } = computeIndicator(cvdDivergence, candles, {});

    expect(cvdOf(candles).every((v) => v === 0)).toBe(true); // CVD plat
    toutUndefined(series.divHauss);
    toutUndefined(series.divBaiss);
    toutUndefined(series.divHaussCachee);
    toutUndefined(series.divBaissCachee);
  });

  it("paramètres par défaut (gauche/droite 5, maxEcart 60) sans params", () => {
    const closes = rampe(N, [[0, 60], [12, 48], [21, 58], [30, 52], [39, 60]]);
    const cvdCible = rampe(N, [[0, 40], [12, 30], [21, 42], [30, 24], [39, 40]]);
    const candles = candlesFromCvd(closes, cvdCible);
    const { series } = computeIndicator(cvdDivergence, candles);
    seulPointA(series.divHaussCachee, 30, 51);
  });
});
