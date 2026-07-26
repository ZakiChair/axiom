import type { PacteState } from "./model";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePacteState(value: unknown): PacteState | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.household)) {
    return null;
  }

  if (
    typeof value.household.name !== "string" ||
    (value.household.currency !== "CHF" && value.household.currency !== "EUR") ||
    !Array.isArray(value.contracts) ||
    !Array.isArray(value.transactions) ||
    !Array.isArray(value.cases) ||
    !Array.isArray(value.dismissedAnomalyIds)
  ) {
    return null;
  }

  return value as PacteState;
}
