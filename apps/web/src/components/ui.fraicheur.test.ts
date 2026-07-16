import { describe, expect, it } from "vitest";
import { texteFraicheur } from "./ui";

const NOW = 1_700_000_000_000;

describe("texteFraicheur — la ligne de fraîcheur standard", () => {
  it("chargement → « maj… »", () => {
    expect(texteFraicheur(true, NOW - 5_000, NOW)).toBe("maj…");
  });
  it("timestamp connu → « maj il y a X »", () => {
    expect(texteFraicheur(false, NOW - 12_000, NOW)).toBe("maj il y a 12 s");
  });
  it("sans timestamp mais cadence connue → « maj ~cadence »", () => {
    expect(texteFraicheur(false, null, NOW, "1 min")).toBe("maj ~1 min");
  });
  it("ni timestamp ni cadence → « — »", () => {
    expect(texteFraicheur(false, null, NOW)).toBe("—");
  });
});
