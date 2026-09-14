import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ModelesPrix } from "../../data/modelesPrix";
import { VueModelesPrix } from "./ModelesPrix";

const jour = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

/** Plus bas quotidien depuis l'ATH (tuile « Repli max depuis l'ATH ») au 2026-09-13. */
const PLUS_BAS_2026 = jour("2026-06-30");

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
    const html = renderToStaticMarkup(<VueModelesPrix modeles={modelesReels()} plusBasMs={PLUS_BAS_2026} />);
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
    // Contexte tiré des épisodes : signal 2022 présent, aucun épisode près du plus bas depuis l'ATH.
    expect(html).toContain("celui de 2022 précédait le creux de 4 mois");
    expect(html).toContain("le plus bas du 2026-06-30 n&#x27;a pas été signalé");
    // Honnêteté : proxy, plancher rompu en 2022-23, aucune prévision, pas de bande 5×.
    expect(html).toContain("proxy");
    expect(html).toContain("250 j");
    expect(html).toContain("ne prévoit");
    expect(html).not.toContain("5×");
  });

  it("sans modèles : « — » partout, aucun chiffre ni signal inventé", () => {
    const html = renderToStaticMarkup(<VueModelesPrix modeles={null} plusBasMs={PLUS_BAS_2026} />);
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
    const html = renderToStaticMarkup(<VueModelesPrix modeles={m} plusBasMs={PLUS_BAS_2026} />);
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
    const html = renderToStaticMarkup(<VueModelesPrix modeles={m} plusBasMs={PLUS_BAS_2026} />);
    expect(html).toContain("Prix / SMA 2 ans 0.87");
    expect(html).toContain("228 j en dessous");
    expect(html).not.toContain("pct");
    expect(html).not.toContain("NaN");
  });

  it("note Pi : clause du plus bas retirée si un épisode tombe à 30 j ou moins du plus bas depuis l'ATH", () => {
    const m = modelesReels();
    const episodes = m.piCycleBottom!.episodes;
    // Épisode entré 5 j après le plus bas (fixture e2e) : le plus bas est signalé.
    const apres = { ...m.piCycleBottom!, episodes: [...episodes, { entreeMs: jour("2026-07-05"), prixEntree: 61_000, sortieMs: jour("2026-08-27") }] };
    const html = renderToStaticMarkup(<VueModelesPrix modeles={{ ...m, piCycleBottom: apres }} plusBasMs={PLUS_BAS_2026} />);
    expect(html).toContain("n = 4 signaux");
    expect(html).not.toContain("a pas été signalé");
    // Plus bas au milieu d'un épisode ouvert avant lui : signalé aussi.
    const ouvert = { ...m.piCycleBottom!, episodes: [...episodes, { entreeMs: jour("2026-03-01"), prixEntree: 70_000, sortieMs: null }] };
    const html2 = renderToStaticMarkup(<VueModelesPrix modeles={{ ...m, piCycleBottom: ouvert }} plusBasMs={PLUS_BAS_2026} />);
    expect(html2).not.toContain("a pas été signalé");
    // Épisode sorti plus de 30 j avant le plus bas : non signalé.
    const loin = { ...m.piCycleBottom!, episodes: [...episodes, { entreeMs: jour("2026-03-01"), prixEntree: 70_000, sortieMs: jour("2026-05-30") }] };
    const html3 = renderToStaticMarkup(<VueModelesPrix modeles={{ ...m, piCycleBottom: loin }} plusBasMs={PLUS_BAS_2026} />);
    expect(html3).toContain("le plus bas du 2026-06-30 n&#x27;a pas été signalé");
  });

  it("note Pi : sans plus bas sous l'ATH ni épisode 2022, aucune clause écrite en dur", () => {
    const m = modelesReels();
    m.piCycleBottom = { ...m.piCycleBottom!, episodes: m.piCycleBottom!.episodes.filter((e) => new Date(e.entreeMs).getUTCFullYear() !== 2022) };
    const html = renderToStaticMarkup(<VueModelesPrix modeles={m} plusBasMs={null} />);
    expect(html).toContain("n = 2 signaux");
    expect(html).not.toContain("celui de 2022");
    expect(html).not.toContain("creux");
    expect(html).not.toContain("plus bas");
  });
});
