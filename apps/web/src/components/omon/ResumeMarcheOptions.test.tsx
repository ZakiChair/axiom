import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ResumeMarcheOptions } from "./ResumeMarcheOptions";
import { resumerMarcheOptions } from "../../data/marcheOptions";

const now = Date.parse("2026-09-25T09:00:00Z");
const resume = resumerMarcheOptions([{
  instrument: "ETH-2OCT26-4000-C", expiryMs: Date.parse("2026-10-02T08:00:00Z"), strike: 4_000,
  type: "call", markIv: 50, openInterest: 25, underlying: 4_000, indexPrice: 4_000,
  interestRate: 0, volume24h: 1, markPrice: 0.05,
}], 4_000, now);
const props = { devise: "ETH" as const, resume, loading: false, erreur: null, majTs: now,
  observedAt: now - 2_000, nowMs: now, onRefresh: () => {} };

describe("résumé options", () => {
  it("distingue heure observée et réception, périmètre inverse Deribit et unités", () => {
    const html = renderToStaticMarkup(<ResumeMarcheOptions {...props} />);
    expect(html).toContain("$100.00K");
    expect(html).toContain("08:59:58 UTC");
    expect(html).toContain("09:00:00 UTC");
    expect(html).toContain("Options inverses Deribit uniquement");
    expect(html).toContain("GEX $/1 %");
    expect(html).toContain("DEX $");
    expect(html).toContain("100.0 %");
  });
  it("date reçue conservée après erreur et signalement de péremption", () => {
    const html = renderToStaticMarkup(<ResumeMarcheOptions {...props} nowMs={now + 600_000} erreur="Actualisation indisponible" />);
    expect(html).toContain("Dernier instantané conservé");
    expect(html).toContain("Instantané périmé");
    expect(html).toContain('dateTime="2026-09-25T09:00:00.000Z"');
    expect(html).toContain("$100.00K");
  });
  it("premier échec sans données : aucune valeur zéro ni tableau trompeur", () => {
    const html = renderToStaticMarkup(<ResumeMarcheOptions {...props} majTs={null} observedAt={null}
      resume={resumerMarcheOptions([], NaN, now)} erreur="Actualisation indisponible" />);
    expect(html).toContain("Données indisponibles");
    expect(html).not.toContain("$0");
    expect(html).not.toContain('role="table"');
  });
});
