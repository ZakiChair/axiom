export const MAX_ABSOLUTE_AMOUNT = 1_000_000_000;
export const MAX_NOTICE_DAYS = 3_650;

const MIN_BUSINESS_YEAR = 1900;
const MAX_BUSINESS_YEAR = 2200;
const DAY_MS = 24 * 60 * 60 * 1_000;

export function isBoundedAmount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= MAX_ABSOLUTE_AMOUNT
  );
}

export function isPositiveAmount(value: unknown): value is number {
  return isBoundedAmount(value) && value > 0;
}

export function isNonZeroAmount(value: unknown): value is number {
  return isBoundedAmount(value) && value !== 0;
}

export function isNonNegativeAmount(value: unknown): value is number {
  return isBoundedAmount(value) && value >= 0;
}

export function isNoticeDays(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_NOTICE_DAYS
  );
}

export function isBusinessIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_BUSINESS_YEAR || year > MAX_BUSINESS_YEAR || month < 1 || month > 12) {
    return false;
  }

  const februaryDays = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  const daysInMonth = [31, februaryDays, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1]!;
}

export function isoDateMs(value: string): number | undefined {
  if (!isBusinessIsoDate(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day);
}

export function shiftIsoDate(value: string, days: number): string | undefined {
  const time = isoDateMs(value);
  if (time === undefined || !Number.isInteger(days) || Math.abs(days) > MAX_NOTICE_DAYS) {
    return undefined;
  }

  const shifted = new Date(time + days * DAY_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  const result = `${year}-${month}-${day}`;
  return isBusinessIsoDate(result) ? result : undefined;
}
