import type {
  Contract,
  ContractCadence,
  ContractStatus,
  Currency,
  Transaction,
} from "./model";
import {
  MAX_ABSOLUTE_AMOUNT,
  MAX_NOTICE_DAYS,
  isBoundedAmount,
  isBusinessIsoDate,
} from "./limits";

export type ContractEntryInput = {
  provider: string;
  amount: string;
  currency: string;
  cadence: string;
  startDate: string;
  category: string;
  reference: string;
  nextRenewalDate: string;
  noticeDays: string;
  status: string;
  terminatedAt?: string;
  expectsRefund?: boolean;
  expectedRefundAmount?: string;
  expectedRefundDueDate?: string;
  merchantAliases: string;
  notes: string;
  sourceText: string;
  sourceFileName?: string;
  sourceFileType?: string;
};

export type TransactionEntryInput = {
  date: string;
  label: string;
  amount: string;
  currency: string;
  contractId?: string;
};

export type EntryErrors<T> = Partial<Record<keyof T, string>>;

export function hasEntryErrors(errors: object): boolean {
  return Object.values(errors).some((message: unknown) => (
    typeof message === "string" && message.length > 0
  ));
}

export function firstInvalidField<Field extends PropertyKey>(
  errors: Partial<Record<Field, string>>,
  order: readonly Field[],
): Field | undefined {
  return order.find((field) => errors[field] !== undefined);
}

const CURRENCIES: Currency[] = ["CHF", "EUR"];
const CADENCES: ContractCadence[] = ["monthly", "quarterly", "annual", "one-off"];
const STATUSES: ContractStatus[] = ["active", "paused", "terminated"];

function isCurrency(value: string): value is Currency {
  return CURRENCIES.some((currency) => currency === value);
}

function isCadence(value: string): value is ContractCadence {
  return CADENCES.some((cadence) => cadence === value);
}

function isStatus(value: string): value is ContractStatus {
  return STATUSES.some((status) => status === value);
}

function isIsoDate(value: string): boolean {
  return isBusinessIsoDate(value);
}

function parseEntryAmount(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  let normalized = value.trim().replace(/[\s'’]/g, "");
  if (!/^[+-]?\d+(?:[.,]\d+)?$/.test(normalized)) return undefined;

  normalized = normalized.replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : undefined;
}

export function validateContractEntry(
  input: ContractEntryInput,
): EntryErrors<ContractEntryInput> {
  const errors: EntryErrors<ContractEntryInput> = {};
  const amount = parseEntryAmount(input.amount);
  const refundAmount = parseEntryAmount(input.expectedRefundAmount);
  const noticeDays = input.noticeDays.trim() === "" ? 0 : Number(input.noticeDays);

  if (input.provider.trim() === "") errors.provider = "Indiquez le fournisseur.";
  if (amount === undefined || amount <= 0) {
    errors.amount = "Indiquez un montant supérieur à zéro.";
  } else if (!isBoundedAmount(amount)) {
    errors.amount = "Indiquez un montant dans la limite autorisée.";
  }
  if (!isCurrency(input.currency)) errors.currency = "Choisissez une devise proposée.";
  if (!isCadence(input.cadence)) errors.cadence = "Choisissez une cadence proposée.";
  if (!isIsoDate(input.startDate)) errors.startDate = "Indiquez une date de début valide.";
  if (input.nextRenewalDate.trim() !== "" && !isIsoDate(input.nextRenewalDate)) {
    errors.nextRenewalDate = "Indiquez une date de renouvellement valide.";
  }
  if (!Number.isInteger(noticeDays) || noticeDays < 0) {
    errors.noticeDays = "Indiquez un nombre entier de jours positif ou nul.";
  } else if (noticeDays > MAX_NOTICE_DAYS) {
    errors.noticeDays = `Le préavis ne peut pas dépasser ${MAX_NOTICE_DAYS} jours.`;
  }
  if (!isStatus(input.status)) errors.status = "Choisissez un statut proposé.";
  if (input.status === "terminated" && !isIsoDate(input.terminatedAt ?? "")) {
    errors.terminatedAt = "Indiquez la date de résiliation.";
  }
  if (input.expectsRefund) {
    if (refundAmount === undefined || refundAmount <= 0) {
      errors.expectedRefundAmount = "Indiquez un remboursement supérieur à zéro.";
    } else if (refundAmount > MAX_ABSOLUTE_AMOUNT) {
      errors.expectedRefundAmount = "Indiquez un remboursement dans la limite autorisée.";
    }
    if (!isIsoDate(input.expectedRefundDueDate ?? "")) {
      errors.expectedRefundDueDate = "Indiquez une date de remboursement valide.";
    }
  }

  return errors;
}

export function buildContractEntry(input: ContractEntryInput, id: string): Contract {
  const aliases: string[] = [];
  const knownAliases = new Set<string>();

  for (const value of input.merchantAliases.split(/[,\n]/)) {
    const alias = value.trim();
    const fingerprint = alias.toLocaleLowerCase("fr-CH");
    if (alias === "" || knownAliases.has(fingerprint)) continue;
    knownAliases.add(fingerprint);
    aliases.push(alias);
  }

  return {
    id,
    provider: input.provider.trim(),
    category: input.category.trim(),
    reference: input.reference.trim(),
    amount: parseEntryAmount(input.amount)!,
    currency: input.currency as Currency,
    cadence: input.cadence as ContractCadence,
    startDate: input.startDate,
    ...(input.nextRenewalDate.trim() === "" ? {} : { nextRenewalDate: input.nextRenewalDate }),
    noticeDays: input.noticeDays.trim() === "" ? 0 : Number(input.noticeDays),
    status: input.status as ContractStatus,
    ...(input.status === "terminated" ? { terminatedAt: input.terminatedAt ?? "" } : {}),
    ...(input.expectsRefund
      ? {
        expectedRefund: {
          amount: parseEntryAmount(input.expectedRefundAmount)!,
          dueDate: input.expectedRefundDueDate ?? "",
        },
      }
      : {}),
    merchantAliases: aliases,
    notes: input.notes.trim(),
    ...(input.sourceText.trim() === "" ? {} : { sourceText: input.sourceText.trim() }),
    ...((input.sourceFileName ?? "").trim() === ""
      ? {}
      : {
        sourceFile: {
          name: input.sourceFileName!.trim(),
          type: (input.sourceFileType ?? "").trim() || "application/octet-stream",
        },
      }),
  };
}

export function validateTransactionEntry(
  input: TransactionEntryInput,
): EntryErrors<TransactionEntryInput> {
  const errors: EntryErrors<TransactionEntryInput> = {};
  const amount = parseEntryAmount(input.amount);

  if (!isIsoDate(input.date)) errors.date = "Indiquez une date valide.";
  if (input.label.trim() === "") errors.label = "Indiquez le libellé du mouvement.";
  if (amount === undefined || amount === 0) {
    errors.amount = "Indiquez un montant différent de zéro.";
  } else if (!isBoundedAmount(amount)) {
    errors.amount = "Indiquez un montant dans la limite autorisée.";
  }
  if (!isCurrency(input.currency)) errors.currency = "Choisissez une devise proposée.";

  return errors;
}

export function buildTransactionEntry(
  input: TransactionEntryInput,
  id: string,
  importedAt: string,
): Transaction {
  return {
    id,
    date: input.date,
    label: input.label.trim(),
    amount: parseEntryAmount(input.amount)!,
    currency: input.currency as Currency,
    ...((input.contractId ?? "").trim() === ""
      ? {}
      : { contractId: input.contractId!.trim() }),
    importedAt,
  };
}
