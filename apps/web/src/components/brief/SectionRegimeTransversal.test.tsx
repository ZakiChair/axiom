/**
 * Ligne BRIEF du régime transversal (rendu statique, env node) : valeurs formatées, mesure
 * absente affichée « non mesuré » (jamais 0), résumé périmé signalé, état sans résumé.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LIBELLE_LIEN_DETAIL, LigneRegime, SectionRegimeTransversal } from "./SectionRegimeTransversal";
import type { ResumeRegime } from "../../data/regimeTransversal";

const RESUME: ResumeRegime = {
  calculeA: Date.UTC(2026, 10, 7, 8, 0),
  jour: 20_398,
  univers: "Top 50 cap. CoinGecko (paires Binance USDT)",
  nAttendus: 49,
  nAlts: 47,
  dispersion7j: { valeur: 0.0312, nActifs: 47, centile: 40, nHistorique: 390 },
  medianeCorrBtc30j: null,
  corrMoyenne60j: { valeur: 0.612, nActifs: 45, centile: 80, nHistorique: 340 },
  absorption60j: { valeur: 0.641, nActifs: 45, centile: 82, nHistorique: 340 },
  plancherBruit60j: 0.0745,
};

describe("LigneRegime", () => {
  it("affiche les quatre mesures, « non mesuré » pour une mesure absente, le plancher du bruit", () => {
    const html = renderToStaticMarkup(<LigneRegime statut="pret" resume={RESUME} />);
    expect(html).toContain("3.12 % /j");
    expect(html).toContain("non mesuré");
    expect(html).toContain("0.61");
    expect(html).toContain("0.64");
    expect(html).toContain("bruit pur ≈ 0.07");
    expect(html).toContain("descriptif");
    expect(html).not.toContain("périmé");
  });

  it("échec de mesure avec un résumé ancien : affiché comme périmé", () => {
    const html = renderToStaticMarkup(<LigneRegime statut="erreur" resume={RESUME} />);
    expect(html).toContain("résumé périmé");
  });

  it("le lien de détail annonce qu'il bascule l'univers de CORR sur le Top 50 (libellé et infobulle)", () => {
    const html = renderToStaticMarkup(<SectionRegimeTransversal refreshToken={0} />);
    expect(LIBELLE_LIEN_DETAIL).toContain("bascule CORR sur Top 50");
    expect(html).toContain(`>${LIBELLE_LIEN_DETAIL}</button>`);
    expect(html).toContain("univers choisi dans CORR (watchlist ou autre top N) est remplacé");
  });

  it("aucun résumé : chargement puis erreur explicite", () => {
    expect(renderToStaticMarkup(<LigneRegime statut="chargement" resume={null} />)).toContain("Mesure du top 50");
    expect(renderToStaticMarkup(<LigneRegime statut="erreur" resume={null} />)).toContain("non mesuré");
  });
});
