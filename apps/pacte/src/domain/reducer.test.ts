import { describe, expect, it } from "vitest";

import { createDemoState } from "../data/demo";
import { analyseState } from "./analyse";
import type { Contract, PacteState, Transaction } from "./model";
import { pacteReducer } from "./reducer";

const NOW = new Date("2026-07-26T12:00:00.000Z");
const LATER = new Date("2026-07-27T09:15:00.000Z");

const contract: Contract = {
  id: "contract-new",
  provider: "Cinéma du Lac",
  category: "Loisirs",
  reference: "CDL-7",
  amount: 24,
  currency: "CHF",
  cadence: "monthly",
  startDate: "2026-07-01",
  noticeDays: 10,
  status: "active",
  merchantAliases: ["Cinéma du Lac"],
  notes: "",
};

const transaction: Transaction = {
  id: "transaction-new",
  date: "2026-07-22",
  label: "CINEMA DU LAC",
  amount: 24,
  currency: "CHF",
  contractId: contract.id,
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

describe("pacteReducer", () => {
  it("ajoute et retire un contrat sans muter l'état précédent", () => {
    const initial = emptyState();
    const added = pacteReducer(initial, { type: "contract/add", contract });
    const removed = pacteReducer(added, { type: "contract/remove", contractId: contract.id });

    expect(initial.contracts).toEqual([]);
    expect(added.contracts).toEqual([contract]);
    expect(removed.contracts).toEqual([]);
  });

  it("fusionne les transactions par identifiant sans doublon ni écrasement", () => {
    const initial = { ...emptyState(), transactions: [transaction] };
    const duplicate = { ...transaction, label: "LIBELLÉ DE LA COPIE" };
    const second = { ...transaction, id: "transaction-second", date: "2026-07-23" };

    const next = pacteReducer(initial, {
      type: "transactions/import",
      transactions: [duplicate, second, second],
    });

    expect(next.transactions).toEqual([transaction, second]);
    expect(initial.transactions).toEqual([transaction]);
  });

  it("n'ouvre qu'un dossier par anomalie avec une lettre initiale", () => {
    const initial = createDemoState();
    const anomaly = analyseState(initial, NOW).find((item) => item.kind === "duplicate")!;
    const once = pacteReducer(initial, { type: "case/open", anomaly, now: NOW });
    const twice = pacteReducer(once, { type: "case/open", anomaly, now: LATER });

    expect(once.cases).toHaveLength(1);
    expect(once.cases[0]?.letter).toContain("Helvetia Protect");
    expect(twice).toBe(once);
  });

  it("change le statut et ajoute un événement avec l'heure reçue par l'action", () => {
    const initial = createDemoState();
    const anomaly = analyseState(initial, NOW).find((item) => item.kind === "duplicate")!;
    const opened = pacteReducer(initial, { type: "case/open", anomaly, now: NOW });
    const evidenceBeforeEdit = opened.cases[0]!.evidence.map((evidence) => ({ ...evidence }));

    const updated = pacteReducer(opened, {
      type: "case/update",
      caseId: opened.cases[0]!.id,
      changes: { status: "sent", note: "Courrier envoyé." },
      now: LATER,
    });

    expect(updated.cases[0]).toMatchObject({ status: "sent", note: "Courrier envoyé." });
    expect(updated.cases[0]?.timeline.at(-1)).toEqual({
      at: LATER.toISOString(),
      status: "sent",
      note: "Courrier envoyé.",
    });
    expect(updated.cases[0]?.evidence).toEqual(evidenceBeforeEdit);
    expect(opened.cases[0]?.status).toBe("review");
  });

  it("classe une anomalie une seule fois", () => {
    const initial = emptyState();
    const dismissed = pacteReducer(initial, {
      type: "anomaly/dismiss",
      anomalyId: "anomaly-1",
    });
    const dismissedAgain = pacteReducer(dismissed, {
      type: "anomaly/dismiss",
      anomalyId: "anomaly-1",
    });

    expect(dismissed.dismissedAnomalyIds).toEqual(["anomaly-1"]);
    expect(dismissedAgain).toBe(dismissed);
  });

  it("importe une sauvegarde par valeur et restaure la démonstration", () => {
    const backup = createDemoState();
    backup.household.name = "Sauvegarde importée";

    const imported = pacteReducer(emptyState(), { type: "state/replace", state: backup });
    backup.household.name = "Sauvegarde modifiée après import";
    const restored = pacteReducer(imported, { type: "demo/restore" });

    expect(imported.household.name).toBe("Sauvegarde importée");
    expect(restored).toEqual(createDemoState());
    expect(restored).not.toBe(imported);
  });

  it("crée un coffre vide en conservant les coordonnées du foyer", () => {
    const initial = createDemoState();
    const reset = pacteReducer(initial, { type: "state/reset" });

    expect(reset).toEqual({ ...emptyState(), household: initial.household });
    expect(reset.household).not.toBe(initial.household);
  });
});
