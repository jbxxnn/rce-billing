import { describe, expect, it } from "vitest";
import { calendarMonthBefore } from "./backfill-calendar";

describe("calendarMonthBefore", () => {
  it("maps a legacy billing-period end to the prior full calendar month", () => {
    expect(calendarMonthBefore("2025-08-18")).toEqual({
      periodStart: "2025-07-01",
      periodEnd: "2025-08-01",
    });
  });

  it("crosses a year boundary", () => {
    expect(calendarMonthBefore("2026-01-18")).toEqual({
      periodStart: "2025-12-01",
      periodEnd: "2026-01-01",
    });
  });
});
