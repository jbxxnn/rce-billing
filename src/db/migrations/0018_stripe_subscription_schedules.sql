ALTER TABLE "subscriptions" ADD COLUMN "stripe_schedule_id" text;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_stripe_schedule_id_unique" UNIQUE("stripe_schedule_id");
