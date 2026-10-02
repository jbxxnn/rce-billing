-- Serialize new workflow activity against the customer-management archive lock.
CREATE FUNCTION guard_archived_customer_activity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE customer_state customer_status;
BEGIN
  SELECT status INTO customer_state FROM customers WHERE id=NEW.customer_id FOR SHARE;
  IF customer_state = 'ARCHIVED' THEN
    IF (TG_TABLE_NAME = 'subscriptions' AND NEW.status::text NOT IN ('CANCELED','INCOMPLETE_EXPIRED'))
       OR (TG_TABLE_NAME = 'billing_runs' AND NEW.status::text NOT IN ('COMPLETED','CANCELED')) THEN
      RAISE EXCEPTION 'Archived customers cannot start or resume billing activity' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER guard_archived_customer_activity BEFORE INSERT OR UPDATE OF customer_id,status ON subscriptions FOR EACH ROW EXECUTE FUNCTION guard_archived_customer_activity();
--> statement-breakpoint
CREATE TRIGGER guard_archived_customer_activity BEFORE INSERT OR UPDATE OF customer_id,status ON billing_runs FOR EACH ROW EXECUTE FUNCTION guard_archived_customer_activity();
