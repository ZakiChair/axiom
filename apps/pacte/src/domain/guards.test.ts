import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parsePacteState } from "./guards";
import type { PacteState } from "./model";
import { loadState, rawStoredState, saveState } from "../infra/storage";

const validState: PacteState = {
  schemaVersion: 1,
  household: { name: "Famille Martin", currency: "CHF" },
  contracts: [],
  transactions: [],
  cases: [],
  dismissedAnomalyIds: [],
};

const validContract: PacteState["contracts"][number] = {
  id: "contract-alpine",
  provider: "Alpine Mobile",
  category: "Téléphonie",
  reference: "ALP-01",
  amount: 49.9,
  currency: "CHF",
  cadence: "monthly",
  startDate: "2026-01-01",
  noticeDays: 30,
  status: "active",
  merchantAliases: ["ALPINE MOBILE"],
  notes: "Forfait mensuel",
};

const validTransaction: PacteState["transactions"][number] = {
  id: "transaction-alpine",
  date: "2026-07-15",
  label: "ALPINE MOBILE",
  amount: 49.9,
  currency: "CHF",
};

const validCase: PacteState["cases"][number] = {
  id: "case-alpine",
  anomalyId: "anomaly-alpine",
  anomalySnapshot: {
    kind: "price-increase",
    title: "Hausse de prix — Alpine Mobile",
    explanation: "Le débit dépasse le prix enregistré.",
    amount: 5,
  },
  status: "review",
  createdAt: "2026-07-26T00:00:00.000Z",
  contractSnapshot: validContract,
  evidence: [
    {
      id: validTransaction.id,
      date: validTransaction.date,
      label: validTransaction.label,
      amount: validTransaction.amount,
      currency: validTransaction.currency,
    },
  ],
  timeline: [{ at: "2026-07-26T00:00:00.000Z", status: "review", note: "Créé" }],
  note: "À examiner",
  letter: "",
};

describe("parsePacteState", () => {
  it("refuse une sauvegarde dont la version ou les collections sont invalides", () => {
    expect(parsePacteState({ schemaVersion: 2 })).toBeNull();
    expect(parsePacteState({ schemaVersion: 1, contracts: "non" })).toBeNull();
  });

  it("accepte un état V1 complet", () => {
    expect(parsePacteState(validState)).toEqual(validState);
  });

  it("refuse un foyer incomplet sans modifier la sauvegarde fournie", () => {
    const invalidState = {
      ...validState,
      household: { name: "Famille Martin", currency: "USD" },
    };

    expect(parsePacteState(invalidState)).toBeNull();
    expect(invalidState.household.currency).toBe("USD");
  });

  it("refuse les éléments corrompus dans chaque collection persistée", () => {
    expect(
      parsePacteState({ ...validState, contracts: [{ ...validContract, status: "pending" }] }),
    ).toBeNull();
    expect(
      parsePacteState({ ...validState, contracts: [{ ...validContract, amount: "49.90" }] }),
    ).toBeNull();
    expect(
      parsePacteState({ ...validState, transactions: [{ ...validTransaction, date: "15.07.2026" }] }),
    ).toBeNull();
    expect(
      parsePacteState({
        ...validState,
        transactions: [{ ...validTransaction, importedAt: "July 26, 2026" }],
      }),
    ).toBeNull();
    expect(
      parsePacteState({ ...validState, cases: [{ ...validCase, status: "archived" }] }),
    ).toBeNull();
    const { anomalySnapshot: _omitted, ...caseWithoutSnapshot } = validCase;
    expect(parsePacteState({ ...validState, cases: [caseWithoutSnapshot] })).toBeNull();
    expect(
      parsePacteState({
        ...validState,
        cases: [{ ...validCase, anomalySnapshot: { ...validCase.anomalySnapshot, kind: "other" } }],
      }),
    ).toBeNull();
    expect(parsePacteState({ ...validState, dismissedAnomalyIds: [42] })).toBeNull();
  });
});

describe("coffre local", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  it("retourne null pour une sauvegarde JSON invalide sans effacer le secours", () => {
    values.set("pacte:v1", "{");

    expect(loadState()).toBeNull();
    expect(rawStoredState()).toBe("{");
  });

  it("enregistre et relit un état V1 sous la clé versionnée", () => {
    saveState(validState);

    expect(values.get("pacte:v1")).toBe(JSON.stringify(validState));
    expect(loadState()).toEqual(validState);
  });
});
