CREATE TABLE "billing_sync_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "billing_run_id" uuid NOT NULL,
  "status" "background_job_status" DEFAULT 'PENDING' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_error_code" text,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "billing_sync_jobs_run_key" UNIQUE("billing_run_id"),
  CONSTRAINT "billing_sync_jobs_attempt_check" CHECK ("attempt_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "billing_sync_jobs" ADD CONSTRAINT "billing_sync_jobs_billing_run_id_billing_runs_id_fk" FOREIGN KEY ("billing_run_id") REFERENCES "public"."billing_runs"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "billing_sync_jobs_dispatch_idx" ON "billing_sync_jobs" USING btree ("status","next_attempt_at");
