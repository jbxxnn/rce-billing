CREATE TABLE "app_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"app_user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "app_sessions_hash_check" CHECK ("app_sessions"."token_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "app_sessions_expiry_check" CHECK ("app_sessions"."expires_at" > "app_sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"attempts" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "auth_rate_limits_attempts_check" CHECK ("auth_rate_limits"."attempts" > 0)
);
--> statement-breakpoint
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_app_user_id_app_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_sessions_user_idx" ON "app_sessions" USING btree ("app_user_id");--> statement-breakpoint
CREATE INDEX "app_sessions_expiry_idx" ON "app_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_rate_limits_expiry_idx" ON "auth_rate_limits" USING btree ("expires_at");