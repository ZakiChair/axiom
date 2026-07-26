import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createDemoState } from "../data/demo";
import { analyseState } from "../domain/analyse";
import { createClaimCase } from "../domain/cases";
import { filterAnomalies, AnomaliesView } from "./AnomaliesView";

const NOW = new Date("2026-07-26T12:00:00.000Z");

describe("filterAnomalies", () => {
  it("conserve toutes les anomalies ou seulement la sévérité demandée", () => {
    const anomalies = analyseState(createDemoState(), NOW);

    expect(filterAnomalies(anomalies, "all")).toEqual(anomalies);
    expect(filterAnomalies(anomalies, "critical")).toEqual(
      anomalies.filter((anomaly) => anomaly.severity === "critical"),
    );
  });
});

describe("AnomaliesView", () => {
  it("rend les règles, la confiance, les preuves et le lien du dossier existant", () => {
    const state = createDemoState();
    const anomalies = analyseState(state, NOW);
    const linkedAnomaly = anomalies[0]!;
    const claim = createClaimCase(linkedAnomaly, state, NOW);
    const markup = renderToStaticMarkup(
      <AnomaliesView
        anomalies={anomalies}
        cases={[claim]}
        onDismissAnomaly={() => ({ ok: true, changed: 1 })}
        onOpenCase={() => ({ ok: true, changed: 1 })}
        onSelectCase={() => undefined}
        selectedAnomalyId={linkedAnomaly.id}
      />,
    );

    expect(markup).toContain('aria-labelledby="anomalies-title"');
    expect(markup).toContain('aria-label="Filtrer les anomalies"');
    expect(markup).toContain("Confiance");
    expect(markup).toContain("Preuves consignées");
    expect(markup).toContain("Voir le dossier");
    expect(markup).toContain("Classer cette anomalie");
  });
});
