import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DeltaOi, enTeteDeltaOi, formatDeltaContrats } from "./DeltaOi";
import { calculerDeltaOi, construireInstantaneOi, topStrikesDeltaOi, type ReferencesOi } from "../../data/deltaOiStrikes";
import type { OptionPoint } from "../../data/deribit";

const NOW = Date.parse("2026-11-07T10:00:00Z");
const E1 = Date.parse("2026-11-14T08:00:00Z");

function opt(strike: number, type: "call" | "put", openInterest: number): OptionPoint {
  return { instrument: `${strike}-${type}`, expiryMs: E1, strike, type, markIv: 50, openInterest, underlying: 100_000, indexPrice: 100_000, interestRate: 0, volume24h: 0, markPrice: 0.01 };
}

const ref = construireInstantaneOi([opt(100_000, "call", 300), opt(95_000, "put", 120)], Date.parse("2026-11-06T08:42:00Z"));
const resultat = calculerDeltaOi([opt(100_000, "call", 250), opt(95_000, "put", 150), opt(115_000, "call", 25)], ref, 100_000, NOW)!;
const refs: ReferencesOi = { j1: ref, j7: null, jourJ1: "2026-11-06", jourJ7: "2026-10-31", joursLocaux: ["2026-11-06", "2026-11-07"], daemon: false };

describe("DeltaOi", () => {
  it("affiche toujours la date de référence, le top 5 et les instruments nouveaux, sans libellé directionnel", () => {
    const html = renderToStaticMarkup(
      <DeltaOi devise="BTC" choix="j1" refs={refs} resultat={resultat} top={topStrikesDeltaOi(resultat, E1)} expiryMs={E1} />,
    );
    expect(html).toContain("Δ depuis le 06/11 08:42 UTC (J-1)");
    expect(html).toContain("Construits · OI en hausse");
    expect(html).toContain("Vidés · OI en baisse");
    expect(html).toContain("+30.0 BTC");
    expect(html).toContain("−50.0 BTC");
    expect(html).toContain("−$5.00M");
    expect(html).toContain("nouveau");
    expect(html).toContain("06/11, 07/11");
    expect(html).toContain("Instantanés dans ce navigateur");
    expect(html).toContain("ce navigateur seulement");
    expect(html).not.toMatch(/haussi|baissi|bullish|bearish|achet|vend/i);
  });

  it("référence absente : état explicite avec le jour attendu, aucun top 5", () => {
    const html = renderToStaticMarkup(<DeltaOi devise="ETH" choix="j7" refs={refs} resultat={null} top={null} expiryMs={E1} />);
    expect(html).toContain("Aucun instantané du 31/10 (J-7) : ΔOI non mesuré.");
    expect(html).not.toContain("Top 5");
  });

  it("en-tête pendant la lecture des instantanés, format des Δ", () => {
    expect(enTeteDeltaOi("j1", null, null)).toBe("Lecture des instantanés…");
    expect(formatDeltaContrats(12.34)).toBe("+12.3");
    expect(formatDeltaContrats(-3)).toBe("−3.0");
    expect(formatDeltaContrats(0)).toBe("0.0");
    expect(formatDeltaContrats(null)).toBe("—");
  });
});
