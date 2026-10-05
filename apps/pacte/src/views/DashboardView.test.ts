import { describe, expect, it } from "vitest";

import type { Anomaly, Contract } from "../domain/model";
import {
  computeDashboardKpis,
  getRecentContracts,
  getUpcomingDeadlines,
} from "./DashboardView";

function contract(id: string, nextRenewalDate: string): Contract {
  return {
    id,
    provider: `Fournisseur ${id}`,
    category: "Service",
    reference: `REF-${id}`,
    amount: 10,
    currency: "CHF",
    cadence: "monthly",
    startDate: "2026-01-01",
    nextRenewalDate,
    noticeDays: 0,
    status: "active",
    merchantAliases: [],
    notes: "",
  };
}

describe("getUpcomingDeadlines", () => {
  it("exclut le passé, conserve aujourd’hui et limite aux deux prochaines dates", () => {
    const deadlines = getUpcomingDeadlines(
      [
        contract("past", "2026-07-25"),
        contract("later", "2026-07-28"),
        contract("future", "2026-07-27"),
        contract("today", "2026-07-26"),
      ],
      "2026-07-26",
    );

    expect(deadlines.map(({ contractId, date }) => ({ contractId, date }))).toEqual([
      { contractId: "today", date: "2026-07-26" },
      { contractId: "future", date: "2026-07-27" },
    ]);
  });
});

describe("indicateurs du foyer", () => {
  it("mensualise seulement les contrats actifs récurrents et sépare chaque devise", () => {
    const contracts: Contract[] = [
      { ...contract("monthly-chf", "2027-01-01"), amount: 10, cadence: "monthly" },
      { ...contract("quarterly-eur", "2027-01-01"), amount: 90, cadence: "quarterly", currency: "EUR" },
      { ...contract("annual-chf", "2027-01-01"), amount: 120, cadence: "annual" },
      { ...contract("one-off", "2027-01-01"), amount: 999, cadence: "one-off" },
      { ...contract("paused", "2027-01-01"), amount: 999, status: "paused" },
    ];
    const anomalies = [
      { amount: 12.34, currency: "CHF" },
      { amount: 5, currency: "EUR" },
      { amount: 0, currency: "CHF" },
    ] as Anomaly[];

    expect(computeDashboardKpis(contracts, anomalies)).toEqual({
      activeContracts: 4,
      recurringMonthly: { CHF: 20, EUR: 30 },
      recoverable: { CHF: 12.34, EUR: 5 },
    });
  });

  it("ignore les montants hors bornes sans contaminer les agrégats", () => {
    const contracts: Contract[] = [
      { ...contract("valid", "2027-01-01"), amount: 20 },
      { ...contract("unsafe", "2027-01-01"), amount: Number.POSITIVE_INFINITY },
    ];
    const anomalies = [
      { amount: 5, currency: "CHF" },
      { amount: Number.POSITIVE_INFINITY, currency: "EUR" },
    ] as Anomaly[];

    expect(computeDashboardKpis(contracts, anomalies)).toMatchObject({
      recurringMonthly: { CHF: 20, EUR: 0 },
      recoverable: { CHF: 5, EUR: 0 },
    });
  });

  it("retourne les derniers contrats ajoutés, du plus récent au plus ancien", () => {
    const contracts = [1, 2, 3, 4, 5].map((index) => (
      contract(`contract-${index}`, "2027-01-01")
    ));

    expect(getRecentContracts(contracts, 4).map(({ id }) => id)).toEqual([
      "contract-5",
      "contract-4",
      "contract-3",
      "contract-2",
    ]);
  });
});
