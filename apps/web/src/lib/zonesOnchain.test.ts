import { describe, expect, it } from "vitest";
import { zoneMvrvZ, zoneNupl, zonePourMetrique, zoneSopr } from "./zonesOnchain";

describe("zoneMvrvZ", () => {
  it("froid / neutre / chaud / surchauffe", () => {
    expect(zoneMvrvZ(-0.5)).toEqual({ libelle: "froid", ton: "up" });
    expect(zoneMvrvZ(1.5)).toEqual({ libelle: "neutre", ton: "neutre" });
    expect(zoneMvrvZ(3)).toEqual({ libelle: "chaud", ton: "warn" });
    expect(zoneMvrvZ(7)).toEqual({ libelle: "surchauffe", ton: "down" });
  });
});

describe("zoneSopr", () => {
  it("pivot à 1", () => {
    expect(zoneSopr(0.98)).toEqual({ libelle: "capitulation", ton: "down" });
    expect(zoneSopr(1.01)).toEqual({ libelle: "profit", ton: "neutre" });
  });
});

describe("zoneNupl", () => {
  it("5 zones canoniques", () => {
    expect(zoneNupl(-0.1)).toEqual({ libelle: "capitulation", ton: "down" });
    expect(zoneNupl(0.1)).toEqual({ libelle: "espoir", ton: "neutre" });
    expect(zoneNupl(0.3)).toEqual({ libelle: "optimisme", ton: "neutre" });
    expect(zoneNupl(0.6)).toEqual({ libelle: "croyance", ton: "warn" });
    expect(zoneNupl(0.8)).toEqual({ libelle: "euphorie", ton: "down" });
  });
});

describe("zonePourMetrique", () => {
  it("route par id BG et rejette l'inconnu / non fini", () => {
    expect(zonePourMetrique("mvrv", 3.5)?.libelle).toBe("chaud");
    expect(zonePourMetrique("sopr", 0.9)?.libelle).toBe("capitulation");
    expect(zonePourMetrique("nupl", 0.8)?.libelle).toBe("euphorie");
    expect(zonePourMetrique("puell", 1)).toBeNull();
    expect(zonePourMetrique("mvrv", Number.NaN)).toBeNull();
    expect(zonePourMetrique("mvrv", null)).toBeNull();
  });
});
