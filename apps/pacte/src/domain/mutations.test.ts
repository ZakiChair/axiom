import { describe, expect, it } from "vitest";

import type { Contract, PacteState, Transaction } from "./model";
import { commitPacteAction } from "./mutations";

const contract: Contract = {
  id: "contract-local",
  provider: "Service Local",
  category: "",
  reference: "",
  amount: 20,
  currency: "CHF",
  cadence: "monthly",
  startDate: "2026-07-01",
  noticeDays: 0,
  status: "active",
  merchantAliases: [],
  notes: "",
};

const transaction: Transaction = {
  id: "transaction-known",
  date: "2026-07-01",
  label: "SERVICE LOCAL",
  amount: 20,
  currency: "CHF",
};

function emptyState(): PacteState {
  return {
    schemaVersion: 1,
    household: { name: "Foyer Test", currency: "CHF" },
    contracts: [],
    transactions: [],
    cases: [],
    dismissedAnomalyIds: [],
  };
}

describe("commitPacteAction", () => {
  it("conserve l'état courant et retourne l'erreur lorsque la persistance échoue", () => {
    const current = emptyState();
    let attemptedState: PacteState | undefined;

    const outcome = commitPacteAction(
      current,
      { type: "contract/add", contract },
      (next) => {
        attemptedState = next;
        return { ok: false, error: "Coffre indisponible." };
      },
    );

    expect(attemptedState?.contracts).toEqual([contract]);
    expect(outcome).toEqual({
      state: current,
      result: { ok: false, changed: 0, error: "Coffre indisponible." },
    });
    expect(outcome.state).toBe(current);
  });

  it("compte seulement les transactions nouvelles réellement persistées", () => {
    const current = { ...emptyState(), transactions: [transaction] };
    const newTransaction = { ...transaction, id: "transaction-new", date: "2026-07-02" };

    const outcome = commitPacteAction(
      current,
      {
        type: "transactions/import",
        transactions: [transaction, newTransaction, newTransaction],
      },
      () => ({ ok: true }),
    );

    expect(outcome.result).toEqual({ ok: true, changed: 1 });
    expect(outcome.state.transactions).toEqual([transaction, newTransaction]);
  });

  it("n'écrit pas le coffre quand un réimport ne produit aucun changement", () => {
    const current = { ...emptyState(), transactions: [transaction] };

    const outcome = commitPacteAction(
      current,
      { type: "transactions/import", transactions: [transaction] },
      () => { throw new Error("La persistance ne doit pas être appelée."); },
    );

    expect(outcome).toEqual({ state: current, result: { ok: true, changed: 0 } });
  });
});
