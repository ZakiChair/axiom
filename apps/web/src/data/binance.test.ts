/**
 * Tests de l'agrégation calendaire 3M/6M/12M (binance.ts) — seule logique du repo qui
 * recompose des timeframes longs non natifs depuis le flux mensuel WS. Une erreur d'un
 * cran dans bucketStartMs fusionnerait/casserait des trimestres sans casser ni la
 * compilation ni aucun autre test (l'OHLCV affiché en 3M/6M/12M serait juste faux).
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { aggregateMonthly, bucketStartMs } from "./binance";

function at(c: Candle[], i: number): Candle {
  const v = c[i];
  if (v === undefined) throw new Error(`bougie ${i} absente`);
  return v;
}

describe("bucketStartMs", () => {
  it("ramène n'importe quel mois du trimestre au 1er jour du trimestre (UTC)", () => {
    expect(bucketStartMs(Date.UTC(2024, 1, 15), 3)).toBe(Date.UTC(2024, 0, 1)); // fév -> T1 (jan)
    expect(bucketStartMs(Date.UTC(2024, 3, 1), 3)).toBe(Date.UTC(2024, 3, 1)); // avr -> T2 (avr)
    expect(bucketStartMs(Date.UTC(2024, 11, 31), 3)).toBe(Date.UTC(2024, 9, 1)); // déc -> T4 (oct)
  });

  it("12 mois => un seul bucket (1er janvier), quel que soit le mois", () => {
    expect(bucketStartMs(Date.UTC(2024, 6, 4), 12)).toBe(Date.UTC(2024, 0, 1));
  });
});

describe("aggregateMonthly", () => {
  // 12 bougies mensuelles 2024, valeurs distinctes par mois pour vérifier l'agrégation.
  const monthly: Candle[] = Array.from({ length: 12 }, (_, i) => ({
    time: Date.UTC(2024, i, 1),
    open: 100 + i,
    high: 200 + i, // croissant -> le max du trimestre doit être le DERNIER mois
    low: 50 - i, // décroissant -> le min du trimestre doit être le DERNIER mois
    close: 150 + i,
    volume: 10,
    quoteVolume: 100,
    buyVolume: 4,
    sellVolume: 6,
    trades: 2,
    closed: true,
  }));

  it("3M : 4 buckets aux bonnes bornes calendaires (T1=jan, T2=avr, T3=jui, T4=oct)", () => {
    const out = aggregateMonthly(monthly, 3);
    expect(out.map((c) => c.time)).toEqual([
      Date.UTC(2024, 0, 1),
      Date.UTC(2024, 3, 1),
      Date.UTC(2024, 6, 1),
      Date.UTC(2024, 9, 1),
    ]);
  });

  it("open = 1er mois du bucket, close = dernier, high/low = max/min du bucket", () => {
    const q1 = at(aggregateMonthly(monthly, 3), 0); // jan/fév/mars (i=0,1,2)
    expect(q1.open).toBe(100); // janvier
    expect(q1.close).toBe(152); // mars (150+2)
    expect(q1.high).toBe(202); // max(200,201,202) = mars
    expect(q1.low).toBe(48); // min(50,49,48) = mars
  });

  it("somme volume/quoteVolume/buyVolume/sellVolume/trades sur le bucket", () => {
    const q1 = at(aggregateMonthly(monthly, 3), 0);
    expect(q1.volume).toBe(30);
    expect(q1.quoteVolume).toBe(300);
    expect(q1.buyVolume).toBe(12);
    expect(q1.sellVolume).toBe(18);
    expect(q1.trades).toBe(6);
  });

  it("closed=true seulement si TOUS les mois sont clos ET que le dernier ferme le bucket calendaire", () => {
    const allClosed = aggregateMonthly(monthly, 3);
    for (const bucket of allClosed) expect(bucket.closed).toBe(true);

    // Décembre (dernier mois du dernier trimestre) encore en cours => le bucket T4
    // doit rester ouvert, mais les trimestres précédents restent clos.
    const withOpenDecember = monthly.map((c, i) => (i === 11 ? { ...c, closed: false } : c));
    const out = aggregateMonthly(withOpenDecember, 3);
    expect(out.map((c) => c.closed)).toEqual([true, true, true, false]);
  });

  it("6M : 2 buckets (S1=jan, S2=juil)", () => {
    const out = aggregateMonthly(monthly, 6);
    expect(out.map((c) => c.time)).toEqual([Date.UTC(2024, 0, 1), Date.UTC(2024, 6, 1)]);
    expect(out.map((c) => c.volume)).toEqual([60, 60]);
  });

  it("12M : un seul bucket annuel, somme du volume sur les 12 mois", () => {
    const out = aggregateMonthly(monthly, 12);
    expect(out).toHaveLength(1);
    expect(at(out, 0).time).toBe(Date.UTC(2024, 0, 1));
    expect(at(out, 0).volume).toBe(120);
    expect(at(out, 0).high).toBe(211); // max(200..211)
    expect(at(out, 0).low).toBe(39); // min(50..39)
  });
});
