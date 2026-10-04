import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SectionCot } from "./SectionCot";
import { assemblerCategorie } from "../../store/cot";

describe("mini résumé BRIEF COT", () => {
  it("rend les mouvements compensés même lorsque Δ net est nul, et date l'instrument", () => {
    const resume = assemblerCategorie({ legacy: ["2026-06-09", "2026-06-23"].map((date, i) => ({
      market_and_exchange_names: "GOLD - COMMODITY EXCHANGE INC.",
      report_date_as_yyyy_mm_dd: date,
      noncomm_positions_long_all: i ? 120 : 100,
      noncomm_positions_short_all: i ? 70 : 50,
    })) }, "legacy");
    const ligne = resume.lignes.find((l) => !l.nonCouvert)!;
    const html = renderToStaticMarkup(<SectionCot cot={{
      lignes: [{ ligne, delta: 0 }], dateRapport: Date.parse("2026-06-30"),
    }} />);
    expect(html).toContain("Longs · acheteurs");
    expect(html).toContain("Shorts · vendeurs");
    expect(html.match(/Ajouts nets/g)).toHaveLength(2);
    expect(html.match(/\+20/g)).toHaveLength(2);
    expect(html).toContain("Δ net : 0 contrats");
    expect(html).toContain("vs 9 juin 2026 (14 jours)");
    expect(html).not.toContain("30 juin");
    expect(html).not.toContain("1 semaine");
    expect(html).toContain("pas des ouvertures / clôtures brutes");
  });

  it("un seul rapport affiche ses stocks sans faux flux nuls", () => {
    const ligne = assemblerCategorie({ legacy: [{
      market_and_exchange_names: "GOLD - COMMODITY EXCHANGE INC.",
      report_date_as_yyyy_mm_dd: "2026-06-23",
      noncomm_positions_long_all: 0, noncomm_positions_short_all: 0,
    }] }, "legacy").lignes.find((l) => !l.nonCouvert)!;
    const html = renderToStaticMarkup(<SectionCot cot={{ lignes: [{ ligne, delta: 0 }], dateRapport: ligne.dateRapport }} />);
    expect(html).toContain("Équilibré");
    expect(html.match(/Variation indisponible/g)).toHaveLength(2);
    expect(html).toContain("Δ net : — (indisponible)");
  });
});
