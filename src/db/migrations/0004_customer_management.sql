ALTER TABLE "customer_provider_credentials" DROP CONSTRAINT "credentials_status_check";--> statement-breakpoint
ALTER TABLE "customer_provider_credentials" ALTER COLUMN "status" SET DEFAULT 'UNVERIFIED';--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_provider_credentials" ADD CONSTRAINT "credentials_status_check" CHECK ("customer_provider_credentials"."status" IN ('UNVERIFIED', 'ACTIVE', 'INVALID', 'REVOKED'));--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_revision_check" CHECK ("customers"."revision" > 0);