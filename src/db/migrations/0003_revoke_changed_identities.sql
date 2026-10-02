CREATE FUNCTION revoke_changed_identity_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.password_hash, NEW.status, NEW.role) IS DISTINCT FROM ROW(OLD.password_hash, OLD.status, OLD.role) THEN
    DELETE FROM app_sessions WHERE app_user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER revoke_changed_identity_sessions AFTER UPDATE OF password_hash, status, role ON app_users FOR EACH ROW EXECUTE FUNCTION revoke_changed_identity_sessions();
