/**
 * Liquidations multi-exchange — parse pur + convention de côté figée contre une inversion
 * silencieuse ; résumé notionnel. Deux venues :
 *  - Bybit (S=Sell→long liquidé, S=Buy→short liquidé) ;
 *  - OKX (canal liquidation-orders : posSide PRIORITAIRE, repli side ; sz en CONTRATS → qty = sz × ctVal).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  okxInstFamily,
  parseBybitLiquidation,
  parseOkxLiquidation,
  resumerLiquidations,
  subscribeLiquidations,
  type Liquidation,
} from "./liquidations";

describe("parseBybitLiquidation", () => {
  it("S=Sell (taker vend) => position LONGUE liquidée", () => {
    expect(parseBybitLiquidation({ T: 1000, s: "BTCUSDT", S: "Sell", v: "2", p: "100" })?.side).toBe("long");
  });
  it("S=Buy (taker rachète) => position COURTE liquidée", () => {
    expect(parseBybitLiquidation({ T: 1000, s: "BTCUSDT", S: "Buy", v: "2", p: "100" })?.side).toBe("short");
  });
  it("marque la venue « bybit »", () => {
    expect(parseBybitLiquidation({ T: 1, s: "BTCUSDT", S: "Sell", v: "1", p: "100" })?.venue).toBe("bybit");
  });
  it("calcule le notionnel v × p", () => {
    const l = parseBybitLiquidation({ T: 1, s: "BTCUSDT", S: "Sell", v: "0.007", p: "65513.30" });
    expect(l?.qty).toBe(0.007);
    expect(l?.price).toBe(65513.3);
    expect(l?.notionalUsd).toBeCloseTo(458.5931, 4);
  });
  it("rejette une entrée illisible (côté inconnu, prix ≤ 0, non numérique)", () => {
    expect(parseBybitLiquidation({ S: "X", v: "1", p: "1" })).toBeNull();
    expect(parseBybitLiquidation({ S: "Buy", v: "1", p: "0" })).toBeNull();
    expect(parseBybitLiquidation({ S: "Sell", v: "x", p: "1" })).toBeNull();
  });
});

describe("okxInstFamily", () => {
  it("BTCUSDT → BTC-USDT", () => {
    expect(okxInstFamily("BTCUSDT")).toBe("BTC-USDT");
  });
  it("suffixe de cotation le plus long d'abord (ETHUSDT → ETH-USDT)", () => {
    expect(okxInstFamily("ETHUSDT")).toBe("ETH-USDT");
  });
  it("lève sur une cotation inconnue (mapping OKX impossible)", () => {
    expect(() => okxInstFamily("FOOZZZ")).toThrow();
  });
});

describe("parseOkxLiquidation", () => {
  it("posSide « long » PRIORITAIRE ; sz en contrats → qty = sz × ctVal ; usd = qty × bkPx", () => {
    const l = parseOkxLiquidation(
      "BTC-USDT-SWAP",
      { posSide: "long", bkPx: "65000", sz: "20", ts: "1700000000000" },
      0.01,
    );
    expect(l).toEqual({
      time: 1700000000000,
      side: "long",
      qty: 0.2,
      price: 65000,
      notionalUsd: 13000,
      venue: "okx",
    });
  });

  it("posSide « short » → position COURTE liquidée", () => {
    const l = parseOkxLiquidation("BTC-USDT-SWAP", { posSide: "short", bkPx: "100", sz: "1", ts: "1" }, 0.01);
    expect(l?.side).toBe("short");
  });

  it("posSide « net »/absent → repli sur side (sell→long liquidé, buy→short liquidé)", () => {
    const vente = parseOkxLiquidation("BTC-USDT-SWAP", { side: "sell", bkPx: "100", sz: "1", ts: "1" }, 0.01);
    expect(vente?.side).toBe("long");
    const rachat = parseOkxLiquidation(
      "BTC-USDT-SWAP",
      { posSide: "net", side: "buy", bkPx: "100", sz: "1", ts: "1" },
      0.01,
    );
    expect(rachat?.side).toBe("short");
  });

  it("rejette une entrée illisible (bkPx ≤ 0, sz/bkPx non numériques, côté indéterminé, ctVal ≤ 0)", () => {
    expect(parseOkxLiquidation("BTC-USDT-SWAP", { posSide: "long", bkPx: "0", sz: "1", ts: "1" }, 0.01)).toBeNull();
    expect(parseOkxLiquidation("BTC-USDT-SWAP", { posSide: "long", bkPx: "x", sz: "1", ts: "1" }, 0.01)).toBeNull();
    expect(parseOkxLiquidation("BTC-USDT-SWAP", { posSide: "long", bkPx: "1", sz: "x", ts: "1" }, 0.01)).toBeNull();
    expect(parseOkxLiquidation("BTC-USDT-SWAP", { bkPx: "1", sz: "1", ts: "1" }, 0.01)).toBeNull();
    expect(parseOkxLiquidation("BTC-USDT-SWAP", { posSide: "long", bkPx: "1", sz: "1", ts: "1" }, 0)).toBeNull();
    expect(parseOkxLiquidation("BTC-USDT-SWAP", null, 0.01)).toBeNull();
  });
});

describe("subscribeLiquidations — garde anti-course OKX (cb après unsubscribe)", () => {
  /** WebSocket mocké minimal (déclencheurs manuels), même style que wsLoop.test.ts. */
  class MockWebSocket {
    static instances: MockWebSocket[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    closed = false;
    constructor(public url: string) {
      MockWebSocket.instances.push(this);
    }
    send(): void {}
    close(): void {
      if (this.closed) return;
      this.closed = true;
      this.onclose?.();
    }
    ouvrir(): void {
      this.onopen?.();
    }
    envoyer(data: string): void {
      this.onmessage?.({ data });
    }
  }

  /** Résout le fetch ctVal DIFFÉRÉ (le test le déclenche APRÈS l'unsubscribe). */
  let resoudreCtVal: (() => void) | null = null;

  beforeEach(() => {
    MockWebSocket.instances = [];
    resoudreCtVal = null;
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
    // fetch ctVal en vol tant que le test ne le résout pas (simule la latence réseau).
    vi.stubGlobal("fetch", () =>
      new Promise((resolve) => {
        resoudreCtVal = () =>
          resolve({
            ok: true,
            json: () => Promise.resolve({ code: "0", data: [{ instId: "BTC-USDT-SWAP", ctVal: "0.01" }] }),
          } as Response);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resoudreCtVal = null;
  });

  it("liq OKX bufferisée + unsubscribe avant résolution du ctVal → cb PAS appelé après", async () => {
    const cb = vi.fn();
    const stop = subscribeLiquidations("BTCUSDT", cb);

    // L'agrégateur ouvre Bybit + OKX ; on pilote la socket OKX (repérée par son URL).
    const okx = MockWebSocket.instances.find((w) => w.url.includes("okx"));
    expect(okx).toBeDefined();
    okx?.ouvrir();
    // Liquidation OKX de notre instId AVANT que le ctVal soit connu → bufferisée + fetch en vol.
    okx?.envoyer(
      JSON.stringify({
        arg: { channel: "liquidation-orders", instType: "SWAP" },
        data: [
          {
            instId: "BTC-USDT-SWAP",
            details: [{ posSide: "long", side: "sell", bkPx: "65000", sz: "20", ts: "1" }],
          },
        ],
      }),
    );
    expect(typeof resoudreCtVal).toBe("function"); // fetch ctVal bien déclenché

    stop(); // unsubscribe AVANT résolution du fetch (ex. changement de symbole)
    resoudreCtVal?.(); // le ctVal résout maintenant → .then(rejouer) s'exécuterait

    // Laisse dérouler la chaîne fetch → json → then/finally (microtâches + macrotâche).
    await new Promise((r) => setTimeout(r, 0));

    // Garde anti-course : rien ne doit être rejoué dans le feed après l'unsubscribe.
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("resumerLiquidations", () => {
  it("agrège le notionnel long/short et la part longue", () => {
    const liqs: Liquidation[] = [
      { time: 1, side: "long", qty: 1, price: 100, notionalUsd: 100, venue: "bybit" },
      { time: 2, side: "long", qty: 1, price: 200, notionalUsd: 200, venue: "okx" },
      { time: 3, side: "short", qty: 1, price: 100, notionalUsd: 100, venue: "bybit" },
    ];
    expect(resumerLiquidations(liqs)).toEqual({ longUsd: 300, shortUsd: 100, total: 400, partLong: 0.75 });
  });
  it("part longue = null si aucune liquidation", () => {
    expect(resumerLiquidations([]).partLong).toBeNull();
  });
});
