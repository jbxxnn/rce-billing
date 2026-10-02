import { describe, expect, it } from "vitest";
import { heldInvoiceSchedule } from "./schedule";

describe("held invoice subscription schedule", () => {
  it("bridges to the next customer anchor then releases after a full anchored month", () => {
    const schedule = heldInvoiceSchedule({
      customerId: "cus_fixture",
      priceId: "price_fixture",
      billingDay: 31,
      collectionMethod: "charge_automatically",
      subscriptionId: "sub_internal",
      internalCustomerId: "customer_internal",
      quantity: 1,
      now: new Date("2026-04-15T12:00:00.000Z"),
    });
    expect(schedule.start_date).toBe("now");
    expect(schedule.end_behavior).toBe("release");
    expect(schedule.phases).toEqual([
      expect.objectContaining({ end_date: 1777546800 }),
      expect.objectContaining({
        end_date: 1780225200,
        billing_cycle_anchor: "phase_start",
      }),
    ]);
  });
});
