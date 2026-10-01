import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { buildCalcContext, computeIndicator } from "../engine";
import { rollingDrawdown } from "./rollingDrawdown";

const bars = (closes: number[]): Candle[] => closes.map((close, i) => ({ time: i * 60_000, open: close, high: close, low: close, close, volume: 1 }));
const calc = (candles: Candle[], length = 3) => computeIndicator(rollingDrawdown, candles, { length });

describe("rollingDrawdown — sommet des N clôtures, récupération arithmétique", () => {
  it("ne calcule pas sur une fenêtre tronquée et oublie le sommet sortant sans hausse du prix", () => {
    expect(calc(bars([100, 80, 80, 80])).series).toEqual({
      drawdown: [undefined, undefined, -20, 0], recovery: [undefined, undefined, 25, 0],
    });
  });

  it.each([{ closes: [100, 90, 50], drawdown: -50, recovery: 100 }, { closes: [80, 90, 100], drawdown: 0, recovery: 0 }, { closes: [80, 80, 80], drawdown: 0, recovery: 0 }])(
    "le repli $drawdown et la hausse requise $recovery ne sont pas symétriques", ({ closes, drawdown, recovery }) => {
      const r = calc(bars(closes)).series;
      expect(r.drawdown?.[2]).toBe(drawdown);
      expect(r.recovery?.[2]).toBe(recovery);
    },
  );

  it("ignore les mèches/volume et conserve les pourcentages après changement d'échelle", () => {
    const r = calc(bars([100, 80, 80]).map((c) => ({ ...c, close: c.close * 1e10, high: Infinity, low: -Infinity, open: NaN, volume: NaN }))).series;
    expect(r.drawdown?.[2]).toBeCloseTo(-20, 12);
    expect(r.recovery?.[2]).toBeCloseTo(25, 12);
  });

  it.each([
    { valeur: 2, premier: 1 }, { valeur: 3.9, premier: 2 }, { valeur: -10, premier: 1 }, { valeur: 1001, premier: 999 },
    { valeur: NaN, premier: 99 }, { valeur: Infinity, premier: 99 }, { valeur: "2", premier: 99 }, { valeur: true, premier: 99 },
  ])("length=$valeur : période entière bornée ou défaut sans coercition", ({ valeur, premier }) => {
    const candles = bars(Array(1001).fill(100));
    const r = rollingDrawdown.calc(candles, { length: valeur }, buildCalcContext(candles)).series;
    expect(r.drawdown?.findIndex((v) => v !== undefined)).toBe(premier);
    expect(r.drawdown?.[premier]).toBe(0);
    expect(r.recovery?.[premier]).toBe(0);
  });

  it.each([
    { nom: "zéro", mutation: { close: 0 } }, { nom: "négatif", mutation: { close: -1 } },
    { nom: "NaN", mutation: { close: NaN } }, { nom: "infini", mutation: { close: Infinity } },
    { nom: "non clôturée", mutation: { closed: false } }, { nom: "date invalide", mutation: { time: NaN } },
  ])("$nom reste absent jusqu'à la sortie de la bougie de la fenêtre", ({ mutation }) => {
    const candles = bars([100, 90, 80, 75, 70, 60]);
    candles[2] = { ...candles[2]!, ...mutation };
    const r = calc(candles).series;
    expect(r.drawdown?.slice(0, 5)).toEqual(Array(5).fill(undefined));
    expect(r.recovery?.slice(0, 5)).toEqual(Array(5).fill(undefined));
    expect(r.drawdown?.[5]).toBe(-20);
    expect(r.recovery?.[5]).toBe(25);
  });

  it.each([60_000, 0])("une date non croissante %s invalide les fenêtres chevauchant la paire", (time) => {
    const candles = bars([100, 90, 80, 75, 60]);
    candles[2]!.time = time;
    const r = calc(candles).series;
    expect(r.drawdown?.slice(0, 4)).toEqual(Array(4).fill(undefined));
    expect(r.drawdown?.[4]).toBe(-25);
  });

  it("tolère un gap positif comme des observations disponibles", () => {
    const candles = bars([100, 80, 80]);
    candles[2]!.time = 600_000;
    expect(calc(candles).series.drawdown?.[2]).toBe(-20);
  });

  it("préserve le repli fini si la récupération déborde et normalise les zéros", () => {
    const extreme = calc(bars([Number.MAX_VALUE, Number.MIN_VALUE]), 2);
    expect(extreme.series.drawdown?.[1]).toBe(-100);
    expect(extreme.series.recovery?.[1]).toBeUndefined();
    const grand = calc(bars([Number.MAX_VALUE, Number.MAX_VALUE / 2]), 2);
    expect(grand.series.drawdown?.[1]).toBe(-50);
    expect(grand.series.recovery?.[1]).toBe(100);
    const petit = calc(bars([2 * Number.MIN_VALUE, Number.MIN_VALUE]), 2);
    expect(petit.series.drawdown?.[1]).toBe(-50);
    expect(petit.series.recovery?.[1]).toBe(100);
    expect(calc(bars([100, 100]), 2).series.drawdown?.[1]).toBe(0);
  });

  it("préserve chaque préfixe malgré les futurs sommets et ne mute aucune bougie", () => {
    const candles = bars([100, 90, 80, 95, 110, 70, 60]);
    candles.forEach(Object.freeze); Object.freeze(candles);
    const complet = calc(candles).series;
    for (let n = 0; n <= candles.length; n++) {
      expect(calc(candles.slice(0, n)).series).toEqual(Object.fromEntries(Object.entries(complet).map(([k, v]) => [k, v.slice(0, n)])));
      const futur = [...candles.slice(0, n), ...candles.slice(n).map((c) => ({ ...c, close: 1e100 }))];
      for (const [k, v] of Object.entries(complet)) expect(calc(futur).series[k]?.slice(0, n)).toEqual(v.slice(0, n));
    }
  });

  it("annote l'indisponibilité sans inventer de point, ni masquer les valeurs antérieures", () => {
    expect(calc([])).toEqual({ series: { drawdown: [], recovery: [] } });
    const incomplet = calc(bars([100]));
    expect(incomplet.series.drawdown).toEqual([undefined]);
    expect(incomplet.annotations?.labels).toHaveLength(1);
    const r = calc([...bars([100, 80, 80]), { ...bars([70])[0]!, time: 180_000, closed: false }]);
    expect(r.series.drawdown).toEqual([undefined, undefined, -20, undefined]);
    expect(r.annotations?.labels?.[0]).toMatchObject({ idx: 3, ancrageY: "haut-pane" });
    expect(r.annotations?.labels?.[0]?.texte).toMatch(/clôture/i);
  });
});
