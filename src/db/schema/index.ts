import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const time = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
const created = () => time("created_at").notNull().defaultNow();
const updated = () => time("updated_at").notNull().defaultNow();
const minor = (name: string) => bigint(name, { mode: "bigint" });
const decimal = (name: string) => numeric(name, { precision: 30, scale: 12 });
const object = (name: string) => jsonb(name).$type<Record<string, unknown>>();

export const customerStatus = pgEnum("customer_status", [
  "DRAFT",
  "ACTIVE",
  "SUSPENDED",
  "ARCHIVED",
]);
export const accountPaymentStatus = pgEnum("account_payment_status", [
  "CURRENT",
  "PAST_DUE",
]);
export const planType = pgEnum("plan_type", [
  "FIXED",
  "METERED",
  "UNMETERED",
  "OTHER",
]);
export const usageExportStatus = pgEnum("usage_export_status", [
  "PENDING",
  "REQUESTED",
  "PROCESSING",
  "COMPLETED",
  "FAILED_RETRYABLE",
  "FAILED_PERMANENT",
]);
export const billingRunStatus = pgEnum("billing_run_status", [
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
export const triggerType = pgEnum("billing_trigger_type", [
  "SCHEDULED",
  "MANUAL",
  "REPLAY",
]);
export const processingStatus = pgEnum("processing_status", [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED_RETRYABLE",
  "FAILED_PERMANENT",
]);
export const backgroundJobStatus = pgEnum("background_job_status", [
  "PENDING",
  "ENQUEUED",
  "COMPLETED",
  "NEEDS_REVIEW",
]);

export const appUsers = pgTable(
  "app_users",
  {
    id: id(),
    email: text("email").notNull(),
    username: text("username"),
    passwordHash: text("password_hash"),
    role: text("role").notNull().default("ADMIN"),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: created(),
    updatedAt: updated(),
    lastLoginAt: time("last_login_at"),
  },
  (t) => [
    uniqueIndex("app_users_email_key").on(sql`lower(${t.email})`),
    uniqueIndex("app_users_username_key").on(sql`lower(${t.username})`),
    check("app_users_role_check", sql`${t.role} IN ('ADMIN')`),
    check("app_users_status_check", sql`${t.status} IN ('ACTIVE', 'DISABLED')`),
  ],
);

export const customers = pgTable(
  "customers",
  {
    id: id(),
    legacyId: minor("legacy_id").unique(),
    revision: integer("revision").notNull().default(1),
    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    status: customerStatus("status").notNull().default("DRAFT"),
    paymentStatus: accountPaymentStatus("payment_status")
      .notNull()
      .default("CURRENT"),
    billingDay: smallint("billing_day").notNull(),
    billingTimezone: text("billing_timezone").notNull().default("UTC"),
    stripeCustomerId: text("stripe_customer_id").unique(),
    streetAddress: text("street_address"),
    city: text("city"),
    state: text("state"),
    postalCode: text("postal_code"),
    countryCode: text("country_code").notNull().default("US"),
    createdAt: created(),
    updatedAt: updated(),
    archivedAt: time("archived_at"),
  },
  (t) => [
    check("customers_revision_check", sql`${t.revision} > 0`),
    check("customers_billing_day_check", sql`${t.billingDay} BETWEEN 1 AND 31`),
    check("customers_name_check", sql`length(trim(${t.fullName})) > 0`),
    check("customers_email_check", sql`length(trim(${t.email})) > 0`),
    check("customers_country_check", sql`${t.countryCode} ~ '^[A-Z]{2}$'`),
    index("customers_due_idx").on(t.status, t.billingDay),
    index("customers_email_idx").on(t.email),
    index("customers_page_idx").on(t.createdAt, t.id),
  ],
);

export const customerProviderCredentials = pgTable(
  "customer_provider_credentials",
  {
    id: id(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    provider: text("provider").notNull().default("FLOWROUTE"),
    accessKeyEncrypted: text("access_key_encrypted").notNull(),
    secretKeyEncrypted: text("secret_key_encrypted").notNull(),
    encryptionKeyVersion: text("encryption_key_version").notNull(),
    status: text("status").notNull().default("UNVERIFIED"),
    createdAt: created(),
    updatedAt: updated(),
    rotatedAt: time("rotated_at"),
  },
  (t) => [
    unique("credentials_customer_provider_key").on(t.customerId, t.provider),
    check("credentials_provider_check", sql`${t.provider} = 'FLOWROUTE'`),
    check(
      "credentials_status_check",
      sql`${t.status} IN ('UNVERIFIED', 'ACTIVE', 'INVALID', 'REVOKED')`,
    ),
    check(
      "credentials_nonempty_check",
      sql`length(${t.accessKeyEncrypted}) > 0 AND length(${t.secretKeyEncrypted}) > 0 AND length(${t.encryptionKeyVersion}) > 0`,
    ),
  ],
);

export const plans = pgTable(
  "plans",
  {
    id: id(),
    revision: integer("revision").notNull().default(1),
    legacyId: minor("legacy_id").unique(),
    name: text("name").notNull(),
    description: text("description"),
    planType: planType("plan_type").notNull(),
    currency: text("currency").notNull().default("USD"),
    baseAmountMinor: minor("base_amount_minor"),
    includedMinutes: decimal("included_minutes"),
    additionalMinuteAmountMinor: minor("additional_minute_amount_minor"),
    includedNumbers: integer("included_numbers").notNull().default(0),
    numberAmountMinor: minor("number_amount_minor")
      .notNull()
      .default(sql`0`),
    includedChannels: integer("included_channels").notNull().default(0),
    channelAmountMinor: minor("channel_amount_minor")
      .notNull()
      .default(sql`0`),
    active: boolean("active").notNull().default(true),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    check("plans_currency_check", sql`${t.currency} = 'USD'`),
    check(
      "plans_amount_check",
      sql`(${t.baseAmountMinor} IS NULL OR ${t.baseAmountMinor} >= 0) AND (${t.additionalMinuteAmountMinor} IS NULL OR ${t.additionalMinuteAmountMinor} >= 0) AND ${t.numberAmountMinor} >= 0 AND ${t.channelAmountMinor} >= 0`,
    ),
    check(
      "plans_quantity_check",
      sql`${t.includedNumbers} >= 0 AND ${t.includedChannels} >= 0 AND (${t.includedMinutes} IS NULL OR (${t.includedMinutes} >= 0 AND ${t.includedMinutes} <> 'NaN'::numeric))`,
    ),
  ],
);

export const planPriceVersions = pgTable(
  "plan_price_versions",
  {
    id: id(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id),
    version: integer("version").notNull(),
    stripeProductId: text("stripe_product_id"),
    stripePriceId: text("stripe_price_id").unique(),
    pricingConfiguration: object("pricing_configuration").notNull(),
    activeFrom: time("active_from").notNull(),
    activeUntil: time("active_until"),
    createdAt: created(),
  },
  (t) => [
    unique("plan_price_versions_version_key").on(t.planId, t.version),
    uniqueIndex("plan_price_versions_current_key")
      .on(t.planId)
      .where(sql`${t.activeUntil} IS NULL`),
    check("plan_price_versions_positive_check", sql`${t.version} > 0`),
    check(
      "plan_price_versions_dates_check",
      sql`${t.activeUntil} IS NULL OR ${t.activeUntil} > ${t.activeFrom}`,
    ),
    check(
      "plan_price_versions_config_check",
      sql`jsonb_typeof(${t.pricingConfiguration}) = 'object'`,
    ),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: id(),
    revision: integer("revision").notNull().default(1),
    creationKey: uuid("creation_key").unique(),
    pendingStripeWorkflowId: uuid("pending_stripe_workflow_id"),
    proposedBillingAnchor: time("proposed_billing_anchor"),
    billingPolicyVersion: text("billing_policy_version"),
    legacyId: minor("legacy_id").unique(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    planPriceVersionId: uuid("plan_price_version_id")
      .notNull()
      .references(() => planPriceVersions.id),
    stripeSubscriptionId: text("stripe_subscription_id").unique(),
    stripeScheduleId: text("stripe_schedule_id").unique(),
    stripeSubscriptionItemId: text("stripe_subscription_item_id").unique(),
    status: text("status").notNull().default("DRAFT"),
    collectionMethod: text("collection_method"),
    billingDay: smallint("billing_day").notNull(),
    currentPeriodStart: time("current_period_start"),
    currentPeriodEnd: time("current_period_end"),
    createdAt: created(),
    updatedAt: updated(),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    cancellationRequestedAt: time("cancellation_requested_at"),
    canceledAt: time("canceled_at"),
  },
  (t) => [
    unique("subscriptions_id_customer_key").on(t.id, t.customerId),
    check("subscriptions_day_check", sql`${t.billingDay} BETWEEN 1 AND 31`),
    check(
      "subscriptions_status_check",
      sql`${t.status} IN ('DRAFT','INCOMPLETE','INCOMPLETE_EXPIRED','TRIALING','ACTIVE','PAST_DUE','CANCELED','UNPAID','PAUSED')`,
    ),
    check(
      "subscriptions_collection_check",
      sql`${t.collectionMethod} IS NULL OR ${t.collectionMethod} IN ('send_invoice','charge_automatically')`,
    ),
    check(
      "subscriptions_dates_check",
      sql`(${t.currentPeriodStart} IS NULL AND ${t.currentPeriodEnd} IS NULL) OR (${t.currentPeriodStart} IS NOT NULL AND ${t.currentPeriodEnd} IS NOT NULL AND ${t.currentPeriodStart} < ${t.currentPeriodEnd})`,
    ),
    index("subscriptions_customer_status_idx").on(t.customerId, t.status),
    index("subscriptions_due_idx").on(t.status, t.billingDay),
    index("subscriptions_plan_idx").on(t.planPriceVersionId),
  ],
);

export const customerBillingAdjustments = pgTable(
  "customer_billing_adjustments",
  {
    id: id(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    code: text("code").notNull(),
    amountMinor: minor("amount_minor"),
    quantity: decimal("quantity"),
    metadata: object("metadata").notNull().default({}),
    reason: text("reason").notNull(),
    createdByAppUserId: uuid("created_by_app_user_id")
      .notNull()
      .references(() => appUsers.id),
    active: boolean("active").notNull().default(true),
    validFrom: time("valid_from").notNull(),
    validUntil: time("valid_until"),
    createdAt: created(),
  },
  (t) => [
    check(
      "adjustments_value_check",
      sql`${t.amountMinor} IS NOT NULL OR ${t.quantity} IS NOT NULL`,
    ),
    check(
      "adjustments_quantity_check",
      sql`${t.quantity} IS NULL OR ${t.quantity} <> 'NaN'::numeric`,
    ),
    check("adjustments_reason_check", sql`length(trim(${t.reason})) > 0`),
    check(
      "adjustments_dates_check",
      sql`${t.validUntil} IS NULL OR ${t.validUntil} > ${t.validFrom}`,
    ),
    index("adjustments_customer_idx").on(t.customerId, t.validFrom),
    index("adjustments_actor_idx").on(t.createdByAppUserId),
  ],
);

export const usageExports = pgTable(
  "usage_exports",
  {
    id: id(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    provider: text("provider").notNull().default("FLOWROUTE"),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    providerExportId: text("provider_export_id"),
    status: usageExportStatus("status").notNull().default("PENDING"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: time("next_attempt_at"),
    processingToken: uuid("processing_token"),
    processingUntil: time("processing_until"),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    requestedAt: time("requested_at"),
    completedAt: time("completed_at"),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique("usage_exports_period_key").on(
      t.customerId,
      t.provider,
      t.periodStart,
      t.periodEnd,
    ),
    unique("usage_exports_identity_key").on(
      t.id,
      t.customerId,
      t.provider,
      t.periodStart,
      t.periodEnd,
    ),
    check("usage_exports_provider_check", sql`${t.provider} = 'FLOWROUTE'`),
    check("usage_exports_dates_check", sql`${t.periodStart} < ${t.periodEnd}`),
    check("usage_exports_attempt_check", sql`${t.attemptCount} >= 0`),
    index("usage_exports_retry_idx").on(t.status, t.nextAttemptAt),
  ],
);

export const usageSnapshots = pgTable(
  "usage_snapshots",
  {
    id: id(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    usageExportId: uuid("usage_export_id").notNull(),
    provider: text("provider").notNull().default("FLOWROUTE"),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    providerCostMinor: minor("provider_cost_minor"),
    providerCostExact: decimal("provider_cost_exact"),
    usageQuantity: decimal("usage_quantity"),
    currency: text("currency").notNull().default("USD"),
    rawPayload: object("raw_payload"),
    rawPayloadHash: text("raw_payload_hash").notNull(),
    capturedAt: time("captured_at").notNull(),
    createdAt: created(),
  },
  (t) => [
    unique("usage_snapshots_period_key").on(
      t.customerId,
      t.provider,
      t.periodStart,
      t.periodEnd,
    ),
    unique("usage_snapshots_identity_key").on(
      t.id,
      t.customerId,
      t.periodStart,
      t.periodEnd,
    ),
    foreignKey({
      name: "usage_snapshots_export_fk",
      columns: [
        t.usageExportId,
        t.customerId,
        t.provider,
        t.periodStart,
        t.periodEnd,
      ],
      foreignColumns: [
        usageExports.id,
        usageExports.customerId,
        usageExports.provider,
        usageExports.periodStart,
        usageExports.periodEnd,
      ],
    }),
    index("usage_snapshots_export_idx").on(t.usageExportId),
    check("usage_snapshots_currency_check", sql`${t.currency} = 'USD'`),
    check(
      "usage_snapshots_value_check",
      sql`${t.providerCostMinor} IS NOT NULL OR ${t.providerCostExact} IS NOT NULL OR ${t.usageQuantity} IS NOT NULL`,
    ),
    check(
      "usage_snapshots_numeric_check",
      sql`(${t.providerCostMinor} IS NULL OR ${t.providerCostMinor} >= 0) AND (${t.providerCostExact} IS NULL OR (${t.providerCostExact} >= 0 AND ${t.providerCostExact} <> 'NaN'::numeric)) AND (${t.usageQuantity} IS NULL OR (${t.usageQuantity} >= 0 AND ${t.usageQuantity} <> 'NaN'::numeric))`,
    ),
    check(
      "usage_snapshots_hash_check",
      sql`${t.rawPayloadHash} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);

/**
 * A later Flowroute export can supply the quantity that the legacy database
 * did not retain. The original snapshot remains immutable evidence of the
 * historical cost; this table records the separate retrieval and its export.
 */
export const flowrouteUsageBackfills = pgTable(
  "flowroute_usage_backfills",
  {
    id: id(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    legacyUsageSnapshotId: uuid("legacy_usage_snapshot_id")
      .notNull()
      .references(() => usageSnapshots.id),
    usageExportId: uuid("usage_export_id")
      .notNull()
      .references(() => usageExports.id),
    createdByAppUserId: uuid("created_by_app_user_id")
      .notNull()
      .references(() => appUsers.id),
    createdAt: created(),
  },
  (t) => [
    unique("flowroute_usage_backfills_snapshot_key").on(
      t.legacyUsageSnapshotId,
    ),
    unique("flowroute_usage_backfills_export_key").on(t.usageExportId),
    index("flowroute_usage_backfills_customer_idx").on(t.customerId),
  ],
);

/**
 * Transactional outbox for durable background work. Queue delivery is
 * intentionally advisory: this row is the recovery point if delivery fails,
 * is duplicated, or reaches the provider dead-letter queue.
 */
export const backgroundJobs = pgTable(
  "background_jobs",
  {
    id: id(),
    kind: text("kind").notNull().default("FLOWROUTE_EXPORT"),
    usageExportId: uuid("usage_export_id")
      .notNull()
      .references(() => usageExports.id),
    billingRunId: uuid("billing_run_id"),
    status: backgroundJobStatus("status").notNull().default("PENDING"),
    deliveryAttemptCount: integer("delivery_attempt_count")
      .notNull()
      .default(0),
    nextAttemptAt: time("next_attempt_at").notNull().defaultNow(),
    lastErrorCode: text("last_error_code"),
    enqueuedAt: time("enqueued_at"),
    completedAt: time("completed_at"),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique("background_jobs_usage_export_key").on(t.usageExportId),
    check(
      "background_jobs_kind_check",
      sql`${t.kind} IN ('FLOWROUTE_EXPORT', 'FLOWROUTE_BACKFILL')`,
    ),
    check("background_jobs_attempt_check", sql`${t.deliveryAttemptCount} >= 0`),
    index("background_jobs_dispatch_idx").on(t.status, t.nextAttemptAt),
    index("background_jobs_run_idx").on(t.billingRunId),
  ],
);

export const billingRuns = pgTable(
  "billing_runs",
  {
    id: id(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    subscriptionId: uuid("subscription_id"),
    // Captured when work is reserved so a plan change cannot revise a bill
    // that is still waiting for provider usage.
    planPriceVersionId: uuid("plan_price_version_id").references(
      () => planPriceVersions.id,
    ),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    status: billingRunStatus("status").notNull().default("DISCOVERED"),
    triggerType: triggerType("trigger_type").notNull(),
    formulaVersion: text("formula_version").notNull(),
    usageSnapshotId: uuid("usage_snapshot_id"),
    calculationSnapshot: object("calculation_snapshot"),
    subtotalMinor: minor("subtotal_minor"),
    currency: text("currency").notNull().default("USD"),
    stripeInvoiceId: text("stripe_invoice_id").unique(),
    attemptCount: integer("attempt_count").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: time("started_at"),
    completedAt: time("completed_at"),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique("billing_runs_customer_period_key").on(
      t.customerId,
      t.periodStart,
      t.periodEnd,
    ),
    foreignKey({
      name: "billing_runs_subscription_fk",
      columns: [t.subscriptionId, t.customerId],
      foreignColumns: [subscriptions.id, subscriptions.customerId],
    }),
    check(
      "billing_runs_pricing_check",
      sql`${t.subscriptionId} IS NULL OR ${t.planPriceVersionId} IS NOT NULL`,
    ),
    foreignKey({
      name: "billing_runs_usage_fk",
      columns: [t.usageSnapshotId, t.customerId, t.periodStart, t.periodEnd],
      foreignColumns: [
        usageSnapshots.id,
        usageSnapshots.customerId,
        usageSnapshots.periodStart,
        usageSnapshots.periodEnd,
      ],
    }),
    check(
      "billing_runs_month_check",
      sql`extract(day from ${t.periodStart}) = 1 AND ${t.periodEnd} = (${t.periodStart} + interval '1 month')::date`,
    ),
    check("billing_runs_currency_check", sql`${t.currency} = 'USD'`),
    check("billing_runs_attempt_check", sql`${t.attemptCount} >= 0`),
    check(
      "billing_runs_calculation_check",
      sql`(${t.calculationSnapshot} IS NULL AND ${t.subtotalMinor} IS NULL) OR (${t.calculationSnapshot} IS NOT NULL AND ${t.subtotalMinor} IS NOT NULL AND ${t.usageSnapshotId} IS NOT NULL)`,
    ),
    index("billing_runs_status_idx").on(t.status, t.createdAt),
    index("billing_runs_subscription_idx").on(t.subscriptionId),
    index("billing_runs_usage_idx").on(t.usageSnapshotId),
  ],
);

export const billingSyncJobs = pgTable(
  "billing_sync_jobs",
  {
    id: id(),
    billingRunId: uuid("billing_run_id")
      .notNull()
      .references(() => billingRuns.id),
    status: backgroundJobStatus("status").notNull().default("PENDING"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: time("next_attempt_at").notNull().defaultNow(),
    processingToken: uuid("processing_token"),
    processingUntil: time("processing_until"),
    lastErrorCode: text("last_error_code"),
    completedAt: time("completed_at"),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique("billing_sync_jobs_run_key").on(t.billingRunId),
    check("billing_sync_jobs_attempt_check", sql`${t.attemptCount} >= 0`),
    index("billing_sync_jobs_dispatch_idx").on(t.status, t.nextAttemptAt),
  ],
);

export const billingLineItems = pgTable(
  "billing_line_items",
  {
    id: id(),
    billingRunId: uuid("billing_run_id")
      .notNull()
      .references(() => billingRuns.id),
    code: text("code").notNull(),
    description: text("description").notNull(),
    quantity: decimal("quantity").notNull(),
    unitAmountMinor: minor("unit_amount_minor").notNull(),
    amountMinor: minor("amount_minor").notNull(),
    calculationMetadata: object("calculation_metadata").notNull(),
    stripeInvoiceItemId: text("stripe_invoice_item_id").unique(),
    createdAt: created(),
  },
  (t) => [
    unique("billing_line_items_code_key").on(t.billingRunId, t.code),
    check(
      "billing_line_items_quantity_check",
      sql`${t.quantity} <> 'NaN'::numeric`,
    ),
  ],
);

export const billingRunAdjustments = pgTable(
  "billing_run_adjustments",
  {
    id: id(),
    billingRunId: uuid("billing_run_id")
      .notNull()
      .references(() => billingRuns.id),
    amountMinor: minor("amount_minor").notNull(),
    reason: text("reason").notNull(),
    createdByAppUserId: uuid("created_by_app_user_id")
      .notNull()
      .references(() => appUsers.id),
    createdAt: created(),
  },
  (t) => [
    check(
      "billing_run_adjustments_reason_check",
      sql`length(trim(${t.reason})) > 0`,
    ),
    index("billing_run_adjustments_run_idx").on(t.billingRunId),
    index("billing_run_adjustments_actor_idx").on(t.createdByAppUserId),
  ],
);

export const stripeEvents = pgTable(
  "stripe_events",
  {
    id: id(),
    stripeEventId: text("stripe_event_id").notNull().unique(),
    eventType: text("event_type").notNull(),
    livemode: boolean("livemode").notNull(),
    payload: object("payload").notNull(),
    processingStatus: processingStatus("processing_status")
      .notNull()
      .default("PENDING"),
    receivedAt: time("received_at").notNull().defaultNow(),
    processedAt: time("processed_at"),
    errorMessage: text("error_message"),
  },
  (t) => [
    index("stripe_events_pending_idx").on(t.processingStatus, t.receivedAt),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    beforeJson: object("before_json"),
    afterJson: object("after_json"),
    requestId: text("request_id"),
    createdAt: created(),
  },
  (t) => [
    check(
      "audit_events_actor_check",
      sql`${t.actorType} IN ('ADMIN','SYSTEM','PROVIDER','MIGRATION')`,
    ),
    check(
      "audit_events_admin_check",
      sql`${t.actorType} <> 'ADMIN' OR ${t.actorId} IS NOT NULL`,
    ),
    index("audit_events_entity_idx").on(t.entityType, t.entityId, t.createdAt),
  ],
);

export const appSessions = pgTable(
  "app_sessions",
  {
    id: id(),
    tokenHash: text("token_hash").notNull().unique(),
    appUserId: uuid("app_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    expiresAt: time("expires_at").notNull(),
    createdAt: created(),
  },
  (t) => [
    check("app_sessions_hash_check", sql`${t.tokenHash} ~ '^[a-f0-9]{64}$'`),
    check("app_sessions_expiry_check", sql`${t.expiresAt} > ${t.createdAt}`),
    index("app_sessions_user_idx").on(t.appUserId),
    index("app_sessions_expiry_idx").on(t.expiresAt),
  ],
);

export const authRateLimits = pgTable(
  "auth_rate_limits",
  {
    key: text("key").primaryKey(),
    attempts: integer("attempts").notNull(),
    expiresAt: time("expires_at").notNull(),
  },
  (t) => [
    check("auth_rate_limits_attempts_check", sql`${t.attempts} > 0`),
    index("auth_rate_limits_expiry_idx").on(t.expiresAt),
  ],
);

/** One-time OAuth authorization codes for the remote administrative MCP. */
export const mcpAuthorizationCodes = pgTable(
  "mcp_authorization_codes",
  {
    id: id(),
    codeHash: text("code_hash").notNull().unique(),
    appUserId: uuid("app_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    resource: text("resource").notNull(),
    scope: text("scope").notNull(),
    expiresAt: time("expires_at").notNull(),
    consumedAt: time("consumed_at"),
    createdAt: created(),
  },
  (t) => [
    check(
      "mcp_authorization_codes_hash_check",
      sql`${t.codeHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "mcp_authorization_codes_expiry_check",
      sql`${t.expiresAt} > ${t.createdAt}`,
    ),
    index("mcp_authorization_codes_expiry_idx").on(t.expiresAt),
    index("mcp_authorization_codes_user_idx").on(t.appUserId, t.createdAt),
  ],
);

// One test account per database; changing API keys must never silently mix accounts.
export const stripeConnection = pgTable(
  "stripe_connection",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull().unique(),
    createdAt: created(),
  },
  (t) => [check("stripe_connection_test_only", sql`${t.id} = 'test'`)],
);
export const stripeWorkflows = pgTable(
  "stripe_workflows",
  {
    id: id(),
    requestKey: uuid("request_key").notNull().unique(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id),
    kind: text("kind").notNull(),
    input: object("input").notNull(),
    status: text("status").notNull().default("PENDING"),
    leaseToken: uuid("lease_token"),
    leaseUntil: time("lease_until"),
    errorCode: text("error_code"),
    createdAt: created(),
    completedAt: time("completed_at"),
  },
  (t) => [
    index("stripe_workflows_subscription_idx").on(
      t.subscriptionId,
      t.createdAt,
    ),
    check(
      "stripe_workflows_kind_check",
      sql`${t.kind} IN ('activate','change','cancel')`,
    ),
    check(
      "stripe_workflows_status_check",
      sql`${t.status} IN ('PENDING','SUCCEEDED','NEEDS_REVIEW')`,
    ),
  ],
);
export const stripeRequests = pgTable(
  "stripe_requests",
  {
    id: id(),
    operationKey: text("operation_key").notNull().unique(),
    kind: text("kind").notNull(),
    input: object("input").notNull(),
    providerId: text("provider_id"),
    status: text("status").notNull().default("PENDING"),
    leaseToken: uuid("lease_token"),
    leaseUntil: time("lease_until"),
    firstAttemptAt: time("first_attempt_at"),
    createdAt: created(),
    completedAt: time("completed_at"),
  },
  (t) => [
    check(
      "stripe_requests_status_check",
      sql`${t.status} IN ('PENDING','SUCCEEDED','NEEDS_REVIEW')`,
    ),
  ],
);
export const stripeInvoices = pgTable(
  "stripe_invoices",
  {
    id: text("id").primaryKey(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id),
    status: text("status").notNull(),
    delinquent: boolean("delinquent").notNull(),
    autoAdvance: boolean("auto_advance").notNull(),
    updatedAt: updated(),
  },
  (t) => [
    index("stripe_invoices_customer_delinquent_idx").on(
      t.customerId,
      t.delinquent,
    ),
  ],
);

/**
 * A local, privacy-minimized ledger of Stripe invoices. Unlike stripeInvoices,
 * this includes legacy invoices that predate the billing migration and invoices
 * that do not belong to a local subscription.
 */
export const stripeInvoiceHistory = pgTable(
  "stripe_invoice_history",
  {
    id: text("id").primaryKey(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    stripeSubscriptionId: text("stripe_subscription_id"),
    status: text("status").notNull(),
    collectionMethod: text("collection_method").notNull(),
    currency: text("currency").notNull(),
    totalMinor: minor("total_minor").notNull(),
    amountPaidMinor: minor("amount_paid_minor").notNull(),
    amountDueMinor: minor("amount_due_minor").notNull(),
    amountRemainingMinor: minor("amount_remaining_minor").notNull(),
    billingPeriodStart: date("billing_period_start"),
    billingPeriodEnd: date("billing_period_end"),
    dueAt: time("due_at"),
    paidAt: time("paid_at"),
    invoiceCreatedAt: time("invoice_created_at").notNull(),
    syncedAt: updated(),
  },
  (t) => [
    check(
      "stripe_invoice_history_status_check",
      sql`${t.status} IN ('draft', 'open', 'paid', 'uncollectible', 'void')`,
    ),
    check(
      "stripe_invoice_history_amounts_check",
      sql`${t.amountPaidMinor} >= 0 AND ${t.amountDueMinor} >= 0 AND ${t.amountRemainingMinor} >= 0`,
    ),
    check(
      "stripe_invoice_history_period_check",
      sql`(${t.billingPeriodStart} IS NULL AND ${t.billingPeriodEnd} IS NULL) OR (${t.billingPeriodStart} IS NOT NULL AND ${t.billingPeriodEnd} IS NOT NULL AND ${t.billingPeriodStart} < ${t.billingPeriodEnd})`,
    ),
    index("stripe_invoice_history_customer_created_idx").on(
      t.customerId,
      t.invoiceCreatedAt,
    ),
    index("stripe_invoice_history_customer_period_idx").on(
      t.customerId,
      t.billingPeriodStart,
      t.billingPeriodEnd,
    ),
    index("stripe_invoice_history_collection_idx").on(t.status, t.dueAt),
  ],
);
