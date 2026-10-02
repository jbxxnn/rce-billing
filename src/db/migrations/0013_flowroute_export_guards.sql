-- Custom SQL migration file, put your code below! --
CREATE FUNCTION guard_usage_export_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Usage export history cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF ROW(NEW.id, NEW.customer_id, NEW.provider, NEW.period_start, NEW.period_end, NEW.created_at)
       IS DISTINCT FROM ROW(OLD.id, OLD.customer_id, OLD.provider, OLD.period_start, OLD.period_end, OLD.created_at)
     OR (OLD.provider_export_id IS NOT NULL AND NEW.provider_export_id IS DISTINCT FROM OLD.provider_export_id)
     OR (OLD.status = 'COMPLETED' AND NEW.status <> 'COMPLETED') THEN
    RAISE EXCEPTION 'Usage export identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER guard_usage_export_identity BEFORE UPDATE OR DELETE ON usage_exports FOR EACH ROW EXECUTE FUNCTION guard_usage_export_identity();
--> statement-breakpoint
CREATE TRIGGER prevent_usage_export_truncate BEFORE TRUNCATE ON usage_exports FOR EACH STATEMENT EXECUTE FUNCTION reject_history_mutation();
