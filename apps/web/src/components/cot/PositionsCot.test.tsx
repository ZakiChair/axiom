import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { LigneCot } from "../../data/cot";
import { GuidePositionsCot, NetCot, PositionsCot } from "./PositionsCot";

const ligne: LigneCot = {
  nom: "or", libelle: "Or", categorie: "metal", net: 0, delta: 0,
  longs: 100, shorts: 100, openInterest: 1000, dateRapport: 2000,
  serie: [
    { t: 1000, net: 0, oi: 1000, longs: 100, shorts: 100 },
    { t: 2000, net: 0, oi: 1000, longs: 100, shorts: 100 },
  ],
};

describe("colonnes de positions COT", () => {
  it("explique les variations sans raccourci directionnel ni flux brut observé", () => {
    const html = renderToStaticMarkup(<GuidePositionsCot />);
    expect(html).toContain("Δ net = Δ longs − Δ shorts");
    expect(html).not.toContain("Il monte si");
    expect(html).toContain("plus d&#x27;ouvertures que de clôtures");
    expect(html).toContain("changements de classement possibles");
    expect(html).toContain("flux bruts peuvent se compenser et restent inconnus");
    expect(html).toContain("servir de couverture, pas une prévision de prix");
  });

  it("des ajouts longs +20 et shorts +30 réduisent le net de 10", () => {
    const oppose: LigneCot = {
      ...ligne, longs: 120, shorts: 130, net: -10, delta: -10,
      serie: [ligne.serie[0]!, { t: 2000, net: -10, oi: 1000, longs: 120, shorts: 130 }],
    };
    const html = renderToStaticMarkup(<><PositionsCot ligne={oppose} /><NetCot ligne={oppose} /></>);
    expect(html).toContain("+20");
    expect(html).toContain("+30");
    expect(html).toContain("Net vendeur : −10 contrats · Δ net : −10 contrats");
  });

  it("stocks identiques : deux Inchangé et Δ net 0, sans faux ajout/clôture", () => {
    const html = renderToStaticMarkup(<><PositionsCot ligne={ligne} /><NetCot ligne={ligne} /></>);
    expect(html.match(/Inchangé/g)).toHaveLength(2);
    expect(html.match(/0<\/strong> contrats/g)).toHaveLength(2);
    expect(html).toContain("Équilibré : 0 contrats");
    expect(html).not.toContain("Ajouts nets");
    expect(html).not.toContain("fermés");
  });

  it("une absence ne masque pas le côté connu et ne devient pas zéro", () => {
    const html = renderToStaticMarkup(<PositionsCot ligne={{ ...ligne, longs: undefined }} />);
    expect(html).toContain("Indisponible");
    expect(html).toContain("Variation indisponible");
    expect(html.match(/>100</g)).toHaveLength(1);
    expect(html.match(/Inchangé/g)).toHaveLength(1);
  });
});
