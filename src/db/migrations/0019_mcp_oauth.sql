CREATE TABLE "mcp_authorization_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code_hash" text NOT NULL,
  "app_user_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE CASCADE,
  "client_id" text NOT NULL,
  "redirect_uri" text NOT NULL,
  "code_challenge" text NOT NULL,
  "resource" text NOT NULL,
  "scope" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "mcp_authorization_codes_code_hash_unique" UNIQUE("code_hash"),
  CONSTRAINT "mcp_authorization_codes_hash_check" CHECK ("code_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "mcp_authorization_codes_expiry_check" CHECK ("expires_at" > "created_at")
);
--> statement-breakpoint
CREATE INDEX "mcp_authorization_codes_expiry_idx" ON "mcp_authorization_codes" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "mcp_authorization_codes_user_idx" ON "mcp_authorization_codes" USING btree ("app_user_id", "created_at");
