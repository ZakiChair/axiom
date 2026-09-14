import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { OiPerpsDex } from "../data/onchain/oiPerpsDex";
import { SectionOiPerpsDex, VueOiPerpsDex } from "./OiPerpsDexSection";

const donnee: OiPerpsDex = {
  niveau: 23_248_981_545,
  observation: Date.UTC(2026, 8, 14),
  delta7jPct: -2.64,
  delta30jPct: 27.48,
  partHyperliquidPct: 59.4,
  record: { valeur: 26_552_157_325, time: Date.UTC(2025, 9, 5) },
  serie: [
    { time: Date.UTC(2026, 8, 13), value: 23.1e9 },
    { time: Date.UTC(2026, 8, 14), value: 23_248_981_545 },
  ],
};

describe("section OI perps DEX de DES", () => {
  it("niveau, Δ7j / Δ30j, part d'Hyperliquid, record daté, courbe, provenance et limites", () => {
    const html = renderToStaticMarkup(<VueOiPerpsDex resultat={{ ts: Date.UTC(2026, 8, 14, 18), perime: false, donnee }} />);
    expect(html).toContain("$23.25B");
    expect(html).toContain("-2.6%");
    expect(html).toContain("+27.5%");
    expect(html).toContain("59.4 %");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain("$26.55B");
    expect(html).toContain("2025-10-05");
    expect(html).toContain("-12.4%");
    expect(html).toContain("<svg");
    expect(html).toContain("DefiLlama");
    expect(html).toContain("quotidien · DefiLlama");
    expect(html).toContain("tous actifs");
    expect(html).toContain("marchés prédictifs");
    expect(html).toContain("+29 %");
    expect(html).toContain("jour UTC en cours");
    expect(html).toContain("révisable");
    expect(html).not.toContain("périmé");
  });

  it("part d'Hyperliquid et variations absentes : « — », aucune valeur ni barre inventée", () => {
    const html = renderToStaticMarkup(
      <VueOiPerpsDex
        resultat={{
          ts: 1,
          perime: true,
          donnee: { ...donnee, partHyperliquidPct: null, delta7jPct: null, delta30jPct: null },
        }}
      />,
    );
    expect(html).not.toContain("59.4");
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain("-2.6%");
    expect(html).toContain("—");
    expect(html).toContain("périmé");
  });

  it("résultat nul : chargement puis indisponibilité explicite", () => {
    expect(renderToStaticMarkup(<VueOiPerpsDex resultat={null} loading />)).toContain("Chargement");
    expect(renderToStaticMarkup(<VueOiPerpsDex resultat={null} />)).toContain("OI perps DEX indisponible");
  });

  it("section repliée par défaut : bouton seul, aucun contenu", () => {
    const html = renderToStaticMarkup(<SectionOiPerpsDex />);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("OI perps DEX (quotidien, tous actifs)");
    expect(html).not.toContain("indisponible");
  });
});
