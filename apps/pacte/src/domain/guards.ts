import type {
  AnomalyEvidence,
  ClaimCase,
  ClaimCaseEvent,
  Contract,
  Currency,
  ExpectedRefund,
  PacteState,
  Transaction,
} from "./model";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCurrency(value: unknown): value is Currency {
  return value === "CHF" || value === "EUR";
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsedDate = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsedDate.valueOf()) && parsedDate.toISOString().slice(0, 10) === value;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(
      value,
    );

  if (match === null) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const februaryDays = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  const daysInMonth = [31, februaryDays, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth[month - 1]! &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    !Number.isNaN(Date.parse(value))
  );
}

function isExpectedRefund(value: unknown): value is ExpectedRefund {
  return (
    isRecord(value) &&
    isFiniteNumber(value.amount) &&
    value.amount >= 0 &&
    isIsoDate(value.dueDate)
  );
}

function isContract(value: unknown): value is Contract {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.provider) &&
    isNonEmptyString(value.category) &&
    isNonEmptyString(value.reference) &&
    isFiniteNumber(value.amount) &&
    value.amount >= 0 &&
    isCurrency(value.currency) &&
    (value.cadence === "monthly" ||
      value.cadence === "quarterly" ||
      value.cadence === "annual" ||
      value.cadence === "one-off") &&
    isIsoDate(value.startDate) &&
    isFiniteNumber(value.noticeDays) &&
    Number.isInteger(value.noticeDays) &&
    value.noticeDays >= 0 &&
    (value.status === "active" || value.status === "terminated" || value.status === "paused") &&
    Array.isArray(value.merchantAliases) &&
    value.merchantAliases.every(isNonEmptyString) &&
    typeof value.notes === "string" &&
    (value.nextRenewalDate === undefined || isIsoDate(value.nextRenewalDate)) &&
    (value.terminatedAt === undefined || isIsoDate(value.terminatedAt)) &&
    (value.expectedRefund === undefined || isExpectedRefund(value.expectedRefund)) &&
    (value.sourceText === undefined || typeof value.sourceText === "string")
  );
}

function isTransaction(value: unknown): value is Transaction {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isIsoDate(value.date) &&
    isNonEmptyString(value.label) &&
    isFiniteNumber(value.amount) &&
    isCurrency(value.currency) &&
    (value.contractId === undefined || isNonEmptyString(value.contractId)) &&
    (value.importedAt === undefined || isIsoTimestamp(value.importedAt))
  );
}

function isAnomalyEvidence(value: unknown): value is AnomalyEvidence {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isIsoDate(value.date) &&
    isNonEmptyString(value.label) &&
    isFiniteNumber(value.amount) &&
    isCurrency(value.currency)
  );
}

function isClaimCaseEvent(value: unknown): value is ClaimCaseEvent {
  return (
    isRecord(value) &&
    isIsoTimestamp(value.at) &&
    (value.status === "review" ||
      value.status === "ready" ||
      value.status === "sent" ||
      value.status === "answered" ||
      value.status === "resolved" ||
      value.status === "abandoned") &&
    typeof value.note === "string"
  );
}

function isClaimCase(value: unknown): value is ClaimCase {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.anomalyId) &&
    (value.status === "review" ||
      value.status === "ready" ||
      value.status === "sent" ||
      value.status === "answered" ||
      value.status === "resolved" ||
      value.status === "abandoned") &&
    isIsoTimestamp(value.createdAt) &&
    isContract(value.contractSnapshot) &&
    Array.isArray(value.evidence) &&
    value.evidence.every(isAnomalyEvidence) &&
    Array.isArray(value.timeline) &&
    value.timeline.every(isClaimCaseEvent) &&
    typeof value.note === "string" &&
    typeof value.letter === "string"
  );
}

export function parsePacteState(value: unknown): PacteState | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.household)) {
    return null;
  }

  if (
    typeof value.household.name !== "string" ||
    (value.household.currency !== "CHF" && value.household.currency !== "EUR") ||
    !Array.isArray(value.contracts) ||
    !value.contracts.every(isContract) ||
    !Array.isArray(value.transactions) ||
    !value.transactions.every(isTransaction) ||
    !Array.isArray(value.cases) ||
    !value.cases.every(isClaimCase) ||
    !Array.isArray(value.dismissedAnomalyIds) ||
    !value.dismissedAnomalyIds.every(isNonEmptyString)
  ) {
    return null;
  }

  return value as PacteState;
}
