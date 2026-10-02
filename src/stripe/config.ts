export const STRIPE_API_VERSION = "2026-08-26.dahlia" as const;

export type StripeMode = "test" | "live";

export function stripeConfiguration(input: Record<string, string | undefined>) {
  const environment = input.APP_ENV ?? "";
  const testEnvironment = ["development", "test", "staging"].includes(
    environment,
  );
  const liveEnvironment = environment === "production";
  const mode: StripeMode = testEnvironment
    ? "test"
    : liveEnvironment
      ? "live"
      : (() => {
          throw new Error("Stripe is not enabled for this environment");
        })();
  const enabled =
    mode === "test"
      ? input.STRIPE_TEST_ENABLED === "true"
      : input.STRIPE_LIVE_ENABLED === "true" &&
        input.STRIPE_TEST_ENABLED !== "true";
  if (!enabled)
    throw new Error(
      mode === "test"
        ? "Stripe test integration is disabled"
        : "Stripe live integration is disabled",
    );
  const keyPattern =
    mode === "test" ? /^sk_test_[A-Za-z0-9]+$/ : /^sk_live_[A-Za-z0-9]+$/;
  if (
    !keyPattern.test(input.STRIPE_SECRET_KEY ?? "") ||
    /REPLACE/.test(input.STRIPE_SECRET_KEY ?? "")
  )
    throw new Error(`Configure a Stripe ${mode} secret key`);
  if (
    !/^acct_[A-Za-z0-9]+$/.test(input.STRIPE_ACCOUNT_ID ?? "") ||
    /REPLACE/.test(input.STRIPE_ACCOUNT_ID ?? "")
  )
    throw new Error("Configure the Stripe account ID");
  return {
    mode,
    secretKey: input.STRIPE_SECRET_KEY!,
    accountId: input.STRIPE_ACCOUNT_ID!,
    webhookSecret: input.STRIPE_WEBHOOK_SECRET,
  };
}
