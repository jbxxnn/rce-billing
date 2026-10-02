ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_pending_stripe_workflow_fk FOREIGN KEY (pending_stripe_workflow_id) REFERENCES stripe_workflows(id);
--> statement-breakpoint
CREATE FUNCTION guard_stripe_request_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Stripe request history cannot be deleted' USING ERRCODE = '23514'; END IF;
 IF ROW(NEW.id,NEW.operation_key,NEW.kind,NEW.input,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.operation_key,OLD.kind,OLD.input,OLD.created_at)
 OR (OLD.first_attempt_at IS NOT NULL AND NEW.first_attempt_at IS DISTINCT FROM OLD.first_attempt_at)
 OR (OLD.provider_id IS NOT NULL AND NEW.provider_id IS DISTINCT FROM OLD.provider_id)
 OR (OLD.status = 'SUCCEEDED' AND NEW.status <> 'SUCCEEDED') THEN
 RAISE EXCEPTION 'Stripe request identity is immutable' USING ERRCODE = '23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER guard_stripe_request_identity BEFORE UPDATE OR DELETE ON stripe_requests FOR EACH ROW EXECUTE FUNCTION guard_stripe_request_identity();
--> statement-breakpoint
CREATE FUNCTION guard_stripe_workflow_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Stripe workflow history cannot be deleted' USING ERRCODE = '23514'; END IF;
 IF ROW(NEW.id,NEW.request_key,NEW.subscription_id,NEW.kind,NEW.input,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.request_key,OLD.subscription_id,OLD.kind,OLD.input,OLD.created_at)
 OR (OLD.status = 'SUCCEEDED' AND NEW.status <> 'SUCCEEDED') THEN
 RAISE EXCEPTION 'Stripe workflow identity is immutable' USING ERRCODE = '23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER guard_stripe_workflow_identity BEFORE UPDATE OR DELETE ON stripe_workflows FOR EACH ROW EXECUTE FUNCTION guard_stripe_workflow_identity();
--> statement-breakpoint
CREATE TRIGGER immutable_stripe_connection BEFORE UPDATE OR DELETE ON stripe_connection FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['stripe_requests','stripe_workflows','stripe_connection'] LOOP
 EXECUTE format('CREATE TRIGGER prevent_stripe_history_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_history_mutation()',table_name);
 END LOOP;
END;
$$;
