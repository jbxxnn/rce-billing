CREATE TABLE "stripe_invoice_history" (
  "id" text PRIMARY KEY NOT NULL,
  "customer_id" uuid NOT NULL,
  "stripe_subscription_id" text,
  "status" text NOT NULL,
  "collection_method" text NOT NULL,
  "currency" text NOT NULL,
  "total_minor" bigint NOT NULL,
  "amount_paid_minor" bigint NOT NULL,
  "amount_due_minor" bigint NOT NULL,
  "amount_remaining_minor" bigint NOT NULL,
  "due_at" timestamp with time zone,
  "paid_at" timestamp with time zone,
  "invoice_created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "stripe_invoice_history_status_check" CHECK ("status" IN ('draft', 'open', 'paid', 'uncollectible', 'void')),
  CONSTRAINT "stripe_invoice_history_amounts_check" CHECK ("amount_paid_minor" >= 0 AND "amount_due_minor" >= 0 AND "amount_remaining_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "stripe_invoice_history" ADD CONSTRAINT "stripe_invoice_history_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "stripe_invoice_history_customer_created_idx" ON "stripe_invoice_history" USING btree ("customer_id","invoice_created_at");
--> statement-breakpoint
CREATE INDEX "stripe_invoice_history_collection_idx" ON "stripe_invoice_history" USING btree ("status","due_at");
