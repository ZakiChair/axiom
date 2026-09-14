import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VueMineurs } from "./Mineurs";

const JOUR = 86_400_000;
const debut = Date.UTC(2026, 5, 1);
const serie = (valeurs: number[]) => valeurs.map((value, i) => ({ time: debut + i * JOUR, value }));

describe("section Mineurs de CHAIN", () => {
  it("affiche une capitulation, le hashprice en $/PH/j et la provenance", () => {
    // 60 jours à 800 EH/s puis 30 jours à 500 EH/s : la SMA 30 passe sous la SMA 60.
    const hashrate = serie([...Array(60).fill(800e18), ...Array(30).fill(500e18)]);
    // Revenus constants 40 M$/j : hashprice 50 $/PH/j sur le plateau, 80 $/PH/j après la chute.
    const revenus = serie(Array(90).fill(40e6));
    const html = renderToStaticMarkup(
      <VueMineurs hashrate={{ points: hashrate, dernier: hashrate.at(-1) }} revenus={{ donnee: revenus, ts: debut + 90 * JOUR, perime: false }} />,
    );
    expect(html).toContain("Capitulation");
    expect(html).toContain("croisement baissier le");
    expect(html).toContain("80.00 $/PH/j");
    expect(html).toContain("revenus / j $40.00M");
    expect(html).toContain("blockchain.info");
    expect(html).toContain("<svg");
  });

  it("sans revenus : rubans seuls, message d'indisponibilité, aucun dollar inventé", () => {
    const hashrate = serie(Array(70).fill(800e18));
    const html = renderToStaticMarkup(<VueMineurs hashrate={{ points: hashrate }} revenus={null} />);
    expect(html).toContain("Expansion");
    expect(html).toContain("Revenus mineurs indisponibles");
    expect(html).not.toContain("$/PH/j</span>");
    expect(html).not.toContain("<svg");
  });

  it("sans hashrate : tuiles vides, pas d'état inventé", () => {
    const html = renderToStaticMarkup(<VueMineurs hashrate={null} revenus={null} loading />);
    expect(html).toContain("Chargement des revenus mineurs");
    expect(html).not.toContain("Capitulation");
    expect(html).not.toContain("Expansion");
  });
});
