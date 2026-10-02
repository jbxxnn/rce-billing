import "server-only";
import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  auditEvents,
  billingLineItems,
  billingRuns,
  customerBillingAdjustments,
  planPriceVersions,
  usageSnapshots,
} from "../db/schema";
import {
  calculateLegacyV1,
  type LegacyCalculationInput,
  type LegacyPlanType,
} from "../domain/billing/formulas/legacy-v1";

type PricingConfiguration = {
  schemaVersion: 1;
  currency: "USD";
  planType: LegacyPlanType;
  baseAmountMinor: string;
  includedNumbers: number;
  numberAmountMinor: string;
  includedChannels: number;
  channelAmountMinor: string;
};

export class BillingCalculationError extends Error {}

function integer(value: unknown, label: string) {
  if (typeof value !== "string" || !/^-?\d+$/.test(value))
    throw new BillingCalculationError(`Invalid ${label} in price snapshot`);
  return BigInt(value);
}

function nonNegativeInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new BillingCalculationError(`Invalid ${label} in price snapshot`);
  return BigInt(value);
}

function pricing(value: Record<string, unknown>): PricingConfiguration {
  if (
    value.schemaVersion !== 1 ||
    value.currency !== "USD" ||
    !["FIXED", "METERED", "UNMETERED", "OTHER"].includes(String(value.planType))
  )
    throw new BillingCalculationError("Unsupported price snapshot");
  integer(value.baseAmountMinor, "base amount");
  integer(value.numberAmountMinor, "number amount");
  integer(value.channelAmountMinor, "channel amount");
  nonNegativeInteger(value.includedNumbers, "included numbers");
  nonNegativeInteger(value.includedChannels, "included channels");
  return value as PricingConfiguration;
}

function adjustmentValues(
  adjustments: Array<{
    id: string;
    code: string;
    amountMinor: bigint | null;
    quantity: string | null;
    reason: string;
  }>,
) {
  let meteredSipChargeMinor = 0n;
  let hostingChargeMinor = 0n;
  let extraNumbers = 0n;
  let extraChannels: bigint | undefined;
  for (const adjustment of adjustments) {
    if (adjustment.code === "METERED_SIP_TRUNK_USAGE")
      meteredSipChargeMinor += adjustment.amountMinor ?? 0n;
    if (adjustment.code === "CLOUD_SERVER_HOSTING")
      hostingChargeMinor += adjustment.amountMinor ?? 0n;
    if (adjustment.code === "EXTRA_NUMBERS") {
      if (!adjustment.quantity || !/^\d+$/.test(adjustment.quantity))
        throw new BillingCalculationError(
          "EXTRA_NUMBERS must use a whole non-negative quantity",
        );
      extraNumbers += BigInt(adjustment.quantity);
    }
    if (adjustment.code === "EXTRA_CHANNELS") {
      if (!adjustment.quantity || !/^\d+$/.test(adjustment.quantity))
        throw new BillingCalculationError(
          "EXTRA_CHANNELS must use a whole non-negative quantity",
        );
      extraChannels = (extraChannels ?? 0n) + BigInt(adjustment.quantity);
    }
  }
  return { meteredSipChargeMinor, hostingChargeMinor, extraNumbers, extraChannels };
}

/**
 * Seals exactly one calculation. Provider work has already completed, so the
 * transaction contains only short database reads/writes and no external calls.
 */
export async function calculateBillingRun(db: Database, runId: string) {
  try {
    return await db.transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(billingRuns)
        .where(eq(billingRuns.id, runId))
        .for("update");
      if (!run) throw new BillingCalculationError("Billing run not found");
      if (run.status === "CALCULATED") return { status: "IGNORED" as const };
      if (run.status !== "CALCULATING") return { status: "IGNORED" as const };
      if (!run.planPriceVersionId)
        throw new BillingCalculationError("Billing run has no reserved price");

      const [price] = await tx
        .select({ configuration: planPriceVersions.pricingConfiguration })
        .from(planPriceVersions)
        .where(eq(planPriceVersions.id, run.planPriceVersionId));
      if (!price)
        throw new BillingCalculationError("Reserved price was not found");
      const priceSnapshot = pricing(price.configuration);

      const [usage] = await tx
        .select({
          id: usageSnapshots.id,
          providerCostExact: usageSnapshots.providerCostExact,
          currency: usageSnapshots.currency,
        })
        .from(usageSnapshots)
        .where(
          and(
            eq(usageSnapshots.customerId, run.customerId),
            eq(usageSnapshots.periodStart, run.periodStart),
            eq(usageSnapshots.periodEnd, run.periodEnd),
          ),
        )
        .for("share");
      if (!usage || usage.currency !== "USD")
        throw new BillingCalculationError(
          "Completed USD usage snapshot is required",
        );

      const adjustments = await tx
        .select({
          id: customerBillingAdjustments.id,
          code: customerBillingAdjustments.code,
          amountMinor: customerBillingAdjustments.amountMinor,
          quantity: customerBillingAdjustments.quantity,
          reason: customerBillingAdjustments.reason,
        })
        .from(customerBillingAdjustments)
        .where(
          and(
            eq(customerBillingAdjustments.customerId, run.customerId),
            eq(customerBillingAdjustments.active, true),
            lte(
              customerBillingAdjustments.validFrom,
              new Date(`${run.periodEnd}T00:00:00.000Z`),
            ),
            or(
              isNull(customerBillingAdjustments.validUntil),
              gt(
                customerBillingAdjustments.validUntil,
                new Date(`${run.periodStart}T00:00:00.000Z`),
              ),
            ),
          ),
        );
      const adjustment = adjustmentValues(adjustments);
      const input: LegacyCalculationInput = {
        planType: priceSnapshot.planType,
        flowrouteTotalCost: usage.providerCostExact,
        productPriceMinor: integer(
          priceSnapshot.baseAmountMinor,
          "base amount",
        ),
        meteredSipChargeMinor: adjustment.meteredSipChargeMinor,
        hostingChargeMinor: adjustment.hostingChargeMinor,
        extraNumbers: adjustment.extraNumbers,
        includedNumbers: nonNegativeInteger(
          priceSnapshot.includedNumbers,
          "included numbers",
        ),
        numberCostMinor: integer(
          priceSnapshot.numberAmountMinor,
          "number amount",
        ),
        extraChannels: adjustment.extraChannels,
        includedChannels: nonNegativeInteger(
          priceSnapshot.includedChannels,
          "included channels",
        ),
        channelCostMinor: integer(
          priceSnapshot.channelAmountMinor,
          "channel amount",
        ),
      };
      const calculation = calculateLegacyV1(input);
      const metadata = {
        formulaVersion: calculation.version,
        source: calculation.source,
        usageQuantity: calculation.usageQuantity.toString(),
        adjustmentIds: adjustments.map((item) => item.id),
      };
      await tx.insert(billingLineItems).values(
        calculation.lines.map((line) => ({
          billingRunId: run.id,
          code: line.code,
          description: line.description,
          quantity: "1",
          unitAmountMinor: line.amountMinor,
          amountMinor: line.amountMinor,
          calculationMetadata: { ...metadata, ...line.metadata },
        })),
      );
      await tx
        .update(billingRuns)
        .set({
          formulaVersion: calculation.version,
          usageSnapshotId: usage.id,
          calculationSnapshot: {
            pricing: priceSnapshot,
            usage: { id: usage.id, providerCostExact: usage.providerCostExact },
            adjustments: adjustments.map((item) => ({
              id: item.id,
              code: item.code,
              amountMinor: item.amountMinor?.toString() ?? null,
              quantity: item.quantity,
              reason: item.reason,
            })),
            result: {
              amountMinor: calculation.amountMinor.toString(),
              usageQuantity: calculation.usageQuantity.toString(),
              metadata: calculation.metadata,
              lines: calculation.lines.map((line) => ({
                ...line,
                amountMinor: line.amountMinor.toString(),
              })),
            },
          },
          subtotalMinor: calculation.amountMinor,
          status: "CALCULATED",
          errorCode: null,
          errorMessage: null,
        })
        .where(eq(billingRuns.id, run.id));
      await tx.insert(auditEvents).values({
        actorType: "SYSTEM",
        action: "billing_run.calculated",
        entityType: "billing_run",
        entityId: run.id,
        afterJson: { subtotalMinor: calculation.amountMinor.toString() },
      });
      return { status: "CALCULATED" as const };
    });
  } catch (error) {
    if (!(error instanceof BillingCalculationError)) throw error;
    await db.transaction(async (tx) => {
      const [run] = await tx
        .select({ status: billingRuns.status })
        .from(billingRuns)
        .where(eq(billingRuns.id, runId))
        .for("update");
      if (run?.status !== "CALCULATING") return;
      await tx
        .update(billingRuns)
        .set({
          status: "NEEDS_REVIEW",
          errorCode: "CALCULATION_INPUT",
          errorMessage: error.message,
        })
        .where(eq(billingRuns.id, runId));
      await tx.insert(auditEvents).values({
        actorType: "SYSTEM",
        action: "billing_run.calculation_needs_review",
        entityType: "billing_run",
        entityId: runId,
        afterJson: { errorCode: "CALCULATION_INPUT" },
      });
    });
    return { status: "NEEDS_REVIEW" as const };
  }
}
