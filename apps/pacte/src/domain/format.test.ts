import { describe, expect, it } from "vitest";

import {
  formatCalendarDate,
  formatCurrency,
  formatTimestamp,
  localDateKey,
} from "./format";

describe("formateurs français partagés", () => {
  it("présente montants, dates civiles et horodatages sans décalage de jour", () => {
    expect(formatCurrency(89.9, "CHF").replace(/\s/g, " ")).toBe("89.90 CHF");
    expect(formatCalendarDate("2026-07-26")).toBe("26 juil. 2026");
    expect(formatTimestamp("2026-07-26T21:15:00.000Z")).toContain("26 juil. 2026");
  });
});

describe("date civile locale", () => {
  it("conserve le jour local pour un instant situé à 00 h 30", () => {
    expect(localDateKey(new Date(2026, 6, 26, 0, 30))).toBe("2026-07-26");
  });
});
