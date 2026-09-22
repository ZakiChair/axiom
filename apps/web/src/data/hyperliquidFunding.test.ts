/**
 * Tests de `data/hyperliquidFunding.ts` : parseur PUR (`parseFundingHistory`) et
 * pagination bornée de `fetchHlFundingHistory` sur fetch factice — aucun réseau.
 */
import { describe, it, expect, vi } from "vitest";

import { parseFundingHistory, fetchHlFundingHistory } from "./hyperliquidFunding";

/** Entrée `fundingHistory` conforme (chaîne `fundingRate`, `time` ms). */
const entree = (time: number, rate = "0.00001") => ({ coin: "BTC", fundingRate: rate, premium: "0.0001", time });

describe("parseFundingHistory — forme tolérante, triée, dédoublonnée", () => {
  it("mappe les entrées conformes (fraction horaire, ms)", () => {
    const pts = parseFundingHistory([entree(2_000), entree(1_000, "0.00002")]);
    expect(pts).toEqual([
      { time: 1_000, value: 0.00002 },
      { time: 2_000, value: 0.00001 },
    ]);
  });

  it("écarte les entrées bancales une à une et dédoublonne par time", () => {
    const pts = parseFundingHistory([
      entree(1_000),
      { coin: "BTC", fundingRate: "abc", time: 2_000 }, // taux non numérique
      { coin: "BTC", fundingRate: "0.00001" }, // time absent
      "chaine",
      entree(1_000, "0.00003"), // doublon de time → ignoré
    ]);
    expect(pts).toEqual([{ time: 1_000, value: 0.00001 }]);
  });

  it("réponse non-tableau → []", () => {
    expect(parseFundingHistory({})).toEqual([]);
    expect(parseFundingHistory(null)).toEqual([]);
  });
});

describe("fetchHlFundingHistory — pagination avant bornée", () => {
  const corps = (startTime: number) =>
    JSON.stringify({ type: "fundingHistory", coin: "BTC", startTime });

  it("pagine `startTime = dernier + 1` jusqu'à une page < 500 entrées", async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => entree(1_000 + i));
    const page2 = [entree(1_501)];
    const fetchImpl = vi.fn(async (url: unknown, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}") as { startTime: number };
      const rows = body.startTime === 1_000 ? page1 : page2;
      return new Response(JSON.stringify(rows), { status: 200 });
    });
    const pts = await fetchHlFundingHistory("BTC", 1_000, fetchImpl as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((fetchImpl.mock.calls[1]?.[1] as { body: string }).body).toBe(corps(1_500));
    expect(pts).toHaveLength(501);
  });

  it("page vide / HTTP non-ok / throw → partiel ou [] sans exception", async () => {
    const vide = vi.fn(async () => new Response("[]", { status: 200 }));
    expect(await fetchHlFundingHistory("BTC", 0, vide as typeof fetch)).toEqual([]);

    const ko = vi.fn(async () => new Response("x", { status: 500 }));
    expect(await fetchHlFundingHistory("BTC", 0, ko as typeof fetch)).toEqual([]);

    const jette = vi.fn(async () => Promise.reject(new Error("réseau")));
    expect(await fetchHlFundingHistory("BTC", 0, jette as typeof fetch)).toEqual([]);
  });

  it("borne la pagination à 8 appels (pages toujours pleines)", async () => {
    let appel = 0;
    const pleine = vi.fn(async () => {
      appel += 1;
      // Page pleine (500) datée dans le passé → pagination continue.
      return new Response(
        JSON.stringify(Array.from({ length: 500 }, (_, i) => entree(1_000 + appel * 600 + i))),
        { status: 200 },
      );
    });
    const pts = await fetchHlFundingHistory("BTC", 0, pleine as typeof fetch);
    expect(pleine).toHaveBeenCalledTimes(8);
    expect(pts.length).toBe(8 * 500);
  });
});
