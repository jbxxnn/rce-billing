CREATE TABLE "flowroute_usage_backfills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"legacy_usage_snapshot_id" uuid NOT NULL,
	"usage_export_id" uuid NOT NULL,
	"created_by_app_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flowroute_usage_backfills_snapshot_key" UNIQUE("legacy_usage_snapshot_id"),
	CONSTRAINT "flowroute_usage_backfills_export_key" UNIQUE("usage_export_id")
);
--> statement-breakpoint
ALTER TABLE "background_jobs" DROP CONSTRAINT "background_jobs_kind_check";--> statement-breakpoint
ALTER TABLE "flowroute_usage_backfills" ADD CONSTRAINT "flowroute_usage_backfills_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flowroute_usage_backfills" ADD CONSTRAINT "flowroute_usage_backfills_legacy_usage_snapshot_id_usage_snapshots_id_fk" FOREIGN KEY ("legacy_usage_snapshot_id") REFERENCES "public"."usage_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flowroute_usage_backfills" ADD CONSTRAINT "flowroute_usage_backfills_usage_export_id_usage_exports_id_fk" FOREIGN KEY ("usage_export_id") REFERENCES "public"."usage_exports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flowroute_usage_backfills" ADD CONSTRAINT "flowroute_usage_backfills_created_by_app_user_id_app_users_id_fk" FOREIGN KEY ("created_by_app_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flowroute_usage_backfills_customer_idx" ON "flowroute_usage_backfills" USING btree ("customer_id");--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_kind_check" CHECK ("background_jobs"."kind" IN ('FLOWROUTE_EXPORT', 'FLOWROUTE_BACKFILL'));