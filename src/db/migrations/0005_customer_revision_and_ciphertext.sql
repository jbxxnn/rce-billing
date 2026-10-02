CREATE FUNCTION increment_customer_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.revision = OLD.revision + 1; RETURN NEW; END;
$$;
--> statement-breakpoint
CREATE TRIGGER increment_customer_revision BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION increment_customer_revision();
--> statement-breakpoint
ALTER TABLE customer_provider_credentials ADD CONSTRAINT credentials_envelope_check CHECK (
 access_key_encrypted ~ '^v1\.[A-Za-z0-9+/]{16}\.[A-Za-z0-9+/]+=*$'
 AND secret_key_encrypted ~ '^v1\.[A-Za-z0-9+/]{16}\.[A-Za-z0-9+/]+=*$'
);
