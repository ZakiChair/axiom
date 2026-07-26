import { createDemoState } from "../data/demo";
import { createClaimCase } from "./cases";
import type {
  Anomaly,
  ClaimCase,
  Contract,
  PacteState,
  Transaction,
} from "./model";

type CaseChanges = Partial<Pick<ClaimCase, "status" | "note" | "letter">>;

export type PacteAction =
  | { type: "contract/add"; contract: Contract }
  | { type: "contract/remove"; contractId: string }
  | { type: "transactions/import"; transactions: Transaction[] }
  | { type: "case/open"; anomaly: Anomaly; now: Date }
  | { type: "case/update"; caseId: string; changes: CaseChanges; now: Date }
  | { type: "anomaly/dismiss"; anomalyId: string }
  | { type: "state/replace"; state: PacteState }
  | { type: "demo/restore" }
  | { type: "state/reset" };

function copyContract(contract: Contract): Contract {
  return {
    ...contract,
    expectedRefund: contract.expectedRefund ? { ...contract.expectedRefund } : undefined,
    merchantAliases: [...contract.merchantAliases],
  };
}

function copyCase(claim: ClaimCase): ClaimCase {
  return {
    ...claim,
    contractSnapshot: copyContract(claim.contractSnapshot),
    evidence: claim.evidence.map((evidence) => ({ ...evidence })),
    timeline: claim.timeline.map((event) => ({ ...event })),
  };
}

function copyState(state: PacteState): PacteState {
  return {
    ...state,
    household: { ...state.household },
    contracts: state.contracts.map(copyContract),
    transactions: state.transactions.map((transaction) => ({ ...transaction })),
    cases: state.cases.map(copyCase),
    dismissedAnomalyIds: [...state.dismissedAnomalyIds],
  };
}

function updateCase(
  state: PacteState,
  caseId: string,
  changes: CaseChanges,
  now: Date,
): PacteState {
  const current = state.cases.find((claim) => claim.id === caseId);
  if (!current) return state;

  const statusChanged = changes.status !== undefined && changes.status !== current.status;
  const nextClaim: ClaimCase = {
    ...current,
    ...changes,
    timeline: statusChanged
      ? [
        ...current.timeline,
        {
          at: now.toISOString(),
          status: changes.status!,
          note: changes.note ?? `Statut mis à jour : ${changes.status}.`,
        },
      ]
      : current.timeline,
  };

  return {
    ...state,
    cases: state.cases.map((claim) => (claim.id === caseId ? nextClaim : claim)),
  };
}

export function pacteReducer(state: PacteState, action: PacteAction): PacteState {
  switch (action.type) {
    case "contract/add":
      if (state.contracts.some((contract) => contract.id === action.contract.id)) return state;
      return {
        ...state,
        contracts: [...state.contracts, copyContract(action.contract)],
      };

    case "contract/remove":
      if (!state.contracts.some((contract) => contract.id === action.contractId)) return state;
      return {
        ...state,
        contracts: state.contracts.filter((contract) => contract.id !== action.contractId),
      };

    case "transactions/import": {
      const knownIds = new Set(state.transactions.map((transaction) => transaction.id));
      const additions = action.transactions.filter((transaction) => {
        if (knownIds.has(transaction.id)) return false;
        knownIds.add(transaction.id);
        return true;
      });
      if (additions.length === 0) return state;
      return {
        ...state,
        transactions: [
          ...state.transactions,
          ...additions.map((transaction) => ({ ...transaction })),
        ],
      };
    }

    case "case/open":
      if (state.cases.some((claim) => claim.anomalyId === action.anomaly.id)) return state;
      return {
        ...state,
        cases: [...state.cases, createClaimCase(action.anomaly, state, action.now)],
      };

    case "case/update":
      return updateCase(state, action.caseId, action.changes, action.now);

    case "anomaly/dismiss":
      if (state.dismissedAnomalyIds.includes(action.anomalyId)) return state;
      return {
        ...state,
        dismissedAnomalyIds: [...state.dismissedAnomalyIds, action.anomalyId],
      };

    case "state/replace":
      return copyState(action.state);

    case "demo/restore":
      return createDemoState();

    case "state/reset":
      return {
        schemaVersion: 1,
        household: { ...state.household },
        contracts: [],
        transactions: [],
        cases: [],
        dismissedAnomalyIds: [],
      };
  }
}
