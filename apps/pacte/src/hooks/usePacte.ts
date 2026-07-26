import { useCallback, useEffect, useMemo, useReducer } from "react";

import { createDemoState } from "../data/demo";
import { analyseState, computeControlScore } from "../domain/analyse";
import type {
  Anomaly,
  ClaimCase,
  Contract,
  PacteState,
  Transaction,
} from "../domain/model";
import { pacteReducer } from "../domain/reducer";
import { loadState, saveState } from "../infra/storage";

type CaseChanges = Partial<Pick<ClaimCase, "status" | "note" | "letter">>;

function initializeState(): PacteState {
  return loadState() ?? createDemoState();
}

export function usePacte() {
  const [state, dispatch] = useReducer(pacteReducer, undefined, initializeState);

  useEffect(() => {
    saveState(state);
  }, [state]);

  const analysis = useMemo(() => {
    const now = new Date();
    const anomalies = analyseState(state, now);

    return {
      anomalies,
      score: computeControlScore(state, anomalies, now),
    };
  }, [state]);

  const addContract = useCallback((contract: Contract) => {
    dispatch({ type: "contract/add", contract });
  }, []);

  const removeContract = useCallback((contractId: string) => {
    dispatch({ type: "contract/remove", contractId });
  }, []);

  const importTransactions = useCallback((transactions: Transaction[]) => {
    dispatch({ type: "transactions/import", transactions });
  }, []);

  const openCase = useCallback((anomaly: Anomaly) => {
    dispatch({ type: "case/open", anomaly, now: new Date() });
  }, []);

  const updateCase = useCallback((caseId: string, changes: CaseChanges) => {
    dispatch({ type: "case/update", caseId, changes, now: new Date() });
  }, []);

  const dismissAnomaly = useCallback((anomalyId: string) => {
    dispatch({ type: "anomaly/dismiss", anomalyId });
  }, []);

  const replaceState = useCallback((replacement: PacteState) => {
    dispatch({ type: "state/replace", state: replacement });
  }, []);

  const restoreDemo = useCallback(() => {
    dispatch({ type: "demo/restore" });
  }, []);

  const resetEmpty = useCallback(() => {
    dispatch({ type: "state/reset" });
  }, []);

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
