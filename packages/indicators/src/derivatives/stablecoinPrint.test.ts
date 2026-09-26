/**
 * @axiom/indicators — derivatives/stablecoinPrint.test.ts
 *
 * Impression de stablecoins : variation nette QUOTIDIENNE de l'offre agrégée (ctx.aux.stablecoins,
 * série DefiLlama journalière alignée par report sur les bougies). Une valeur reportée à
 * l'identique n'est pas une nouvelle observation : jamais de 0 inventé.
 */
import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { stablecoinPrint } from "./stablecoinPrint";

const JOUR = 86_400_000;
const H = 3_600_000;
const T0 = Date.UTC(2026, 8, 1);
const baseCtx = { hl2: [], hlc3: [], ohlc4: [], source: [] };
const bougies = (n: number, pas: number): Candle[] =>
  Array.from({ length: n }, (_, i) => ({ time: T0 + i * pas, open: 1, high: 1, low: 1, close: 1, volume: 1 }));

describe("stablecoinPrint (impression de stablecoins, Δ offre / jour)", () => {
  it("1d : émission nette positive en --up, contraction en --down, première bougie sans référence", () => {
    const stablecoins = [300e9, 301.5e9, 301e9, 302e9];
    const r = stablecoinPrint.calc(bougies(4, JOUR), { lissage: 2 }, { ...baseCtx, aux: { stablecoins } });
    expect(r.series.emission).toEqual([undefined, 1.5e9, undefined, 1e9]);
    expect(r.series.contraction).toEqual([undefined, undefined, -0.5e9, undefined]);
    // Moyenne des 2 dernières impressions observées : (1.5 − 0.5) / 2 puis (−0.5 + 1) / 2.
    expect(r.series.moyenne).toEqual([undefined, undefined, 0.5e9, 0.25e9]);
  });

  it("valeur reportée à l'identique (DefiLlama pas encore publié) : aucune barre, pas un 0", () => {
    const stablecoins = [300e9, 301e9, 301e9];
    const r = stablecoinPrint.calc(bougies(3, JOUR), { lissage: 2 }, { ...baseCtx, aux: { stablecoins } });
    expect(r.series.emission).toEqual([undefined, 1e9, undefined]);
    expect(r.series.contraction).toEqual([undefined, undefined, undefined]);
  });

  it("1w : ramené à un montant par jour (écart / 7)", () => {
    const stablecoins = [300e9, 307e9];
    const r = stablecoinPrint.calc(bougies(2, 7 * JOUR), {}, { ...baseCtx, aux: { stablecoins } });
    expect(r.series.emission).toEqual([undefined, 1e9]);
  });

  it("1h : une barre par nouvelle observation quotidienne, montant du jour (pas ×24)", () => {
    // Offre reportée heure par heure : 300 G le 1er, 302 G dès la 1re heure du 2.
    const stablecoins = Array.from({ length: 48 }, (_, i) => (i < 24 ? 300e9 : 302e9));
    const r = stablecoinPrint.calc(bougies(48, H), {}, { ...baseCtx, aux: { stablecoins } });
    const emission = r.series.emission ?? [];
    expect(emission.filter((v) => v !== undefined)).toEqual([2e9]);
    expect(emission[24]).toBe(2e9);
  });

  it("aux absent → séries vides, jamais de throw ; métadonnées", () => {
    const r = stablecoinPrint.calc(bougies(3, JOUR), {}, baseCtx);
    expect(r.series.emission).toEqual([undefined, undefined, undefined]);
    expect(stablecoinPrint).toMatchObject({ id: "stablecoinPrint", category: "derivatives", pane: "separate", aux: ["stablecoins"] });
  });
});
