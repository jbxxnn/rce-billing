ALTER TABLE "usage_exports" ADD COLUMN "processing_token" uuid;--> statement-breakpoint
ALTER TABLE "usage_exports" ADD COLUMN "processing_until" timestamp with time zone;