import "server-only";
import { and, asc, eq, gt } from "drizzle-orm";
import type { Database } from "../client";
import {
  appUsers,
  auditEvents,
  billingRuns,
  customers,
  plans,
  stripeEvents,
  subscriptions,
  usageExports,
  usageSnapshots,
} from "../schema";
import type {
  AuditActor,
  BillingRunRepository,
  CatalogRepository,
  CustomerRepository,
  StripeEventRepository,
  UsageRepository,
} from "./contracts";

function pageSize(limit = 50) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Page size must be between 1 and 100");
  return limit;
}
const customerFields = {
  id: customers.id,
  fullName: customers.fullName,
  email: customers.email,
  billingDay: customers.billingDay,
  billingTimezone: customers.billingTimezone,
  status: customers.status,
  paymentStatus: customers.paymentStatus,
};
const runFields = {
  id: billingRuns.id,
  customerId: billingRuns.customerId,
  planPriceVersionId: billingRuns.planPriceVersionId,
  periodStart: billingRuns.periodStart,
  periodEnd: billingRuns.periodEnd,
  status: billingRuns.status,
  formulaVersion: billingRuns.formulaVersion,
};

// Authentication/authorization belongs to the service boundary. This additional check
// keeps mutations from attributing an audit event to an absent/disabled administrator.
async function verifyActor(db: Pick<Database, "select">, actor: AuditActor) {
  const [user] = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(
      and(
        eq(appUsers.id, actor.appUserId),
        eq(appUsers.status, "ACTIVE"),
        eq(appUsers.role, "ADMIN"),
      ),
    );
  if (!user) throw new Error("An active administrator is required");
}

export function createCustomerRepository(db: Database): CustomerRepository {
  return {
    async findById(id) {
      return (
        (
          await db
            .select(customerFields)
            .from(customers)
            .where(eq(customers.id, id))
        )[0] ?? null
      );
    },
    async list(input = {}) {
      return db
        .select(customerFields)
        .from(customers)
        .where(input.afterId ? gt(customers.id, input.afterId) : undefined)
        .orderBy(asc(customers.id))
        .limit(pageSize(input.limit));
    },
    async create(input, actor) {
      return db.transaction(async (tx) => {
        await verifyActor(tx, actor);
        const [customer] = await tx
          .insert(customers)
          .values(input)
          .returning(customerFields);
        await tx.insert(auditEvents).values({
          actorType: "ADMIN",
          actorId: actor.appUserId,
          action: "customer.created",
          entityType: "customer",
          entityId: customer.id,
          afterJson: {
            billingDay: customer.billingDay,
            billingTimezone: customer.billingTimezone,
            status: customer.status,
          },
          requestId: actor.requestId,
        });
        return customer;
      });
    },
  };
}
export function createCatalogRepository(db: Database): CatalogRepository {
  return {
    async listActivePlans(limit) {
      return db
        .select({
          id: plans.id,
          name: plans.name,
          planType: plans.planType,
          currency: plans.currency,
          active: plans.active,
        })
        .from(plans)
        .where(eq(plans.active, true))
        .orderBy(asc(plans.id))
        .limit(pageSize(limit));
    },
    async listSubscriptions(customerId, limit) {
      return db
        .select({
          id: subscriptions.id,
          customerId: subscriptions.customerId,
          planPriceVersionId: subscriptions.planPriceVersionId,
          status: subscriptions.status,
          cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
        })
        .from(subscriptions)
        .where(eq(subscriptions.customerId, customerId))
        .orderBy(asc(subscriptions.id))
        .limit(pageSize(limit));
    },
  };
}
export function createBillingRunRepository(db: Database): BillingRunRepository {
  return {
    async findById(id) {
      return (
        (
          await db
            .select(runFields)
            .from(billingRuns)
            .where(eq(billingRuns.id, id))
        )[0] ?? null
      );
    },
    async ensure(input, actor) {
      if (input.triggerType !== "SCHEDULED" && !actor)
        throw new Error("Manual billing requires an administrator");
      return db.transaction(async (tx) => {
        if (actor) await verifyActor(tx, actor);
        const [createdRun] = await tx
          .insert(billingRuns)
          .values(input)
          .onConflictDoNothing({
            target: [
              billingRuns.customerId,
              billingRuns.periodStart,
              billingRuns.periodEnd,
            ],
          })
          .returning(runFields);
        const run =
          createdRun ??
          (
            await tx
              .select(runFields)
              .from(billingRuns)
              .where(
                and(
                  eq(billingRuns.customerId, input.customerId),
                  eq(billingRuns.periodStart, input.periodStart),
                  eq(billingRuns.periodEnd, input.periodEnd),
                ),
              )
          )[0];
        if (!run) throw new Error("Billing run could not be reserved");
        // An existing run is returned unchanged, even if the caller supplied a new formula.
        // Services must inspect its status; this API never authorizes another charge.
        if (createdRun || actor)
          await tx.insert(auditEvents).values({
            actorType: actor ? "ADMIN" : "SYSTEM",
            actorId: actor?.appUserId,
            action: createdRun ? "billing_run.created" : "billing_run.reused",
            entityType: "billing_run",
            entityId: run.id,
            afterJson: { triggerType: input.triggerType },
            requestId: actor?.requestId,
          });
        return { run, created: Boolean(createdRun) };
      });
    },
  };
}
export function createUsageRepository(db: Database): UsageRepository {
  return {
    async ensureExport(input) {
      return db.transaction(async (tx) => {
        const [createdExport] = await tx
          .insert(usageExports)
          .values(input)
          .onConflictDoNothing({
            target: [
              usageExports.customerId,
              usageExports.provider,
              usageExports.periodStart,
              usageExports.periodEnd,
            ],
          })
          .returning();
        const row =
          createdExport ??
          (
            await tx
              .select()
              .from(usageExports)
              .where(
                and(
                  eq(usageExports.customerId, input.customerId),
                  eq(usageExports.provider, "FLOWROUTE"),
                  eq(usageExports.periodStart, input.periodStart),
                  eq(usageExports.periodEnd, input.periodEnd),
                ),
              )
          )[0];
        if (!row) throw new Error("Usage export could not be reserved");
        return {
          id: row.id,
          customerId: row.customerId,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          status: row.status,
        };
      });
    },
    async findSnapshot(input) {
      return (
        (
          await db
            .select({
              id: usageSnapshots.id,
              providerCostMinor: usageSnapshots.providerCostMinor,
              providerCostExact: usageSnapshots.providerCostExact,
              usageQuantity: usageSnapshots.usageQuantity,
              currency: usageSnapshots.currency,
            })
            .from(usageSnapshots)
            .where(
              and(
                eq(usageSnapshots.customerId, input.customerId),
                eq(usageSnapshots.provider, "FLOWROUTE"),
                eq(usageSnapshots.periodStart, input.periodStart),
                eq(usageSnapshots.periodEnd, input.periodEnd),
              ),
            )
        )[0] ?? null
      );
    },
  };
}
export function createStripeEventRepository(
  db: Database,
): StripeEventRepository {
  return {
    async record(input) {
      return db.transaction(async (tx) => {
        const fields = {
          id: stripeEvents.id,
          processingStatus: stripeEvents.processingStatus,
        };
        const [createdEvent] = await tx
          .insert(stripeEvents)
          .values(input)
          .onConflictDoNothing({ target: stripeEvents.stripeEventId })
          .returning(fields);
        const event =
          createdEvent ??
          (
            await tx
              .select(fields)
              .from(stripeEvents)
              .where(eq(stripeEvents.stripeEventId, input.stripeEventId))
          )[0];
        if (!event) throw new Error("Stripe event could not be recorded");
        return { ...event, inserted: Boolean(createdEvent) };
      });
    },
  };
}
