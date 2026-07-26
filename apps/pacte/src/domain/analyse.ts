import type {
  Anomaly,
  AnomalyEvidence,
  AnomalySeverity,
  Contract,
  PacteState,
  Transaction,
} from "./model";
import { matchContract, normalizeMerchant } from "./normalize";

const DAY_MS = 24 * 60 * 60 * 1_000;
const DUPLICATE_WINDOW_DAYS = 7;
const PRICE_TOLERANCE = 0.02;
const DEADLINE_WINDOW_DAYS = 30;

type MatchedTransaction = {
  transaction: Transaction;
  contract: Contract;
};

function isoDateMs(value: string): number {
  return Date.parse(`${value}T00:00:00.000Z`);
}

function todayMs(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function addDays(value: string, days: number): string {
  return new Date(isoDateMs(value) + days * DAY_MS).toISOString().slice(0, 10);
}

function formatAmount(amount: number, currency: Contract["currency"]): string {
  return new Intl.NumberFormat("fr-CH", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("fr-CH", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function transactionEvidence(transaction: Transaction): AnomalyEvidence {
  return {
    id: transaction.id,
    date: transaction.date,
    label: transaction.label,
    amount: transaction.amount,
    currency: transaction.currency,
  };
}

function matchedTransactions(state: PacteState): MatchedTransaction[] {
  const contractsById = new Map(state.contracts.map((contract) => [contract.id, contract]));

  return state.transactions.flatMap((transaction) => {
    const explicitContract = transaction.contractId
      ? contractsById.get(transaction.contractId)
      : undefined;
    const matchedId = explicitContract ? undefined : matchContract(transaction, state.contracts);
    const contract = explicitContract ?? (matchedId ? contractsById.get(matchedId) : undefined);

    return contract ? [{ transaction, contract }] : [];
  });
}

function duplicateAnomalies(matched: MatchedTransaction[]): Anomaly[] {
  const debits = matched
    .filter(({ transaction }) => transaction.amount > 0)
    .sort(
      (left, right) =>
        left.transaction.date.localeCompare(right.transaction.date) ||
        left.transaction.id.localeCompare(right.transaction.id),
    );
  const anomalies: Anomaly[] = [];

  for (let leftIndex = 0; leftIndex < debits.length; leftIndex += 1) {
    const left = debits[leftIndex];
    if (!left) continue;

    for (let rightIndex = leftIndex + 1; rightIndex < debits.length; rightIndex += 1) {
      const right = debits[rightIndex];
      if (!right) continue;

      const elapsedDays =
        (isoDateMs(right.transaction.date) - isoDateMs(left.transaction.date)) / DAY_MS;
      if (elapsedDays > DUPLICATE_WINDOW_DAYS) break;

      const sameProvider =
        normalizeMerchant(left.contract.provider) === normalizeMerchant(right.contract.provider);
      const sameAmount =
        left.transaction.amount === right.transaction.amount &&
        left.transaction.currency === right.transaction.currency;
      if (!sameProvider || !sameAmount) continue;

      const transactionIds = [left.transaction.id, right.transaction.id].sort();
      const contractId =
        left.contract.id === right.contract.id ? left.contract.id : undefined;

      anomalies.push({
        id: `anomaly:duplicate:${transactionIds.join(":")}`,
        kind: "duplicate",
        severity: "critical",
        confidence: "high",
        title: `Double débit possible — ${left.contract.provider}`,
        explanation: `Deux débits de ${formatAmount(left.transaction.amount, left.transaction.currency)} ont été relevés à sept jours d’intervalle ou moins.`,
        amount: left.transaction.amount,
        contractId,
        transactionIds,
        evidence: [left.transaction, right.transaction]
          .sort(
            (first, second) =>
              first.date.localeCompare(second.date) || first.id.localeCompare(second.id),
          )
          .map(transactionEvidence),
      });
    }
  }

  return anomalies;
}

function priceIncreaseAnomalies(matched: MatchedTransaction[]): Anomaly[] {
  return matched.flatMap(({ transaction, contract }) => {
    if (
      transaction.amount <= 0 ||
      transaction.currency !== contract.currency ||
      transaction.amount <= contract.amount * (1 + PRICE_TOLERANCE)
    ) {
      return [];
    }

    const recoverableAmount = transaction.amount - contract.amount;

    return [{
      id: `anomaly:price-increase:${contract.id}:${transaction.id}`,
      kind: "price-increase",
      severity: "important",
      confidence: "high",
      title: `Hausse de prix — ${contract.provider}`,
      explanation: `Le débit du ${formatDate(transaction.date)} dépasse le prix contractuel de ${formatAmount(recoverableAmount, contract.currency)}.`,
      amount: recoverableAmount,
      contractId: contract.id,
      transactionIds: [transaction.id],
      evidence: [transactionEvidence(transaction)],
    } satisfies Anomaly];
  });
}

function postTerminationAnomalies(matched: MatchedTransaction[]): Anomaly[] {
  return matched.flatMap(({ transaction, contract }) => {
    if (
      transaction.amount <= 0 ||
      contract.status !== "terminated" ||
      !contract.terminatedAt ||
      transaction.date <= contract.terminatedAt
    ) {
      return [];
    }

    return [{
      id: `anomaly:post-termination:${contract.id}:${transaction.id}`,
      kind: "post-termination",
      severity: "critical",
      confidence: "high",
      title: `Débit après résiliation — ${contract.provider}`,
      explanation: `Un débit de ${formatAmount(transaction.amount, transaction.currency)} a été relevé le ${formatDate(transaction.date)}, après la résiliation du ${formatDate(contract.terminatedAt)}.`,
      amount: transaction.amount,
      contractId: contract.id,
      transactionIds: [transaction.id],
      evidence: [transactionEvidence(transaction)],
    } satisfies Anomaly];
  });
}

function missingRefundAnomalies(
  state: PacteState,
  matched: MatchedTransaction[],
  now: Date,
): Anomaly[] {
  const nowDateMs = todayMs(now);

  return state.contracts.flatMap((contract) => {
    const expectedRefund = contract.expectedRefund;
    if (!expectedRefund || isoDateMs(expectedRefund.dueDate) > nowDateMs) return [];

    const matchingCredit = matched.some(({ transaction, contract: matchedContract }) => {
      if (
        matchedContract.id !== contract.id ||
        transaction.amount >= 0 ||
        transaction.currency !== contract.currency
      ) {
        return false;
      }

      return (
        Math.abs(Math.abs(transaction.amount) - expectedRefund.amount) <=
        expectedRefund.amount * PRICE_TOLERANCE
      );
    });
    if (matchingCredit) return [];

    const evidence: AnomalyEvidence = {
      id: `expected-refund:${contract.id}:${expectedRefund.dueDate}`,
      date: expectedRefund.dueDate,
      label: `Remboursement attendu de ${contract.provider}`,
      amount: -expectedRefund.amount,
      currency: contract.currency,
    };

    return [{
      id: `anomaly:missing-refund:${contract.id}:${expectedRefund.dueDate}:${expectedRefund.amount}`,
      kind: "missing-refund",
      severity: "important",
      confidence: "high",
      title: `Remboursement manquant — ${contract.provider}`,
      explanation: `Le remboursement de ${formatAmount(expectedRefund.amount, contract.currency)} attendu au ${formatDate(expectedRefund.dueDate)} n’a pas de crédit correspondant.`,
      amount: expectedRefund.amount,
      contractId: contract.id,
      transactionIds: [],
      evidence: [evidence],
    } satisfies Anomaly];
  });
}

function deadlineAnomalies(state: PacteState, now: Date): Anomaly[] {
  const from = todayMs(now);
  const until = from + DEADLINE_WINDOW_DAYS * DAY_MS;

  return state.contracts.flatMap((contract) => {
    if (contract.status !== "active" || !contract.nextRenewalDate) return [];

    const deadline = addDays(contract.nextRenewalDate, -contract.noticeDays);
    const deadlineMs = isoDateMs(deadline);
    if (deadlineMs < from || deadlineMs > until) return [];

    const evidence: AnomalyEvidence = {
      id: `notice-deadline:${contract.id}:${deadline}`,
      date: deadline,
      label: `Préavis pour ${contract.provider}`,
      amount: 0,
      currency: contract.currency,
    };

    return [{
      id: `anomaly:deadline:${contract.id}:${deadline}`,
      kind: "deadline",
      severity: "vigilance",
      confidence: "high",
      title: `Échéance proche — ${contract.provider}`,
      explanation: `Le préavis doit être exercé au plus tard le ${formatDate(deadline)} pour le renouvellement du ${formatDate(contract.nextRenewalDate)}.`,
      amount: 0,
      contractId: contract.id,
      transactionIds: [],
      evidence: [evidence],
    } satisfies Anomaly];
  });
}

const SEVERITY_ORDER: Record<AnomalySeverity, number> = {
  critical: 0,
  important: 1,
  vigilance: 2,
};

function anomalyDate(anomaly: Anomaly): string {
  return anomaly.evidence.reduce(
    (latest, evidence) => (evidence.date > latest ? evidence.date : latest),
    "",
  );
}

export function analyseState(state: PacteState, now: Date): Anomaly[] {
  const matched = matchedTransactions(state);
  const dismissedIds = new Set(state.dismissedAnomalyIds);

  return [
    ...duplicateAnomalies(matched),
    ...priceIncreaseAnomalies(matched),
    ...postTerminationAnomalies(matched),
    ...missingRefundAnomalies(state, matched, now),
    ...deadlineAnomalies(state, now),
  ]
    .filter((anomaly) => !dismissedIds.has(anomaly.id))
    .sort(
      (left, right) =>
        SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
        right.amount - left.amount ||
        anomalyDate(right).localeCompare(anomalyDate(left)) ||
        left.id.localeCompare(right.id),
    );
}

const SCORE_PENALTY: Record<AnomalySeverity, number> = {
  critical: 18,
  important: 12,
  vigilance: 7,
};

export function computeControlScore(
  state: PacteState,
  anomalies: Anomaly[],
  now: Date,
): number {
  const anomalyPenalty = anomalies.reduce(
    (total, anomaly) => total + SCORE_PENALTY[anomaly.severity],
    0,
  );
  const incompleteContractPenalty = state.contracts.filter(
    (contract) => contract.status === "active" && !contract.nextRenewalDate,
  ).length * 5;

  void now;
  return Math.max(0, Math.min(100, 100 - anomalyPenalty - incompleteContractPenalty));
}
