import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { buildCalcContext, computeIndicator } from "../engine";
import { returnAutocorrelation } from "./returnAutocorrelation";

function bars(returns: number[]): Candle[] {
  let close = 100;
  return [0, ...returns].map((r, i) => { close *= Math.exp(r); return { time: i * 60_000, open: close, high: close, low: close, close, volume: 1 }; });
}
const calc = (candles: Candle[], length = 4) => computeIndicator(returnAutocorrelation, candles, { length });

describe("returnAutocorrelation — ACF lag 1, moyenne complète NIST", () => {
  it.each([{ returns: [-0.01, 0.01, -0.01, 0.01], attendu: -0.75 }, { returns: [0.01, 0.02, 0.03, 0.04], attendu: 0.25 }])(
    "calcule $attendu avec N rendements, sans Pearson de deux listes tronquées", ({ returns, attendu }) => {
      const serie = calc(bars(returns)).series.acf!;
      expect(serie.slice(0, 4)).toEqual([undefined, undefined, undefined, undefined]);
      expect(serie[4]).toBeCloseTo(attendu, 12);
    },
  );

  it.each([0, 0.01])("les rendements constants %s sont indéterminés, jamais 0/1", (r) => {
    const resultat = calc(bars(Array(8).fill(r)));
    expect(resultat.series.acf?.every((v) => v === undefined)).toBe(true);
    expect(resultat.annotations?.labels?.[0]?.texte).toMatch(/variance/i);
  });

  it("conserve les faibles variations au-dessus de la résolution numérique", () => {
    expect(calc(bars([-1e-10, 1e-10, -1e-10, 1e-10])).series.acf?.[4]).toBeCloseTo(-0.75, 6);
    expect(calc(bars([-Number.EPSILON, Number.EPSILON, -Number.EPSILON, Number.EPSILON])).series.acf?.[4]).toBeUndefined();
  });

  it("préserve l'ACF quand l'échelle des closes ou les signes des rendements changent", () => {
    const returns = [0.01, 0.02, 0.03, 0.04];
    const candles = bars(returns).map((c) => ({ ...c, close: c.close * 1000, high: NaN, low: NaN, open: NaN, volume: NaN }));
    expect(calc(candles).series.acf?.[4]).toBeCloseTo(0.25, 12);
    expect(calc(bars(returns.map((r) => -r))).series.acf?.[4]).toBeCloseTo(0.25, 12);
  });

  it("évite overflow et underflow des ratios de prix finis", () => {
    const candles = bars([0, 0, 0, 0]);
    [Number.MAX_VALUE, Number.MIN_VALUE, Number.MAX_VALUE, Number.MIN_VALUE, Number.MAX_VALUE].forEach((close, i) => { candles[i]!.close = close; });
    expect(calc(candles).series.acf?.[4]).toBeCloseTo(-0.75, 12);
  });

  it.each([
    { valeur: 3, premier: 3 }, { valeur: 4.9, premier: 4 }, { valeur: -1, premier: 3 }, { valeur: 501, premier: 500 },
    { valeur: NaN, premier: 50 }, { valeur: Infinity, premier: 50 }, { valeur: "3", premier: 50 }, { valeur: false, premier: 50 },
  ])("quantifie/borde length=$valeur sans convertir les valeurs non numériques", ({ valeur, premier }) => {
    const candles = bars(Array.from({ length: 501 }, (_, i) => i % 2 === 0 ? -0.01 : 0.01));
    const result = returnAutocorrelation.calc(candles, { length: valeur }, buildCalcContext(candles));
    expect(result.series.acf?.findIndex((v) => v !== undefined)).toBe(premier);
    if (premier === 3) expect(result.series.acf?.[premier]).toBeCloseTo(-2 / 3, 12);
  });

  it.each([
    { nom: "zéro", mutation: { close: 0 } }, { nom: "négatif", mutation: { close: -1 } },
    { nom: "NaN", mutation: { close: NaN } }, { nom: "infini", mutation: { close: Infinity } },
    { nom: "non clôturée", mutation: { closed: false } }, { nom: "date invalide", mutation: { time: NaN } },
  ])("une clôture $nom invalide N+1 observations, puis reprend naturellement", ({ mutation }) => {
    const candles = bars([-0.01, 0.01, -0.01, 0.01, -0.01, 0.01, -0.01, 0.01]);
    candles[2] = { ...candles[2]!, ...mutation };
    const r = calc(candles, 3).series.acf!;
    expect(r.slice(0, 6)).toEqual(Array(6).fill(undefined));
    expect(r[6]).toBeCloseTo(-2 / 3, 12);
  });

  it.each([0, 60_000, 180_000])("refuse la cadence interrompue par time=$time et reprend une fenêtre régulière", (time) => {
    const candles = bars([-0.01, 0.01, -0.01, 0.01, -0.01, 0.01, -0.01, 0.01]);
    candles[2]!.time = time;
    expect(calc(candles, 3).series.acf?.slice(0, 6)).toEqual(Array(6).fill(undefined));
    expect(calc(candles, 3).series.acf?.[6]).toBeCloseTo(-2 / 3, 12);
  });

  it("nomme le pas irrégulier ; accepte un pas régulier observé sans deviner son unité", () => {
    const trou = bars([-0.01, 0.01, -0.01, 0.01]);
    trou[4]!.time += 60_000;
    const resultat = calc(trou);
    expect(resultat.series.acf?.[4]).toBeUndefined();
    expect(resultat.annotations?.labels?.[0]?.texte).toContain("Pas temporel irrégulier");
    expect(calc(bars([-0.01, 0.01, -0.01, 0.01]).map((c) => ({ ...c, time: c.time * 2 }))).series.acf?.[4]).toBeCloseTo(-0.75, 12);
  });

  it.each(["Pas temporel irrégulier", "Variance indéterminable"])("conserve le diagnostic précédent %s pendant la bougie ouverte", (motif) => {
    const candles = bars(motif === "Variance indéterminable" ? [0, 0, 0, 0] : [-0.01, 0.01, -0.01, 0.01]);
    if (motif === "Pas temporel irrégulier") candles[4]!.time += 60_000;
    candles.push({ ...candles[4]!, time: candles[4]!.time + 60_000, closed: false });
    const resultat = calc(candles);
    expect(resultat.series.acf?.at(-1)).toBeUndefined();
    expect(resultat.annotations?.labels?.[0]?.texte).toBe(`Attente de clôture · fenêtre précédente : ${motif}`);
  });

  it("ne produit aucun point avant la chauffe ou la clôture et ne réécrit jamais les préfixes", () => {
    expect(calc([])).toEqual({ series: { acf: [] } });
    const candles = bars([0.01, 0.02, -0.03, 0.04, 0.01, -0.02, 0.02]);
    candles.forEach(Object.freeze); Object.freeze(candles);
    const complet = calc(candles).series.acf!;
    for (let n = 0; n <= candles.length; n++) {
      expect(calc(candles.slice(0, n)).series.acf).toEqual(complet.slice(0, n));
      const futur = [...candles.slice(0, n), ...candles.slice(n).map((c) => ({ ...c, close: Number.MIN_VALUE }))];
      expect(calc(futur).series.acf?.slice(0, n)).toEqual(complet.slice(0, n));
    }
    const ouverte = calc([...candles.slice(0, -1), { ...candles.at(-1)!, closed: false }]);
    expect(ouverte.series.acf?.at(-1)).toBeUndefined();
    expect(ouverte.annotations?.labels).toHaveLength(1);
    expect(ouverte.annotations?.labels?.[0]?.texte).toMatch(/clôture/i);
    expect(calc(candles.slice(0, 3)).annotations?.labels?.[0]).toMatchObject({ idx: 2, ancrageY: "haut-pane" });
  });
});
