import "server-only";
import { and, asc, desc, eq, gt, ilike, isNull, sql } from "drizzle-orm";
import type { Database } from "../client";
import {
  appUsers,
  auditEvents,
  customers,
  plans,
  planPriceVersions,
  subscriptions,
  stripeWorkflows,
} from "../schema";
import type { AuditActor } from "./contracts";
import { CustomerError } from "../../customers/validation";
import { type PlanInput, pricingSnapshot } from "../../plans/validation";
import { parseUsd, formatUsd } from "../../domain/billing/money";
import {
  BILLING_POLICY_VERSION,
  nextBillingAnchor,
} from "../../domain/billing/calendar";
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
async function authorize(tx: Tx, actor: AuditActor) {
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
async function audit(
  tx: Tx,
  actor: AuditActor,
  type: string,
  id: string,
  action: string,
  before?: Record<string, unknown>,
  after?: Record<string, unknown>,
) {
  await tx.insert(auditEvents).values({
    actorType: "ADMIN",
    actorId: actor.appUserId,
    requestId: actor.requestId,
    entityType: type,
    entityId: id,
    action,
    beforeJson: before,
    afterJson: after,
  });
}
function values(input: PlanInput) {
  return {
    name: input.name,
    description: input.description,
    planType: input.planType,
    baseAmountMinor: parseUsd(input.baseAmount),
    includedMinutes: input.includedMinutes,
    additionalMinuteAmountMinor: parseUsd(input.additionalMinuteAmount),
    includedNumbers: input.includedNumbers,
    numberAmountMinor: parseUsd(input.numberAmount),
    includedChannels: input.includedChannels,
    channelAmountMinor: parseUsd(input.channelAmount),
  };
}
function planView(row: typeof plans.$inferSelect) {
  return {
    id: row.id,
    revision: row.revision,
    name: row.name,
    description: row.description ?? "",
    planType: row.planType,
    active: row.active,
    baseAmount: formatUsd(row.baseAmountMinor ?? 0n),
    includedMinutes: row.includedMinutes ?? "0",
    additionalMinuteAmount: formatUsd(row.additionalMinuteAmountMinor ?? 0n),
    includedNumbers: row.includedNumbers,
    numberAmount: formatUsd(row.numberAmountMinor),
    includedChannels: row.includedChannels,
    channelAmount: formatUsd(row.channelAmountMinor),
  };
}
async function availableVersion(tx: Tx, versionId: string) {
  const [pointer] = await tx
    .select({ planId: planPriceVersions.planId })
    .from(planPriceVersions)
    .where(eq(planPriceVersions.id, versionId));
  if (!pointer) throw new CustomerError("NOT_FOUND", "Price version not found");
  const [plan] = await tx
    .select()
    .from(plans)
    .where(eq(plans.id, pointer.planId))
    .for("share");
  const [version] = await tx
    .select()
    .from(planPriceVersions)
    .where(eq(planPriceVersions.id, versionId));
  if (!plan.active || version.activeUntil)
    throw new CustomerError(
      "CONFLICT",
      "This price is no longer available. Select the latest active plan.",
    );
  return version;
}
async function lockCustomer(tx: Tx, id: string) {
  const [customer] = await tx
    .select({
      id: customers.id,
      status: customers.status,
      billingDay: customers.billingDay,
    })
    .from(customers)
    .where(eq(customers.id, id))
    .for("update");
  if (!customer) throw new CustomerError("NOT_FOUND", "Customer not found");
  if (customer.status === "ARCHIVED")
    throw new CustomerError(
      "ARCHIVED",
      "Restore this customer before preparing a subscription.",
    );
  return customer;
}
async function lockDraft(tx: Tx, id: string, revision: number) {
  // Customer first, matching archive/activity locks; then subscription and plan.
  const [pointer] = await tx
    .select({ customerId: subscriptions.customerId })
    .from(subscriptions)
    .where(eq(subscriptions.id, id));
  if (!pointer) throw new CustomerError("NOT_FOUND", "Subscription not found");
  const customer = await lockCustomer(tx, pointer.customerId);
  const [draft] = await tx
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, id))
    .for("update");
  if (draft.revision !== revision)
    throw new CustomerError(
      "CONFLICT",
      "This subscription changed. Refresh before saving.",
    );
  if (
    draft.pendingStripeWorkflowId ||
    draft.status !== "DRAFT" ||
    draft.stripeSubscriptionId ||
    draft.currentPeriodStart
  )
    throw new CustomerError(
      "CONFLICT",
      "Provider-linked subscriptions require the Stripe integration for changes.",
    );
  return { customer, draft };
}
export function planManagementRepository(db: Database) {
  return {
    async listPlans(
      input: {
        q?: string;
        after?: string;
        activeOnly?: boolean;
        limit?: number;
      } = {},
    ) {
      const limit = input.limit ?? 25;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new Error("Invalid page size");
      const search = input.q?.replace(/[\\%_]/g, "\\$&");
      const rows = await db
        .select({
          id: plans.id,
          name: plans.name,
          planType: plans.planType,
          active: plans.active,
          version: planPriceVersions.version,
          priceVersionId: planPriceVersions.id,
          baseAmount: sql<string>`${plans.baseAmountMinor}::text`,
        })
        .from(plans)
        .leftJoin(
          planPriceVersions,
          and(
            eq(planPriceVersions.planId, plans.id),
            isNull(planPriceVersions.activeUntil),
          ),
        )
        .where(
          and(
            input.after ? gt(plans.id, input.after) : undefined,
            input.activeOnly ? eq(plans.active, true) : undefined,
            search ? ilike(plans.name, `%${search}%`) : undefined,
          ),
        )
        .orderBy(asc(plans.id))
        .limit(limit + 1);
      return {
        items: rows.slice(0, limit),
        next: rows.length > limit ? rows[limit - 1].id : null,
      };
    },
    async planDetail(id: string, page = 0) {
      if (!Number.isInteger(page) || page < 0 || page > 10000)
        throw new Error("Invalid page");
      const [row] = await db.select().from(plans).where(eq(plans.id, id));
      if (!row) return null;
      const versions = await db
        .select({
          id: planPriceVersions.id,
          version: planPriceVersions.version,
          configuration: planPriceVersions.pricingConfiguration,
          activeFrom: planPriceVersions.activeFrom,
          activeUntil: planPriceVersions.activeUntil,
        })
        .from(planPriceVersions)
        .where(eq(planPriceVersions.planId, id))
        .orderBy(desc(planPriceVersions.version))
        .limit(21)
        .offset(page * 20);
      return {
        plan: planView(row),
        versions: versions.slice(0, 20),
        moreVersions: versions.length > 20,
      };
    },
    async createPlan(input: PlanInput, actor: AuditActor) {
      return db.transaction(async (tx) => {
        await authorize(tx, actor);
        const [plan] = await tx.insert(plans).values(values(input)).returning();
        const snapshot = pricingSnapshot(input);
        await tx.insert(planPriceVersions).values({
          planId: plan.id,
          version: 1,
          pricingConfiguration: snapshot,
          activeFrom: new Date(),
        });
        await audit(
          tx,
          actor,
          "plan",
          plan.id,
          "plan.created",
          undefined,
          snapshot,
        );
        return { id: plan.id };
      });
    },
    async updatePlan(
      id: string,
      revision: number,
      input: PlanInput,
      actor: AuditActor,
    ) {
      return db.transaction(async (tx) => {
        await authorize(tx, actor);
        const [plan] = await tx
          .select()
          .from(plans)
          .where(eq(plans.id, id))
          .for("update");
        if (!plan) throw new CustomerError("NOT_FOUND", "Plan not found");
        if (plan.revision !== revision)
          throw new CustomerError(
            "CONFLICT",
            "This plan changed. Refresh before saving.",
          );
        const [latest] = await tx
          .select()
          .from(planPriceVersions)
          .where(eq(planPriceVersions.planId, id))
          .orderBy(desc(planPriceVersions.version))
          .limit(1);
        const now = new Date(
          Math.max(Date.now(), (latest?.activeFrom.getTime() ?? 0) + 1),
        );
        if (latest && !latest.activeUntil)
          await tx
            .update(planPriceVersions)
            .set({ activeUntil: now })
            .where(eq(planPriceVersions.id, latest.id));
        const snapshot = pricingSnapshot(input);
        const version = (latest?.version ?? 0) + 1;
        await tx.insert(planPriceVersions).values({
          planId: id,
          version,
          pricingConfiguration: snapshot,
          activeFrom: now,
        });
        await tx.update(plans).set(values(input)).where(eq(plans.id, id));
        await audit(
          tx,
          actor,
          "plan",
          id,
          "plan.price_version_created",
          { version: latest?.version ?? 0 },
          { version, ...snapshot },
        );
        return { id };
      });
    },
    async setPlanActive(
      id: string,
      revision: number,
      active: boolean,
      actor: AuditActor,
    ) {
      return db.transaction(async (tx) => {
        await authorize(tx, actor);
        const [plan] = await tx
          .select()
          .from(plans)
          .where(eq(plans.id, id))
          .for("update");
        if (!plan) throw new CustomerError("NOT_FOUND", "Plan not found");
        if (plan.revision !== revision)
          throw new CustomerError(
            "CONFLICT",
            "This plan changed. Refresh before saving.",
          );
        await tx.update(plans).set({ active }).where(eq(plans.id, id));
        await audit(
          tx,
          actor,
          "plan",
          id,
          "plan.availability_changed",
          { active: plan.active },
          { active },
        );
        return { id };
      });
    },
    async listSubscriptions(
      input: { customerId?: string; after?: string; limit?: number } = {},
    ) {
      const limit = input.limit ?? 25;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new Error("Invalid page size");
      const rows = await db
        .select({
          id: subscriptions.id,
          customerId: customers.id,
          customerName: customers.fullName,
          planName: plans.name,
          version: planPriceVersions.version,
          status: subscriptions.status,
          billingDay: subscriptions.billingDay,
          anchor: subscriptions.proposedBillingAnchor,
        })
        .from(subscriptions)
        .innerJoin(customers, eq(customers.id, subscriptions.customerId))
        .innerJoin(
          planPriceVersions,
          eq(planPriceVersions.id, subscriptions.planPriceVersionId),
        )
        .innerJoin(plans, eq(plans.id, planPriceVersions.planId))
        .where(
          and(
            input.customerId ? eq(customers.id, input.customerId) : undefined,
            input.after ? gt(subscriptions.id, input.after) : undefined,
          ),
        )
        .orderBy(asc(subscriptions.id))
        .limit(limit + 1);
      return {
        items: rows.slice(0, limit),
        next: rows.length > limit ? rows[limit - 1].id : null,
      };
    },
    async subscriptionDetail(id: string) {
      const [row] = await db
        .select({
          id: subscriptions.id,
          customerId: customers.id,
          customerName: customers.fullName,
          revision: subscriptions.revision,
          pendingStripeWorkflowId: subscriptions.pendingStripeWorkflowId,
          status: subscriptions.status,
          collectionMethod: subscriptions.collectionMethod,
          billingDay: subscriptions.billingDay,
          anchor: subscriptions.proposedBillingAnchor,
          policy: subscriptions.billingPolicyVersion,
          stripeSubscriptionId: subscriptions.stripeSubscriptionId,
          cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
          currentPeriodEnd: subscriptions.currentPeriodEnd,
          priceVersionId: planPriceVersions.id,
          version: planPriceVersions.version,
          pricing: planPriceVersions.pricingConfiguration,
          planName: plans.name,
        })
        .from(subscriptions)
        .innerJoin(customers, eq(customers.id, subscriptions.customerId))
        .innerJoin(
          planPriceVersions,
          eq(planPriceVersions.id, subscriptions.planPriceVersionId),
        )
        .innerJoin(plans, eq(plans.id, planPriceVersions.planId))
        .where(eq(subscriptions.id, id));
      if (!row) return null;
      const workflow = row.pendingStripeWorkflowId
        ? (
            await db
              .select({
                status: stripeWorkflows.status,
                errorCode: stripeWorkflows.errorCode,
              })
              .from(stripeWorkflows)
              .where(eq(stripeWorkflows.id, row.pendingStripeWorkflowId))
          )[0]
        : null;
      return { ...row, workflow };
    },
    async createDraft(
      input: {
        creationKey: string;
        customerId: string;
        planPriceVersionId: string;
        collectionMethod: "send_invoice" | "charge_automatically";
      },
      actor: AuditActor,
    ) {
      return db.transaction(async (tx) => {
        await authorize(tx, actor);
        const customer = await lockCustomer(tx, input.customerId);
        const [existing] = await tx
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.creationKey, input.creationKey));
        if (existing) {
          if (
            existing.customerId !== input.customerId ||
            existing.planPriceVersionId !== input.planPriceVersionId ||
            existing.collectionMethod !== input.collectionMethod
          )
            throw new CustomerError(
              "CONFLICT",
              "This request was already used for different subscription details.",
            );
          return { id: existing.id };
        }
        await availableVersion(tx, input.planPriceVersionId);
        const [draft] = await tx
          .insert(subscriptions)
          .values({
            ...input,
            billingDay: customer.billingDay,
            proposedBillingAnchor: nextBillingAnchor(
              new Date(),
              customer.billingDay,
            ),
            billingPolicyVersion: BILLING_POLICY_VERSION,
          })
          .onConflictDoNothing({ target: subscriptions.creationKey })
          .returning();
        if (!draft)
          throw new CustomerError(
            "CONFLICT",
            "Subscription request already used. Refresh and review existing subscriptions.",
          );
        await audit(
          tx,
          actor,
          "subscription",
          draft.id,
          "subscription.draft_created",
          undefined,
          {
            customerId: input.customerId,
            priceVersionId: input.planPriceVersionId,
            collectionMethod: input.collectionMethod,
            billingDay: customer.billingDay,
            anchor: draft.proposedBillingAnchor!.toISOString(),
            policy: BILLING_POLICY_VERSION,
          },
        );
        return { id: draft.id };
      });
    },
    async updateDraft(
      id: string,
      revision: number,
      input: {
        planPriceVersionId: string;
        collectionMethod: "send_invoice" | "charge_automatically";
      },
      actor: AuditActor,
    ) {
      return db.transaction(async (tx) => {
        await authorize(tx, actor);
        const { customer, draft } = await lockDraft(tx, id, revision);
        await availableVersion(tx, input.planPriceVersionId);
        await tx
          .update(subscriptions)
          .set({
            ...input,
            billingDay: customer.billingDay,
            proposedBillingAnchor: nextBillingAnchor(
              new Date(),
              customer.billingDay,
            ),
            billingPolicyVersion: BILLING_POLICY_VERSION,
          })
          .where(eq(subscriptions.id, id));
        await audit(
          tx,
          actor,
          "subscription",
          id,
          "subscription.draft_changed",
          {
            priceVersionId: draft.planPriceVersionId,
            collectionMethod: draft.collectionMethod,
          },
          {
            priceVersionId: input.planPriceVersionId,
            collectionMethod: input.collectionMethod,
          },
        );
        return { id };
      });
    },
    async discardDraft(id: string, revision: number, actor: AuditActor) {
      return db.transaction(async (tx) => {
        await authorize(tx, actor);
        await lockDraft(tx, id, revision);
        await tx
          .update(subscriptions)
          .set({ status: "CANCELED", canceledAt: new Date() })
          .where(eq(subscriptions.id, id));
        await audit(
          tx,
          actor,
          "subscription",
          id,
          "subscription.draft_discarded",
          { status: "DRAFT" },
          { status: "CANCELED" },
        );
        return { id };
      });
    },
  };
}
