export type LegacyPlanType = "OTHER" | "METERED" | "UNMETERED" | "FIXED";
export type LegacyCalculationInput = {
  planType: LegacyPlanType;
  /** Exact Flowroute total_cost, deliberately retained for legacy parity. */
  flowrouteTotalCost?: string | null;
  productPriceMinor: bigint;
  meteredSipChargeMinor?: bigint;
  hostingChargeMinor?: bigint;
  extraNumbers?: bigint;
  includedNumbers?: bigint;
  numberCostMinor?: bigint;
  /** Customer-specific unmetered channel quantity. Falls back to the legacy plan value. */
  extraChannels?: bigint;
  includedChannels?: bigint;
  channelCostMinor?: bigint;
};
export type LegacyCalculationLine = {
  code: string;
  description: string;
  amountMinor: bigint;
  metadata: Record<string, string>;
};
export type LegacyCalculation = {
  version: "legacy-v1";
  source: "FLOWROUTE_TOTAL_COST" | "NONE";
  usageQuantity: bigint;
  amountMinor: bigint;
  metadata: Record<string, string>;
  lines: LegacyCalculationLine[];
};

function ceilDecimal(value: string | null | undefined) {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value))
    throw new Error("Legacy Flowroute total cost is required");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) + (/[1-9]/.test(fraction) ? 1n : 0n);
}
function nonNegative(value: bigint) {
  return value < 0n ? 0n : value;
}
function numbers(input: LegacyCalculationInput) {
  return (input.extraNumbers ?? 0n) - (input.includedNumbers ?? 0n);
}
/**
 * Characterization of the legacy PHP formulas. All values are integer minor
 * units at this boundary; the named constants preserve the observed 35% × 4
 * rule. Negative results are explicitly clamped to zero by owner decision.
 */
export function calculateLegacyV1(
  input: LegacyCalculationInput,
): LegacyCalculation {
  const usage =
    input.planType === "UNMETERED" || input.planType === "FIXED"
      ? 0n
      : ceilDecimal(input.flowrouteTotalCost);
  const numbersCharge = numbers(input) * (input.numberCostMinor ?? 0n);
  let amount: bigint;
  let lines: LegacyCalculationLine[];
  switch (input.planType) {
    case "OTHER": {
      const usageAndSip =
        usage * input.productPriceMinor + (input.meteredSipChargeMinor ?? 0n);
      const hosting = input.hostingChargeMinor ?? 0n;
      amount = usageAndSip + hosting;
      const otherLines: LegacyCalculationLine[] = [
        {
          code: "LEGACY_V1_OTHER_USAGE",
          description: "Flowroute usage and SIP trunk charge",
          amountMinor: usageAndSip,
          metadata: {
            flowrouteUsageQuantity: usage.toString(),
            meteredSipChargeMinor: (input.meteredSipChargeMinor ?? 0n).toString(),
          },
        },
        {
          code: "LEGACY_V1_CLOUD_HOSTING",
          description: "Cloud server hosting subscription",
          amountMinor: hosting,
          metadata: {},
        },
      ];
      lines = otherLines.filter((line) => line.amountMinor !== 0n);
      if (!lines.length)
        lines = [{
          code: "LEGACY_V1_OTHER_USAGE",
          description: "Flowroute usage and SIP trunk charge",
          amountMinor: 0n,
          metadata: { flowrouteUsageQuantity: usage.toString(), meteredSipChargeMinor: "0" },
        }];
      break;
    }
    case "METERED":
      // `usage` is expressed in whole legacy dollars whereas price inputs are
      // stored in cents. Convert usage once, then apply the legacy 35% × 4
      // calculation in cents. Dividing the final result by 100 here would
      // undercharge every positive result by a factor of one hundred.
      amount =
        ((usage * 10_000n - input.productPriceMinor * 35n) * 4n) / 100n +
        numbersCharge;
      lines = [{
        code: "LEGACY_V1_METERED_USAGE",
        description: "Metered SIP trunk usage and phone-number adjustment",
        amountMinor: nonNegative(amount),
        metadata: { phoneNumberAdjustmentMinor: numbersCharge.toString() },
      }];
      break;
    case "UNMETERED": {
      const channelQuantity = input.extraChannels ?? input.includedChannels ?? 0n;
      amount =
        channelQuantity * (input.channelCostMinor ?? 0n) +
        numbersCharge;
      lines = [{
        code: "LEGACY_V1_UNMETERED_USAGE",
        description: "Unmetered channel and phone-number adjustment",
        amountMinor: nonNegative(amount),
        metadata: {
          channelQuantity: channelQuantity.toString(),
          phoneNumberAdjustmentMinor: numbersCharge.toString(),
        },
      }];
      break;
    }
    case "FIXED":
      amount = input.productPriceMinor;
      lines = [{
        code: "LEGACY_V1_FIXED_CHARGE",
        description: "Fixed monthly charge",
        amountMinor: nonNegative(amount),
        metadata: {},
      }];
  }
  return {
    version: "legacy-v1",
    source: usage === 0n ? "NONE" : "FLOWROUTE_TOTAL_COST",
    usageQuantity: usage,
    amountMinor: nonNegative(amount),
    metadata: {
      negativeResultClamped: String(amount < 0n),
      legacyConstants: input.planType === "METERED" ? "0.35,4" : "none",
    },
    lines,
  };
}
