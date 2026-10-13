import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, asc, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { withDatabase } from "../db/client";
import type { DatabaseSource } from "../db/client";
import { customerManagementRepository } from "../db/repositories/customer-management";
import type { AuditActor } from "../db/repositories/contracts";
import { planManagementRepository } from "../db/repositories/plan-management";
import {
  backgroundJobs,
  billingLineItems,
  billingRuns,
  billingSyncJobs,
  customerProviderCredentials,
  customers,
  planPriceVersions,
  plans,
  subscriptions,
  usageSnapshots,
} from "../db/schema";
import { profileSchema } from "../customers/validation";

const customerStatus = z.enum(["DRAFT", "ACTIVE", "SUSPENDED", "ARCHIVED"]);
const billingRunStatus = z.enum([
  "DISCOVERED",
  "WAITING_FOR_USAGE",
  "NEEDS_REVIEW",
  "CALCULATING",
  "CALCULATED",
  "SYNCING_STRIPE",
  "PAYMENT_PENDING",
  "PAST_DUE",
  "COMPLETED",
  "FAILED_RETRYABLE",
  "FAILED_PERMANENT",
  "CANCELED",
]);
const uuid = z.string().uuid();

function localDatabaseSource() {
  const connectionString =
    process.env.RCE_BILLING_MCP_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error(
      "Set RCE_BILLING_MCP_DATABASE_URL (or DATABASE_URL) before starting the RCE Billing MCP server.",
    );
  return { connectionString };
}

function localWriteActor(): AuditActor {
  const appUserId = process.env.RCE_BILLING_MCP_ACTOR_ID;
  if (!appUserId || !z.uuid().safeParse(appUserId).success)
    throw new Error(
      "Write tools require RCE_BILLING_MCP_ACTOR_ID to be the UUID of an active RCE Billing user.",
    );
  return { appUserId, requestId: crypto.randomUUID() };
}

function json(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          value,
          (_key, item) => {
            if (typeof item === "bigint") return item.toString();
            if (item instanceof Date) return item.toISOString();
            return item;
          },
          2,
        ),
      },
    ],
  };
}

function toolError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "The request failed.";
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

export type RceBillingMcpServerOptions = {
  /** Override the local process environment for a remotely authenticated request. */
  databaseSource?: DatabaseSource;
  /** The authenticated RCE Billing user responsible for MCP draft writes. */
  actor?: AuditActor;
};

/**
 * RCE Billing's local MCP server for active RCE Billing users.
 * It never returns encrypted credentials, raw Flowroute payloads, or mutation tools.
 */
export function createRceBillingMcpServer(
  options: RceBillingMcpServerOptions = {},
) {
  const source = options.databaseSource;
  const actor = options.actor;
  async function read<T>(work: Parameters<typeof withDatabase<T>>[1]) {
    return withDatabase(source ?? localDatabaseSource(), work);
  }
  function writeActor() {
    return actor ?? localWriteActor();
  }
  const server = new McpServer({ name: "rce-billing", version: "0.1.0" });

  server.registerTool(
    "search_customers",
    {
      title: "Search customers",
      description:
        "Find customers by name or email. Returns billing configuration and Flowroute credential status, never keys.",
      inputSchema: {
        query: z.string().trim().min(1).max(160),
        status: customerStatus.optional(),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, status, limit }) => {
      try {
        const rows = await read((db) =>
          db
            .select({
              id: customers.id,
              name: customers.fullName,
              email: customers.email,
              status: customers.status,
              paymentStatus: customers.paymentStatus,
              billingDay: customers.billingDay,
              stripeCustomerId: customers.stripeCustomerId,
              flowrouteCredentialStatus: customerProviderCredentials.status,
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
                status ? eq(customers.status, status) : undefined,
                or(
                  ilike(
                    customers.fullName,
                    `%${query.replace(/[\\%_]/g, "\\$&")}%`,
                  ),
                  ilike(
                    customers.email,
                    `%${query.replace(/[\\%_]/g, "\\$&")}%`,
                  ),
                ),
              ),
            )
            .orderBy(asc(customers.fullName))
            .limit(limit),
        );
        return json({ customers: rows });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "list_active_plan_versions",
    {
      title: "List active plan versions",
      description:
        "List active plans and their current price-version IDs. Use a price-version ID when preparing a subscription draft.",
      inputSchema: { limit: z.number().int().min(1).max(100).default(50) },
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => {
      try {
        const rows = await read((db) =>
          db
            .select({
              planId: plans.id,
              name: plans.name,
              planType: plans.planType,
              active: plans.active,
              baseAmountMinor: plans.baseAmountMinor,
              priceVersionId: planPriceVersions.id,
              priceVersion: planPriceVersions.version,
              stripeProductId: planPriceVersions.stripeProductId,
              stripePriceId: planPriceVersions.stripePriceId,
            })
            .from(plans)
            .innerJoin(
              planPriceVersions,
              eq(planPriceVersions.planId, plans.id),
            )
            .where(
              and(
                eq(plans.active, true),
                isNull(planPriceVersions.activeUntil),
              ),
            )
            .orderBy(asc(plans.name))
            .limit(limit),
        );
        return json({
          planVersions: rows,
          moneyNote: "baseAmountMinor is in cents: 250 means USD 2.50.",
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "customer_overview",
    {
      title: "Customer overview",
      description:
        "Read a customer’s billing profile, Flowroute status, subscriptions, latest usage snapshots, and recent billing runs.",
      inputSchema: { customerId: uuid },
      annotations: { readOnlyHint: true },
    },
    async ({ customerId }) => {
      try {
        const result = await read(async (db) => {
          const [customer] = await db
            .select({
              id: customers.id,
              name: customers.fullName,
              email: customers.email,
              phone: customers.phone,
              status: customers.status,
              paymentStatus: customers.paymentStatus,
              billingDay: customers.billingDay,
              billingTimezone: customers.billingTimezone,
              stripeCustomerId: customers.stripeCustomerId,
              flowrouteCredentialStatus: customerProviderCredentials.status,
              flowrouteCredentialsUpdatedAt:
                customerProviderCredentials.updatedAt,
            })
            .from(customers)
            .leftJoin(
              customerProviderCredentials,
              and(
                eq(customerProviderCredentials.customerId, customers.id),
                eq(customerProviderCredentials.provider, "FLOWROUTE"),
              ),
            )
            .where(eq(customers.id, customerId));
          if (!customer) return null;

          const [customerSubscriptions, latestUsage, recentRuns] =
            await Promise.all([
              db
                .select({
                  id: subscriptions.id,
                  status: subscriptions.status,
                  collectionMethod: subscriptions.collectionMethod,
                  billingDay: subscriptions.billingDay,
                  currentPeriodStart: subscriptions.currentPeriodStart,
                  currentPeriodEnd: subscriptions.currentPeriodEnd,
                  cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
                  stripeSubscriptionId: subscriptions.stripeSubscriptionId,
                  stripeSubscriptionItemId:
                    subscriptions.stripeSubscriptionItemId,
                  plan: plans.name,
                  planType: plans.planType,
                  priceVersion: planPriceVersions.version,
                })
                .from(subscriptions)
                .leftJoin(
                  planPriceVersions,
                  eq(planPriceVersions.id, subscriptions.planPriceVersionId),
                )
                .leftJoin(plans, eq(plans.id, planPriceVersions.planId))
                .where(eq(subscriptions.customerId, customerId))
                .orderBy(desc(subscriptions.updatedAt))
                .limit(10),
              db
                .select({
                  id: usageSnapshots.id,
                  periodStart: usageSnapshots.periodStart,
                  periodEnd: usageSnapshots.periodEnd,
                  providerCostExact: usageSnapshots.providerCostExact,
                  usageQuantity: usageSnapshots.usageQuantity,
                  currency: usageSnapshots.currency,
                  capturedAt: usageSnapshots.capturedAt,
                })
                .from(usageSnapshots)
                .where(eq(usageSnapshots.customerId, customerId))
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
                .where(eq(billingRuns.customerId, customerId))
                .orderBy(desc(billingRuns.periodEnd))
                .limit(6),
            ]);
          return {
            customer,
            subscriptions: customerSubscriptions,
            latestUsage,
            recentBillingRuns: recentRuns,
          };
        });
        return json(result ?? { error: "Customer not found." });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "create_customer_draft",
    {
      title: "Create customer draft",
      description:
        "Create a customer in DRAFT status inside RCE Billing. It does not store Flowroute keys, create Stripe objects, send a message, or bill the customer.",
      inputSchema: {
        confirmation: z.literal("CREATE_DRAFT_CUSTOMER"),
        fullName: z.string().trim().min(1).max(160),
        email: z.email().max(254),
        billingDay: z.number().int().min(1).max(31),
        billingTimezone: z.string().trim().min(1).max(100).default("UTC"),
        phone: z.string().trim().max(40).default(""),
        streetAddress: z.string().trim().max(250).default(""),
        city: z.string().trim().max(100).default(""),
        state: z.string().trim().max(100).default(""),
        postalCode: z.string().trim().max(20).default(""),
        countryCode: z
          .string()
          .trim()
          .regex(/^[A-Za-z]{2}$/)
          .default("US"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input) => {
      const { confirmation, ...customerInput } = input;
      void confirmation;
      try {
        const customer = await read((db) =>
          customerManagementRepository(db).create(
            profileSchema.parse(customerInput),
            writeActor(),
          ),
        );
        return json({
          customer,
          nextStep:
            "Add Flowroute credentials through the secure billing UI, then create a subscription draft if needed.",
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "create_subscription_draft",
    {
      title: "Create subscription draft",
      description:
        "Create an internal subscription draft. This does not create or modify a Stripe subscription, invoice, payment link, or charge.",
      inputSchema: {
        confirmation: z.literal("CREATE_DRAFT_SUBSCRIPTION"),
        requestId: uuid,
        customerId: uuid,
        planPriceVersionId: uuid,
        collectionMethod: z.enum(["send_invoice", "charge_automatically"]),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (input) => {
      const {
        confirmation,
        requestId,
        customerId,
        planPriceVersionId,
        collectionMethod,
      } = input;
      void confirmation;
      try {
        const subscription = await read((db) =>
          planManagementRepository(db).createDraft(
            {
              creationKey: requestId,
              customerId,
              planPriceVersionId,
              collectionMethod,
            },
            writeActor(),
          ),
        );
        return json({
          subscription,
          nextStep:
            "Review the draft in RCE Billing before explicitly activating it in Stripe.",
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "list_billing_runs",
    {
      title: "List billing runs",
      description:
        "List recent billing runs, optionally filtered by customer or billing-run status. Amounts are returned in minor USD units.",
      inputSchema: {
        customerId: uuid.optional(),
        status: billingRunStatus.optional(),
        limit: z.number().int().min(1).max(100).default(25),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ customerId, status, limit }) => {
      try {
        const rows = await read((db) =>
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
              createdAt: billingRuns.createdAt,
            })
            .from(billingRuns)
            .leftJoin(customers, eq(customers.id, billingRuns.customerId))
            .where(
              and(
                customerId ? eq(billingRuns.customerId, customerId) : undefined,
                status ? eq(billingRuns.status, status) : undefined,
              ),
            )
            .orderBy(desc(billingRuns.createdAt))
            .limit(limit),
        );
        return json({
          billingRuns: rows,
          moneyNote: "subtotalMinor is in cents: 40250 means USD 402.50.",
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "billing_run_detail",
    {
      title: "Billing run detail",
      description:
        "Explain the billing period, calculated total, Stripe invoice reference, provider cost, and individual line items for one billing run.",
      inputSchema: { billingRunId: uuid },
      annotations: { readOnlyHint: true },
    },
    async ({ billingRunId }) => {
      try {
        const result = await read(async (db) => {
          const [run] = await db
            .select({
              id: billingRuns.id,
              customerId: customers.id,
              customer: customers.fullName,
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
              providerCostExact: usageSnapshots.providerCostExact,
              usageQuantity: usageSnapshots.usageQuantity,
              plan: plans.name,
              planType: plans.planType,
              priceVersion: planPriceVersions.version,
            })
            .from(billingRuns)
            .leftJoin(customers, eq(customers.id, billingRuns.customerId))
            .leftJoin(
              usageSnapshots,
              eq(usageSnapshots.id, billingRuns.usageSnapshotId),
            )
            .leftJoin(
              planPriceVersions,
              eq(planPriceVersions.id, billingRuns.planPriceVersionId),
            )
            .leftJoin(plans, eq(plans.id, planPriceVersions.planId))
            .where(eq(billingRuns.id, billingRunId));
          if (!run) return null;
          const lines = await db
            .select({
              code: billingLineItems.code,
              description: billingLineItems.description,
              quantity: billingLineItems.quantity,
              unitAmountMinor: billingLineItems.unitAmountMinor,
              amountMinor: billingLineItems.amountMinor,
              calculationMetadata: billingLineItems.calculationMetadata,
              stripeInvoiceItemId: billingLineItems.stripeInvoiceItemId,
            })
            .from(billingLineItems)
            .where(eq(billingLineItems.billingRunId, billingRunId));
          return {
            run,
            lineItems: lines,
            moneyNote:
              "Amounts ending in Minor are cents: 40250 means USD 402.50.",
          };
        });
        return json(result ?? { error: "Billing run not found." });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "usage_history",
    {
      title: "Flowroute usage history",
      description:
        "Return the latest completed Flowroute usage snapshots for a customer. It excludes raw provider payloads and credentials.",
      inputSchema: {
        customerId: uuid,
        limit: z.number().int().min(1).max(60).default(12),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ customerId, limit }) => {
      try {
        const rows = await read((db) =>
          db
            .select({
              periodStart: usageSnapshots.periodStart,
              periodEnd: usageSnapshots.periodEnd,
              providerCostExact: usageSnapshots.providerCostExact,
              usageQuantity: usageSnapshots.usageQuantity,
              currency: usageSnapshots.currency,
              capturedAt: usageSnapshots.capturedAt,
            })
            .from(usageSnapshots)
            .where(eq(usageSnapshots.customerId, customerId))
            .orderBy(desc(usageSnapshots.periodEnd))
            .limit(limit),
        );
        return json({ usageSnapshots: rows });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "operational_attention",
    {
      title: "Operational attention",
      description:
        "List Flowroute and Stripe background jobs that need administrator review. This only reports status; it cannot replay or modify a job.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const result = await read(async (db) => {
          const [flowrouteJobs, stripeJobs] = await Promise.all([
            db
              .select({
                id: backgroundJobs.id,
                usageExportId: backgroundJobs.usageExportId,
                billingRunId: backgroundJobs.billingRunId,
                status: backgroundJobs.status,
                nextAttemptAt: backgroundJobs.nextAttemptAt,
                lastErrorCode: backgroundJobs.lastErrorCode,
                updatedAt: backgroundJobs.updatedAt,
              })
              .from(backgroundJobs)
              .where(eq(backgroundJobs.status, "NEEDS_REVIEW"))
              .orderBy(desc(backgroundJobs.updatedAt))
              .limit(50),
            db
              .select({
                id: billingSyncJobs.id,
                billingRunId: billingSyncJobs.billingRunId,
                status: billingSyncJobs.status,
                nextAttemptAt: billingSyncJobs.nextAttemptAt,
                lastErrorCode: billingSyncJobs.lastErrorCode,
                updatedAt: billingSyncJobs.updatedAt,
              })
              .from(billingSyncJobs)
              .where(eq(billingSyncJobs.status, "NEEDS_REVIEW"))
              .orderBy(desc(billingSyncJobs.updatedAt))
              .limit(50),
          ]);
          return { flowrouteJobs, stripeJobs };
        });
        return json(result);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  return server;
}
