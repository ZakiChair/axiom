import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VueHistoriqueEtf } from "./HistoriqueEtf";
import { VueFilesStakingEth } from "./FilesStakingEth";
import { CohortesBtc } from "./CohortesBtc";
import { CourbeOnchain } from "./HistoriqueCommun";

describe("compléments CHAIN : unités et disponibilités", () => {
  it("une courbe quotidienne coupe les jours absents ; l'ETF autorise un week-end", () => {
    const points = [0, 1, 4, 10].map(i => ({ time: Date.UTC(2026, 8, i + 1), value: i + 1 }));
    const quotidien = renderToStaticMarkup(<CourbeOnchain points={points} label="Files" unite="ETH" />);
    const etf = renderToStaticMarkup(<CourbeOnchain points={points} label="Flux" unite="USD" ecartMaxJours={4} />);
    const chemin = (html: string) => html.match(/<path d="([^"]+)"/)?.[1] ?? "";
    expect(chemin(quotidien).match(/M/g)).toHaveLength(3);
    expect(chemin(etf).match(/M/g)).toHaveLength(2);
  });
  it("présente les séances ETF réelles et l'encours de leur date", () => {
    const html = renderToStaticMarkup(<VueHistoriqueEtf resultat={{ ts: Date.UTC(2026, 8, 7), perime: false,
      points: [{ time: Date.UTC(2026, 8, 4), fluxUsd: -10, encoursUsd: 100 }] }} />);
    expect(html).toContain("5 séances");
    expect(html).toContain("20 séances");
    expect(html).toContain("Historique insuffisant");
    expect(html).toContain("Flux / encours du jour");
    expect(html).toContain("-10.00 %");
    expect(html).toContain("SoSoValue");
    expect(html).toContain("séances publiées · SoSoValue");
    expect(html).toContain("2026-09-04");
  });
  it("un repli ETF BTC ne se présente jamais comme des dollars", () => {
    const html = renderToStaticMarkup(<VueHistoriqueEtf resultat={{ points: [], ts: 0, perime: true, raison: "Clé absente" }}
      repliBtc={{ ts: 1, perime: true, serie: { points: Array.from({ length: 5 }, (_, i) => ({ time: Date.UTC(2026, 8, i + 1), value: 2 })) } }} />);
    expect(html).toContain("10.00 BTC");
    expect(html).toContain("BGeometrics");
    expect(html).toContain("Aucun ratio USD");
    expect(html).not.toContain("10 $");
  });
  it("les files post-Pectra restent en ETH, avec observation quotidienne et cache périmé", () => {
    const html = renderToStaticMarkup(<VueFilesStakingEth resultat={{ ts: Date.UTC(2026, 8, 7), perime: true,
      points: [{ time: Date.UTC(2026, 8, 6), entreeEth: 100, sortieEth: 0, attenteEntreeJours: 2, attenteSortieJours: 0,
        stakeEth: 4000, stakePct: 30, aprPct: 2.6 }] }} />);
    expect(html).toContain("100.00 ETH");
    expect(html).toContain("0.00 ETH");
    expect(html).toContain("2.00 j");
    expect(html).toContain("Observation quotidienne");
    expect(html).toContain("périmé");
    expect(html).toContain("ValidatorQueue");
    expect(html).toContain("quotidien · ValidatorQueue");
    expect(html).not.toContain("3 200 ETH");
  });
  it("les nouvelles métriques BTC attendent une sélection explicite", () => {
    const html = renderToStaticMarkup(<CohortesBtc open={true} />);
    expect(html).toContain("Charger un groupe");
    expect(html).toContain("Cohortes");
    expect(html).not.toContain("<svg");
  });
});
