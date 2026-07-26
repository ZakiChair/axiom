import { useCallback, useMemo, useRef, useState } from "react";

import { createDemoState } from "../data/demo";
import { analyseState, computeControlScore } from "../domain/analyse";
import type {
  Anomaly,
  ClaimCase,
  Contract,
  PacteState,
  Transaction,
} from "../domain/model";
import { commitPacteAction } from "../domain/mutations";
import type { MutationResult } from "../domain/mutations";
import type { PacteAction } from "../domain/reducer";
import { loadState, saveState } from "../infra/storage";

type CaseChanges = Partial<Pick<ClaimCase, "status" | "note" | "letter">>;

function initializeState(): PacteState {
  return loadState() ?? createDemoState();
}

export function usePacte() {
  const [state, setState] = useState(initializeState);
  const stateRef = useRef(state);

  const commit = useCallback((action: PacteAction): MutationResult => {
    const outcome = commitPacteAction(stateRef.current, action, saveState);
    if (outcome.state !== stateRef.current) {
      stateRef.current = outcome.state;
      setState(outcome.state);
    }
    return outcome.result;
  }, []);

  const analysis = useMemo(() => {
    const now = new Date();
    const anomalies = analyseState(state, now);

    return {
      anomalies,
      score: computeControlScore(state, anomalies, now),
    };
  }, [state]);

  const addContract = useCallback((contract: Contract) => {
    return commit({ type: "contract/add", contract });
  }, [commit]);

  const removeContract = useCallback((contractId: string) => {
    return commit({ type: "contract/remove", contractId });
  }, [commit]);

  const importTransactions = useCallback((transactions: Transaction[]) => {
    return commit({ type: "transactions/import", transactions });
  }, [commit]);

  const openCase = useCallback((anomaly: Anomaly) => {
    return commit({ type: "case/open", anomaly, now: new Date() });
  }, [commit]);

  const updateCase = useCallback((caseId: string, changes: CaseChanges) => {
    return commit({ type: "case/update", caseId, changes, now: new Date() });
  }, [commit]);

  const dismissAnomaly = useCallback((anomalyId: string) => {
    return commit({ type: "anomaly/dismiss", anomalyId });
  }, [commit]);

  const replaceState = useCallback((replacement: PacteState) => {
    return commit({ type: "state/replace", state: replacement });
  }, [commit]);

  const restoreDemo = useCallback(() => {
    return commit({ type: "demo/restore" });
  }, [commit]);

  const resetEmpty = useCallback(() => {
    return commit({ type: "state/reset" });
  }, [commit]);

  return {
    state,
    anomalies: analysis.anomalies,
    score: analysis.score,
    addContract,
    removeContract,
    importTransactions,
    openCase,
    updateCase,
    dismissAnomaly,
    replaceState,
    restoreDemo,
    resetEmpty,
  };
}
