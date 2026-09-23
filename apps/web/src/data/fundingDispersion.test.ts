import { describe, expect, it } from "vitest";
import { construireSerieDispersion } from "./fundingDispersion";
import type { PointFundingHoraire, VenueFunding } from "./fundingHistory";

const H = 3_600_000;
const F = 24 * 365 * 100;
const point = (time: number, apr: number, duree = H): PointFundingHoraire => ({ time, value: apr / F, validUntil: time + duree });
const quatre = (b: PointFundingHoraire[], y: PointFundingHoraire[], o: PointFundingHoraire[], h: PointFundingHoraire[]) => ({
  binance: b, bybit: y, okx: o, hyperliquid: h,
} satisfies Record<VenueFunding, PointFundingHoraire[]>);

describe("série historique de dispersion", () => {
  it("oracle APR 0/2/4/6, expiration exclusive à l'heure suivante", () => {
    const e = quatre([point(0, 0)], [point(0, 2)], [point(0, 4)], [point(0, 6)]);
    const s = construireSerieDispersion(e, [0, H - 1, H]);
    expect(s[0]).toMatchObject({ knownCount: 4, min: 0, max: 6 });
    expect(s[0]?.sigma).toBeCloseTo(Math.sqrt(5));
    expect(s[1]?.sigma).toBeCloseTo(Math.sqrt(5));
    expect(s[2]).toMatchObject({ knownCount: 0, sigma: undefined });
  });

  it("taux inconnu et venue absente forment des trous, sans réduire la cohorte", () => {
    const e = quatre([point(0, 1), { time: H, value: undefined, validUntil: undefined }], [point(0, 2, 2 * H)], [point(0, 3, 2 * H)], [point(0, 4, 2 * H)]);
    const s = construireSerieDispersion(e, [0, H]);
    expect(s[0]?.knownCount).toBe(4);
    expect(s[1]).toMatchObject({ knownCount: 3, sigma: undefined, min: undefined, max: undefined });
  });

  it("une donnée future ne modifie pas le préfixe calculé", () => {
    const e = quatre([point(0, 1)], [point(0, 2)], [point(0, 3)], [point(0, 4)]);
    const avant = construireSerieDispersion(e, [0, H]);
    e.binance.push(point(2 * H, 100));
    const apres = construireSerieDispersion(e, [0, H, 2 * H]);
    expect(apres.slice(0, avant.length)).toEqual(avant);
  });
});
