import { describe, expect, it } from "vitest";

import {
  matchContract,
  normalizeMerchant,
  transactionFingerprint,
} from "./normalize";
import type { Contract, Transaction } from "./model";

const helvetia: Contract = {
  id: "contract-helvetia",
  provider: "Helvetia Assurances",
  category: "Assurance",
  reference: "HEL-1",
  amount: 89.9,
  currency: "CHF",
  cadence: "monthly",
  startDate: "2026-01-01",
  noticeDays: 30,
  status: "active",
  merchantAliases: ["HELVETIA"],
  notes: "",
};

const transaction = (label: string): Transaction => ({
  id: "transaction-1",
  date: "2026-07-15",
  label,
  amount: 89.9,
  currency: "CHF",
});

describe("normalizeMerchant", () => {
  it("retire les espaces, accents, ponctuation et forme sociale", () => {
    expect(normalizeMerchant("  Helvetia Assurances SA ")).toBe("helvetia assurances");
  });
});

describe("matchContract", () => {
  it("associe une transaction à un alias présent dans son libellé", () => {
    expect(matchContract(transaction("PRLV HELVETIA"), [helvetia])).toBe(helvetia.id);
  });

  it("ne force pas une association sans alias correspondant", () => {
    expect(matchContract(transaction("BOULANGERIE"), [helvetia])).toBeUndefined();
  });

  it("privilégie l'alias correspondant le plus long", () => {
    const generic: Contract = { ...helvetia, id: "contract-generic", merchantAliases: ["mobile"] };
    const precise: Contract = {
      ...helvetia,
      id: "contract-precise",
      merchantAliases: ["alpine mobile"],
    };

    expect(matchContract(transaction("PRLV ALPINE MOBILE"), [generic, precise])).toBe(precise.id);
  });
});

describe("transactionFingerprint", () => {
  it("ignore l’identifiant, l’origine et le rattachement pour une même opération métier", () => {
    const first = transaction("  PRLV  HÉLVETIA ");
    const second: Transaction = {
      ...first,
      id: "transaction-import-other",
      label: "prlv helvetia",
      contractId: "contract-corrige",
      importedAt: "2026-07-26T12:00:00.000Z",
    };

    expect(transactionFingerprint(first)).toBe("2026-07-15|prlv helvetia|89.9000|CHF");
    expect(transactionFingerprint(second)).toBe(transactionFingerprint(first));
  });
});
