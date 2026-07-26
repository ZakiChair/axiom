import { describe, expect, it } from "vitest";

import {
  buildContractEntry,
  buildTransactionEntry,
  firstInvalidField,
  hasEntryErrors,
  validateContractEntry,
  validateTransactionEntry,
} from "./entries";

describe("hasEntryErrors", () => {
  it("ignore une clé corrigée à undefined et détecte un vrai message", () => {
    expect(hasEntryErrors({ provider: undefined })).toBe(false);
    expect(hasEntryErrors({ provider: "Indiquez le fournisseur." })).toBe(true);
  });
});

describe("firstInvalidField", () => {
  it("retourne le premier champ invalide dans l'ordre du formulaire", () => {
    expect(firstInvalidField(
      { amount: "Montant invalide", provider: "Fournisseur manquant" },
      ["provider", "amount", "currency"] as const,
    )).toBe("provider");
    expect(firstInvalidField({}, ["provider", "amount"] as const)).toBeUndefined();
  });
});

const validContract = {
  provider: "  Énergie Lac  ",
  amount: "129,90",
  currency: "CHF",
  cadence: "monthly",
  startDate: "2026-07-01",
  category: "Énergie",
  reference: "  EL-42 ",
  nextRenewalDate: "2027-07-01",
  noticeDays: "30",
  status: "active",
  terminatedAt: "",
  expectsRefund: false,
  expectedRefundAmount: "",
  expectedRefundDueDate: "",
  merchantAliases: "Énergie Lac, ENERGIE-LAC\nÉnergie Lac",
  notes: "Contrat familial.",
  sourceText: "Prime CHF 129.90.",
  sourceFileName: "conditions.eml",
  sourceFileType: "message/rfc822",
};

describe("validateContractEntry", () => {
  it("relie chaque valeur requise absente à son champ", () => {
    expect(validateContractEntry({
      ...validContract,
      provider: " ",
      amount: "",
      currency: "USD",
      cadence: "weekly",
      startDate: "",
    })).toEqual({
      provider: "Indiquez le fournisseur.",
      amount: "Indiquez un montant supérieur à zéro.",
      currency: "Choisissez une devise proposée.",
      cadence: "Choisissez une cadence proposée.",
      startDate: "Indiquez une date de début valide.",
    });
  });

  it("refuse une date impossible et un préavis fractionnaire", () => {
    expect(validateContractEntry({
      ...validContract,
      startDate: "2026-02-31",
      noticeDays: "2.5",
    })).toMatchObject({
      startDate: "Indiquez une date de début valide.",
      noticeDays: "Indiquez un nombre entier de jours positif ou nul.",
    });
  });

  it("exige les faits conditionnels d’une résiliation et d’un remboursement attendu", () => {
    expect(validateContractEntry({
      ...validContract,
      status: "terminated",
      terminatedAt: "",
      expectsRefund: true,
      expectedRefundAmount: "0",
      expectedRefundDueDate: "2026-02-31",
    })).toMatchObject({
      terminatedAt: "Indiquez la date de résiliation.",
      expectedRefundAmount: "Indiquez un remboursement supérieur à zéro.",
      expectedRefundDueDate: "Indiquez une date de remboursement valide.",
    });
  });

  it("refuse les montants et préavis au-delà des bornes métier", () => {
    expect(validateContractEntry({
      ...validContract,
      amount: "1000000000.01",
      noticeDays: "3651",
      expectsRefund: true,
      expectedRefundAmount: "1000000000.01",
      expectedRefundDueDate: "2026-08-01",
    })).toMatchObject({
      amount: "Indiquez un montant dans la limite autorisée.",
      noticeDays: "Le préavis ne peut pas dépasser 3650 jours.",
      expectedRefundAmount: "Indiquez un remboursement dans la limite autorisée.",
    });
  });
});

describe("buildContractEntry", () => {
  it("normalise les décimales et déduplique les alias sans perdre la source confirmée", () => {
    expect(buildContractEntry(validContract, "contract-local-1")).toEqual({
      id: "contract-local-1",
      provider: "Énergie Lac",
      amount: 129.9,
      currency: "CHF",
      cadence: "monthly",
      startDate: "2026-07-01",
      category: "Énergie",
      reference: "EL-42",
      nextRenewalDate: "2027-07-01",
      noticeDays: 30,
      status: "active",
      merchantAliases: ["Énergie Lac", "ENERGIE-LAC"],
      notes: "Contrat familial.",
      sourceText: "Prime CHF 129.90.",
      sourceFile: { name: "conditions.eml", type: "message/rfc822" },
    });
  });

  it("construit la résiliation et le remboursement uniquement lorsqu’ils sont déclarés", () => {
    expect(buildContractEntry({
      ...validContract,
      status: "terminated",
      terminatedAt: "2026-07-10",
      expectsRefund: true,
      expectedRefundAmount: "24,50",
      expectedRefundDueDate: "2026-08-01",
    }, "contract-terminated")).toMatchObject({
      terminatedAt: "2026-07-10",
      expectedRefund: { amount: 24.5, dueDate: "2026-08-01" },
    });

    expect(buildContractEntry({
      ...validContract,
      terminatedAt: "2026-07-10",
      expectedRefundAmount: "24,50",
      expectedRefundDueDate: "2026-08-01",
    }, "contract-active")).not.toMatchObject({
      terminatedAt: expect.anything(),
      expectedRefund: expect.anything(),
    });
  });
});

const validTransaction = {
  date: "2026-07-26",
  label: "  ÉNERGIE LAC  ",
  amount: "-18,50",
  currency: "EUR",
  contractId: "contract-energie",
};

describe("validateTransactionEntry", () => {
  it("refuse les dates impossibles, libellés vides, montants nuls et devises inconnues", () => {
    expect(validateTransactionEntry({
      date: "2026-13-01",
      label: " ",
      amount: "0",
      currency: "GBP",
    })).toEqual({
      date: "Indiquez une date valide.",
      label: "Indiquez le libellé du mouvement.",
      amount: "Indiquez un montant différent de zéro.",
      currency: "Choisissez une devise proposée.",
    });
  });

  it("refuse un mouvement qui dépasse la borne monétaire", () => {
    expect(validateTransactionEntry({
      ...validTransaction,
      amount: "-1000000000.01",
    })).toMatchObject({
      amount: "Indiquez un montant dans la limite autorisée.",
    });
  });
});

describe("buildTransactionEntry", () => {
  it("conserve le signe du montant et marque la date d'ajout", () => {
    expect(buildTransactionEntry(
      validTransaction,
      "transaction-local-1",
      "2026-07-26T08:30:00.000Z",
    )).toEqual({
      id: "transaction-local-1",
      date: "2026-07-26",
      label: "ÉNERGIE LAC",
      amount: -18.5,
      currency: "EUR",
      contractId: "contract-energie",
      importedAt: "2026-07-26T08:30:00.000Z",
    });
  });
});
