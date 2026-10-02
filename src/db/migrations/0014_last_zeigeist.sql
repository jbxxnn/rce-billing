CREATE TYPE "public"."background_job_status" AS ENUM('PENDING', 'ENQUEUED', 'COMPLETED', 'NEEDS_REVIEW');--> statement-breakpoint
CREATE TABLE "background_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text DEFAULT 'FLOWROUTE_EXPORT' NOT NULL,
	"usage_export_id" uuid NOT NULL,
	"billing_run_id" uuid,
	"status" "background_job_status" DEFAULT 'PENDING' NOT NULL,
	"delivery_attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error_code" text,
	"enqueued_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "background_jobs_usage_export_key" UNIQUE("usage_export_id"),
	CONSTRAINT "background_jobs_kind_check" CHECK ("background_jobs"."kind" = 'FLOWROUTE_EXPORT'),
	CONSTRAINT "background_jobs_attempt_check" CHECK ("background_jobs"."delivery_attempt_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_usage_export_id_usage_exports_id_fk" FOREIGN KEY ("usage_export_id") REFERENCES "public"."usage_exports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "background_jobs_dispatch_idx" ON "background_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "background_jobs_run_idx" ON "background_jobs" USING btree ("billing_run_id");