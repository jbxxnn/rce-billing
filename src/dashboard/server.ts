import "server-only";
import { count, desc, eq, inArray, sql } from "drizzle-orm";
import { requireAdministrator } from "../auth/server";
import { withDatabase } from "../db/client";
import { databaseSource } from "@runtime/database";
import { billingRuns, customers, subscriptions } from "../db/schema";

const billableStatuses = [
  "CALCULATED",
  "SYNCING_STRIPE",
  "PAYMENT_PENDING",
  "PAST_DUE",
  "COMPLETED",
] as const;
const waitingStatuses = [
  "DISCOVERED",
  "WAITING_FOR_USAGE",
  "CALCULATING",
  "SYNCING_STRIPE",
] as const;
const attentionStatuses = [
  "NEEDS_REVIEW",
  "FAILED_RETRYABLE",
  "FAILED_PERMANENT",
] as const;

export async function dashboardOverview() {
  await requireAdministrator();
  return withDatabase(databaseSource(), async (db) => {
    const [
      activeCustomers,
      activeSubscriptions,
      calculatedBilling,
      waitingForUsage,
      needsAttention,
      recentRuns,
    ] = await Promise.all([
      db
        .select({ value: count() })
        .from(customers)
        .where(eq(customers.status, "ACTIVE")),
      db
        .select({ value: count() })
        .from(subscriptions)
        .where(eq(subscriptions.status, "ACTIVE")),
      db
        .select({
          value: sql<string | null>`sum(${billingRuns.subtotalMinor})`,
          count: count(),
        })
        .from(billingRuns)
        .where(inArray(billingRuns.status, billableStatuses)),
      db
        .select({ value: count() })
        .from(billingRuns)
        .where(inArray(billingRuns.status, waitingStatuses)),
      db
        .select({ value: count() })
        .from(billingRuns)
        .where(inArray(billingRuns.status, attentionStatuses)),
      db
        .select({
          id: billingRuns.id,
          customerId: customers.id,
          customerName: customers.fullName,
          periodStart: billingRuns.periodStart,
          periodEnd: billingRuns.periodEnd,
          status: billingRuns.status,
          subtotalMinor: billingRuns.subtotalMinor,
          currency: billingRuns.currency,
          stripeInvoiceId: billingRuns.stripeInvoiceId,
        })
        .from(billingRuns)
        .leftJoin(customers, eq(customers.id, billingRuns.customerId))
        .orderBy(desc(billingRuns.createdAt))
        .limit(6),
    ]);
    return {
      activeCustomers: activeCustomers[0]?.value ?? 0,
      activeSubscriptions: activeSubscriptions[0]?.value ?? 0,
      calculatedBillingMinor: calculatedBilling[0]?.value ?? "0",
      calculatedBillingRuns: calculatedBilling[0]?.count ?? 0,
      waitingForUsage: waitingForUsage[0]?.value ?? 0,
      needsAttention: needsAttention[0]?.value ?? 0,
      recentRuns,
    };
  });
}
