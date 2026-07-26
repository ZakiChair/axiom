import { describe, expect, it } from "vitest";

import type { Contract } from "../domain/model";
import { getUpcomingDeadlines } from "./DashboardView";

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
