import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createDemoState } from "../data/demo";
import { analyseState } from "../domain/analyse";
import { createClaimCase } from "../domain/cases";
import {
  caseDraftFor,
  caseLetterFileName,
  CasesView,
  updateCaseDraft,
} from "./CasesView";

const NOW = new Date("2026-07-26T12:00:00.000Z");

describe("caseLetterFileName", () => {
  it("produit un nom de fichier texte sûr à partir du fournisseur", () => {
    expect(caseLetterFileName("Énergie & Lac SA", "2026-07-26")).toBe(
      "reclamation-energie-lac-sa-2026-07-26.txt",
    );
  });
});

describe("brouillons de dossier", () => {
  it("préserve chaque brouillon et ne montre jamais celui de l'autre dossier lors de A → B → A", () => {
    type Draft = { note: string; letter: string };
    type Drafts = Record<string, Draft>;
    const state = createDemoState();
    const anomalies = analyseState(state, NOW);
    const claimA = createClaimCase(anomalies[0]!, state, NOW);
    const claimB = createClaimCase(anomalies[1]!, state, NOW);
    let drafts: Drafts = {};

    drafts = updateCaseDraft(drafts, claimA, { note: "Brouillon A" });
    expect(caseDraftFor(drafts, claimB)).toEqual({ note: claimB.note, letter: claimB.letter });

    drafts = updateCaseDraft(drafts, claimB, { letter: "Lettre B modifiée" });
    expect(caseDraftFor(drafts, claimA)).toEqual({ note: "Brouillon A", letter: claimA.letter });
    expect(caseDraftFor(drafts, claimB)).toEqual({ note: claimB.note, letter: "Lettre B modifiée" });
  });
});

describe("CasesView", () => {
  it("rend la liste maître, le suivi, les preuves et la lettre imprimable active", () => {
    const state = createDemoState();
    const anomaly = analyseState(state, NOW)[0]!;
    const claim = createClaimCase(anomaly, state, NOW);
    const markup = renderToStaticMarkup(
      <CasesView
        cases={[claim]}
        onSelectCase={() => undefined}
        onUpdateCase={() => ({ ok: true, changed: 1 })}
        selectedCaseId={claim.id}
      />,
    );

    expect(markup).toContain('aria-labelledby="cases-title"');
    expect(markup).toContain("Chronologie du dossier");
    expect(markup).toContain("Preuves figées");
    expect(markup).toContain('for="case-status"');
    expect(markup).toContain('for="case-letter"');
    expect(markup).toContain('class="printable-letter"');
    expect(markup).toContain("Vérifiez les informations et les délais");
  });
});
