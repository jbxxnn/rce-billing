import "server-only";
import { desc, eq } from "drizzle-orm";
import { databaseSource } from "@runtime/database";
import { requireAdministrator } from "../auth/server";
import { withDatabase } from "../db/client";
import {
  backgroundJobs,
  billingLineItems,
  billingRuns,
  billingSyncJobs,
  customers,
  planPriceVersions,
  plans,
  usageSnapshots,
  usageExports,
} from "../db/schema";

export async function operationalOverview() {
  await requireAdministrator();
  return withDatabase(databaseSource(), async (db) => {
    const [runs, exports, flowrouteJobs, stripeJobs] = await Promise.all([
      db
        .select({
          id: billingRuns.id,
          customerId: customers.id,
          customer: customers.fullName,
          periodStart: billingRuns.periodStart,
          periodEnd: billingRuns.periodEnd,
          status: billingRuns.status,
          subtotalMinor: billingRuns.subtotalMinor,
          currency: billingRuns.currency,
          stripeInvoiceId: billingRuns.stripeInvoiceId,
          errorCode: billingRuns.errorCode,
        })
        .from(billingRuns)
        .leftJoin(customers, eq(customers.id, billingRuns.customerId))
        .orderBy(desc(billingRuns.createdAt))
        .limit(25),
      db
        .select({
          id: usageExports.id,
          customerId: customers.id,
          customer: customers.fullName,
          periodStart: usageExports.periodStart,
          periodEnd: usageExports.periodEnd,
          status: usageExports.status,
          attemptCount: usageExports.attemptCount,
          providerExportId: usageExports.providerExportId,
          lastErrorCode: usageExports.lastErrorCode,
        })
        .from(usageExports)
        .leftJoin(customers, eq(customers.id, usageExports.customerId))
        .orderBy(desc(usageExports.createdAt))
        .limit(25),
      db
        .select({
          id: backgroundJobs.id,
          status: backgroundJobs.status,
          nextAttemptAt: backgroundJobs.nextAttemptAt,
          lastErrorCode: backgroundJobs.lastErrorCode,
        })
        .from(backgroundJobs)
        .where(eq(backgroundJobs.status, "NEEDS_REVIEW"))
        .orderBy(desc(backgroundJobs.updatedAt))
        .limit(25),
      db
        .select({
          id: billingSyncJobs.id,
          billingRunId: billingSyncJobs.billingRunId,
          status: billingSyncJobs.status,
          nextAttemptAt: billingSyncJobs.nextAttemptAt,
          lastErrorCode: billingSyncJobs.lastErrorCode,
        })
        .from(billingSyncJobs)
        .where(eq(billingSyncJobs.status, "NEEDS_REVIEW"))
        .orderBy(desc(billingSyncJobs.updatedAt))
        .limit(25),
    ]);
    return { runs, exports, flowrouteJobs, stripeJobs };
  });
}

export async function operationalBillingRun(id: string) {
  await requireAdministrator();
  return withDatabase(databaseSource(), async (db) => {
    const [run] = await db
      .select({
        id: billingRuns.id,
        customerId: customers.id,
        customer: customers.fullName,
        customerEmail: customers.email,
        periodStart: billingRuns.periodStart,
        periodEnd: billingRuns.periodEnd,
        status: billingRuns.status,
        formulaVersion: billingRuns.formulaVersion,
        subtotalMinor: billingRuns.subtotalMinor,
        currency: billingRuns.currency,
        stripeInvoiceId: billingRuns.stripeInvoiceId,
        errorCode: billingRuns.errorCode,
        errorMessage: billingRuns.errorMessage,
        calculationSnapshot: billingRuns.calculationSnapshot,
        planName: plans.name,
        planType: plans.planType,
        providerCostExact: usageSnapshots.providerCostExact,
        usageQuantity: usageSnapshots.usageQuantity,
      })
      .from(billingRuns)
      .leftJoin(customers, eq(customers.id, billingRuns.customerId))
      .leftJoin(
        planPriceVersions,
        eq(planPriceVersions.id, billingRuns.planPriceVersionId),
      )
      .leftJoin(plans, eq(plans.id, planPriceVersions.planId))
      .leftJoin(
        usageSnapshots,
        eq(usageSnapshots.id, billingRuns.usageSnapshotId),
      )
      .where(eq(billingRuns.id, id));
    if (!run) return null;
    const lines = await db
      .select({
        id: billingLineItems.id,
        code: billingLineItems.code,
        description: billingLineItems.description,
        quantity: billingLineItems.quantity,
        unitAmountMinor: billingLineItems.unitAmountMinor,
        amountMinor: billingLineItems.amountMinor,
        calculationMetadata: billingLineItems.calculationMetadata,
        stripeInvoiceItemId: billingLineItems.stripeInvoiceItemId,
      })
      .from(billingLineItems)
      .where(eq(billingLineItems.billingRunId, id));
    return { run, lines };
  });
}
