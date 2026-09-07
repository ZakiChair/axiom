import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { getIndicator } from "../registry";

const H = 3_600_000;
const START = Date.UTC(2026, 0, 5); // lundi UTC
function bars(days = 30): Candle[] {
  return Array.from({ length: days * 24 }, (_, i) => ({ time: START + i * H, open: 1, high: 1, low: 1, close: 1, volume: i % 24 === 8 ? 100 : 10 }));
}
function calc(candles: Candle[], params = {}) {
  const def = getIndicator("rvolSeasonal");
  expect(def, "RVOL saisonnier raccordé au registre").toBeDefined();
  return computeIndicator(def!, candles, { minimum: 3, ...params });
}

describe("rvolSeasonal — références strictement antérieures", () => {
  it("compare la même heure UTC sans inclure son propre volume", () => {
    const c = bars(4);
    c[80]!.volume = 300;
    const r = calc(c);
    expect(r.series.rvol?.[56]).toBeUndefined();
    expect(r.series.references?.[80]).toBe(3);
    expect(r.series.rvol?.[80]).toBe(3);
  });
  it("sépare les jours de semaine et affiche la couverture insuffisante", () => {
    const c = bars(23);
    c[21 * 24 + 8]!.volume = 200;
    const r = calc(c, { mode: "jour + heure UTC" });
    expect(r.series.references?.[14 * 24 + 8]).toBe(2);
    expect(r.series.rvol?.[14 * 24 + 8]).toBeUndefined();
    expect(r.series.rvol?.[21 * 24 + 8]).toBe(2);
    expect(r.annotations?.labels?.[0]?.info).toContain("références");
  });
  it("ne modifie aucun résultat passé lorsque des bougies futures arrivent", () => {
    const c = bars(10);
    const prefix = calc(c.slice(0, 100));
    c[150]!.volume = 1e9;
    expect(calc(c).series.rvol?.slice(0, 100)).toEqual(prefix.series.rvol);
  });
  it("borne la référence en jours, ignore invalides et doublons sans les traiter comme zéro", () => {
    const c = bars(15);
    c[8]!.volume = NaN;
    const r = calc(c, { jours: 7 });
    expect(r.series.references?.[14 * 24 + 8]).toBe(7);
    const duplicate = [...c.slice(0, 33), c[32]!, ...c.slice(33)];
    expect(calc(duplicate).series.references?.at(-1)).toBe(calc(c).series.references?.at(-1));
  });
  it("garde zéro pour un volume nul, mais aucune valeur pour une référence nulle", () => {
    const c = bars(4);
    c[80]!.volume = 0;
    expect(calc(c).series.rvol?.[80]).toBe(0);
    for (const b of c) b.volume = 0;
    expect(calc(c).series.rvol?.every((v) => v === undefined)).toBe(true);
  });
});
