import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  auditEvents,
  billingLineItems,
  billingRuns,
  customers,
  subscriptions,
} from "../db/schema";
import { StripeWorkflowError, type StripeProvider } from "./contracts";
import { bindStripeAccount, stripeRequest } from "./requests";

/**
 * Sends only application-owned, sealed line items.  The request record and
 * Stripe idempotency key are stable per line, so a crashed retry cannot create
 * a second charge.  The invoice remains non-finalizing while its identity is
 * known; webhook reconciliation keeps enforcing the same hold afterwards.
 */
export async function syncBillingRun(
  db: Database,
  provider: StripeProvider,
  billingRunId: string,
) {
  await bindStripeAccount(db, provider);
  const prepared = await db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(billingRuns)
      .where(eq(billingRuns.id, billingRunId))
      .for("update");
    if (!run)
      throw new StripeWorkflowError("NEEDS_REVIEW", "Billing run not found");
    if (["PAYMENT_PENDING", "PAST_DUE", "COMPLETED"].includes(run.status))
      return null;
    if (run.status !== "CALCULATED" && run.status !== "SYNCING_STRIPE")
      throw new StripeWorkflowError(
        "NEEDS_REVIEW",
        "Billing run is not ready for Stripe",
      );
    if (!run.subscriptionId || !run.calculationSnapshot)
      throw new StripeWorkflowError(
        "NEEDS_REVIEW",
        "Billing run has no sealed subscription calculation",
      );
    const [subscription] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, run.subscriptionId))
      .for("share");
    const [customer] = await tx
      .select()
      .from(customers)
      .where(eq(customers.id, run.customerId))
      .for("share");
    if (!subscription?.stripeSubscriptionId || !customer?.stripeCustomerId)
      throw new StripeWorkflowError(
        "NEEDS_REVIEW",
        "Stripe customer or subscription is not mapped",
      );
    const lines = await tx
      .select()
      .from(billingLineItems)
      .where(
        and(
          eq(billingLineItems.billingRunId, run.id),
          isNull(billingLineItems.stripeInvoiceItemId),
        ),
      );
    await tx
      .update(billingRuns)
      .set({ status: "SYNCING_STRIPE", errorCode: null, errorMessage: null })
      .where(eq(billingRuns.id, run.id));
    return { run, subscription, customer, lines };
  });
  if (!prepared) return { status: "IGNORED" as const };
  const stripeCustomerId = prepared.customer.stripeCustomerId;
  const stripeSubscriptionId = prepared.subscription.stripeSubscriptionId;
  if (!stripeCustomerId || !stripeSubscriptionId)
    throw new StripeWorkflowError(
      "NEEDS_REVIEW",
      "Stripe customer or subscription is not mapped",
    );

  const state = await provider.subscription(stripeSubscriptionId);
  if (!state.latestInvoiceId)
    throw new StripeWorkflowError(
      "NEEDS_REVIEW",
      "Stripe did not provide a draft invoice for this billing run.",
    );
  const invoice = await provider.invoice(state.latestInvoiceId);
  if (
    invoice.customerId !== stripeCustomerId ||
    invoice.subscriptionId !== state.id
  )
    throw new StripeWorkflowError(
      "NEEDS_REVIEW",
      "Stripe invoice ownership mismatch",
    );
  if (invoice.autoAdvance)
    await stripeRequest(db, provider, `invoice-hold:${invoice.id}`, "hold", {
      id: invoice.id,
    });
  if (invoice.status !== "draft")
    throw new StripeWorkflowError(
      "NEEDS_REVIEW",
      "The Stripe invoice is no longer a draft and cannot safely receive usage charges.",
    );

  for (const line of prepared.lines) {
    if (
      line.amountMinor < 0n ||
      line.amountMinor > BigInt(Number.MAX_SAFE_INTEGER)
    )
      throw new StripeWorkflowError(
        "NEEDS_REVIEW",
        "Billing line amount is outside Stripe's supported integer range",
      );
    const itemId = await stripeRequest(
      db,
      provider,
      `billing-line:${line.id}`,
      "invoice_item",
      {
        customer: stripeCustomerId,
        invoice: invoice.id,
        amount: Number(line.amountMinor),
        currency: "usd",
        description: line.description,
        metadata: {
          billing_run_id: prepared.run.id,
          billing_line_item_id: line.id,
          internal_customer_id: prepared.customer.id,
          subscription_id: prepared.subscription.id,
          formula_version: prepared.run.formulaVersion,
          billing_period_start: prepared.run.periodStart,
          billing_period_end: prepared.run.periodEnd,
        },
      },
    );
    await db
      .update(billingLineItems)
      .set({ stripeInvoiceItemId: itemId })
      .where(
        and(
          eq(billingLineItems.id, line.id),
          isNull(billingLineItems.stripeInvoiceItemId),
        ),
      );
  }
  await stripeRequest(db, provider, `invoice-release:${invoice.id}`, "release", {
    id: invoice.id,
  });
  await stripeRequest(db, provider, `invoice-finalize:${invoice.id}`, "finalize", {
    id: invoice.id,
  });
  if (prepared.subscription.collectionMethod === "send_invoice")
    await stripeRequest(db, provider, `invoice-send:${invoice.id}`, "send", {
      id: invoice.id,
    });
  const releasedInvoiceId = invoice.id;
  await db
    .update(billingRuns)
    .set({ stripeInvoiceId: invoice.id })
    .where(eq(billingRuns.id, prepared.run.id));
  await db.transaction(async (tx) => {
    const [remaining] = await tx
      .select({ id: billingLineItems.id })
      .from(billingLineItems)
      .where(
        and(
          eq(billingLineItems.billingRunId, prepared.run.id),
          isNull(billingLineItems.stripeInvoiceItemId),
        ),
      )
      .limit(1);
    if (remaining)
      throw new StripeWorkflowError("RETRY", "Billing lines are still syncing");
    await tx
      .update(billingRuns)
      .set({ status: "PAYMENT_PENDING" })
      .where(eq(billingRuns.id, prepared.run.id));
    await tx.insert(auditEvents).values({
      actorType: "SYSTEM",
      action: "billing_run.stripe_synchronized",
      entityType: "billing_run",
      entityId: prepared.run.id,
      afterJson: {
        invoiceId: releasedInvoiceId,
        lineCount: prepared.lines.length,
      },
    });
  });
  return { status: "PAYMENT_PENDING" as const };
}
