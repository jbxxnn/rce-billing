import "server-only";
import type Stripe from "stripe";
import { and, eq, or } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  auditEvents,
  billingRuns,
  customers,
  planPriceVersions,
  stripeEvents,
  stripeInvoices,
  subscriptions,
} from "../db/schema";
import { bindStripeAccount, stripeRequest } from "./requests";
import { refreshPaymentStatus, subscriptionValues } from "./service";
import {
  StripeWorkflowError,
  type InvoiceState,
  type StripeProvider,
} from "./contracts";
import { saveStripeInvoiceHistory } from "./invoice-history";
import type { StripeMode } from "./config";
function idOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (
    value &&
    typeof value === "object" &&
    "id" in value &&
    typeof value.id === "string"
  )
    return value.id;
  return null;
}
export async function processStripeEvent(
  db: Database,
  provider: StripeProvider,
  event: Stripe.Event,
  mode: StripeMode = "test",
) {
  if (event.livemode !== (mode === "live") || event.account)
    throw new Error("Stripe event mode or account mismatch");
  await db
    .insert(stripeEvents)
    .values({
      stripeEventId: event.id,
      eventType: event.type,
      livemode: mode === "live",
      payload: JSON.parse(JSON.stringify(event)),
    })
    .onConflictDoNothing();
  const [saved] = await db
    .select()
    .from(stripeEvents)
    .where(eq(stripeEvents.stripeEventId, event.id));
  if (saved.processingStatus === "COMPLETED") return;
  await bindStripeAccount(db, provider);
  // A verified event is an invalidation signal: retrieve current objects, never replay stale state.
  const object = event.data.object as unknown as Record<string, unknown>;
  const isSubscription = [
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "customer.subscription.paused",
    "customer.subscription.resumed",
  ].includes(event.type);
  const isInvoice = [
    "invoice.created",
    "invoice.updated",
    "invoice.finalized",
    "invoice.finalization_failed",
    "invoice.paid",
    "invoice.payment_failed",
    "invoice.voided",
    "invoice.marked_uncollectible",
  ].includes(event.type);
  if (!isSubscription && !isInvoice) {
    await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(stripeEvents)
        .where(eq(stripeEvents.id, saved.id))
        .for("update");
      if (locked.processingStatus === "COMPLETED") return;
      if (event.type === "customer.deleted") {
        const [customer] = await tx
          .select({ id: customers.id })
          .from(customers)
          .where(eq(customers.stripeCustomerId, String(object.id)));
        if (customer)
          await tx.insert(auditEvents).values({
            actorType: "PROVIDER",
            action: "stripe.customer_deleted_needs_review",
            entityType: "customer",
            entityId: customer.id,
            afterJson: { eventId: event.id },
          });
      }
      reconciliationStage = "completing webhook event";
      await tx
        .update(stripeEvents)
        .set({ processingStatus: "COMPLETED", processedAt: new Date() })
        .where(eq(stripeEvents.id, saved.id));
    });
    return;
  }
  let reconciliationStage = "starting reconciliation";
  try {
    // Capture the local customer revision BEFORE fetching the authoritative provider state.
    let subscriptionId = isSubscription ? idOf(object.id) : null;
    if (isInvoice) {
      const parent = object.parent as
        { subscription_details?: { subscription?: unknown } } | undefined;
      subscriptionId =
        idOf(parent?.subscription_details?.subscription) ??
        idOf(object.subscription);
    }
    if (!subscriptionId) {
      await db
        .update(stripeEvents)
        .set({ processingStatus: "COMPLETED", processedAt: new Date() })
        .where(eq(stripeEvents.id, saved.id));
      return;
    }
    let [local] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, subscriptionId));
    if (!local) {
      reconciliationStage = "retrieving unmapped subscription";
      const current = await provider.subscription(subscriptionId);
      if (/^[0-9a-f-]{36}$/i.test(current.internalId))
        [local] = await db
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.id, current.internalId));
      if (local)
        throw new StripeWorkflowError(
          "RETRY",
          "Subscription activation has not finished mapping its Stripe ID.",
        );
      await db
        .update(stripeEvents)
        .set({ processingStatus: "COMPLETED", processedAt: new Date() })
        .where(eq(stripeEvents.id, saved.id));
      return;
    }
    if (local.pendingStripeWorkflowId)
      throw new StripeWorkflowError(
        "RETRY",
        "A subscription operation is still pending.",
      );
    const [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, local.customerId));
    reconciliationStage = "retrieving Stripe subscription";
    const current = await provider.subscription(subscriptionId);
    if (
      current.customerId !== customer.stripeCustomerId ||
      (current.customerInternalId &&
        current.customerInternalId !== customer.id) ||
      (current.internalId && current.internalId !== local.id)
    )
      throw new StripeWorkflowError(
        "NEEDS_REVIEW",
        "Subscription ownership mismatch.",
      );
    let invoice: InvoiceState | undefined;
    if (isInvoice) {
      reconciliationStage = "retrieving Stripe invoice";
      invoice = await provider.invoice(String(object.id));
      if (
        invoice.customerId !== customer.stripeCustomerId ||
        invoice.subscriptionId !== current.id
      )
        throw new StripeWorkflowError(
          "NEEDS_REVIEW",
          "Invoice ownership mismatch.",
        );
      if (invoice.status === "draft" && invoice.autoAdvance) {
        await stripeRequest(
          db,
          provider,
          `invoice-hold:${invoice.id}`,
          "hold",
          { id: invoice.id },
        );
        invoice = await provider.invoice(invoice.id);
        if (invoice.autoAdvance)
          throw new StripeWorkflowError(
            "NEEDS_REVIEW",
            "Invoice automatic advancement is still enabled.",
          );
      }
    }
    reconciliationStage = "reconciling local records";
    await db.transaction(async (tx) => {
      reconciliationStage = "locking webhook event";
      const [lockedEvent] = await tx
        .select()
        .from(stripeEvents)
        .where(eq(stripeEvents.id, saved.id))
        .for("update");
      if (lockedEvent.processingStatus === "COMPLETED") return;
      reconciliationStage = "locking customer";
      const [lockedCustomer] = await tx
        .select()
        .from(customers)
        .where(eq(customers.id, customer.id))
        .for("update");
      reconciliationStage = "locking subscription";
      const [lockedSub] = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, local.id))
        .for("update");
      if (
        lockedCustomer.revision !== customer.revision ||
        lockedSub.revision !== local.revision ||
        lockedSub.pendingStripeWorkflowId
      )
        throw new StripeWorkflowError(
          "RETRY",
          "Local state changed during Stripe reconciliation. Retry with fresh state.",
        );
      reconciliationStage = "finding local price mapping";
      const [price] = await tx
        .select({ id: planPriceVersions.id })
        .from(planPriceVersions)
        .where(eq(planPriceVersions.stripePriceId, current.priceId));
      if (!price)
        throw new StripeWorkflowError(
          "NEEDS_REVIEW",
          "Stripe price is not mapped to an immutable local version.",
        );
      reconciliationStage = "saving subscription";
      await tx
        .update(subscriptions)
        .set({ ...subscriptionValues(current), planPriceVersionId: price.id })
        .where(eq(subscriptions.id, local.id));
      if (
        ["active", "trialing", "past_due"].includes(current.status) &&
        customer.status === "DRAFT"
      )
        reconciliationStage = "activating customer";
      await tx
        .update(customers)
        .set({ status: "ACTIVE" })
        .where(eq(customers.id, customer.id));
      if (invoice) {
        reconciliationStage = "saving invoice";
        const delinquent =
          invoice.status === "uncollectible" ||
          (invoice.status === "open" &&
            invoice.amountRemaining > 0 &&
            (invoice.attemptCount > 0 ||
              (invoice.dueDate !== null &&
                invoice.dueDate < Math.floor(Date.now() / 1000))));
        const values = {
          customerId: customer.id,
          subscriptionId: local.id,
          status: invoice.status,
          delinquent,
          autoAdvance: invoice.autoAdvance,
          updatedAt: new Date(),
        };
        await tx
          .insert(stripeInvoices)
          .values({ id: invoice.id, ...values })
          .onConflictDoUpdate({ target: stripeInvoices.id, set: values });
        reconciliationStage = "saving invoice history";
        await saveStripeInvoiceHistory(tx, invoice, customer.id);
        if (invoice.status === "paid")
          await tx
            .update(billingRuns)
            .set({ status: "COMPLETED", completedAt: new Date() })
            .where(
              and(
                eq(billingRuns.stripeInvoiceId, invoice.id),
                or(
                  eq(billingRuns.status, "PAYMENT_PENDING"),
                  eq(billingRuns.status, "PAST_DUE"),
                ),
              ),
            );
      }
      reconciliationStage = "refreshing payment status";
      await refreshPaymentStatus(tx, customer.id);
      reconciliationStage = "writing audit event";
      await tx.insert(auditEvents).values({
        actorType: "PROVIDER",
        actorId: event.id,
        action: invoice
          ? "stripe.invoice_reconciled"
          : "stripe.subscription_reconciled",
        entityType: "subscription",
        entityId: local.id,
        afterJson: {
          eventId: event.id,
          status: current.status,
          ...(invoice
            ? { invoiceId: invoice.id, invoiceStatus: invoice.status }
            : {}),
        },
      });
      await tx
        .update(stripeEvents)
        .set({
          processingStatus: "COMPLETED",
          processedAt: new Date(),
          errorMessage: null,
        })
        .where(eq(stripeEvents.id, saved.id));
    });
  } catch (error) {
    await db
      .update(stripeEvents)
      .set({
        processingStatus: "FAILED_RETRYABLE",
        errorMessage:
          error instanceof StripeWorkflowError
            ? error.code
            : `FAILED_AT:${reconciliationStage}`,
      })
      .where(
        and(
          eq(stripeEvents.id, saved.id),
          or(
            eq(stripeEvents.processingStatus, "PENDING"),
            eq(stripeEvents.processingStatus, "FAILED_RETRYABLE"),
          ),
        ),
      );
    throw error;
  }
}
