import { describe, expect, it, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { reinitialiserSanteLiqFeed, santeLiqFeed } from "./liqFeed";
import {
  corpsLiquidations,
  type LiqFil,
  normaliserLiqs,
  parseRequeteLiqs,
  traiterLiquidations,
} from "./liquidations";

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
    expect(parseRequeteLiqs(p)).toEqual({ depuis: 5, jusqua: 9, limite: 100_000, venue: null });
  });

  it("venue : acceptée si /^[a-z0-9_-]{1,32}$/i, ignorée sinon", () => {
    expect(parseRequeteLiqs(new URLSearchParams("venue=hyperliquid")).venue).toBe("hyperliquid");
    expect(parseRequeteLiqs(new URLSearchParams("venue=OKX")).venue).toBe("OKX");
    expect(parseRequeteLiqs(new URLSearchParams("venue=' OR 1=1")).venue).toBeNull();
    expect(parseRequeteLiqs(new URLSearchParams("venue=" + "a".repeat(33))).venue).toBeNull();
    expect(parseRequeteLiqs(new URLSearchParams()).venue).toBeNull();
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

/**
 * Filtre `venue` EFFECTIF sur le GET. `traiterLiquidations`/`insererLiquidations` ne
 * sont pas injectables (ils appellent `getDb()`) : on substitue le module `./db` par
 * une base `:memory:` (`mock.module`, pattern snapshots.test.ts) — le fichier axiom.db
 * réel n'est jamais touché. Bloc EN DERNIER (substitution globale au process).
 */
describe("GET /liquidations/:symbole?venue= — filtre effectif", () => {
  it("ne renvoie que les lignes de la venue demandée", async () => {
    const dbReel = await import("./db");
    const memDb = new Database(":memory:");
    mock.module("./db", () => ({ ...dbReel, getDb: () => memDb }));

    const req = (q: string) =>
      new Request(`http://127.0.0.1/liquidations/BTCUSDT${q}`, { method: "GET" });
    const url = (q: string) => new URL(`http://127.0.0.1/liquidations/BTCUSDT${q}`);

    // Insertion via le chemin normal (db() → getDb() substitué).
    const { insererLiquidations } = await import("./liquidations");
    insererLiquidations("BTCUSDT", [
      { t: 1, venue: "bybit", side: "long", price: 100, qty: 1, usd: 100 },
      { t: 2, venue: "hyperliquid", side: "short", price: 101, qty: 2, usd: 202 },
      { t: 3, venue: "okx", side: "long", price: 102, qty: 3, usd: 306 },
    ]);

    const resAll = await traiterLiquidations(req(""), url(""));
    const toutes = (await resAll.json()) as { liquidations: LiqFil[] };
    expect(toutes.liquidations).toHaveLength(3);

    const resHl = await traiterLiquidations(req("?venue=hyperliquid"), url("?venue=hyperliquid"));
    const hl = (await resHl.json()) as { liquidations: LiqFil[] };
    expect(hl.liquidations).toHaveLength(1);
    expect(hl.liquidations[0]?.venue).toBe("hyperliquid");
    expect(hl.liquidations[0]?.usd).toBe(202);

    // Venue invalide → ignorée (pas de filtre appliqué).
    const resBizarre = await traiterLiquidations(req("?venue=.."), url("?venue=.."));
    const bizarre = (await resBizarre.json()) as { liquidations: LiqFil[] };
    expect(bizarre.liquidations).toHaveLength(3);
    memDb.close();
  });
});
