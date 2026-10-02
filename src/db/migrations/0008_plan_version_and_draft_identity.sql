ALTER TABLE "subscriptions" ADD COLUMN "creation_key" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_price_versions_current_key" ON "plan_price_versions" USING btree ("plan_id") WHERE "plan_price_versions"."active_until" IS NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_creation_key_unique" UNIQUE("creation_key");