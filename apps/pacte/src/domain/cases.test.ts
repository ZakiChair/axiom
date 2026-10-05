import { describe, expect, it } from "vitest";

import { createDemoState } from "../data/demo";
import { analyseState } from "./analyse";
import { createClaimCase, generateClaimLetter } from "./cases";
import type { Anomaly, AnomalyKind, PacteState } from "./model";

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
    currency: "CHF",
    contractId: "contract-demo-helvetia-protect",
    transactionIds: [
      "transaction-demo-helvetia-first",
      "transaction-demo-helvetia-second",
    ],
    evidence: [],
  };
}

function claimFor(kind: AnomalyKind): {
  state: PacteState;
  anomaly: Anomaly;
  claim: ReturnType<typeof createClaimCase>;
} {
  const state = createDemoState();
  const anomaly = analyseState(state, NOW).find((candidate) => candidate.kind === kind)!;
  anomaly.id = `controle-metier-${kind}`;

  return { state, anomaly, claim: createClaimCase(anomaly, state, NOW) };
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
    expect(claim.anomalySnapshot).toEqual({
      kind: "duplicate",
      title: "Double débit possible — Helvetia Protect",
      explanation: "Deux débits distincts de 89,90 CHF ont été relevés.",
      amount: 89.9,
      currency: "CHF",
    });
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

  it("décrit une hausse depuis son snapshot sémantique sans dépendre de l'identifiant", () => {
    const { state, anomaly, claim } = claimFor("price-increase");

    const letter = generateClaimLetter(claim, state.household);

    expect(letter).toContain(anomaly.title);
    expect(letter).toContain(anomaly.explanation);
    expect(letter).toContain("prix contractuel de 59,90 CHF");
    expect(letter).toContain("écart relevé de 5,00 CHF");
  });

  it("décrit l'absence de crédit et demande le remboursement attendu", () => {
    const { state, anomaly, claim } = claimFor("missing-refund");

    const letter = generateClaimLetter(claim, state.household);

    expect(letter).toContain(anomaly.title);
    expect(letter).toContain(anomaly.explanation);
    expect(letter).toContain("remboursement attendu de 24,50 CHF");
    expect(letter).toContain("crédit correspondant");
  });

  it("demande une confirmation d'échéance sans réclamer de remboursement nul", () => {
    const { state, anomaly, claim } = claimFor("deadline");

    const letter = generateClaimLetter(claim, state.household);

    expect(letter).toContain(anomaly.title);
    expect(letter).toContain(anomaly.explanation);
    expect(letter).toContain("confirmer la date limite et les modalités applicables");
    expect(letter).not.toMatch(/rembours/i);
    expect(letter).not.toContain("0,00 CHF");
  });

  it("conserve la devise du débit dans le snapshot et la demande si le contrat diffère", () => {
    const state = createDemoState();
    const terminated = {
      ...state.contracts[2]!,
      currency: "CHF" as const,
    };
    const debit = {
      ...state.transactions[3]!,
      amount: 79,
      currency: "EUR" as const,
      contractId: terminated.id,
    };
    const crossCurrencyState = {
      ...state,
      contracts: [terminated],
      transactions: [debit],
    };
    const anomaly = analyseState(crossCurrencyState, NOW)
      .find(({ kind }) => kind === "post-termination")!;

    const claim = createClaimCase(anomaly, crossCurrencyState, NOW);
    const letter = generateClaimLetter(claim, state.household);

    expect(anomaly.currency).toBe("EUR");
    expect(claim.anomalySnapshot.currency).toBe("EUR");
    expect(letter).toContain("montant concerné de 79,00 EUR");
    expect(letter).not.toContain("montant concerné de 79,00 CHF");
  });
});
