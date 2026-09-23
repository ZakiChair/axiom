import { describe, expect, it } from "vitest";
import { normaliserIdentiteFunding } from "./fundingIdentity";

describe("identité commune du funding historique", () => {
  it("BTCUSDT et le perp natif HL BTC-PERP désignent la même base et les mêmes CEX", () => {
    const spot = normaliserIdentiteFunding("binance", "BTCUSDT");
    const perp = normaliserIdentiteFunding("hyperliquid", "BTC-PERP");
    expect(perp).toEqual(spot);
    expect(perp).toEqual({ base: "BTC", cexSymbol: "BTCUSDT", okxInstId: "BTC-USDT-SWAP" });
  });

  it("refuse les quotes différentes, synthétiques et noms perp d'autres sources", () => {
    expect(normaliserIdentiteFunding("binance", "BTCUSD")).toBeNull();
    expect(normaliserIdentiteFunding("coinbase", "BTC-PERP")).toBeNull();
    expect(normaliserIdentiteFunding("synthetic", "BTCUSDT")).toBeNull();
    expect(normaliserIdentiteFunding("synthetic", "BTC-PERP")).toBeNull();
    expect(normaliserIdentiteFunding("hyperliquid", "BTC/USDT")).toBeNull();
    expect(normaliserIdentiteFunding("hyperliquid", "BTCUSDT|ETHUSDT")).toBeNull();
  });

  it("ne fabrique aucun alias de multiplicateur HL vers un contrat CEX différent", () => {
    const id = normaliserIdentiteFunding("hyperliquid", "KPEPE-PERP");
    expect(id?.cexSymbol).not.toBe("1000PEPEUSDT");
  });
});
