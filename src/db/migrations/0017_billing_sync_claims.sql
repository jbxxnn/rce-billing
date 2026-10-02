ALTER TABLE "billing_sync_jobs" ADD COLUMN "processing_token" uuid;
--> statement-breakpoint
ALTER TABLE "billing_sync_jobs" ADD COLUMN "processing_until" timestamp with time zone;
