CREATE FUNCTION increment_domain_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.revision = OLD.revision + 1; RETURN NEW; END;
$$;
--> statement-breakpoint
CREATE TRIGGER increment_domain_revision BEFORE UPDATE ON plans FOR EACH ROW EXECUTE FUNCTION increment_domain_revision();
--> statement-breakpoint
CREATE TRIGGER increment_domain_revision BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION increment_domain_revision();
--> statement-breakpoint
ALTER TABLE plans ADD CONSTRAINT plans_revision_positive CHECK (revision > 0);
--> statement-breakpoint
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_revision_positive CHECK (revision > 0);
--> statement-breakpoint
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_proposed_anchor_pair CHECK ((proposed_billing_anchor IS NULL AND billing_policy_version IS NULL) OR (proposed_billing_anchor IS NOT NULL AND billing_policy_version IS NOT NULL));
