/**
 * @axiom/indicators — volatility/atrRegime.test.ts
 *
 * Test déterministe du rang percentile roulant de l'ATR, avec des valeurs
 * attendues CALCULÉES À LA MAIN.
 *
 * On appelle `atrRegime.calc(...)` directement (plutôt que `computeIndicator`)
 * pour utiliser period=2 et lookback=5 — des valeurs volontairement plus
 * petites que les min déclarés (period min=2 est en fait respecté ; lookback
 * min=20 ne l'est pas) afin de garder la fenêtre traçable à la main, comme
 * `atr.test.ts`/`rsi.test.ts` le font déjà avec des `length` réduites. Passer
 * par `computeIndicator` aurait clampé lookback à 20 (cf. `resolveParams`),
 * ce qui n'aurait pas changé la logique testée mais aurait rendu le calcul à
 * la main disproportionné.
 *
 * Bougies "plates" (high = low = close) : le True Range se réduit alors à
 *   TR[0] = 0 (pas de close précédent)
 *   TR[i] = |close[i] - close[i-1]|   pour i > 0
 * ce qui rend la série ATR entièrement pilotable via les clôtures choisies.
 *
 * --- Fixture A : ATR strictement croissant ---
 * Closes : [100, 101, 103, 106, 110, 115, 121, 128, 136]  (diffs 1..8)
 *   TR = [0, 1, 2, 3, 4, 5, 6, 7, 8]
 *
 * RMA(period=2), amorce = SMA des 2 premières valeurs, placée à l'index 1 :
 *   atr[1] = (0+1)/2         = 0.5
 *   atr[2] = 0.5 + (2-0.5)/2   = 1.25
 *   atr[3] = 1.25 + (3-1.25)/2 = 2.125
 *   atr[4] = 2.125 + (4-2.125)/2 = 3.0625
 *   atr[5] = 3.0625 + (5-3.0625)/2 = 4.03125
 *   atr[6] = 4.03125 + (6-4.03125)/2 = 5.015625
 *   atr[7] = 5.015625 + (7-5.015625)/2 = 6.0078125
 *   atr[8] = 6.0078125 + (8-6.0078125)/2 = 7.00390625
 *   (atr[0] = undefined, fenêtre RMA non amorcée)
 *
 * Cette série ATR est strictement croissante à partir de l'index 1.
 *
 * Avec lookback=5, la fenêtre [i-4, i] n'est "pleine" (toutes valeurs ATR
 * définies) qu'à partir de i=5 (fenêtre [1..5] : atr[0] n'existe pas, donc à
 * i=4 la fenêtre [0..4] contient un `undefined` -> pct[4] reste undefined).
 *
 * Pour i=5 : fenêtre = [atr1..atr5] = [0.5, 1.25, 2.125, 3.0625, 4.03125].
 *   atr[5]=4.03125 est le maximum (série croissante) -> les 5 valeurs de la
 *   fenêtre sont ≤ atr[5] -> pct[5] = 100*(5-1)/(5-1) = 100.
 * Le même raisonnement s'applique à i=6,7,8 (toujours au sommet de sa propre
 * fenêtre) -> pct = 100 jusqu'à la fin de la série.
 *
 * --- Fixture B : ATR constant ---
 * Bougies (high=102.5, low=97.5, close=100) répétées 9 fois :
 *   TR[0] = high-low = 5
 *   TR[i>0] = max(high-low=5, |high-closePrev|=2.5, |low-closePrev|=2.5) = 5
 *   TR = [5,5,5,5,5,5,5,5,5]
 * RMA(period=2) : amorce = (5+5)/2 = 5 ; puis prev + (5-prev)/2 = prev (déjà
 * égal à 5) -> atr = [undefined, 5,5,5,5,5,5,5,5].
 *
 * Pour i=5 (fenêtre [1..5] = [5,5,5,5,5], atr[5]=5) : les 5 valeurs de la
 * fenêtre sont ≤ 5 (égalité, pas d'inégalité stricte) -> pct[5] = 100*(5-1)/4
 * = 100. C'est un CHOIX documenté, pas un bug : la formule compte "≤ courante",
 * donc une série plate se classe au rang maximal (interprétation standard du
 * rang percentile en cas d'égalités).
 */

import { describe, it, expect } from "vitest";
import type { Candle, CalcContext } from "@axiom/types";
import { atrRegime } from "./atrRegime";

/** Construit des bougies "plates" (high = low = close) à partir de clôtures. */
function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    time: i * 60_000,
    open: close,
    high: close,
    low: close,
    close,
    volume: 0,
  }));
}

/** Contexte minimal (non utilisé par le calc, qui lit les bougies directement). */
const baseCtx: CalcContext = { hl2: [], hlc3: [], ohlc4: [], source: [] };

describe("ATR Régime (percentile roulant)", () => {
  it("ATR strictement croissant sur la fenêtre -> pct final = 100", () => {
    const candles = candlesFromCloses([100, 101, 103, 106, 110, 115, 121, 128, 136]);
    const { series } = atrRegime.calc(candles, { period: 2, lookback: 5 }, baseCtx);
    const out = series.pct;

    expect(out).toBeDefined();
    if (out === undefined) throw new Error("série pct absente");

    // Fenêtre pas encore pleine (voir test dédié ci-dessous pour le détail).
    expect(out[4]).toBeUndefined();

    // Régime établi : la série ATR étant strictement croissante, la valeur
    // courante est toujours le maximum de sa propre fenêtre -> pct = 100.
    expect(out[5]).toBeCloseTo(100, 9);
    expect(out[6]).toBeCloseTo(100, 9);
    expect(out[7]).toBeCloseTo(100, 9);
    expect(out[8]).toBeCloseTo(100, 9); // pct final

    expect(out.length).toBe(candles.length);
  });

  it("ATR constant sur la fenêtre -> pct = 100 (égalités : rang maximal, choix documenté)", () => {
    const candles: Candle[] = new Array(9).fill(0).map((_, i) => ({
      time: i * 60_000,
      open: 100,
      high: 102.5,
      low: 97.5,
      close: 100,
      volume: 0,
    }));
    const { series } = atrRegime.calc(candles, { period: 2, lookback: 5 }, baseCtx);
    const out = series.pct;

    expect(out).toBeDefined();
    if (out === undefined) throw new Error("série pct absente");

    // Toutes les valeurs de la fenêtre sont égales à la valeur courante ("≤"
    // est vrai pour les 5) -> pct = 100, pas un edge-case buggé.
    expect(out[5]).toBeCloseTo(100, 9);
    expect(out[8]).toBeCloseTo(100, 9);
  });

  it("moins de lookback valeurs d'ATR disponibles -> pct undefined", () => {
    const candles = candlesFromCloses([100, 101, 103, 106, 110, 115, 121, 128, 136]);
    const { series } = atrRegime.calc(candles, { period: 2, lookback: 5 }, baseCtx);
    const out = series.pct;

    expect(out).toBeDefined();
    if (out === undefined) throw new Error("série pct absente");

    // out[0] : ATR lui-même pas encore amorcé (RMA period=2).
    // out[1..4] : ATR défini mais fenêtre de 5 valeurs pas encore pleine
    // (atr[0] n'existe pas -> la fenêtre [0..4] contient un undefined).
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeUndefined();
    expect(out[2]).toBeUndefined();
    expect(out[3]).toBeUndefined();
    expect(out[4]).toBeUndefined();
  });
});
