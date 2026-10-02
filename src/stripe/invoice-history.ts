import "server-only";
import type Stripe from "stripe";
import { and, eq, isNotNull } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, customers, stripeInvoiceHistory } from "@/db/schema";
import type { AuditActor } from "@/db/repositories/contracts";
import { configuredStripe } from "./server";
import type { InvoiceState } from "./contracts";
import { invoiceSubscriptionId, isSubscriptionLine } from "./invoice-period";

function identifier(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : (value?.id ?? null);
}

function fromUnix(value: number | null | undefined) {
  return value == null ? null : new Date(value * 1000);
}

function dateFromUnix(value: number) {
  return new Date(value * 1000).toISOString().slice(0, 10);
}

async function billingPeriod(
  stripe: Stripe,
  invoice: Stripe.Invoice,
  subscriptionId: string | null,
) {
  if (!subscriptionId)
    return { billingPeriodStart: null, billingPeriodEnd: null };
  for await (const line of stripe.invoices.listLineItems(invoice.id, {
    limit: 100,
  })) {
    if (!isSubscriptionLine(line, subscriptionId)) continue;
    const billingPeriodStart = dateFromUnix(line.period.start);
    const billingPeriodEnd = dateFromUnix(line.period.end);
    // The database stores whole UTC dates, so a sub-day Stripe period can
    // still collapse into an invalid identical start and end date.
    if (billingPeriodEnd <= billingPeriodStart) continue;
    return { billingPeriodStart, billingPeriodEnd };
  }
  return { billingPeriodStart: null, billingPeriodEnd: null };
}

async function invoiceValues(
  stripe: Stripe,
  invoice: Stripe.Invoice,
  customerId: string,
) {
  const subscriptionId = invoiceSubscriptionId(invoice);
  const period = await billingPeriod(stripe, invoice, subscriptionId);
  return {
    customerId,
    stripeSubscriptionId: subscriptionId,
    status: invoice.status ?? "draft",
    collectionMethod: invoice.collection_method,
    currency: invoice.currency.toUpperCase(),
    totalMinor: BigInt(invoice.total),
    amountPaidMinor: BigInt(invoice.amount_paid),
    amountDueMinor: BigInt(invoice.amount_due),
    amountRemainingMinor: BigInt(invoice.amount_remaining),
    ...period,
    dueAt: fromUnix(invoice.due_date),
    paidAt: fromUnix(invoice.status_transitions.paid_at),
    invoiceCreatedAt: new Date(invoice.created * 1000),
    syncedAt: new Date(),
  };
}

export type InvoiceHistorySyncResult = {
  customers: number;
  invoices: number;
  latestInvoiceAt: string | null;
};

export async function saveStripeInvoiceHistory(
  db: Database,
  invoice: InvoiceState,
  customerId: string,
) {
  const values = {
    customerId,
    stripeSubscriptionId: invoice.subscriptionId,
    status: invoice.status,
    collectionMethod: invoice.collectionMethod,
    currency: invoice.currency,
    totalMinor: BigInt(invoice.total),
    amountPaidMinor: BigInt(invoice.amountPaid),
    amountDueMinor: BigInt(invoice.amountDue),
    amountRemainingMinor: BigInt(invoice.amountRemaining),
    billingPeriodStart:
      invoice.billingPeriodStart == null
        ? null
        : dateFromUnix(invoice.billingPeriodStart),
    billingPeriodEnd:
      invoice.billingPeriodEnd == null
        ? null
        : dateFromUnix(invoice.billingPeriodEnd),
    dueAt: fromUnix(invoice.dueDate),
    paidAt: fromUnix(invoice.paidAt),
    invoiceCreatedAt: new Date(invoice.createdAt * 1000),
    syncedAt: new Date(),
  };
  await db
    .insert(stripeInvoiceHistory)
    .values({ id: invoice.id, ...values })
    .onConflictDoUpdate({ target: stripeInvoiceHistory.id, set: values });
}

/**
 * Imports Stripe's invoice ledger into our read model. The Stripe API calls
 * are read-only; this only writes the minimal invoice facts required for
 * collections reporting.
 */
export async function syncStripeInvoiceHistory(
  db: Database,
  actor: AuditActor,
  customerId?: string,
): Promise<InvoiceHistorySyncResult> {
  const runtime = configuredStripe();
  await runtime.provider.account();
  const selected = await db
    .select({ id: customers.id, stripeCustomerId: customers.stripeCustomerId })
    .from(customers)
    .where(
      customerId
        ? and(
            isNotNull(customers.stripeCustomerId),
            eq(customers.id, customerId),
          )
        : isNotNull(customers.stripeCustomerId),
    );

  let invoices = 0;
  let latestInvoiceAt: Date | null = null;
  for (const customer of selected) {
    if (!customer.stripeCustomerId) continue;
    for await (const invoice of runtime.sdk.invoices.list({
      customer: customer.stripeCustomerId,
      limit: 100,
    })) {
      if (invoice.livemode !== (runtime.config.mode === "live"))
        throw new Error("Stripe invoice mode mismatch");
      if (identifier(invoice.customer) !== customer.stripeCustomerId)
        throw new Error("Stripe invoice customer mismatch");
      const values = await invoiceValues(runtime.sdk, invoice, customer.id);
      await db
        .insert(stripeInvoiceHistory)
        .values({ id: invoice.id, ...values })
        .onConflictDoUpdate({ target: stripeInvoiceHistory.id, set: values });
      invoices += 1;
      if (!latestInvoiceAt || values.invoiceCreatedAt > latestInvoiceAt)
        latestInvoiceAt = values.invoiceCreatedAt;
    }
  }
  await db.insert(auditEvents).values({
    actorType: actor.appUserId ? "ADMIN" : "SYSTEM",
    actorId: actor.appUserId ?? null,
    requestId: actor.requestId,
    action: "stripe.invoice_history_synced",
    entityType: customerId ? "customer" : "stripe_invoice_history",
    entityId: customerId ?? null,
    afterJson: {
      customers: selected.length,
      invoices,
      mode: runtime.config.mode,
    },
  });
  return {
    customers: selected.length,
    invoices,
    latestInvoiceAt: latestInvoiceAt?.toISOString() ?? null,
  };
}
