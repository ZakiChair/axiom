import { describe, expect, it } from "vitest";

import { createDemoState } from "../data/demo";
import { createClaimCase, generateClaimLetter } from "./cases";
import type { Anomaly } from "./model";

const NOW = new Date("2026-07-26T12:00:00.000Z");

function duplicateAnomaly(): Anomaly {
  return {
    id: "anomaly:duplicate:transaction-demo-helvetia-first:transaction-demo-helvetia-second",
    kind: "duplicate",
    severity: "critical",
    confidence: "high",
    title: "Double débit possible — Helvetia Protect",
    explanation: "Deux débits distincts de 89,90 CHF ont été relevés.",
    amount: 89.9,
    contractId: "contract-demo-helvetia-protect",
    transactionIds: [
      "transaction-demo-helvetia-first",
      "transaction-demo-helvetia-second",
    ],
    evidence: [],
  };
}

describe("createClaimCase", () => {
  it("fige profondément le contrat, les faits et les preuves au moment de la création", () => {
    const state = createDemoState();
    const anomaly = duplicateAnomaly();
    anomaly.evidence = state.transactions
      .filter((transaction) => anomaly.transactionIds.includes(transaction.id));

    const claim = createClaimCase(anomaly, state, NOW);
    const capturedFacts = claim.note;

    state.contracts[1]!.provider = "fournisseur modifié";
    state.contracts[1]!.merchantAliases[0] = "alias modifié";
    state.transactions[1]!.label = "libellé modifié";
    anomaly.title = "fait modifié";
    anomaly.explanation = "explication modifiée";
    anomaly.evidence[0]!.label = "preuve modifiée";

    expect(claim).toMatchObject({
      id: `case:${duplicateAnomaly().id}`,
      anomalyId: duplicateAnomaly().id,
      status: "review",
      createdAt: NOW.toISOString(),
    });
    expect(claim.contractSnapshot.provider).toBe("Helvetia Protect");
    expect(claim.contractSnapshot.merchantAliases).toEqual(["Helvetia Protect"]);
    expect(claim.evidence[0]?.label).toBe("PRLV HELVETIA PROTECT");
    expect(claim.note).toBe(capturedFacts);
    expect(claim.timeline).toEqual([
      {
        at: NOW.toISOString(),
        status: "review",
        note: "Dossier créé depuis le contrôle « Double débit possible — Helvetia Protect ».",
      },
    ]);
  });
});

describe("generateClaimLetter", () => {
  it("produit une lettre factuelle, chiffrée et explicitement à vérifier", () => {
    const state = createDemoState();
    const anomaly = duplicateAnomaly();
    anomaly.evidence = state.transactions
      .filter((transaction) => anomaly.transactionIds.includes(transaction.id));
    const claim = createClaimCase(anomaly, state, NOW);

    const letter = generateClaimLetter(claim, state.household);

    expect(letter).toContain(state.household.name);
    expect(letter).toContain(claim.contractSnapshot.provider);
    expect(letter).toContain(claim.contractSnapshot.reference);
    expect(letter).toContain("89,90");
    expect(letter).toContain("8 juillet 2026");
    expect(letter).toContain("Pièces à joindre");
    expect(letter).toContain("14 jours");
    expect(letter).toContain("Vérifiez les dates, montants et pièces");
    expect(letter).not.toMatch(/article|garanti|certain/i);
  });
});
