import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parsePacteState } from "./guards";
import { buildContractEntry } from "./entries";
import type { PacteState } from "./model";
import { inspectStoredState, loadState, rawStoredState, saveState } from "../infra/storage";

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

  it("relit un contrat minimal produit par le formulaire sans catégorie ni référence", () => {
    const contract = buildContractEntry({
      provider: "Service Minimal",
      amount: "12,50",
      currency: "CHF",
      cadence: "monthly",
      startDate: "2026-07-01",
      category: "",
      reference: "",
      nextRenewalDate: "",
      noticeDays: "0",
      status: "active",
      merchantAliases: "",
      notes: "",
      sourceText: "",
    }, "contract-minimal");
    const state = { ...validState, contracts: [contract] };

    expect(parsePacteState(JSON.parse(JSON.stringify(state)))).toEqual(state);
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

  it("refuse les zéros positifs requis et toutes les valeurs au-delà des bornes métier", () => {
    expect(parsePacteState({
      ...validState,
      contracts: [{ ...validContract, amount: 0 }],
    })).toBeNull();
    expect(parsePacteState({
      ...validState,
      contracts: [{ ...validContract, noticeDays: 3651 }],
    })).toBeNull();
    expect(parsePacteState({
      ...validState,
      contracts: [{
        ...validContract,
        expectedRefund: { amount: 0, dueDate: "2026-08-01" },
      }],
    })).toBeNull();
    expect(parsePacteState({
      ...validState,
      transactions: [{ ...validTransaction, amount: 1000000000.01 }],
    })).toBeNull();
  });

  it("refuse un contrat marqué résilié sans date de résiliation", () => {
    expect(parsePacteState({
      ...validState,
      contracts: [{ ...validContract, status: "terminated" }],
    })).toBeNull();
  });

  it("accepte les nouveaux champs V1 optionnels et les anciens snapshots sans devise", () => {
    const enrichedContract = {
      ...validContract,
      sourceFile: { name: "conditions.eml", type: "message/rfc822" },
    };
    const enrichedCase = {
      ...validCase,
      anomalySnapshot: { ...validCase.anomalySnapshot, currency: "EUR" },
    };

    expect(parsePacteState({
      ...validState,
      contracts: [enrichedContract],
      cases: [enrichedCase],
    })).toEqual({
      ...validState,
      contracts: [enrichedContract],
      cases: [enrichedCase],
    });
    expect(parsePacteState({ ...validState, cases: [validCase] })).toEqual({
      ...validState,
      cases: [validCase],
    });
    expect(parsePacteState({
      ...validState,
      cases: [{
        ...validCase,
        anomalySnapshot: { ...validCase.anomalySnapshot, currency: "USD" },
      }],
    })).toBeNull();
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

  it("distingue un coffre absent, valide et corrompu sans perdre la valeur brute", () => {
    expect(inspectStoredState()).toEqual({ status: "missing" });

    values.set("pacte:v1", JSON.stringify(validState));
    expect(inspectStoredState()).toEqual({ status: "valid", state: validState });

    values.set("pacte:v1", '{"schemaVersion":2}');
    expect(inspectStoredState()).toEqual({
      status: "corrupt",
      raw: '{"schemaVersion":2}',
    });
  });

  it("enregistre et relit un état V1 sous la clé versionnée", () => {
    const result = saveState(validState);

    expect(result).toEqual({ ok: true });
    expect(values.get("pacte:v1")).toBe(JSON.stringify(validState));
    expect(loadState()).toEqual(validState);
  });

  it("refuse d’écrire un état hors bornes même si un appelant contourne le typage", () => {
    values.set("pacte:v1", JSON.stringify(validState));
    const invalidState = {
      ...validState,
      transactions: [{ ...validTransaction, amount: Number.POSITIVE_INFINITY }],
    } as PacteState;

    expect(saveState(invalidState)).toEqual({
      ok: false,
      error: "Le coffre local n’a pas pu être enregistré. Libérez de l’espace puis réessayez.",
    });
    expect(values.get("pacte:v1")).toBe(JSON.stringify(validState));
  });

  it("signale l'échec d'écriture sans prétendre que le coffre a été mis à jour", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => { throw new DOMException("Quota exceeded", "QuotaExceededError"); },
      },
    });

    expect(saveState(validState)).toEqual({
      ok: false,
      error: "Le coffre local n’a pas pu être enregistré. Libérez de l’espace puis réessayez.",
    });
  });
});
