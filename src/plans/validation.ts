import { z } from "zod";
import { parseUsd } from "../domain/billing/money";
export const usd = z
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
  }, "Enter a non-negative USD amount with up to two decimals");
const count = z.coerce.number().int().min(0).max(2147483647);
export const planSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).default(""),
    planType: z.enum(["FIXED", "METERED", "UNMETERED", "OTHER"]),
    baseAmount: usd,
    includedMinutes: z
      .string()
      .trim()
      .regex(
        /^(0|[1-9]\d{0,17})(\.\d{1,12})?$/,
        "Enter a non-negative quantity with at most 12 decimal places",
      ),
    additionalMinuteAmount: usd,
    includedNumbers: count,
    numberAmount: usd,
    includedChannels: count,
    channelAmount: usd,
  })
  .strict();
export const planUpdateSchema = planSchema.extend({
  revision: z.coerce.number().int().positive(),
});
export const planStatusSchema = z
  .object({
    revision: z.coerce.number().int().positive(),
    active: z.enum(["true", "false"]).transform((value) => value === "true"),
  })
  .strict();
export const draftSubscriptionSchema = z
  .object({
    creationKey: z.uuid(),
    customerId: z.uuid(),
    planPriceVersionId: z.uuid(),
    collectionMethod: z.enum(["send_invoice", "charge_automatically"]),
  })
  .strict();
export const draftUpdateSchema = z
  .object({
    revision: z.coerce.number().int().positive(),
    planPriceVersionId: z.uuid(),
    collectionMethod: z.enum(["send_invoice", "charge_automatically"]),
  })
  .strict();
export const draftDiscardSchema = z
  .object({ revision: z.coerce.number().int().positive() })
  .strict();
export type PlanInput = z.output<typeof planSchema>;
export function pricingSnapshot(input: PlanInput) {
  return {
    schemaVersion: 1,
    name: input.name,
    description: input.description,
    currency: "USD",
    planType: input.planType,
    baseAmountMinor: parseUsd(input.baseAmount).toString(),
    includedMinutes: input.includedMinutes,
    additionalMinuteAmountMinor: parseUsd(
      input.additionalMinuteAmount,
    ).toString(),
    includedNumbers: input.includedNumbers,
    numberAmountMinor: parseUsd(input.numberAmount).toString(),
    includedChannels: input.includedChannels,
    channelAmountMinor: parseUsd(input.channelAmount).toString(),
  };
}
