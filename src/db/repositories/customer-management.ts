import "server-only";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { Database } from "../client";
import {
  appUsers,
  auditEvents,
  billingRuns,
  customerBillingAdjustments,
  customerProviderCredentials,
  customers,
  stripeInvoices,
  subscriptions,
  usageSnapshots,
} from "../schema";
import type { AuditActor } from "./contracts";
import {
  CustomerError,
  type CustomerProfile,
} from "../../customers/validation";
import { parseUsd } from "../../domain/billing/money";
const profileFields = {
  fullName: customers.fullName,
  email: customers.email,
  phone: customers.phone,
  streetAddress: customers.streetAddress,
  city: customers.city,
  state: customers.state,
  postalCode: customers.postalCode,
  countryCode: customers.countryCode,
  billingDay: customers.billingDay,
  billingTimezone: customers.billingTimezone,
};
const fields = {
  ...profileFields,
  id: customers.id,
  revision: customers.revision,
  status: customers.status,
  paymentStatus: customers.paymentStatus,
  createdAt: customers.createdAt,
  updatedAt: customers.updatedAt,
};
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
async function authorized(tx: Transaction, actor: AuditActor) {
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
async function locked(tx: Transaction, id: string, revision: number) {
  const [row] = await tx
    .select(fields)
    .from(customers)
    .where(eq(customers.id, id))
    .for("update");
  if (!row) throw new CustomerError("NOT_FOUND", "Customer not found");
  if (row.revision !== revision)
    throw new CustomerError(
      "CONFLICT",
      "This customer changed. Refresh the page before saving again.",
    );
  return row;
}
function editable(status: string) {
  if (status === "ARCHIVED")
    throw new CustomerError(
      "ARCHIVED",
      "Restore this customer before making changes.",
    );
}
async function linked(tx: Transaction, id: string) {
  const [subscription] = await tx
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.customerId, id),
        notInArray(subscriptions.status, ["CANCELED", "INCOMPLETE_EXPIRED"]),
      ),
    )
    .limit(1);
  return Boolean(subscription);
}
async function audit(
  tx: Transaction,
  actor: AuditActor,
  id: string,
  action: string,
  beforeJson?: Record<string, unknown>,
  afterJson?: Record<string, unknown>,
) {
  await tx.insert(auditEvents).values({
    actorType: "ADMIN",
    actorId: actor.appUserId,
    requestId: actor.requestId,
    entityType: "customer",
    entityId: id,
    action,
    beforeJson,
    afterJson,
  });
}
function profile(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.keys(profileFields).map((key) => [key, row[key]]),
  );
}
export function customerManagementRepository(db: Database) {
  return {
    async list(
      input: {
        q?: string;
        status?: "ALL" | "DRAFT" | "ACTIVE" | "SUSPENDED" | "ARCHIVED";
        after?: string;
        limit?: number;
      } = {},
    ) {
      const limit = input.limit ?? 25;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new Error("Invalid page size");
      const search = input.q?.replace(/[\\%_]/g, "\\$&");
      const rows = await db
        .select({
          ...fields,
          credentialStatus: customerProviderCredentials.status,
        })
        .from(customers)
        .leftJoin(
          customerProviderCredentials,
          and(
            eq(customerProviderCredentials.customerId, customers.id),
            eq(customerProviderCredentials.provider, "FLOWROUTE"),
          ),
        )
        .where(
          and(
            input.after ? gt(customers.id, input.after) : undefined,
            input.status && input.status !== "ALL"
              ? eq(customers.status, input.status)
              : undefined,
            search
              ? or(
                  ilike(customers.fullName, `%${search}%`),
                  ilike(customers.email, `%${search}%`),
                )
              : undefined,
          ),
        )
        .orderBy(asc(customers.id))
        .limit(limit + 1);
      const items = rows.slice(0, limit);
      return { items, next: rows.length > limit ? items.at(-1)!.id : null };
    },
    async detail(id: string, auditPage = 0) {
      if (!Number.isInteger(auditPage) || auditPage < 0 || auditPage > 10000)
        throw new Error("Invalid audit page");
      const [customer] = await db
        .select(fields)
        .from(customers)
        .where(eq(customers.id, id));
      if (!customer) return null;
      const [credentials] = await db
        .select({
          status: customerProviderCredentials.status,
          updatedAt: customerProviderCredentials.updatedAt,
        })
        .from(customerProviderCredentials)
        .where(
          and(
            eq(customerProviderCredentials.customerId, id),
            eq(customerProviderCredentials.provider, "FLOWROUTE"),
          ),
        );
      const [history, usage, runs, customerSubscriptions, invoices, adjustments] =
        await Promise.all([
          db
            .select({
              id: auditEvents.id,
              action: auditEvents.action,
              actorId: auditEvents.actorId,
              createdAt: auditEvents.createdAt,
              beforeJson: auditEvents.beforeJson,
              afterJson: auditEvents.afterJson,
            })
            .from(auditEvents)
            .where(
              and(
                eq(auditEvents.entityType, "customer"),
                eq(auditEvents.entityId, id),
              ),
            )
            .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
            .limit(21)
            .offset(auditPage * 20),
          db
            .select({
              id: usageSnapshots.id,
              periodStart: usageSnapshots.periodStart,
              periodEnd: usageSnapshots.periodEnd,
              usageQuantity: usageSnapshots.usageQuantity,
              providerCostMinor: usageSnapshots.providerCostMinor,
              providerCostExact: usageSnapshots.providerCostExact,
              currency: usageSnapshots.currency,
              capturedAt: usageSnapshots.capturedAt,
            })
            .from(usageSnapshots)
            .where(eq(usageSnapshots.customerId, id))
            .orderBy(desc(usageSnapshots.periodEnd))
            .limit(6),
          db
            .select({
              id: billingRuns.id,
              periodStart: billingRuns.periodStart,
              periodEnd: billingRuns.periodEnd,
              status: billingRuns.status,
              subtotalMinor: billingRuns.subtotalMinor,
              currency: billingRuns.currency,
              stripeInvoiceId: billingRuns.stripeInvoiceId,
            })
            .from(billingRuns)
            .where(eq(billingRuns.customerId, id))
            .orderBy(desc(billingRuns.periodEnd))
            .limit(6),
          db
            .select({
              id: subscriptions.id,
              status: subscriptions.status,
              stripeSubscriptionId: subscriptions.stripeSubscriptionId,
              collectionMethod: subscriptions.collectionMethod,
              currentPeriodEnd: subscriptions.currentPeriodEnd,
              cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
            })
            .from(subscriptions)
            .where(eq(subscriptions.customerId, id))
            .orderBy(desc(subscriptions.updatedAt))
            .limit(3),
          db
            .select({
              id: stripeInvoices.id,
              status: stripeInvoices.status,
              delinquent: stripeInvoices.delinquent,
              autoAdvance: stripeInvoices.autoAdvance,
              updatedAt: stripeInvoices.updatedAt,
            })
            .from(stripeInvoices)
            .where(eq(stripeInvoices.customerId, id))
            .orderBy(desc(stripeInvoices.updatedAt))
            .limit(3),
          db
            .select({
              id: customerBillingAdjustments.id,
              code: customerBillingAdjustments.code,
              amountMinor: customerBillingAdjustments.amountMinor,
              quantity: customerBillingAdjustments.quantity,
              validFrom: customerBillingAdjustments.validFrom,
            })
            .from(customerBillingAdjustments)
            .where(
              and(
                eq(customerBillingAdjustments.customerId, id),
                eq(customerBillingAdjustments.active, true),
              ),
            )
            .orderBy(desc(customerBillingAdjustments.validFrom)),
        ]);
      return {
        customer,
        credentials: credentials ?? null,
        history: history.slice(0, 20),
        moreHistory: history.length > 20,
        account: {
          usage,
          runs,
          subscriptions: customerSubscriptions,
          invoices,
          adjustments,
        },
      };
    },
    async create(input: CustomerProfile, actor: AuditActor) {
      return db.transaction(async (tx) => {
        await authorized(tx, actor);
        const [row] = await tx
          .insert(customers)
          .values(input)
          .returning(fields);
        await audit(tx, actor, row.id, "customer.created", undefined, {
          ...input,
          status: row.status,
        });
        return row;
      });
    },
    async update(
      id: string,
      revision: number,
      input: CustomerProfile,
      actor: AuditActor,
    ) {
      return db.transaction(async (tx) => {
        await authorized(tx, actor);
        const old = await locked(tx, id, revision);
        editable(old.status);
        if (
          (old.billingDay !== input.billingDay ||
            old.billingTimezone !== input.billingTimezone) &&
          (await linked(tx, id))
        )
          throw new CustomerError(
            "LINKED_BILLING",
            "Billing dates for linked subscriptions must be changed through subscription management.",
          );
        const [row] = await tx
          .update(customers)
          .set(input)
          .where(eq(customers.id, id))
          .returning(fields);
        await audit(tx, actor, id, "customer.updated", profile(old), input);
        return row;
      });
    },
    async saveBillingAdjustments(
      id: string,
      revision: number,
      input: {
        effectiveFrom: string;
        meteredSipTrunkUsage: string;
        cloudServerHosting: string;
        extraNumbers: number;
        extraChannels?: number;
      },
      actor: AuditActor,
    ) {
      return db.transaction(async (tx) => {
        await authorized(tx, actor);
        const customer = await locked(tx, id, revision);
        editable(customer.status);
        const managedCodes = [
          "METERED_SIP_TRUNK_USAGE",
          "CLOUD_SERVER_HOSTING",
          "EXTRA_NUMBERS",
          "EXTRA_CHANNELS",
        ];
        const current = await tx
          .select({ id: customerBillingAdjustments.id })
          .from(customerBillingAdjustments)
          .where(
            and(
              eq(customerBillingAdjustments.customerId, id),
              eq(customerBillingAdjustments.active, true),
              inArray(customerBillingAdjustments.code, managedCodes),
            ),
          )
          .for("update");
        if (current.length)
          await tx
            .update(customerBillingAdjustments)
            .set({ active: false })
            .where(inArray(customerBillingAdjustments.id, current.map((item) => item.id)));
        const effectiveFrom = new Date(`${input.effectiveFrom}T00:00:00.000Z`);
        const values: Array<{
          code: string;
          amountMinor?: bigint;
          quantity?: string;
        }> = [
          {
            code: "METERED_SIP_TRUNK_USAGE",
            amountMinor: parseUsd(input.meteredSipTrunkUsage),
          },
          {
            code: "CLOUD_SERVER_HOSTING",
            amountMinor: parseUsd(input.cloudServerHosting),
          },
          { code: "EXTRA_NUMBERS", quantity: String(input.extraNumbers) },
          ...(input.extraChannels === undefined
            ? []
            : [{ code: "EXTRA_CHANNELS", quantity: String(input.extraChannels) }]),
        ].filter((item) => {
          if (item.amountMinor !== undefined) return item.amountMinor > 0n;
          return Number(item.quantity ?? "0") > 0;
        });
        if (values.length)
          await tx.insert(customerBillingAdjustments).values(
            values.map((item) => ({
              customerId: id,
              code: item.code,
              ...(item.amountMinor !== undefined
                ? { amountMinor: item.amountMinor }
                : { quantity: item.quantity }),
              metadata: { source: "customer_profile" },
              reason: "Customer billing adjustment",
              createdByAppUserId: actor.appUserId,
              validFrom: effectiveFrom,
            })),
          );
        await tx
          .update(customers)
          .set({ updatedAt: sql`now()` })
          .where(eq(customers.id, id));
        await audit(tx, actor, id, "customer.billing_adjustments_updated", undefined, {
          effectiveFrom: input.effectiveFrom,
          meteredSipTrunkUsage: input.meteredSipTrunkUsage,
          cloudServerHosting: input.cloudServerHosting,
          extraNumbers: input.extraNumbers,
          extraChannels: input.extraChannels,
        });
      });
    },
    async archive(id: string, revision: number, actor: AuditActor) {
      return db.transaction(async (tx) => {
        await authorized(tx, actor);
        const old = await locked(tx, id, revision);
        editable(old.status);
        const [run] = await tx
          .select({ id: billingRuns.id })
          .from(billingRuns)
          .where(
            and(
              eq(billingRuns.customerId, id),
              notInArray(billingRuns.status, ["COMPLETED", "CANCELED"]),
            ),
          )
          .limit(1);
        if (run || (await linked(tx, id)))
          throw new CustomerError(
            "LINKED_BILLING",
            "Resolve ongoing subscriptions and billing runs before archiving this customer.",
          );
        await tx
          .update(customers)
          .set({ status: "ARCHIVED", archivedAt: sql`now()` })
          .where(eq(customers.id, id));
        await tx
          .update(customerProviderCredentials)
          .set({ status: "REVOKED" })
          .where(eq(customerProviderCredentials.customerId, id));
        await audit(
          tx,
          actor,
          id,
          "customer.archived",
          { status: old.status },
          { status: "ARCHIVED", credentials: "REVOKED" },
        );
      });
    },
    async restore(id: string, revision: number, actor: AuditActor) {
      return db.transaction(async (tx) => {
        await authorized(tx, actor);
        const old = await locked(tx, id, revision);
        if (old.status !== "ARCHIVED")
          throw new CustomerError(
            "CONFLICT",
            "Only archived customers can be restored.",
          );
        await tx
          .update(customers)
          .set({ status: "DRAFT", archivedAt: null })
          .where(eq(customers.id, id));
        await audit(
          tx,
          actor,
          id,
          "customer.restored",
          { status: "ARCHIVED" },
          { status: "DRAFT" },
        );
      });
    },
    async saveCredentials(
      id: string,
      revision: number,
      input: {
        accessKeyEncrypted: string;
        secretKeyEncrypted: string;
        encryptionKeyVersion: string;
      },
      actor: AuditActor,
    ) {
      return db.transaction(async (tx) => {
        await authorized(tx, actor);
        const old = await locked(tx, id, revision);
        editable(old.status);
        await tx
          .insert(customerProviderCredentials)
          .values({ customerId: id, ...input, status: "UNVERIFIED" })
          .onConflictDoUpdate({
            target: [
              customerProviderCredentials.customerId,
              customerProviderCredentials.provider,
            ],
            set: { ...input, status: "UNVERIFIED", rotatedAt: sql`now()` },
          });
        await tx
          .update(customers)
          .set({ updatedAt: sql`now()` })
          .where(eq(customers.id, id));
        await audit(tx, actor, id, "customer.credentials_replaced", undefined, {
          provider: "FLOWROUTE",
          status: "UNVERIFIED",
          keyVersion: input.encryptionKeyVersion,
        });
      });
    },
    async revokeCredentials(id: string, revision: number, actor: AuditActor) {
      return db.transaction(async (tx) => {
        await authorized(tx, actor);
        const old = await locked(tx, id, revision);
        editable(old.status);
        const [credential] = await tx
          .update(customerProviderCredentials)
          .set({ status: "REVOKED" })
          .where(eq(customerProviderCredentials.customerId, id))
          .returning({ id: customerProviderCredentials.id });
        if (!credential)
          throw new CustomerError(
            "NOT_FOUND",
            "No credentials are stored for this customer.",
          );
        await tx
          .update(customers)
          .set({ updatedAt: sql`now()` })
          .where(eq(customers.id, id));
        await audit(tx, actor, id, "customer.credentials_disabled", undefined, {
          provider: "FLOWROUTE",
          status: "REVOKED",
        });
      });
    },
  };
}
