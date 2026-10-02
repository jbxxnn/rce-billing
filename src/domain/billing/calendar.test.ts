import { describe, it, expect } from "vitest";
import { nextBillingAnchor, usagePeriodForBillingDate } from "./calendar";
import { parseUsd, formatUsd } from "./money";
describe("confirmed billing calendar", () => {
  it.each([29, 30, 31])(
    "clamps day %i in February and preserves the configured day",
    (day) => {
      expect(
        nextBillingAnchor(new Date("2025-02-01Z"), day).toISOString(),
      ).toBe("2025-02-28T11:00:00.000Z");
      expect(
        nextBillingAnchor(new Date("2024-02-01Z"), day).toISOString(),
      ).toBe("2024-02-29T11:00:00.000Z");
      expect(
        nextBillingAnchor(new Date("2025-02-28T11:00:00Z"), day).toISOString(),
      ).toBe(`2025-03-${day}T11:00:00.000Z`);
    },
  );
  it("uses strictly future 11 UTC anchors, including year rollover", () => {
    expect(
      nextBillingAnchor(new Date("2026-12-31T10:59:59.999Z"), 31).toISOString(),
    ).toBe("2026-12-31T11:00:00.000Z");
    expect(
      nextBillingAnchor(new Date("2026-12-31T11:00:00Z"), 31).toISOString(),
    ).toBe("2027-01-31T11:00:00.000Z");
    expect(nextBillingAnchor(new Date("2026-04-01Z"), 31).toISOString()).toBe(
      "2026-04-30T11:00:00.000Z",
    );
    expect(
      nextBillingAnchor(
        new Date("2026-01-15T12:00:00+01:00"),
        15,
      ).toISOString(),
    ).toBe("2026-02-15T11:00:00.000Z");
  });
  it("keeps days 1–28 and prior-month usage independent of anchor day", () => {
    for (let day = 1; day <= 28; day++)
      expect(
        nextBillingAnchor(new Date("2026-02-01T00:00Z"), day).getUTCDate(),
      ).toBe(day);
    for (let day = 1; day <= 31; day++)
      expect(
        usagePeriodForBillingDate(new Date(Date.UTC(2026, 0, day, 11))),
      ).toEqual({ periodStart: "2025-12-01", periodEnd: "2026-01-01" });
  });
  it("rejects invalid dates and configured days", () => {
    for (const day of [0, 32, 1.5, NaN])
      expect(() => nextBillingAnchor(new Date(), day)).toThrow();
    expect(() => nextBillingAnchor(new Date(NaN), 1)).toThrow();
  });
});
describe("exact USD conversion", () => {
  it.each([
    "0.00",
    "0.01",
    "12.34",
    "90071992547409.93",
    "92233720368547758.07",
  ])("round trips %s without floating point", (value) =>
    expect(formatUsd(parseUsd(value))).toBe(value),
  );
  it.each(["-1", "1.001", "1e2", "01", "NaN", "92233720368547758.08"])(
    "rejects invalid amount %s",
    (value) => expect(() => parseUsd(value)).toThrow(),
  );
});
