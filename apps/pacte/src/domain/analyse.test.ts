import { describe, expect, it } from "vitest";

import { analyseState, computeControlScore } from "./analyse";
import { createDemoState } from "../data/demo";
import type { Anomaly, Contract, PacteState, Transaction } from "./model";

const NOW = new Date("2026-07-26T12:00:00.000Z");

const baseContract: Contract = {
  id: "contract-alpine",
  provider: "Alpine Mobile",
  category: "Téléphonie",
  reference: "ALP-42",
  amount: 100,
  currency: "CHF",
  cadence: "monthly",
  startDate: "2026-01-01",
  noticeDays: 30,
  status: "active",
  merchantAliases: ["Alpine Mobile"],
  notes: "",
};

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "transaction-1",
    date: "2026-07-15",
    label: "PRLV ALPINE MOBILE",
    amount: 100,
    currency: "CHF",
    contractId: baseContract.id,
    ...overrides,
  };
}

function state(overrides: Partial<PacteState> = {}): PacteState {
  return {
    schemaVersion: 1,
    household: { name: "Foyer Test", currency: "CHF" },
    contracts: [baseContract],
    transactions: [],
    cases: [],
    dismissedAnomalyIds: [],
    ...overrides,
  };
}

function anomaliesOfKind(
  value: PacteState,
  kind: Anomaly["kind"],
): Anomaly[] {
  return analyseState(value, NOW).filter((anomaly) => anomaly.kind === kind);
}

describe("analyseState", () => {
  it("signale une seule fois une paire de débits identiques à moins de sept jours d'intervalle", () => {
    const duplicateState = state({
      transactions: [
        transaction({ id: "transaction-a", date: "2026-07-09" }),
        transaction({ id: "transaction-b", date: "2026-07-15" }),
      ],
    });

    const duplicates = anomaliesOfKind(duplicateState, "duplicate");

    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toMatchObject({
      severity: "critical",
      confidence: "high",
      amount: 100,
      contractId: baseContract.id,
      transactionIds: ["transaction-a", "transaction-b"],
    });
    expect(duplicates[0]?.evidence).toHaveLength(2);
  });

  it("ignore les débits distants de sept jours ou plus et les transactions sans contrat", () => {
    const unrelated = transaction({
      id: "transaction-unrelated",
      date: "2026-07-15",
      label: "BOULANGERIE DU LAC",
      contractId: undefined,
    });

    expect(
      anomaliesOfKind(
        state({
          transactions: [
            transaction({ id: "transaction-a", date: "2026-07-08" }),
            transaction({ id: "transaction-b", date: "2026-07-15" }),
            unrelated,
          ],
        }),
        "duplicate",
      ),
    ).toHaveLength(0);
  });

  it("signale la part d'un débit qui dépasse le prix contractuel de plus de 2 %", () => {
    const increases = anomaliesOfKind(
      state({ transactions: [transaction({ amount: 112 })] }),
      "price-increase",
    );

    expect(increases).toHaveLength(1);
    expect(increases[0]).toMatchObject({
      severity: "important",
      amount: 12,
      transactionIds: ["transaction-1"],
    });
  });

  it("ne signale ni une hausse exactement à 2 %, ni un crédit, ni une transaction sans contrat", () => {
    expect(
      anomaliesOfKind(
        state({
          transactions: [
            transaction({ id: "transaction-threshold", amount: 102 }),
            transaction({ id: "transaction-credit", amount: -112 }),
            transaction({
              id: "transaction-unrelated",
              label: "BOULANGERIE DU LAC",
              amount: 112,
              contractId: undefined,
            }),
          ],
        }),
        "price-increase",
      ),
    ).toHaveLength(0);
  });

  it("ne signale pas une hausse décimale exactement à 2 %", () => {
    const decimalContract: Contract = { ...baseContract, amount: 19.99 };

    expect(
      anomaliesOfKind(
        state({
          contracts: [decimalContract],
          transactions: [transaction({ amount: 20.3898 })],
        }),
        "price-increase",
      ),
    ).toHaveLength(0);
  });

  it("signale le montant complet d'un débit postérieur à la résiliation", () => {
    const terminated: Contract = {
      ...baseContract,
      status: "terminated",
      terminatedAt: "2026-06-30",
    };
    const postTermination = anomaliesOfKind(
      state({
        contracts: [terminated],
        transactions: [transaction({ date: "2026-07-01" })],
      }),
      "post-termination",
    );

    expect(postTermination).toHaveLength(1);
    expect(postTermination[0]).toMatchObject({
      severity: "critical",
      amount: 100,
      transactionIds: ["transaction-1"],
    });
  });

  it("ignore un débit antérieur à la résiliation et un crédit postérieur", () => {
    const terminated: Contract = {
      ...baseContract,
      status: "terminated",
      terminatedAt: "2026-06-30",
    };

    expect(
      anomaliesOfKind(
        state({
          contracts: [terminated],
          transactions: [
            transaction({ id: "transaction-before", date: "2026-06-29" }),
            transaction({ id: "transaction-credit", date: "2026-07-01", amount: -100 }),
          ],
        }),
        "post-termination",
      ),
    ).toHaveLength(0);
  });

  it("signale le montant d'un remboursement arrivé à échéance sans crédit", () => {
    const refundContract: Contract = {
      ...baseContract,
      expectedRefund: { amount: 80, dueDate: "2026-07-20" },
    };
    const missingRefunds = anomaliesOfKind(
      state({ contracts: [refundContract] }),
      "missing-refund",
    );

    expect(missingRefunds).toHaveLength(1);
    expect(missingRefunds[0]).toMatchObject({
      severity: "important",
      amount: 80,
      transactionIds: [],
    });
  });

  it("accepte comme reçu un crédit correspondant dans la tolérance de 2 %", () => {
    const refundContract: Contract = {
      ...baseContract,
      expectedRefund: { amount: 80, dueDate: "2026-07-20" },
    };

    expect(
      anomaliesOfKind(
        state({
          contracts: [refundContract],
          transactions: [transaction({ amount: -78.4 })],
        }),
        "missing-refund",
      ),
    ).toHaveLength(0);
  });

  it("accepte un crédit décimal exactement à la frontière basse de 2 %", () => {
    const refundContract: Contract = {
      ...baseContract,
      expectedRefund: { amount: 1, dueDate: "2026-07-20" },
    };

    expect(
      anomaliesOfKind(
        state({
          contracts: [refundContract],
          transactions: [transaction({ amount: -0.98 })],
        }),
        "missing-refund",
      ),
    ).toHaveLength(0);
  });

  it("signale un préavis à exercer dans les trente prochains jours", () => {
    const nearDeadline: Contract = {
      ...baseContract,
      nextRenewalDate: "2026-09-15",
      noticeDays: 30,
    };
    const deadlines = anomaliesOfKind(
      state({ contracts: [nearDeadline] }),
      "deadline",
    );

    expect(deadlines).toHaveLength(1);
    expect(deadlines[0]).toMatchObject({
      severity: "vigilance",
      amount: 0,
      transactionIds: [],
    });
    expect(deadlines[0]?.explanation).toContain("16 août 2026");
  });

  it("ignore un préavis passé, à plus de trente jours ou sur un contrat résilié", () => {
    const distant: Contract = {
      ...baseContract,
      nextRenewalDate: "2026-09-30",
      noticeDays: 30,
    };
    const past: Contract = {
      ...baseContract,
      id: "contract-past",
      nextRenewalDate: "2026-08-01",
      noticeDays: 30,
    };
    const terminated: Contract = {
      ...baseContract,
      id: "contract-terminated",
      status: "terminated",
      terminatedAt: "2026-07-01",
      nextRenewalDate: "2026-09-15",
    };

    expect(
      anomaliesOfKind(state({ contracts: [distant, past, terminated] }), "deadline"),
    ).toHaveLength(0);
  });

  it("produit des identifiants stables, des faits explicites et retire les anomalies classées", () => {
    const duplicateState = state({
      transactions: [
        transaction({ id: "transaction-b", date: "2026-07-15" }),
        transaction({ id: "transaction-a", date: "2026-07-10" }),
      ],
    });

    const [first] = anomaliesOfKind(duplicateState, "duplicate");
    const reordered = structuredClone(duplicateState);
    reordered.transactions.reverse();
    const [second] = anomaliesOfKind(reordered, "duplicate");

    expect(first?.id).toBe(second?.id);
    expect(first?.evidence.length).toBeGreaterThan(1);
    expect(first?.explanation).not.toContain("undefined");
    expect(
      analyseState(
        { ...duplicateState, dismissedAnomalyIds: first ? [first.id] : [] },
        NOW,
      ),
    ).not.toContainEqual(first);
  });

  it("trie par sévérité, puis montant décroissant et enfin date", () => {
    const contractWithDeadline: Contract = {
      ...baseContract,
      nextRenewalDate: "2026-09-15",
      noticeDays: 30,
    };
    const analysed = analyseState(
      state({
        contracts: [contractWithDeadline],
        transactions: [
          transaction({ id: "transaction-small", date: "2026-07-15", amount: 105 }),
          transaction({ id: "transaction-large", date: "2026-07-16", amount: 110 }),
        ],
      }),
      NOW,
    );

    expect(analysed.map(({ kind, amount }) => [kind, amount])).toEqual([
      ["price-increase", 10],
      ["price-increase", 5],
      ["deadline", 0],
    ]);
  });
});

describe("computeControlScore", () => {
  it("retire les pénalités de sévérité et celles des contrats actifs sans échéance", () => {
    const anomalies = [
      { severity: "critical" },
      { severity: "important" },
      { severity: "vigilance" },
    ] as Anomaly[];

    expect(computeControlScore(state(), anomalies, NOW)).toBe(58);
  });

  it("borne le score entre zéro et cent", () => {
    const criticals = Array.from({ length: 10 }, () => ({ severity: "critical" })) as Anomaly[];
    const completeState = state({
      contracts: [{ ...baseContract, nextRenewalDate: "2027-01-01" }],
    });

    expect(computeControlScore(completeState, [], NOW)).toBe(100);
    expect(computeControlScore(completeState, criticals, NOW)).toBe(0);
  });
});

describe("createDemoState", () => {
  it("fournit trois contrats CHF et couvre exactement les cinq règles", () => {
    const demo = createDemoState();

    expect(demo.contracts).toHaveLength(3);
    expect(demo.contracts.map(({ provider }) => provider)).toEqual([
      "Alpine Mobile",
      "Helvetia Protect",
      "Studio Forme",
    ]);
    expect(demo.contracts.every(({ currency }) => currency === "CHF")).toBe(true);
    expect(analyseState(demo, NOW).map(({ kind }) => kind).sort()).toEqual([
      "deadline",
      "duplicate",
      "missing-refund",
      "post-termination",
      "price-increase",
    ]);
  });
});
