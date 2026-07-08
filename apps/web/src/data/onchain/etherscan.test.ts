import { describe, expect, it } from "vitest";
import { parseEthSupply, parseGasOracle, parseNodeCount } from "./etherscan";

describe("parseEthSupply", () => {
  it("convertit les wei en ETH", () => {
    expect(parseEthSupply({ status: "1", result: "120000000000000000000000000" })).toBeCloseTo(120_000_000, 0);
  });
  it("null sur échec", () => {
    expect(parseEthSupply({ status: "0" })).toBeNull();
  });
});

describe("parseGasOracle", () => {
  it("parse les 3 niveaux de gas", () => {
    const json = { status: "1", result: { SafeGasPrice: "10", ProposeGasPrice: "12", FastGasPrice: "15" } };
    expect(parseGasOracle(json)).toEqual({ safe: 10, propose: 12, fast: 15 });
  });
  it("null sur échec", () => {
    expect(parseGasOracle({ status: "0" })).toBeNull();
  });
});

describe("parseNodeCount", () => {
  it("parse le nombre de nœuds", () => {
    expect(parseNodeCount({ status: "1", result: { TotalNodeCount: "8500" } })).toBe(8500);
  });
  it("null sur forme inconnue", () => {
    expect(parseNodeCount({})).toBeNull();
  });
});
