import type { Currency } from "./model";

const currencyFormatters = new Map<Currency, Intl.NumberFormat>();
const calendarDateFormatter = new Intl.DateTimeFormat("fr-CH", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const timestampFormatter = new Intl.DateTimeFormat("fr-CH", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatCurrency(amount: number, currency: Currency): string {
  let formatter = currencyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("fr-CH", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    currencyFormatters.set(currency, formatter);
  }
  return formatter.format(amount);
}

export function formatCalendarDate(value: string): string {
  return calendarDateFormatter.format(new Date(`${value}T00:00:00.000Z`));
}

export function formatTimestamp(value: string): string {
  return timestampFormatter.format(new Date(value));
}

export function localDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}
