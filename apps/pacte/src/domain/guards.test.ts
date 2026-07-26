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
