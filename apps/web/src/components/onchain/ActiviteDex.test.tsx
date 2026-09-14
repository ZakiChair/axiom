import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VueActiviteDex } from "./ActiviteDex";

describe("section Activité DEX de CHAIN", () => {
  it("volume DEX 24 h, variation 7 j, part du volume total et provenance", () => {
    const html = renderToStaticMarkup(
      <VueActiviteDex
        resultat={{
          ts: Date.UTC(2026, 8, 14),
          perime: false,
          donnee: {
            dex24h: 6.76e9,
            dex7d: 7.06e10,
            change7dPct: -29.92,
            totalVolume24h: 63.2e9,
            serie: [
              { time: Date.UTC(2026, 8, 12), value: 6e9 },
              { time: Date.UTC(2026, 8, 13), value: 6.76e9 },
            ],
          },
        }}
      />,
    );
    expect(html).toContain("$6.76B");
    expect(html).toContain("-29.92%");
    expect(html).toContain("10.7 %");
    expect(html).toContain("$63.20B");
    expect(html).toContain("DefiLlama");
    expect(html).toContain("CoinGecko");
    expect(html).toContain("<svg");
  });

  it("sans total CoinGecko : part absente, aucune valeur inventée", () => {
    const html = renderToStaticMarkup(
      <VueActiviteDex
        resultat={{ ts: 1, perime: true, donnee: { dex24h: 1e9, dex7d: null, change7dPct: null, totalVolume24h: null, serie: [] } }}
      />,
    );
    expect(html).toContain("$1.00B");
    expect(html).toContain("total 24 h indisponible");
    expect(html).not.toContain(" %</span>");
    expect(html).toContain("périmé");
  });

  it("résultat nul : message d'indisponibilité", () => {
    const html = renderToStaticMarkup(<VueActiviteDex resultat={null} />);
    expect(html).toContain("Activité DEX indisponible");
  });
});
