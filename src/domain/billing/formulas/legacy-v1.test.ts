import { describe, expect, it } from "vitest";
import { calculateLegacyV1 } from "./legacy-v1";

describe("legacy-v1 billing formulas", () => {
  it("uses the rounded-up Flowroute total cost for custom billing", () => {
    expect(
      calculateLegacyV1({
        planType: "OTHER",
        flowrouteTotalCost: "2.01",
        productPriceMinor: 100n,
        meteredSipChargeMinor: 20n,
        hostingChargeMinor: 30n,
      }),
    ).toMatchObject({ usageQuantity: 3n, amountMinor: 350n });
    expect(
      calculateLegacyV1({
        planType: "OTHER",
        flowrouteTotalCost: "2.01",
        productPriceMinor: 100n,
        meteredSipChargeMinor: 20n,
        hostingChargeMinor: 30n,
      }).lines,
    ).toEqual([
      expect.objectContaining({
        code: "LEGACY_V1_OTHER_USAGE",
        amountMinor: 320n,
      }),
      expect.objectContaining({
        code: "LEGACY_V1_CLOUD_HOSTING",
        amountMinor: 30n,
      }),
    ]);
  });
  it("uses the saved SIP charge for each custom-plan billing run", () => {
    const common = {
      planType: "OTHER" as const,
      productPriceMinor: 250n,
      meteredSipChargeMinor: 22_500n,
      hostingChargeMinor: 0n,
    };
    expect(
      calculateLegacyV1({
        ...common,
        flowrouteTotalCost: "75.150987250000",
      }),
    ).toMatchObject({ usageQuantity: 76n, amountMinor: 41_500n });
    expect(
      calculateLegacyV1({
        ...common,
        flowrouteTotalCost: "70.304291520000",
      }),
    ).toMatchObject({ usageQuantity: 71n, amountMinor: 40_250n });
  });
  it("keeps the legacy metered constants and clamps negative charges", () => {
    expect(
      calculateLegacyV1({
        planType: "METERED",
        flowrouteTotalCost: "1",
        productPriceMinor: 1000n,
      }),
    ).toMatchObject({
      amountMinor: 0n,
      metadata: { negativeResultClamped: "true", legacyConstants: "0.35,4" },
    });
  });
  it("keeps positive metered charges in minor units", () => {
    expect(
      calculateLegacyV1({
        planType: "METERED",
        flowrouteTotalCost: "100",
        productPriceMinor: 10_000n,
      }),
    ).toMatchObject({ amountMinor: 26_000n });
  });
  it("rounds only after the metered formula reaches minor units", () => {
    expect(
      calculateLegacyV1({
        planType: "METERED",
        flowrouteTotalCost: "10",
        productPriceMinor: 999n,
      }),
    ).toMatchObject({ amountMinor: 2601n });
  });
  it("does not use Flowroute totals for unmetered billing", () => {
    expect(
      calculateLegacyV1({
        planType: "UNMETERED",
        productPriceMinor: 0n,
        includedChannels: 2n,
        channelCostMinor: 500n,
        extraNumbers: 1n,
        includedNumbers: 3n,
        numberCostMinor: 100n,
      }),
    ).toMatchObject({ usageQuantity: 0n, amountMinor: 800n });
  });
  it("uses the customer extra-channel quantity when one is stored", () => {
    expect(
      calculateLegacyV1({
        planType: "UNMETERED",
        productPriceMinor: 0n,
        includedChannels: 2n,
        extraChannels: 5n,
        channelCostMinor: 500n,
      }),
    ).toMatchObject({ amountMinor: 2500n });
  });
});
