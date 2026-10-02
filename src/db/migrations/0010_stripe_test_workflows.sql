CREATE TABLE "stripe_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_connection_account_id_unique" UNIQUE("account_id"),
	CONSTRAINT "stripe_connection_test_only" CHECK ("stripe_connection"."id" = 'test')
);
--> statement-breakpoint
CREATE TABLE "stripe_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"status" text NOT NULL,
	"delinquent" boolean NOT NULL,
	"auto_advance" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_key" text NOT NULL,
	"kind" text NOT NULL,
	"input" jsonb NOT NULL,
	"provider_id" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"first_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "stripe_requests_operation_key_unique" UNIQUE("operation_key"),
	CONSTRAINT "stripe_requests_status_check" CHECK ("stripe_requests"."status" IN ('PENDING','SUCCEEDED','NEEDS_REVIEW'))
);
--> statement-breakpoint
CREATE TABLE "stripe_workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_key" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"input" jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "stripe_workflows_request_key_unique" UNIQUE("request_key"),
	CONSTRAINT "stripe_workflows_kind_check" CHECK ("stripe_workflows"."kind" IN ('activate','change','cancel')),
	CONSTRAINT "stripe_workflows_status_check" CHECK ("stripe_workflows"."status" IN ('PENDING','SUCCEEDED','NEEDS_REVIEW'))
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pending_stripe_workflow_id" uuid;--> statement-breakpoint
ALTER TABLE "stripe_invoices" ADD CONSTRAINT "stripe_invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_invoices" ADD CONSTRAINT "stripe_invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_workflows" ADD CONSTRAINT "stripe_workflows_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stripe_invoices_customer_delinquent_idx" ON "stripe_invoices" USING btree ("customer_id","delinquent");--> statement-breakpoint
CREATE INDEX "stripe_workflows_subscription_idx" ON "stripe_workflows" USING btree ("subscription_id","created_at");