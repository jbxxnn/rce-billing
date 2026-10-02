import { describe, expect, it } from "vitest";
import {
  invoiceSubscriptionId,
  isSubscriptionLine,
  lineSubscriptionId,
} from "./invoice-period";

describe("Stripe invoice period compatibility", () => {
  it("reads a subscription from both the current and legacy invoice shapes", () => {
    expect(
      invoiceSubscriptionId({
        parent: { subscription_details: { subscription: "sub_current" } },
      } as never),
    ).toBe("sub_current");
    expect(invoiceSubscriptionId({ subscription: "sub_legacy" } as never)).toBe(
      "sub_legacy",
    );
  });

  it("matches subscription lines from both Stripe API shapes", () => {
    const current = {
      parent: {
        type: "subscription_item_details",
        subscription_item_details: { subscription: "sub_current" },
      },
    } as never;
    const legacy = {
      subscription: "sub_legacy",
      type: "subscription",
    } as never;

    expect(lineSubscriptionId(current)).toBe("sub_current");
    expect(isSubscriptionLine(current, "sub_current")).toBe(true);
    expect(lineSubscriptionId(legacy)).toBe("sub_legacy");
    expect(isSubscriptionLine(legacy, "sub_legacy")).toBe(true);
  });
});
