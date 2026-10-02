import { eq } from "drizzle-orm";
import { withDatabase } from "../../src/db/client";
import {
  customerBillingAdjustments,
  customers,
  billingRuns,
  backgroundJobs,
  planPriceVersions,
  stripeWorkflows,
  subscriptions,
  usageSnapshots,
  usageExports,
} from "../../src/db/schema";
import { configuredStripe } from "../../src/stripe/server";

await withDatabase({ connectionString: process.env.DATABASE_URL! }, async (db) => {
  const [customer] = await db
    .select({ id: customers.id, stripeCustomerId: customers.stripeCustomerId })
    .from(customers)
    .where(eq(customers.email, "aisha@re-circuit.com"));
  if (!customer) throw new Error("Aisha was not found");
  const rows = await db
    .select({
      subscriptionId: subscriptions.id,
      planPriceVersionId: subscriptions.planPriceVersionId,
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
      status: subscriptions.status,
      pendingWorkflowId: subscriptions.pendingStripeWorkflowId,
      workflowKind: stripeWorkflows.kind,
      workflowStatus: stripeWorkflows.status,
      workflowErrorCode: stripeWorkflows.errorCode,
    })
    .from(subscriptions)
    .leftJoin(stripeWorkflows, eq(stripeWorkflows.id, subscriptions.pendingStripeWorkflowId))
    .where(eq(subscriptions.customerId, customer.id));
  const runtime = configuredStripe();
  const invoices = customer.stripeCustomerId
    ? (await runtime.sdk.invoices.list({ customer: customer.stripeCustomerId, limit: 100 })).data
        .filter((invoice) => invoice.metadata?.test_only === "true")
        .map((invoice) => ({
          id: invoice.id,
          status: invoice.status,
          total: `$${(invoice.total / 100).toFixed(2)}`,
          key: invoice.metadata?.reconciliation_key,
        }))
    : [];
  const adjustments = await db
    .select({
      code: customerBillingAdjustments.code,
      amountMinor: customerBillingAdjustments.amountMinor,
      validFrom: customerBillingAdjustments.validFrom,
      active: customerBillingAdjustments.active,
    })
    .from(customerBillingAdjustments)
    .where(eq(customerBillingAdjustments.customerId, customer.id));
  const prices = await db
    .select({ id: planPriceVersions.id, configuration: planPriceVersions.pricingConfiguration })
    .from(planPriceVersions)
    .where(eq(planPriceVersions.id, rows[0]?.planPriceVersionId ?? ""));
  const usage = await db
    .select({ periodStart: usageSnapshots.periodStart, periodEnd: usageSnapshots.periodEnd, totalCost: usageSnapshots.providerCostExact })
    .from(usageSnapshots)
    .where(eq(usageSnapshots.customerId, customer.id));
  const runs = await db
    .select({
      id: billingRuns.id,
      periodStart: billingRuns.periodStart,
      periodEnd: billingRuns.periodEnd,
      status: billingRuns.status,
      usageSnapshotId: billingRuns.usageSnapshotId,
      errorCode: billingRuns.errorCode,
      errorMessage: billingRuns.errorMessage,
    })
    .from(billingRuns)
    .where(eq(billingRuns.customerId, customer.id));
  const exports = await db
    .select({
      id: usageExports.id,
      periodStart: usageExports.periodStart,
      periodEnd: usageExports.periodEnd,
      status: usageExports.status,
      providerExportId: usageExports.providerExportId,
    })
    .from(usageExports)
    .where(eq(usageExports.customerId, customer.id));
  const jobs = await db
    .select({
      id: backgroundJobs.id,
      billingRunId: backgroundJobs.billingRunId,
      usageExportId: backgroundJobs.usageExportId,
      status: backgroundJobs.status,
      nextAttemptAt: backgroundJobs.nextAttemptAt,
      lastErrorCode: backgroundJobs.lastErrorCode,
    })
    .from(backgroundJobs)
    .where(eq(backgroundJobs.billingRunId, runs[0]?.id ?? ""));
  console.log(
    JSON.stringify(
      { customer, subscriptions: rows, prices, adjustments, usage, exports, jobs, runs, invoices },
      (_, value) => (typeof value === "bigint" ? value.toString() : value),
    ),
  );
});
