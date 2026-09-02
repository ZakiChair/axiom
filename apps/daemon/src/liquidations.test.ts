import { describe, expect, it } from "bun:test";
import { reinitialiserSanteLiqFeed, santeLiqFeed } from "./liqFeed";
import { corpsLiquidations, type LiqFil, normaliserLiqs, parseRequeteLiqs } from "./liquidations";

describe("normaliserLiqs", () => {
  it("garde les entrées valides et écarte les invalides", () => {
    const ok: LiqFil = { t: 1, venue: "bybit", side: "long", price: 100, qty: 2, usd: 200 };
    expect(normaliserLiqs([ok, { t: "x" }, null, { ...ok, side: "haut" }])).toEqual([ok]);
  });
  it("renvoie [] pour un corps non-tableau", () => {
    expect(normaliserLiqs({})).toEqual([]);
  });
});

describe("parseRequeteLiqs", () => {
  it("borne la limite et parse depuis/jusqua", () => {
    const p = new URLSearchParams("depuis=5&jusqua=9&limite=999999999");
    expect(parseRequeteLiqs(p)).toEqual({ depuis: 5, jusqua: 9, limite: 100_000 });
  });
});

describe("corpsLiquidations", () => {
  it("joint la santé des collecteurs au fil renvoyé par GET /liquidations/:symbole", () => {
    reinitialiserSanteLiqFeed();
    const corps = corpsLiquidations("BTCUSDT", []);
    expect(corps.symbole).toBe("BTCUSDT");
    expect(corps.liquidations).toEqual([]);
    expect(corps.collecteurs).toEqual(santeLiqFeed());
  });
});
