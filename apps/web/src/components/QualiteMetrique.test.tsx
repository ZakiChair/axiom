import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QualiteMetrique } from "./QualiteMetrique";

afterEach(() => vi.useRealTimers());

describe("QualiteMetrique", () => {
  it("à la réouverture après sept jours, affiche périmé et garde l'acquisition en UTC", () => {
    vi.useFakeTimers();
    const ts = Date.UTC(2026, 8, 9, 12, 30);
    const qualite = {
      sourceId: "test", sourceEffective: "Source quotidienne", observeLe: ts, recupereLe: ts,
      cadenceMs: 86_400_000, ageMaxMs: 3 * 86_400_000, couverture: null,
      estime: false, acces: "public" as const, statut: "frais" as const,
    };
    vi.setSystemTime(ts);
    expect(renderToStaticMarkup(<QualiteMetrique qualite={qualite} />)).toContain(">frais<");
    vi.setSystemTime(ts + 7 * 86_400_000);
    const html = renderToStaticMarkup(<QualiteMetrique qualite={qualite} />);
    expect(html).toContain(">perime<");
    expect(html).toContain("09/09/2026 12:30 UTC");
    expect(html).not.toContain(">frais<");
  });
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
