import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { EtfResultat } from "../../data/onchain/etf";
import { formatEntier } from "../../lib/format";
import { TableauEtfFonds } from "./TableauEtfFonds";

// Valeurs d'une réponse réelle du 2026-09-15 (us-btc-spot), déjà parsées : fractions ×100.
// ARKB volontairement réduit à « emetteur + flux » : champs non publiés (ou cache antérieur).
const RESULTAT: EtfResultat = {
  disponible: true,
  jour: "2026-09-15",
  parEmetteur: [
    { emetteur: "FBTC", flux: -214_754_800, encoursUsd: 13_194_434_472.83, partCapitalisationPct: 0.865117,
      cumulUsd: 10_120_528_736.95, volumeUsd: 425_269_700, primeDecotePct: 0.18401928, fraisPct: 0 },
    { emetteur: "IBIT", flux: -161_691_280, encoursUsd: 59_584_956_800, partCapitalisationPct: 3.906797,
      cumulUsd: 63_976_600_063.66, volumeUsd: 3_328_760_000, primeDecotePct: 0.2488198, fraisPct: 0.25 },
    { emetteur: "ARKB", flux: -17_381_727.21 },
  ],
  total: -393_827_807.21,
  encoursTotalUsd: 95_716_988_283.25,
  partCapitalisationTotalePct: 6.275858,
  avoirsTotal: 1_260_520.2,
  volumeTotalUsd: 4_346_558_481.4,
  cumulTotalUsd: 54_885_848_662.93,
};
const rendu = (props: Parameters<typeof TableauEtfFonds>[0]) => renderToStaticMarkup(<TableauEtfFonds {...props} />);

describe("tableau ETF spot par fonds de CHAIN", () => {
  it("quatre colonnes, tri de parEmetteur conservé, pourcentages ×100 formatés, infobulle par ligne", () => {
    const html = rendu({ etf: RESULTAT, actif: "btc" });
    for (const entete of ["Fonds", "Flux jour", "Prime/décote", "Encours"]) expect(html).toContain(entete);
    expect(html.indexOf("FBTC")).toBeLessThan(html.indexOf("IBIT"));
    expect(html.indexOf("IBIT")).toBeLessThan(html.indexOf("ARKB"));
    expect(html).toMatch(/IBIT<\/span><span[^>]*>−\$161\.69M<\/span><span[^>]*>\+0\.25%<\/span><span[^>]*>\$59\.58B<\/span>/);
    expect(html).toContain("+0.18%");
    expect(html).toContain("$13.19B");
    expect(html).toContain('title="3.91 % de la capitalisation BTC · cumul $63.98B · volume $3.33B · frais 0.25 %"');
    // Frais réellement nuls : affichés, pas remplacés par un tiret.
    expect(html).toContain("frais 0.00 %");
    // Pied : cumul du jour (total existant) puis ligne globale.
    expect(html).toContain("Cumul 2026-09-15");
    expect(html).toContain("−$393.83M");
    expect(html).toContain("Encours total");
    expect(html).toContain("$95.72B · avoirs 1.26M BTC · 6.28 % de la capitalisation");
    // Avoirs exacts en infobulle (formatEntier : espaces fines fr-FR), compacts dans la ligne.
    expect(html).toContain(`title="cumul $54.89B · volume $4.35B · avoirs ${formatEntier(1_260_520.2)} BTC"`);
  });

  it("valeur absente → « — », jamais 0 ; aucune infobulle vide", () => {
    const html = rendu({ etf: RESULTAT, actif: "btc" });
    expect(html).toMatch(/ARKB<\/span><span[^>]*>−\$17\.38M<\/span><span[^>]*>—<\/span><span[^>]*>—<\/span>/);
    expect(html).not.toContain("$0.00");
    expect(html).not.toContain("+0.00%");
    expect(html).not.toContain('title=""');
    expect(html).toMatch(/<div[^>]*class="[^"]*"[^>]*><span[^>]*>ARKB/);
    expect(html).not.toMatch(/<div[^>]*title=[^>]*><span[^>]*>ARKB/);
  });

  it("cache antérieur sans les nouveaux champs : tableau et cumul seuls, pas de ligne globale", () => {
    const html = rendu({
      etf: { disponible: true, jour: "2026-09-14", parEmetteur: [{ emetteur: "ETHA", flux: 5_000_000 }], total: 5_000_000 },
      actif: "eth",
    });
    expect(html).toContain("ETHA");
    expect(html).toContain("$5.00M");
    expect(html).toContain("Cumul 2026-09-14");
    expect(html).not.toContain("Encours total");
    expect(html).not.toContain("title=");
  });

  it("globaux partiels : ligne globale avec « — » sur les segments absents, unité de l'actif", () => {
    const html = rendu({
      etf: { disponible: true, parEmetteur: [{ emetteur: "ETHA", flux: 1 }], total: 1, avoirsTotal: 6_500_000 },
      actif: "eth",
    });
    expect(html).toContain("Encours total");
    expect(html).toContain("— · avoirs 6.50M ETH · — de la capitalisation");
  });
});
