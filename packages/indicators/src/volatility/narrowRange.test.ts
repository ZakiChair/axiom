import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { buildCalcContext, computeIndicator } from "../engine";
import { narrowRange } from "./narrowRange";

const bars = (ranges: number[]): Candle[] => ranges.map((r, i) => ({ time: i * 60_000, open: 100, high: 100 + r / 2, low: 100 - r / 2, close: 100, volume: 1 }));
const calc = (candles: Candle[], length = 7) => computeIndicator(narrowRange, candles, { length });

describe("narrowRange — compression confirmée, sans direction", () => {
  it.each([{ dernier: 4, nr: 1, inside: 1 }, { dernier: 6, nr: 0, inside: 0 }, { dernier: 5, nr: 1, inside: 0 }])(
    "NR7 inclut les égalités : dernier range $dernier", ({ dernier, nr, inside }) => {
      const r = calc(bars([10, 9, 8, 7, 6, 5, dernier]));
      expect(r.series.nr).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, nr]);
      expect(r.series.inside).toEqual([undefined, 1, 1, 1, 1, 1, inside]);
    },
  );

  it.each([{ high: 105, low: 95, attendu: 1 }, { high: 110, low: 95, attendu: 0 }, { high: 105, low: 90, attendu: 0 }])(
    "Inside est strict et n'attend pas NR : H=$high L=$low", ({ high, low, attendu }) => {
      expect(calc([{ ...bars([20])[0]! }, { ...bars([20])[0]!, time: 60_000, high, low }]).series.inside).toEqual([undefined, attendu]);
    },
  );

  it("Inside seul reste distinct de NR et un plateau sans amplitude n'est pas une absence", () => {
    expect(calc(bars([2, 20, 10]), 3).series).toEqual({ nr: [undefined, undefined, 0], inside: [undefined, 0, 1] });
    expect(calc(bars([0, 0, 0]), 2).series).toEqual({ nr: [undefined, 1, 1], inside: [undefined, 0, 0] });
  });

  it.each([
    { valeur: 2, premier: 1 }, { valeur: 3.9, premier: 2 }, { valeur: -5, premier: 1 },
    { valeur: 101, premier: 99 }, { valeur: NaN, premier: 6 }, { valeur: Infinity, premier: 6 },
    { valeur: -Infinity, premier: 6 }, { valeur: "2", premier: 6 }, { valeur: true, premier: 6 },
  ])("borne/floor les nombres et refuse la coercition de length=$valeur", ({ valeur, premier }) => {
    const candles = bars(Array(101).fill(0));
    const r = narrowRange.calc(candles, { length: valeur }, buildCalcContext(candles));
    expect(r.series.nr?.findIndex((v) => v !== undefined)).toBe(premier);
    expect(r.series.nr?.[premier]).toBe(1);
  });

  it.each([
    { nom: "OHLC incohérent", mutation: { high: 99 } },
    { nom: "close non fini", mutation: { close: NaN } },
    { nom: "high infini", mutation: { high: Infinity } },
    { nom: "low non fini", mutation: { low: NaN } },
    { nom: "open hors range", mutation: { open: 999 } },
    { nom: "non clôturée", mutation: { closed: false } },
    { nom: "timestamp non fini", mutation: { time: NaN } },
  ])("$nom invalide les fenêtres nécessaires, sans décaler la reprise", ({ mutation }) => {
    const candles = bars([10, 9, 8, 7, 6, 5]);
    candles[2] = { ...candles[2]!, ...mutation };
    const r = calc(candles, 3);
    expect(r.series.nr).toEqual([undefined, undefined, undefined, undefined, undefined, 1]);
    expect(r.series.inside).toEqual([undefined, 1, undefined, undefined, 1, 1]);
  });

  it.each([60_000, 0])("un timestamp non croissant %s invalide seulement les fenêtres contenant la paire", (time) => {
    const candles = bars([10, 9, 8, 7, 6]);
    candles[2]!.time = time;
    const r = calc(candles, 3);
    expect(r.series.nr).toEqual([undefined, undefined, undefined, undefined, 1]);
    expect(r.series.inside).toEqual([undefined, 1, undefined, 1, 1]);
  });

  it("accepte prix négatifs, volume inutilisable et gaps positifs comme observations", () => {
    const candles = bars([10, 9, 8]).map((c, i) => ({ ...c, open: c.open - 200, high: c.high - 200, low: c.low - 200, close: c.close - 200, volume: NaN, time: i === 2 ? 600_000 : c.time }));
    expect(calc(candles, 3).series).toEqual({ nr: [undefined, undefined, 1], inside: [undefined, 1, 1] });
  });

  it("une amplitude non représentable rend NR absent sans perdre Inside ni les petits ranges", () => {
    const candles = bars([0, 0]);
    candles[0] = { ...candles[0]!, high: Number.MAX_VALUE, low: -Number.MAX_VALUE };
    candles[1] = { ...candles[1]!, high: Number.MAX_VALUE, low: -Number.MAX_VALUE / 2 };
    const r = calc(candles, 2);
    expect(r.series.nr).toEqual([undefined, undefined]);
    expect(r.series.inside).toEqual([undefined, 0]);
    expect(r.annotations?.labels?.[0]?.texte).toMatch(/amplitude non représentable/i);
    const petits = [0, 1].map((i) => ({ time: i, open: 0, low: 0, high: Number.MIN_VALUE, close: 0, volume: 0 }));
    expect(calc(petits, 2).series.nr).toEqual([undefined, 1]);
  });

  it("reste causal, aligné et sans mutation des bougies", () => {
    const candles = bars([10, 9, 8, 12, 6, 11, 4, 5]);
    candles.forEach(Object.freeze); Object.freeze(candles);
    const complet = calc(candles, 3).series;
    for (let n = 0; n <= candles.length; n++) {
      const prefixe = calc(candles.slice(0, n), 3).series;
      expect(prefixe).toEqual(Object.fromEntries(Object.entries(complet).map(([k, v]) => [k, v.slice(0, n)])));
      const futur = [...candles.slice(0, n), ...candles.slice(n).map((c) => ({ ...c, high: 1e8, low: -1e8 }))];
      for (const [k, v] of Object.entries(complet)) expect(calc(futur, 3).series[k]?.slice(0, n)).toEqual(v.slice(0, n));
    }
  });

  it("annote l'attente ou l'historique incomplet sans créer de point numérique", () => {
    expect(calc([])).toEqual({ series: { nr: [], inside: [] } });
    const incomplet = calc(bars([10]));
    expect(incomplet.series.nr).toEqual([undefined]);
    expect(incomplet.annotations?.labels).toHaveLength(1);
    const attente = calc([...bars([10, 9]), { ...bars([8])[0]!, time: 120_000, closed: false }], 3);
    expect(attente.series.nr?.[2]).toBeUndefined();
    expect(attente.annotations?.labels?.[0]).toMatchObject({ idx: 2, ancrageY: "haut-pane" });
    expect(attente.annotations?.labels?.[0]?.texte).toMatch(/clôture/i);
  });
});
