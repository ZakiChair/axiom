import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ModelesPrix } from "../../data/modelesPrix";
import { VueModelesPrix } from "./ModelesPrix";

const jour = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

/** Lectures réelles PriceUSD Coin Metrics au 2026-09-13 (cf. data/modelesPrix.test.ts). */
function modelesReels(): ModelesPrix {
  return {
    multiple200Semaines: {
      ratio: 1.1791,
      moyenne: 65_101.96,
      percentile: 20.18,
      premierMs: jour("2014-05-17"),
      sequence: { sens: "dessus", jours: 28, depuisMs: jour("2026-08-17") },
    },
    ratio2Ans: {
      ratio: 0.8701,
      moyenne: 88_221.24,
      percentile: 21.25,
      premierMs: jour("2012-07-16"),
      sequence: { sens: "dessous", jours: 228, depuisMs: jour("2026-01-29") },
    },
    piCycleBottom: {
      ratio: 1.0881,
      ecartPct: 8.81,
      ema150: 71_516.35,
      seuil: 65_725.01,
      episodes: [
        { entreeMs: jour("2015-01-14"), prixEntree: 175.64, sortieMs: jour("2015-09-28") },
        { entreeMs: jour("2018-12-16"), prixEntree: 3_195.41, sortieMs: jour("2019-05-09") },
        { entreeMs: jour("2022-07-13"), prixEntree: 20_155.53, sortieMs: jour("2023-03-16") },
      ],
    },
  };
}

describe("section Modèles de prix de CYCLE", () => {
  it("affiche le multiple 200 semaines, le ratio 2 ans et le Pi Cycle Bottom avec leurs séquences", () => {
    const html = renderToStaticMarkup(<VueModelesPrix modeles={modelesReels()} />);
    expect(html).toContain("Modèles de prix");
    expect(html).toContain("Multiple 200 semaines");
    expect(html).toContain("1.18");
    expect(html).toContain("pct 20");
    expect(html).toContain("28 j au-dessus");
    expect(html).toContain("Prix / SMA 2 ans 0.87");
    expect(html).toContain("228 j en dessous");
    expect(html).toContain("Pi Cycle Bottom");
    expect(html).toContain("+8.8%");
    expect(html).toContain("pas de signal");
    expect(html).toContain("dernier signal 2022-07-13");
    // Croisements historiques lus dans les données, avec leur nombre.
    expect(html).toContain("n = 3 signaux");
    expect(html).toContain("2015-01-14 → 2015-09-28");
    expect(html).toContain("2022-07-13 → 2023-03-16");
    // Honnêteté : proxy, plancher rompu en 2022-23, aucune prévision, pas de bande 5×.
    expect(html).toContain("proxy");
    expect(html).toContain("250 j");
    expect(html).toContain("ne prévoit");
    expect(html).not.toContain("5×");
  });

  it("sans modèles : « — » partout, aucun chiffre ni signal inventé", () => {
    const html = renderToStaticMarkup(<VueModelesPrix modeles={null} />);
    expect(html).toContain("Multiple 200 semaines");
    expect(html).toContain("Pi Cycle Bottom");
    expect(html.match(/—/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain("pct");
    expect(html).not.toContain("signal</span>");
    expect(html).not.toContain("n = ");
    expect(html).not.toContain(" j au-dessus");
    expect(html).not.toContain(" j en dessous");
  });

  it("signal en cours : badge « signal » et date d'entrée de l'épisode ouvert", () => {
    const m = modelesReels();
    m.piCycleBottom = {
      ...m.piCycleBottom!,
      ratio: 0.97,
      ecartPct: -3,
      episodes: [...m.piCycleBottom!.episodes, { entreeMs: jour("2026-10-01"), prixEntree: 60_000, sortieMs: null }],
    };
    const html = renderToStaticMarkup(<VueModelesPrix modeles={m} />);
    expect(html).toContain(">signal</span>");
    expect(html).not.toContain("pas de signal");
    expect(html).toContain("-3.0%");
    expect(html).toContain("signal depuis 2026-10-01");
    expect(html).toContain("2026-10-01 → en cours");
    expect(html).toContain("n = 4 signaux");
  });

  it("historique partiel : multiple 200 semaines absent, ratio 2 ans conservé, percentile NaN jamais affiché à 0", () => {
    const m = modelesReels();
    m.multiple200Semaines = null;
    m.ratio2Ans = { ...m.ratio2Ans!, percentile: Number.NaN };
    const html = renderToStaticMarkup(<VueModelesPrix modeles={m} />);
    expect(html).toContain("Prix / SMA 2 ans 0.87");
    expect(html).toContain("228 j en dessous");
    expect(html).not.toContain("pct");
    expect(html).not.toContain("NaN");
  });
});
