import { afterEach, describe, expect, it, vi } from "vitest";
import { createFredM2Provider } from "./fred";

/** Capture l'URL appelée et renvoie une réponse FRED minimale valide. */
function stubFetch(): { urls: string[] } {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      urls.push(url);
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () =>
          Promise.resolve({
            observations: [
              { date: "2026-06-01", value: "2.9" },
              { date: "2026-07-01", value: "3.3" },
              { date: "2026-08-01", value: "." }, // valeur manquante FRED
            ],
          }),
      });
    }),
  );
  return { urls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createFredM2Provider", () => {
  it("transmet units quand il est fourni", async () => {
    const { urls } = stubFetch();
    await createFredM2Provider("CPIAUCSL", "pc1").fetchSeries();
    expect(urls[0]).toContain("series_id=CPIAUCSL");
    expect(urls[0]).toContain("units=pc1");
  });

  // NON-RÉGRESSION : M2 (MacroIndicators) et NETLIQ appellent ce fournisseur SANS units.
  // Leur URL doit rester bit-à-bit celle d'avant l'ajout du paramètre.
  it("n'ajoute aucun paramètre units quand il est omis", async () => {
    const { urls } = stubFetch();
    await createFredM2Provider("WM2NS").fetchSeries();
    expect(urls[0]).not.toContain("units");
    expect(urls[0]).toBe("/fredapi/fred/series/observations?series_id=WM2NS&file_type=json");
  });

  it("écarte les valeurs manquantes « . » et convertit les dates en ms UTC", async () => {
    stubFetch();
    const serie = await createFredM2Provider("CPIAUCSL", "pc1").fetchSeries();
    expect(serie).toEqual([
      { time: Date.UTC(2026, 5, 1), value: 2.9 },
      { time: Date.UTC(2026, 6, 1), value: 3.3 },
    ]);
  });

  it("porte un identifiant distinct par série", () => {
    expect(createFredM2Provider("CPIAUCSL", "pc1").id).toBe("fred-cpiaucsl");
  });
});
