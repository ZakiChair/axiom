import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QualiteMetrique } from "./QualiteMetrique";

describe("QualiteMetrique", () => {
  it("rend visibles provenance, dates, couverture, accès et motif partiel", () => {
    const html = renderToStaticMarkup(<QualiteMetrique qualite={{
      sourceId: "cm",
      sourceEffective: "cache Coin Metrics",
      observeLe: Date.UTC(2026, 8, 8),
      recupereLe: Date.UTC(2026, 8, 9),
      cadenceMs: 86_400_000,
      couverture: { disponibles: 18, attendus: 20 },
      estime: false,
      acces: "public",
      statut: "partiel",
      raison: "Deux jours absents",
    }} />);
    expect(html).toContain("cache Coin Metrics");
    expect(html).toContain("observé");
    expect(html).toContain("récupéré");
    expect(html).toContain("18/20");
    expect(html).toContain("public");
    expect(html).toContain("Deux jours absents");
  });
});
