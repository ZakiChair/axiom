import { describe, expect, it } from "vitest";

import {
  buildContractEntry,
  buildTransactionEntry,
  validateContractEntry,
  validateTransactionEntry,
} from "./entries";

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
  merchantAliases: "Énergie Lac, ENERGIE-LAC\nÉnergie Lac",
  notes: "Contrat familial.",
  sourceText: "Prime CHF 129.90.",
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
    });
  });
});

const validTransaction = {
  date: "2026-07-26",
  label: "  ÉNERGIE LAC  ",
  amount: "-18,50",
  currency: "EUR",
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
      importedAt: "2026-07-26T08:30:00.000Z",
    });
  });
});
