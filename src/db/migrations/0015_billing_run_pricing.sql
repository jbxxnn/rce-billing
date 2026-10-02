ALTER TABLE "billing_runs" ADD COLUMN "plan_price_version_id" uuid;
--> statement-breakpoint
ALTER TABLE "billing_runs" ADD CONSTRAINT "billing_runs_plan_price_version_id_plan_price_versions_id_fk" FOREIGN KEY ("plan_price_version_id") REFERENCES "public"."plan_price_versions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "billing_runs" ADD CONSTRAINT "billing_runs_pricing_check" CHECK ("subscription_id" IS NULL OR "plan_price_version_id" IS NOT NULL);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_billing_run() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE line_total numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Billing history cannot be deleted' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id,NEW.customer_id,NEW.subscription_id,NEW.plan_price_version_id,NEW.period_start,NEW.period_end,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.customer_id,OLD.subscription_id,OLD.plan_price_version_id,OLD.period_start,OLD.period_end,OLD.created_at) THEN
      RAISE EXCEPTION 'Billing identity is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.calculation_snapshot IS NOT NULL AND ROW(NEW.formula_version,NEW.usage_snapshot_id,NEW.calculation_snapshot,NEW.subtotal_minor,NEW.currency) IS DISTINCT FROM ROW(OLD.formula_version,OLD.usage_snapshot_id,OLD.calculation_snapshot,OLD.subtotal_minor,OLD.currency) THEN
      RAISE EXCEPTION 'Original billing calculation is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.status IN ('CALCULATED','SYNCING_STRIPE','PAYMENT_PENDING','PAST_DUE','COMPLETED') AND NEW.calculation_snapshot IS NULL THEN
    RAISE EXCEPTION 'Valid usage and calculation are required before billing advances' USING ERRCODE = '23514';
  END IF;
  IF NEW.calculation_snapshot IS NOT NULL THEN
    SELECT COALESCE(sum(amount_minor),0) INTO line_total FROM billing_line_items WHERE billing_run_id = NEW.id;
    IF line_total IS DISTINCT FROM NEW.subtotal_minor::numeric THEN
      RAISE EXCEPTION 'Billing subtotal must equal original line items' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
