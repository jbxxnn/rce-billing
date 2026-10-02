CREATE TYPE "public"."account_payment_status" AS ENUM('CURRENT', 'PAST_DUE');--> statement-breakpoint
CREATE TYPE "public"."billing_run_status" AS ENUM('DISCOVERED', 'WAITING_FOR_USAGE', 'NEEDS_REVIEW', 'CALCULATING', 'CALCULATED', 'SYNCING_STRIPE', 'PAYMENT_PENDING', 'PAST_DUE', 'COMPLETED', 'FAILED_RETRYABLE', 'FAILED_PERMANENT', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."customer_status" AS ENUM('DRAFT', 'ACTIVE', 'SUSPENDED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."plan_type" AS ENUM('FIXED', 'METERED', 'UNMETERED', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."processing_status" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED_RETRYABLE', 'FAILED_PERMANENT');--> statement-breakpoint
CREATE TYPE "public"."billing_trigger_type" AS ENUM('SCHEDULED', 'MANUAL', 'REPLAY');--> statement-breakpoint
CREATE TYPE "public"."usage_export_status" AS ENUM('PENDING', 'REQUESTED', 'PROCESSING', 'COMPLETED', 'FAILED_RETRYABLE', 'FAILED_PERMANENT');--> statement-breakpoint
CREATE TABLE "app_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"username" text,
	"password_hash" text,
	"role" text DEFAULT 'ADMIN' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "app_users_role_check" CHECK ("app_users"."role" IN ('ADMIN')),
	CONSTRAINT "app_users_status_check" CHECK ("app_users"."status" IN ('ACTIVE', 'DISABLED'))
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before_json" jsonb,
	"after_json" jsonb,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_actor_check" CHECK ("audit_events"."actor_type" IN ('ADMIN','SYSTEM','PROVIDER','MIGRATION')),
	CONSTRAINT "audit_events_admin_check" CHECK ("audit_events"."actor_type" <> 'ADMIN' OR "audit_events"."actor_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "billing_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"billing_run_id" uuid NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(30, 12) NOT NULL,
	"unit_amount_minor" bigint NOT NULL,
	"amount_minor" bigint NOT NULL,
	"calculation_metadata" jsonb NOT NULL,
	"stripe_invoice_item_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_line_items_stripe_invoice_item_id_unique" UNIQUE("stripe_invoice_item_id"),
	CONSTRAINT "billing_line_items_code_key" UNIQUE("billing_run_id","code"),
	CONSTRAINT "billing_line_items_quantity_check" CHECK ("billing_line_items"."quantity" <> 'NaN'::numeric)
);
--> statement-breakpoint
CREATE TABLE "billing_run_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"billing_run_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"reason" text NOT NULL,
	"created_by_app_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_run_adjustments_reason_check" CHECK (length(trim("billing_run_adjustments"."reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "billing_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"subscription_id" uuid,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" "billing_run_status" DEFAULT 'DISCOVERED' NOT NULL,
	"trigger_type" "billing_trigger_type" NOT NULL,
	"formula_version" text NOT NULL,
	"usage_snapshot_id" uuid,
	"calculation_snapshot" jsonb,
	"subtotal_minor" bigint,
	"currency" text DEFAULT 'USD' NOT NULL,
	"stripe_invoice_id" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_runs_stripe_invoice_id_unique" UNIQUE("stripe_invoice_id"),
	CONSTRAINT "billing_runs_customer_period_key" UNIQUE("customer_id","period_start","period_end"),
	CONSTRAINT "billing_runs_month_check" CHECK (extract(day from "billing_runs"."period_start") = 1 AND "billing_runs"."period_end" = ("billing_runs"."period_start" + interval '1 month')::date),
	CONSTRAINT "billing_runs_currency_check" CHECK ("billing_runs"."currency" = 'USD'),
	CONSTRAINT "billing_runs_attempt_check" CHECK ("billing_runs"."attempt_count" >= 0),
	CONSTRAINT "billing_runs_calculation_check" CHECK (("billing_runs"."calculation_snapshot" IS NULL AND "billing_runs"."subtotal_minor" IS NULL) OR ("billing_runs"."calculation_snapshot" IS NOT NULL AND "billing_runs"."subtotal_minor" IS NOT NULL AND "billing_runs"."usage_snapshot_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "customer_billing_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"code" text NOT NULL,
	"amount_minor" bigint,
	"quantity" numeric(30, 12),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_by_app_user_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adjustments_value_check" CHECK ("customer_billing_adjustments"."amount_minor" IS NOT NULL OR "customer_billing_adjustments"."quantity" IS NOT NULL),
	CONSTRAINT "adjustments_quantity_check" CHECK ("customer_billing_adjustments"."quantity" IS NULL OR "customer_billing_adjustments"."quantity" <> 'NaN'::numeric),
	CONSTRAINT "adjustments_reason_check" CHECK (length(trim("customer_billing_adjustments"."reason")) > 0),
	CONSTRAINT "adjustments_dates_check" CHECK ("customer_billing_adjustments"."valid_until" IS NULL OR "customer_billing_adjustments"."valid_until" > "customer_billing_adjustments"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "customer_provider_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"provider" text DEFAULT 'FLOWROUTE' NOT NULL,
	"access_key_encrypted" text NOT NULL,
	"secret_key_encrypted" text NOT NULL,
	"encryption_key_version" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone,
	CONSTRAINT "credentials_customer_provider_key" UNIQUE("customer_id","provider"),
	CONSTRAINT "credentials_provider_check" CHECK ("customer_provider_credentials"."provider" = 'FLOWROUTE'),
	CONSTRAINT "credentials_status_check" CHECK ("customer_provider_credentials"."status" IN ('ACTIVE', 'INVALID', 'REVOKED')),
	CONSTRAINT "credentials_nonempty_check" CHECK (length("customer_provider_credentials"."access_key_encrypted") > 0 AND length("customer_provider_credentials"."secret_key_encrypted") > 0 AND length("customer_provider_credentials"."encryption_key_version") > 0)
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" bigint,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"status" "customer_status" DEFAULT 'DRAFT' NOT NULL,
	"payment_status" "account_payment_status" DEFAULT 'CURRENT' NOT NULL,
	"billing_day" smallint NOT NULL,
	"billing_timezone" text DEFAULT 'UTC' NOT NULL,
	"stripe_customer_id" text,
	"street_address" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"country_code" text DEFAULT 'US' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "customers_legacy_id_unique" UNIQUE("legacy_id"),
	CONSTRAINT "customers_stripe_customer_id_unique" UNIQUE("stripe_customer_id"),
	CONSTRAINT "customers_billing_day_check" CHECK ("customers"."billing_day" BETWEEN 1 AND 31),
	CONSTRAINT "customers_name_check" CHECK (length(trim("customers"."full_name")) > 0),
	CONSTRAINT "customers_email_check" CHECK (length(trim("customers"."email")) > 0),
	CONSTRAINT "customers_country_check" CHECK ("customers"."country_code" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "plan_price_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"stripe_product_id" text,
	"stripe_price_id" text,
	"pricing_configuration" jsonb NOT NULL,
	"active_from" timestamp with time zone NOT NULL,
	"active_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_price_versions_stripe_price_id_unique" UNIQUE("stripe_price_id"),
	CONSTRAINT "plan_price_versions_version_key" UNIQUE("plan_id","version"),
	CONSTRAINT "plan_price_versions_positive_check" CHECK ("plan_price_versions"."version" > 0),
	CONSTRAINT "plan_price_versions_dates_check" CHECK ("plan_price_versions"."active_until" IS NULL OR "plan_price_versions"."active_until" > "plan_price_versions"."active_from"),
	CONSTRAINT "plan_price_versions_config_check" CHECK (jsonb_typeof("plan_price_versions"."pricing_configuration") = 'object')
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" bigint,
	"name" text NOT NULL,
	"description" text,
	"plan_type" "plan_type" NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"base_amount_minor" bigint,
	"included_minutes" numeric(30, 12),
	"additional_minute_amount_minor" bigint,
	"included_numbers" integer DEFAULT 0 NOT NULL,
	"number_amount_minor" bigint DEFAULT 0 NOT NULL,
	"included_channels" integer DEFAULT 0 NOT NULL,
	"channel_amount_minor" bigint DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_legacy_id_unique" UNIQUE("legacy_id"),
	CONSTRAINT "plans_currency_check" CHECK ("plans"."currency" = 'USD'),
	CONSTRAINT "plans_amount_check" CHECK (("plans"."base_amount_minor" IS NULL OR "plans"."base_amount_minor" >= 0) AND ("plans"."additional_minute_amount_minor" IS NULL OR "plans"."additional_minute_amount_minor" >= 0) AND "plans"."number_amount_minor" >= 0 AND "plans"."channel_amount_minor" >= 0),
	CONSTRAINT "plans_quantity_check" CHECK ("plans"."included_numbers" >= 0 AND "plans"."included_channels" >= 0 AND ("plans"."included_minutes" IS NULL OR ("plans"."included_minutes" >= 0 AND "plans"."included_minutes" <> 'NaN'::numeric)))
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stripe_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"livemode" boolean NOT NULL,
	"payload" jsonb NOT NULL,
	"processing_status" "processing_status" DEFAULT 'PENDING' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error_message" text,
	CONSTRAINT "stripe_events_stripe_event_id_unique" UNIQUE("stripe_event_id")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" bigint,
	"customer_id" uuid NOT NULL,
	"plan_price_version_id" uuid NOT NULL,
	"stripe_subscription_id" text,
	"stripe_subscription_item_id" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"collection_method" text,
	"billing_day" smallint NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"cancellation_requested_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	CONSTRAINT "subscriptions_legacy_id_unique" UNIQUE("legacy_id"),
	CONSTRAINT "subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id"),
	CONSTRAINT "subscriptions_stripe_subscription_item_id_unique" UNIQUE("stripe_subscription_item_id"),
	CONSTRAINT "subscriptions_id_customer_key" UNIQUE("id","customer_id"),
	CONSTRAINT "subscriptions_day_check" CHECK ("subscriptions"."billing_day" BETWEEN 1 AND 31),
	CONSTRAINT "subscriptions_status_check" CHECK ("subscriptions"."status" IN ('DRAFT','INCOMPLETE','INCOMPLETE_EXPIRED','TRIALING','ACTIVE','PAST_DUE','CANCELED','UNPAID','PAUSED')),
	CONSTRAINT "subscriptions_collection_check" CHECK ("subscriptions"."collection_method" IS NULL OR "subscriptions"."collection_method" IN ('send_invoice','charge_automatically')),
	CONSTRAINT "subscriptions_dates_check" CHECK (("subscriptions"."current_period_start" IS NULL AND "subscriptions"."current_period_end" IS NULL) OR ("subscriptions"."current_period_start" IS NOT NULL AND "subscriptions"."current_period_end" IS NOT NULL AND "subscriptions"."current_period_start" < "subscriptions"."current_period_end"))
);
--> statement-breakpoint
CREATE TABLE "usage_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"provider" text DEFAULT 'FLOWROUTE' NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"provider_export_id" text,
	"status" "usage_export_status" DEFAULT 'PENDING' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_message" text,
	"requested_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_exports_period_key" UNIQUE("customer_id","provider","period_start","period_end"),
	CONSTRAINT "usage_exports_identity_key" UNIQUE("id","customer_id","provider","period_start","period_end"),
	CONSTRAINT "usage_exports_provider_check" CHECK ("usage_exports"."provider" = 'FLOWROUTE'),
	CONSTRAINT "usage_exports_dates_check" CHECK ("usage_exports"."period_start" < "usage_exports"."period_end"),
	CONSTRAINT "usage_exports_attempt_check" CHECK ("usage_exports"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "usage_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"usage_export_id" uuid NOT NULL,
	"provider" text DEFAULT 'FLOWROUTE' NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"provider_cost_minor" bigint,
	"provider_cost_exact" numeric(30, 12),
	"usage_quantity" numeric(30, 12),
	"currency" text DEFAULT 'USD' NOT NULL,
	"raw_payload" jsonb,
	"raw_payload_hash" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_snapshots_period_key" UNIQUE("customer_id","provider","period_start","period_end"),
	CONSTRAINT "usage_snapshots_identity_key" UNIQUE("id","customer_id","period_start","period_end"),
	CONSTRAINT "usage_snapshots_currency_check" CHECK ("usage_snapshots"."currency" = 'USD'),
	CONSTRAINT "usage_snapshots_value_check" CHECK ("usage_snapshots"."provider_cost_minor" IS NOT NULL OR "usage_snapshots"."provider_cost_exact" IS NOT NULL OR "usage_snapshots"."usage_quantity" IS NOT NULL),
	CONSTRAINT "usage_snapshots_numeric_check" CHECK (("usage_snapshots"."provider_cost_minor" IS NULL OR "usage_snapshots"."provider_cost_minor" >= 0) AND ("usage_snapshots"."provider_cost_exact" IS NULL OR ("usage_snapshots"."provider_cost_exact" >= 0 AND "usage_snapshots"."provider_cost_exact" <> 'NaN'::numeric)) AND ("usage_snapshots"."usage_quantity" IS NULL OR ("usage_snapshots"."usage_quantity" >= 0 AND "usage_snapshots"."usage_quantity" <> 'NaN'::numeric))),
	CONSTRAINT "usage_snapshots_hash_check" CHECK ("usage_snapshots"."raw_payload_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "billing_line_items" ADD CONSTRAINT "billing_line_items_billing_run_id_billing_runs_id_fk" FOREIGN KEY ("billing_run_id") REFERENCES "public"."billing_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_run_adjustments" ADD CONSTRAINT "billing_run_adjustments_billing_run_id_billing_runs_id_fk" FOREIGN KEY ("billing_run_id") REFERENCES "public"."billing_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_run_adjustments" ADD CONSTRAINT "billing_run_adjustments_created_by_app_user_id_app_users_id_fk" FOREIGN KEY ("created_by_app_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_runs" ADD CONSTRAINT "billing_runs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_runs" ADD CONSTRAINT "billing_runs_subscription_fk" FOREIGN KEY ("subscription_id","customer_id") REFERENCES "public"."subscriptions"("id","customer_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_runs" ADD CONSTRAINT "billing_runs_usage_fk" FOREIGN KEY ("usage_snapshot_id","customer_id","period_start","period_end") REFERENCES "public"."usage_snapshots"("id","customer_id","period_start","period_end") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_billing_adjustments" ADD CONSTRAINT "customer_billing_adjustments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_billing_adjustments" ADD CONSTRAINT "customer_billing_adjustments_created_by_app_user_id_app_users_id_fk" FOREIGN KEY ("created_by_app_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_provider_credentials" ADD CONSTRAINT "customer_provider_credentials_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_price_versions" ADD CONSTRAINT "plan_price_versions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_price_version_id_plan_price_versions_id_fk" FOREIGN KEY ("plan_price_version_id") REFERENCES "public"."plan_price_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_exports" ADD CONSTRAINT "usage_exports_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_snapshots" ADD CONSTRAINT "usage_snapshots_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_snapshots" ADD CONSTRAINT "usage_snapshots_export_fk" FOREIGN KEY ("usage_export_id","customer_id","provider","period_start","period_end") REFERENCES "public"."usage_exports"("id","customer_id","provider","period_start","period_end") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_users_email_key" ON "app_users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "app_users_username_key" ON "app_users" USING btree (lower("username"));--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "billing_run_adjustments_run_idx" ON "billing_run_adjustments" USING btree ("billing_run_id");--> statement-breakpoint
CREATE INDEX "billing_run_adjustments_actor_idx" ON "billing_run_adjustments" USING btree ("created_by_app_user_id");--> statement-breakpoint
CREATE INDEX "billing_runs_status_idx" ON "billing_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "billing_runs_subscription_idx" ON "billing_runs" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "billing_runs_usage_idx" ON "billing_runs" USING btree ("usage_snapshot_id");--> statement-breakpoint
CREATE INDEX "adjustments_customer_idx" ON "customer_billing_adjustments" USING btree ("customer_id","valid_from");--> statement-breakpoint
CREATE INDEX "adjustments_actor_idx" ON "customer_billing_adjustments" USING btree ("created_by_app_user_id");--> statement-breakpoint
CREATE INDEX "customers_due_idx" ON "customers" USING btree ("status","billing_day");--> statement-breakpoint
CREATE INDEX "customers_email_idx" ON "customers" USING btree ("email");--> statement-breakpoint
CREATE INDEX "customers_page_idx" ON "customers" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "stripe_events_pending_idx" ON "stripe_events" USING btree ("processing_status","received_at");--> statement-breakpoint
CREATE INDEX "subscriptions_customer_status_idx" ON "subscriptions" USING btree ("customer_id","status");--> statement-breakpoint
CREATE INDEX "subscriptions_due_idx" ON "subscriptions" USING btree ("status","billing_day");--> statement-breakpoint
CREATE INDEX "subscriptions_plan_idx" ON "subscriptions" USING btree ("plan_price_version_id");--> statement-breakpoint
CREATE INDEX "usage_exports_retry_idx" ON "usage_exports" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "usage_snapshots_export_idx" ON "usage_snapshots" USING btree ("usage_export_id");