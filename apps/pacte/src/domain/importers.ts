import type { Currency, Transaction } from "./model";
import { normalizeMerchant } from "./normalize";

export type CsvImportDefaults = {
  currency: Currency;
  importedAt?: string;
};

export type CsvImportResult = {
  transactions: Transaction[];
  skippedRows: number;
  warnings: string[];
};

export type ContractHints = {
  amount?: number;
  currency?: Currency;
  noticeDays?: number;
};

type CsvColumns = {
  date?: number;
  label?: number;
  amount?: number;
  currency?: number;
  debit?: number;
  credit?: number;
};

const COLUMN_NAMES: Record<keyof CsvColumns, string[]> = {
  date: ["date", "dateoperation", "datevaleur", "operationdate", "transactiondate"],
  label: ["libelle", "description", "label", "intitule", "merchant", "details"],
  amount: ["montant", "amount", "somme", "total"],
  currency: ["devise", "currency", "monnaie"],
  debit: ["debit", "debits"],
  credit: ["credit", "credits"],
};

function normalizeHeader(value: string): string {
  return normalizeMerchant(value).replace(/\s/g, "");
}

function detectSeparator(header: string): string {
  const candidates = [";", ",", "\t"];
  let separator = ";";
  let highestCount = -1;

  for (const candidate of candidates) {
    let count = 0;
    let quoted = false;

    for (let index = 0; index < header.length; index += 1) {
      const character = header[index];
      if (character === '"') {
        quoted = !quoted;
      } else if (!quoted && character === candidate) {
        count += 1;
      }
    }

    if (count > highestCount) {
      separator = candidate;
      highestCount = count;
    }
  }

  return separator;
}

function parseCsv(text: string, separator: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (!quoted && character === separator) {
      row.push(field.trim());
      field = "";
      continue;
    }

    if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += character;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    rows.push(row);
  }

  return rows;
}

function parseDate(value: string): string | undefined {
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed) ?? /^(\d{2})[./-](\d{2})[./-](\d{4})$/.exec(trimmed);

  if (match === null) {
    return undefined;
  }

  const isoDate = match[1]?.length === 4
    ? `${match[1]}-${match[2]}-${match[3]}`
    : `${match[3]}-${match[2]}-${match[1]}`;
  const parsedDate = new Date(`${isoDate}T00:00:00.000Z`);

  return parsedDate.toISOString().slice(0, 10) === isoDate ? isoDate : undefined;
}

function parseAmount(value: string): number | undefined {
  let normalized = value.trim().replace(/[\s'’]/g, "");
  let negative = false;

  if (/^\(.*\)$/.test(normalized)) {
    negative = true;
    normalized = normalized.slice(1, -1);
  }

  if (!/^[+-]?[\d.,]+$/.test(normalized)) {
    return undefined;
  }

  const explicitSign = normalized.startsWith("-") ? -1 : 1;
  normalized = normalized.replace(/^[+-]/, "");
  const lastComma = normalized.lastIndexOf(",");
  const lastDot = normalized.lastIndexOf(".");
  const decimalIndex = Math.max(lastComma, lastDot);
  let numericText: string;

  if (lastComma >= 0 && lastDot >= 0) {
    numericText = `${normalized.slice(0, decimalIndex).replace(/[.,]/g, "")}.${normalized.slice(decimalIndex + 1)}`;
  } else if (decimalIndex >= 0 && normalized.length - decimalIndex - 1 <= 2) {
    numericText = `${normalized.slice(0, decimalIndex).replace(/[.,]/g, "")}.${normalized.slice(decimalIndex + 1)}`;
  } else {
    numericText = normalized.replace(/[.,]/g, "");
  }

  const amount = Number(numericText);
  if (!Number.isFinite(amount)) {
    return undefined;
  }

  return amount * explicitSign * (negative ? -1 : 1);
}

function resolveColumns(header: string[]): CsvColumns {
  const columns: CsvColumns = {};

  for (let index = 0; index < header.length; index += 1) {
    const normalized = normalizeHeader(header[index] ?? "");
    for (const [column, names] of Object.entries(COLUMN_NAMES) as [keyof CsvColumns, string[]][]) {
      if (columns[column] === undefined && names.includes(normalized)) {
        columns[column] = index;
      }
    }
  }

  return columns;
}

function csvValue(row: string[], index: number | undefined): string {
  return index === undefined ? "" : row[index] ?? "";
}

function currencyFrom(value: string, fallback: Currency): Currency {
  const normalized = value.trim().toUpperCase();
  return normalized === "CHF" || normalized === "EUR" ? normalized : fallback;
}

function stableTransactionId(fingerprint: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < fingerprint.length; index += 1) {
    hash ^= fingerprint.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `transaction-${(hash >>> 0).toString(36)}`;
}

export function parseTransactionCsv(text: string, defaults: CsvImportDefaults): CsvImportResult {
  const firstHeaderLine = text.replace(/^\uFEFF/, "").split(/\r?\n/).find((line) => line.trim().length > 0);
  const warnings: string[] = [];

  if (firstHeaderLine === undefined) {
    return { transactions: [], skippedRows: 0, warnings: ["Le fichier CSV est vide."] };
  }

  const rows = parseCsv(text.replace(/^\uFEFF/, ""), detectSeparator(firstHeaderLine));
  const headerIndex = rows.findIndex((row) => row.some((value) => value.trim().length > 0));
  const header = rows[headerIndex];

  if (header === undefined) {
    return { transactions: [], skippedRows: 0, warnings: ["Le fichier CSV est vide."] };
  }

  const columns = resolveColumns(header);
  if (columns.date === undefined || columns.label === undefined || (columns.amount === undefined && columns.debit === undefined && columns.credit === undefined)) {
    return {
      transactions: [],
      skippedRows: rows.slice(headerIndex + 1).filter((row) => row.some((value) => value.trim().length > 0)).length,
      warnings: ["L'en-tête CSV ne contient pas les colonnes nécessaires."],
    };
  }

  const transactions: Transaction[] = [];
  const fingerprints = new Set<string>();
  let skippedRows = 0;

  for (const row of rows.slice(headerIndex + 1)) {
    if (!row.some((value) => value.trim().length > 0)) {
      skippedRows += 1;
      continue;
    }

    const date = parseDate(csvValue(row, columns.date));
    const label = csvValue(row, columns.label).trim();
    const debit = parseAmount(csvValue(row, columns.debit));
    const credit = parseAmount(csvValue(row, columns.credit));
    const amount = columns.amount === undefined ? undefined : parseAmount(csvValue(row, columns.amount));
    const signedAmount = amount ?? (debit !== undefined && credit === undefined ? Math.abs(debit) : credit !== undefined && debit === undefined ? -Math.abs(credit) : undefined);

    if (date === undefined || label.length === 0 || signedAmount === undefined) {
      skippedRows += 1;
      warnings.push("Une ligne CSV invalide a été ignorée.");
      continue;
    }

    const currency = currencyFrom(csvValue(row, columns.currency), defaults.currency);
    const fingerprint = `${date}|${normalizeMerchant(label)}|${signedAmount.toFixed(2)}|${currency}`;
    if (fingerprints.has(fingerprint)) {
      skippedRows += 1;
      warnings.push("Un doublon interne a été ignoré.");
      continue;
    }

    fingerprints.add(fingerprint);
    transactions.push({
      id: stableTransactionId(fingerprint),
      date,
      label,
      amount: signedAmount,
      currency,
      ...(defaults.importedAt === undefined ? {} : { importedAt: defaults.importedAt }),
    });
  }

  return { transactions, skippedRows, warnings };
}

export function extractContractHints(text: string): ContractHints {
  const currencyMatch = /\b(CHF|EUR)\b/i.exec(text);
  const amountMatch = /\b(?:CHF|EUR)\s*([\d](?:[\d\s'’.,]*\d)?)|([\d](?:[\d\s'’.,]*\d)?)\s*(?:CHF|EUR)\b/i.exec(text);
  const noticeMatch = /(?:préavis|preavis)\s*(?:de\s*)?(\d+)\s*jours|\b(\d+)\s*jours\s*(?:de\s*)?(?:préavis|preavis)/i.exec(text);
  const amount = parseAmount(amountMatch?.[1] ?? amountMatch?.[2] ?? "");
  const currency = currencyMatch === null ? undefined : currencyFrom(currencyMatch[1] ?? "", "CHF");
  const noticeDays = Number(noticeMatch?.[1] ?? noticeMatch?.[2]);

  return {
    ...(amount === undefined ? {} : { amount }),
    ...(currency === undefined ? {} : { currency }),
    ...(Number.isInteger(noticeDays) && noticeDays >= 0 ? { noticeDays } : {}),
  };
}
