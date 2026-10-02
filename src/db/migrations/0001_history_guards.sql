-- Financial history is append-only, including for accidental direct SQL updates.
CREATE FUNCTION reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Historical records cannot be changed or removed' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['usage_snapshots', 'audit_events', 'billing_run_adjustments'] LOOP
    EXECUTE format('CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_history_mutation()', table_name);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['usage_snapshots', 'audit_events', 'billing_run_adjustments', 'billing_runs', 'billing_line_items', 'plan_price_versions', 'customer_billing_adjustments'] LOOP
    EXECUTE format('CREATE TRIGGER prevent_history_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_history_mutation()', table_name);
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION guard_pricing_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Pricing history cannot be deleted' USING ERRCODE = '23514'; END IF;
  IF (to_jsonb(NEW) - ARRAY['active_until','stripe_product_id','stripe_price_id']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['active_until','stripe_product_id','stripe_price_id'])
     OR (OLD.stripe_price_id IS NOT NULL AND NEW.stripe_price_id IS DISTINCT FROM OLD.stripe_price_id)
     OR (OLD.stripe_product_id IS NOT NULL AND NEW.stripe_product_id IS DISTINCT FROM OLD.stripe_product_id) THEN
    RAISE EXCEPTION 'Pricing history is immutable; create a new version' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER guard_pricing_history BEFORE UPDATE OR DELETE ON plan_price_versions FOR EACH ROW EXECUTE FUNCTION guard_pricing_history();
--> statement-breakpoint
CREATE FUNCTION guard_customer_adjustment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Adjustment history cannot be deleted' USING ERRCODE = '23514'; END IF;
  IF (to_jsonb(NEW) - ARRAY['active','valid_until']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['active','valid_until']) THEN
    RAISE EXCEPTION 'Adjustment values are immutable; expire and replace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER guard_customer_adjustment BEFORE UPDATE OR DELETE ON customer_billing_adjustments FOR EACH ROW EXECUTE FUNCTION guard_customer_adjustment();
--> statement-breakpoint
CREATE FUNCTION guard_billing_run() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE line_total numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Billing history cannot be deleted' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id,NEW.customer_id,NEW.subscription_id,NEW.period_start,NEW.period_end,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.customer_id,OLD.subscription_id,OLD.period_start,OLD.period_end,OLD.created_at) THEN
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
--> statement-breakpoint
CREATE TRIGGER guard_billing_run BEFORE INSERT OR UPDATE OR DELETE ON billing_runs FOR EACH ROW EXECUTE FUNCTION guard_billing_run();
--> statement-breakpoint
CREATE FUNCTION guard_billing_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE snapshot jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Billing line history cannot be deleted' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'INSERT' THEN
    -- Serialize line creation against sealing the parent calculation.
    SELECT calculation_snapshot INTO snapshot FROM billing_runs WHERE id = NEW.billing_run_id FOR UPDATE;
    IF snapshot IS NOT NULL THEN RAISE EXCEPTION 'Cannot add lines to a sealed calculation' USING ERRCODE = '23514'; END IF;
  ELSE
    IF (to_jsonb(NEW) - 'stripe_invoice_item_id') IS DISTINCT FROM (to_jsonb(OLD) - 'stripe_invoice_item_id')
       OR (OLD.stripe_invoice_item_id IS NOT NULL AND NEW.stripe_invoice_item_id IS DISTINCT FROM OLD.stripe_invoice_item_id) THEN
      RAISE EXCEPTION 'Original billing line is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER guard_billing_line BEFORE INSERT OR UPDATE OR DELETE ON billing_line_items FOR EACH ROW EXECUTE FUNCTION guard_billing_line();
--> statement-breakpoint
CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['app_users','customers','customer_provider_credentials','plans','subscriptions','usage_exports','billing_runs'] LOOP
    EXECUTE format('CREATE TRIGGER touch_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', table_name);
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION check_customer_timezone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.billing_timezone) THEN
    RAISE EXCEPTION 'Unknown billing timezone' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER check_customer_timezone BEFORE INSERT OR UPDATE OF billing_timezone ON customers FOR EACH ROW EXECUTE FUNCTION check_customer_timezone();
