export type Currency = "CHF" | "EUR";

export type ContractStatus = "active" | "terminated" | "paused";
export type ContractCadence = "monthly" | "quarterly" | "annual" | "one-off";
export type ClaimCaseStatus =
  | "review"
  | "ready"
  | "sent"
  | "answered"
  | "resolved"
  | "abandoned";
export type AnomalyKind =
  | "duplicate"
  | "price-increase"
  | "post-termination"
  | "missing-refund"
  | "deadline";
export type AnomalySeverity = "critical" | "important" | "vigilance";
export type AnomalyConfidence = "high" | "medium" | "low";

export type ExpectedRefund = {
  amount: number;
  dueDate: string;
};

export type ContractSourceFile = {
  name: string;
  type: string;
};

export type Contract = {
  id: string;
  provider: string;
  category: string;
  reference: string;
  amount: number;
  currency: Currency;
  cadence: ContractCadence;
  startDate: string;
  nextRenewalDate?: string;
  noticeDays: number;
  status: ContractStatus;
  terminatedAt?: string;
  expectedRefund?: ExpectedRefund;
  merchantAliases: string[];
  notes: string;
  sourceText?: string;
  sourceFile?: ContractSourceFile;
};

export type Transaction = {
  id: string;
  date: string;
  label: string;
  amount: number;
  currency: Currency;
  contractId?: string;
  importedAt?: string;
};

export type AnomalyEvidence = {
  id: string;
  date: string;
  label: string;
  amount: number;
  currency: Currency;
};

export type Anomaly = {
  id: string;
  kind: AnomalyKind;
  severity: AnomalySeverity;
  confidence: AnomalyConfidence;
  title: string;
  explanation: string;
  amount: number;
  currency: Currency;
  contractId?: string;
  transactionIds: string[];
  evidence: AnomalyEvidence[];
};

export type ClaimCaseEvent = {
  at: string;
  status: ClaimCaseStatus;
  note: string;
};

export type ClaimAnomalySnapshot = Pick<
  Anomaly,
  "kind" | "title" | "explanation" | "amount"
> & { currency?: Currency };

export type ClaimCase = {
  id: string;
  anomalyId: string;
  anomalySnapshot: ClaimAnomalySnapshot;
  status: ClaimCaseStatus;
  createdAt: string;
  contractSnapshot: Contract;
  evidence: AnomalyEvidence[];
  timeline: ClaimCaseEvent[];
  note: string;
  letter: string;
};

export type PacteState = {
  schemaVersion: 1;
  household: { name: string; currency: Currency };
  contracts: Contract[];
  transactions: Transaction[];
  cases: ClaimCase[];
  dismissedAnomalyIds: string[];
};
