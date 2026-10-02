import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  appUsers,
  auditEvents,
  customers,
  plans,
  planPriceVersions,
  subscriptions,
  stripeRequests,
  stripeWorkflows,
  stripeInvoices,
} from "../db/schema";
import type { AuditActor } from "../db/repositories/contracts";
import { CustomerError } from "../customers/validation";
import { bindStripeAccount, stripeRequest } from "./requests";
import { heldInvoiceSchedule } from "./schedule";
import {
  StripeWorkflowError,
  type StripeProvider,
  type SubscriptionState,
} from "./contracts";
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Kind = "activate" | "change" | "cancel";
type Command = {
  requestKey: string;
  revision: number;
  planPriceVersionId?: string;
  collectionMethod?: "send_invoice" | "charge_automatically";
  daysUntilDue?: number;
};
type Intent = {
  customerId: string;
  customerName: string;
  customerEmail: string;
  priceVersionId: string;
  planType: "FIXED" | "METERED" | "UNMETERED" | "OTHER";
  billingDay: number;
  collectionMethod: "send_invoice" | "charge_automatically";
  daysUntilDue?: number;
  prorationDate: number;
  request: Command;
};
export async function stripeAuthorize(tx: Tx, actor: AuditActor) {
  const [user] = await tx
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(
      and(
        eq(appUsers.id, actor.appUserId),
        eq(appUsers.status, "ACTIVE"),
        eq(appUsers.role, "ADMIN"),
      ),
    )
    .for("share");
  if (!user)
    throw new CustomerError(
      "UNAUTHORIZED",
      "An active administrator is required",
    );
}
export async function refreshPaymentStatus(tx: Tx, customerId: string) {
  const [due] = await tx
    .select({ id: stripeInvoices.id })
    .from(stripeInvoices)
    .where(
      and(
        eq(stripeInvoices.customerId, customerId),
        eq(stripeInvoices.delinquent, true),
      ),
    )
    .limit(1);
  const [sub] = await tx
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.customerId, customerId),
        sql`${subscriptions.status} IN ('PAST_DUE','UNPAID')`,
      ),
    )
    .limit(1);
  await tx
    .update(customers)
    .set({ paymentStatus: due || sub ? "PAST_DUE" : "CURRENT" })
    .where(eq(customers.id, customerId));
}
export function subscriptionValues(state: SubscriptionState) {
  const status = state.status.toUpperCase();
  if (
    ![
      "INCOMPLETE",
      "INCOMPLETE_EXPIRED",
      "TRIALING",
      "ACTIVE",
      "PAST_DUE",
      "CANCELED",
      "UNPAID",
      "PAUSED",
    ].includes(status)
  )
    throw new Error("Unsupported Stripe subscription state");
  return {
    stripeSubscriptionId: state.id,
    stripeSubscriptionItemId: state.itemId,
    status,
    collectionMethod: state.collectionMethod,
    currentPeriodStart: new Date(state.periodStart * 1000),
    currentPeriodEnd: new Date(state.periodEnd * 1000),
    cancelAtPeriodEnd: state.cancelAtPeriodEnd,
    canceledAt: state.canceledAt ? new Date(state.canceledAt * 1000) : null,
  };
}
export function stripeService(db: Database, provider: StripeProvider) {
  async function requireAutomaticPaymentMethod(
    id: string,
    collectionMethod: Command["collectionMethod"],
  ) {
    const [row] = await db
      .select({
        collectionMethod: subscriptions.collectionMethod,
        stripeCustomerId: customers.stripeCustomerId,
      })
      .from(subscriptions)
      .innerJoin(customers, eq(customers.id, subscriptions.customerId))
      .where(eq(subscriptions.id, id));
    if (
      (collectionMethod ?? row?.collectionMethod) === "charge_automatically" &&
      (!row.stripeCustomerId ||
        !(await provider.hasDefaultPaymentMethod(row.stripeCustomerId)))
    )
      throw new CustomerError(
        "CONFLICT",
        "Add a payment method for this customer before activating automatic charging.",
      );
  }
  async function begin(
    id: string,
    kind: Kind,
    command: Command,
    actor: AuditActor,
  ) {
    return db.transaction(async (tx) => {
      await stripeAuthorize(tx, actor);
      const [pointer] = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, id));
      if (!pointer)
        throw new CustomerError("NOT_FOUND", "Subscription not found");
      const [customer] = await tx
        .select()
        .from(customers)
        .where(eq(customers.id, pointer.customerId))
        .for("update");
      const [sub] = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, id))
        .for("update");
      const [existing] = await tx
        .select()
        .from(stripeWorkflows)
        .where(eq(stripeWorkflows.requestKey, command.requestKey));
      if (existing) {
        const original = existing.input as unknown as Intent;
        if (
          existing.subscriptionId !== id ||
          existing.kind !== kind ||
          (
            [
              "requestKey",
              "revision",
              "planPriceVersionId",
              "daysUntilDue",
            ] as const
          ).some((key) => original.request[key] !== command[key])
        )
          throw new CustomerError(
            "CONFLICT",
            "This request key is already in use.",
          );
        return existing.id;
      }
      if (customer.status === "ARCHIVED")
        throw new CustomerError(
          "ARCHIVED",
          "Restore the customer before changing a subscription.",
        );
      if (sub.pendingStripeWorkflowId)
        throw new CustomerError(
          "CONFLICT",
          "Finish the pending Stripe operation first.",
        );
      if (sub.revision !== command.revision)
        throw new CustomerError(
          "CONFLICT",
          "Subscription changed. Refresh before continuing.",
        );
      if (
        kind === "activate"
          ? sub.status !== "DRAFT" || Boolean(sub.stripeSubscriptionId)
          : !sub.stripeSubscriptionId ||
            !["ACTIVE", "TRIALING", "PAST_DUE", "UNPAID"].includes(sub.status)
      )
        throw new CustomerError(
          "CONFLICT",
          "This subscription cannot perform that operation.",
        );
      if (kind === "change" && sub.cancelAtPeriodEnd)
        throw new CustomerError(
          "CONFLICT",
          "This subscription is scheduled to end.",
        );
      if (
        !["send_invoice", "charge_automatically"].includes(
          command.collectionMethod ?? sub.collectionMethod ?? "",
        )
      )
        throw new CustomerError(
          "CONFLICT",
          "Choose a collection method before activation.",
        );
      if (
        kind === "activate" &&
        (command.collectionMethod ?? sub.collectionMethod) === "send_invoice" &&
        !command.daysUntilDue
      )
        throw new CustomerError(
          "CONFLICT",
          "Enter the number of days until the invoice is due.",
        );
      const priceVersionId =
        command.planPriceVersionId ?? sub.planPriceVersionId;
      const [version] = await tx
        .select()
        .from(planPriceVersions)
        .where(eq(planPriceVersions.id, priceVersionId));
      if (!version)
        throw new CustomerError("NOT_FOUND", "Price version not found");
      const [plan] = await tx
        .select()
        .from(plans)
        .where(eq(plans.id, version.planId))
        .for("share");
      if (kind !== "cancel" && (!plan.active || version.activeUntil))
        throw new CustomerError(
          "CONFLICT",
          "Select an available plan price before continuing.",
        );
      const collectionMethod =
        command.collectionMethod ??
        (sub.collectionMethod as Intent["collectionMethod"]);
      if (
        kind === "change" &&
        priceVersionId === sub.planPriceVersionId &&
        collectionMethod === sub.collectionMethod
      )
        throw new CustomerError(
          "CONFLICT",
          "Choose a different price version.",
        );
      const input: Intent = {
        customerId: customer.id,
        customerName: customer.fullName,
        customerEmail: customer.email,
        priceVersionId,
        planType: plan.planType,
        billingDay: sub.billingDay,
        collectionMethod,
        ...(command.daysUntilDue ? { daysUntilDue: command.daysUntilDue } : {}),
        prorationDate: Math.floor(Date.now() / 1000),
        request: command,
      };
      const [flow] = await tx
        .insert(stripeWorkflows)
        .values({
          requestKey: command.requestKey,
          subscriptionId: id,
          kind,
          input: input as unknown as Record<string, unknown>,
        })
        .returning();
      await tx
        .update(subscriptions)
        .set({ pendingStripeWorkflowId: flow.id })
        .where(eq(subscriptions.id, id));
      await tx.insert(auditEvents).values({
        actorType: "ADMIN",
        actorId: actor.appUserId,
        action: `stripe.${kind}_requested`,
        entityType: "subscription",
        entityId: id,
        afterJson: { workflowId: flow.id, priceVersionId },
        requestId: actor.requestId,
      });
      return flow.id;
    });
  }
  async function run(id: string, workflowId: string, actor: AuditActor) {
    await bindStripeAccount(db, provider);
    const token = crypto.randomUUID();
    const flow = await db.transaction(async (tx) => {
      await stripeAuthorize(tx, actor);
      const [row] = await tx
        .select()
        .from(stripeWorkflows)
        .where(eq(stripeWorkflows.id, workflowId))
        .for("update");
      if (!row || row.subscriptionId !== id)
        throw new CustomerError("NOT_FOUND", "Stripe operation not found");
      if (row.status === "SUCCEEDED") return row;
      if (row.status === "NEEDS_REVIEW")
        throw new StripeWorkflowError(
          "NEEDS_REVIEW",
          "Reconcile this Stripe operation before retrying.",
        );
      if (row.leaseUntil && row.leaseUntil > new Date())
        throw new StripeWorkflowError(
          "BUSY",
          "This operation is running. Refresh shortly.",
        );
      await tx
        .update(stripeWorkflows)
        .set({
          leaseToken: token,
          leaseUntil: new Date(Date.now() + 180_000),
          errorCode: null,
        })
        .where(eq(stripeWorkflows.id, workflowId));
      return row;
    });
    if (flow.status === "SUCCEEDED") return { id };
    const input = flow.input as unknown as Intent;
    try {
      let [customer] = await db
        .select()
        .from(customers)
        .where(eq(customers.id, input.customerId));
      const [sub] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, id));
      if (
        sub.pendingStripeWorkflowId !== workflowId ||
        customer.status === "ARCHIVED"
      )
        throw new StripeWorkflowError(
          "NEEDS_REVIEW",
          "Subscription reservation no longer matches.",
        );
      if (!customer.stripeCustomerId) {
        const customerId = await stripeRequest(
          db,
          provider,
          `customer:${customer.id}`,
          "customer",
          {
            name: input.customerName,
            email: input.customerEmail,
            metadata: { internal_customer_id: customer.id },
          },
        );
        const rows = await db
          .update(customers)
          .set({ stripeCustomerId: customerId })
          .where(
            and(
              eq(customers.id, customer.id),
              sql`(${customers.stripeCustomerId} IS NULL OR ${customers.stripeCustomerId} = ${customerId})`,
            ),
          )
          .returning();
        if (!rows.length)
          throw new StripeWorkflowError(
            "NEEDS_REVIEW",
            "Stripe customer mapping changed.",
          );
        customer = rows[0];
      }
      let priceId: string | null = null;
      if (flow.kind !== "cancel") {
        const [price] = await db
          .select()
          .from(planPriceVersions)
          .where(eq(planPriceVersions.id, input.priceVersionId));
        if (price.stripePriceId) priceId = price.stripePriceId;
        else {
          const snapshot = price.pricingConfiguration;
          if (
            snapshot.schemaVersion !== 1 ||
            snapshot.currency !== "USD" ||
            typeof snapshot.baseAmountMinor !== "string" ||
            !/^\d+$/.test(snapshot.baseAmountMinor) ||
            BigInt(snapshot.baseAmountMinor) > BigInt(Number.MAX_SAFE_INTEGER)
          )
            throw new StripeWorkflowError(
              "NEEDS_REVIEW",
              "This price snapshot requires migration review before Stripe synchronization.",
            );
          const product = await stripeRequest(
            db,
            provider,
            `product:${price.id}`,
            "product",
            {
              name: String(snapshot.name),
              metadata: {
                internal_plan_id: price.planId,
                price_version_id: price.id,
              },
            },
          );
          priceId = await stripeRequest(
            db,
            provider,
            `price:${price.id}`,
            "price",
            {
              product,
              currency: "usd",
              unit_amount: Number(snapshot.baseAmountMinor),
              recurring: { interval: "month" },
              metadata: { price_version_id: price.id },
            },
          );
          await db
            .update(planPriceVersions)
            .set({ stripeProductId: product, stripePriceId: priceId })
            .where(eq(planPriceVersions.id, price.id));
        }
      }
      let providerId = sub.stripeSubscriptionId;
      let scheduleId: string | null = null;
      const itemQuantity = input.planType === "FIXED" ? 1 : 0;
      if (flow.kind === "activate") {
        if (
          input.collectionMethod === "charge_automatically" &&
          !(await provider.hasDefaultPaymentMethod(customer.stripeCustomerId!))
        )
          throw new CustomerError(
            "CONFLICT",
            "Add a payment method for this customer before activating automatic charging.",
          );
        if (input.collectionMethod === "charge_automatically") {
          scheduleId = await stripeRequest(
            db,
            provider,
            `workflow:${flow.id}`,
            "schedule",
            heldInvoiceSchedule({
              customerId: customer.stripeCustomerId!,
              priceId: priceId!,
              billingDay: input.billingDay,
              collectionMethod: input.collectionMethod,
              quantity: itemQuantity,
              subscriptionId: id,
              internalCustomerId: customer.id,
            }),
          );
          providerId = await provider.scheduleSubscription(scheduleId);
        } else
          providerId = await stripeRequest(
            db,
            provider,
            `workflow:${flow.id}`,
            "subscription",
            {
              customer: customer.stripeCustomerId,
              items: [{ price: priceId, quantity: itemQuantity }],
              collection_method: input.collectionMethod,
              days_until_due: input.daysUntilDue,
              billing_cycle_anchor_config: {
                day_of_month: input.billingDay,
                hour: 11,
                minute: 0,
                second: 0,
              },
              proration_behavior: "create_prorations",
              metadata: {
                internal_customer_id: customer.id,
                subscription_id: id,
                price_version_id: input.priceVersionId,
              },
            },
          );
      } else {
        const current = await provider.subscription(providerId!);
        if (
          current.customerId !== customer.stripeCustomerId ||
          (current.internalId && current.internalId !== id) ||
          (current.customerInternalId &&
            current.customerInternalId !== customer.id)
        )
          throw new StripeWorkflowError(
            "NEEDS_REVIEW",
            "Stripe subscription ownership does not match.",
          );
        if (
          !["active", "trialing", "past_due", "unpaid"].includes(current.status)
        )
          throw new StripeWorkflowError(
            "NEEDS_REVIEW",
            "Stripe subscription is no longer editable.",
          );
        const params =
          flow.kind === "cancel"
            ? { id: providerId, cancel_at_period_end: true }
            : {
                id: providerId,
                items: [{ id: current.itemId, price: priceId, quantity: itemQuantity }],
                collection_method: input.collectionMethod,
                ...(input.collectionMethod === "send_invoice" &&
                input.daysUntilDue
                  ? { days_until_due: input.daysUntilDue }
                  : {}),
                proration_behavior: "create_prorations",
                proration_date: input.prorationDate,
                payment_behavior: "allow_incomplete",
                metadata: { price_version_id: input.priceVersionId },
              };
        await stripeRequest(
          db,
          provider,
          `workflow:${flow.id}`,
          flow.kind as "change" | "cancel",
          params,
        );
      }
      const state = await provider.subscription(providerId!);
      if (
        state.id !== providerId ||
        state.customerId !== customer.stripeCustomerId ||
        (state.internalId && state.internalId !== id) ||
        (state.customerInternalId &&
          state.customerInternalId !== customer.id) ||
        (flow.kind !== "cancel" && state.priceId !== priceId)
      )
        throw new StripeWorkflowError(
          "NEEDS_REVIEW",
          "Stripe returned an unexpected subscription mapping.",
        );
      if (scheduleId && state.latestInvoiceId) {
        const invoice = await provider.invoice(state.latestInvoiceId);
        if (
          invoice.customerId !== customer.stripeCustomerId ||
          invoice.subscriptionId !== state.id ||
          invoice.status !== "draft"
        )
          throw new StripeWorkflowError(
            "NEEDS_REVIEW",
            "The scheduled subscription did not produce a held draft invoice.",
          );
        if (invoice.autoAdvance)
          await stripeRequest(
            db,
            provider,
            `invoice-hold:${invoice.id}`,
            "hold",
            { id: invoice.id },
          );
      }
      await db.transaction(async (tx) => {
        await tx
          .select({ id: customers.id })
          .from(customers)
          .where(eq(customers.id, customer.id))
          .for("update");
        const [locked] = await tx
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.id, id))
          .for("update");
        const [owned] = await tx
          .select()
          .from(stripeWorkflows)
          .where(eq(stripeWorkflows.id, flow.id))
          .for("update");
        if (
          owned.leaseToken !== token ||
          locked.pendingStripeWorkflowId !== flow.id
        )
          throw new StripeWorkflowError(
            "BUSY",
            "Operation ownership changed. Retry to reconcile.",
          );
        await tx
          .update(subscriptions)
          .set({
            ...subscriptionValues(state),
            planPriceVersionId: input.priceVersionId,
            ...(scheduleId ? { stripeScheduleId: scheduleId } : {}),
            pendingStripeWorkflowId: null,
            ...(flow.kind === "cancel"
              ? { cancellationRequestedAt: new Date() }
              : {}),
          })
          .where(eq(subscriptions.id, id));
        if (["active", "trialing", "past_due"].includes(state.status))
          await tx
            .update(customers)
            .set({ status: "ACTIVE" })
            .where(
              and(eq(customers.id, customer.id), eq(customers.status, "DRAFT")),
            );
        await refreshPaymentStatus(tx, customer.id);
        await tx
          .update(stripeWorkflows)
          .set({
            status: "SUCCEEDED",
            completedAt: new Date(),
            leaseToken: null,
            leaseUntil: null,
            errorCode: null,
          })
          .where(eq(stripeWorkflows.id, flow.id));
        await tx.insert(auditEvents).values({
          actorType: "ADMIN",
          actorId: actor.appUserId,
          action: `stripe.${flow.kind}_completed`,
          entityType: "subscription",
          entityId: id,
          afterJson: {
            workflowId: flow.id,
            providerId,
            status: state.status,
            priceVersionId: input.priceVersionId,
          },
          requestId: actor.requestId,
        });
      });
      return { id };
    } catch (error) {
      const review =
        error instanceof StripeWorkflowError && error.code === "NEEDS_REVIEW";
      const paymentMethodRequired =
        error instanceof CustomerError &&
        error.message ===
          "Add a payment method for this customer before activating automatic charging.";
      await db
        .update(stripeWorkflows)
        .set({
          status: review ? "NEEDS_REVIEW" : "PENDING",
          errorCode: review
            ? "RECONCILIATION_REQUIRED"
            : paymentMethodRequired
              ? "PAYMENT_METHOD_REQUIRED"
              : "PROVIDER_RETRY_REQUIRED",
          leaseToken: null,
          leaseUntil: null,
        })
        .where(
          and(
            eq(stripeWorkflows.id, flow.id),
            eq(stripeWorkflows.leaseToken, token),
          ),
        );
      if (error instanceof StripeWorkflowError || error instanceof CustomerError)
        throw error;
      throw new StripeWorkflowError(
        "RETRY",
        "Stripe synchronization is incomplete. Refresh and retry the saved operation.",
      );
    }
  }
  return {
    async start(id: string, kind: Kind, command: Command, actor: AuditActor) {
      if (
        kind === "activate" ||
        command.collectionMethod === "charge_automatically"
      )
        await requireAutomaticPaymentMethod(id, command.collectionMethod);
      const flow = await begin(id, kind, command, actor);
      return run(id, flow, actor);
    },
    retry: run,
    async abandonUnstartedDraft(
      id: string,
      workflowId: string,
      actor: AuditActor,
    ) {
      return db.transaction(async (tx) => {
        await stripeAuthorize(tx, actor);
        const [flow] = await tx
          .select()
          .from(stripeWorkflows)
          .where(eq(stripeWorkflows.id, workflowId))
          .for("update");
        if (!flow || flow.subscriptionId !== id)
          throw new CustomerError("NOT_FOUND", "Stripe operation not found");
        if (flow.kind !== "activate")
          throw new CustomerError(
            "CONFLICT",
            "Only an unfinished activation draft can be deleted.",
          );
        const [sub] = await tx
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.id, id))
          .for("update");
        if (
          sub.pendingStripeWorkflowId !== workflowId ||
          sub.status !== "DRAFT" ||
          sub.stripeSubscriptionId
        )
          throw new CustomerError(
            "CONFLICT",
            "Only an unactivated draft can be deleted.",
          );
        const [providerRequest] = await tx
          .select({ providerId: stripeRequests.providerId })
          .from(stripeRequests)
          .where(eq(stripeRequests.operationKey, `workflow:${workflowId}`))
          .for("update");
        if (providerRequest)
          throw new CustomerError(
            "CONFLICT",
            "Stripe has started this activation. Reconcile it before deleting the draft.",
          );
        await tx
          .update(subscriptions)
          .set({ status: "CANCELED", pendingStripeWorkflowId: null })
          .where(eq(subscriptions.id, id));
        await tx
          .update(stripeWorkflows)
          .set({
            status: "NEEDS_REVIEW",
            errorCode: "ABANDONED_BY_ADMIN",
            leaseToken: null,
            leaseUntil: null,
          })
          .where(eq(stripeWorkflows.id, workflowId));
        await tx.insert(auditEvents).values({
          actorType: "ADMIN",
          actorId: actor.appUserId,
          action: "subscription.unstarted_draft_deleted",
          entityType: "subscription",
          entityId: id,
          beforeJson: { status: "DRAFT", workflowId },
          afterJson: { status: "CANCELED", workflowId },
          requestId: actor.requestId,
        });
        return { id };
      });
    },
  };
}
