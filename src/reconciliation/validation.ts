import { z } from "zod";
import { parseUsd } from "../domain/billing/money";

const amount = z
  .string()
  .trim()
  .max(21)
  .refine((value) => {
    try {
      parseUsd(value);
      return true;
    } catch {
      return false;
    }
  }, "Enter a valid USD amount");

const quantity = z
  .string()
  .trim()
  .regex(/^\d+$/, "Enter a whole number")
  .transform((value) => BigInt(value));

export const reconciliationSchema = z
  .object({
    planType: z.enum(["OTHER", "METERED", "UNMETERED", "FIXED"]),
    flowrouteTotalCost: z
      .string()
      .trim()
      .regex(/^\d+(?:\.\d+)?$/, "Enter the exact Flowroute total"),
    planPrice: amount,
    meteredSipTrunkUsage: amount,
    cloudServerHosting: amount,
    extraNumbers: quantity,
    includedNumbers: quantity,
    extraNumberCost: amount,
    extraChannels: quantity,
    channelCost: amount,
    legacyInvoiceTotal: z.union([amount, z.literal("")]),
  })
  .strict();

export function reconciliationInput(
  value: z.output<typeof reconciliationSchema>,
) {
  return {
    planType: value.planType,
    flowrouteTotalCost: value.flowrouteTotalCost,
    productPriceMinor: parseUsd(value.planPrice),
    meteredSipChargeMinor: parseUsd(value.meteredSipTrunkUsage),
    hostingChargeMinor: parseUsd(value.cloudServerHosting),
    extraNumbers: value.extraNumbers,
    includedNumbers: value.includedNumbers,
    numberCostMinor: parseUsd(value.extraNumberCost),
    extraChannels: value.extraChannels,
    channelCostMinor: parseUsd(value.channelCost),
  } as const;
}
