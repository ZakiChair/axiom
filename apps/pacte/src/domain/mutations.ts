import type { PacteState } from "./model";
import { pacteReducer } from "./reducer";
import type { PacteAction } from "./reducer";

export type MutationResult =
  | { ok: true; changed: number }
  | { ok: false; changed: 0; error: string };

export type MutationOutcome = {
  state: PacteState;
  result: MutationResult;
};

type PersistResult = { ok: true } | { ok: false; error: string };

function changedCount(state: PacteState, next: PacteState, action: PacteAction): number {
  switch (action.type) {
    case "transactions/import":
      return next.transactions.length - state.transactions.length;
    case "contract/add":
    case "contract/remove":
      return Math.abs(next.contracts.length - state.contracts.length);
    default:
      return next === state ? 0 : 1;
  }
}

export function commitPacteAction(
  state: PacteState,
  action: PacteAction,
  persist: (state: PacteState) => PersistResult,
): MutationOutcome {
  const next = pacteReducer(state, action);
  const changed = changedCount(state, next, action);
  if (changed === 0) return { state, result: { ok: true, changed: 0 } };

  const saved = persist(next);
  if (!saved.ok) {
    return {
      state,
      result: { ok: false, changed: 0, error: saved.error },
    };
  }

  return { state: next, result: { ok: true, changed } };
}
