import { afterEach, describe, it, expect, vi } from "vitest";
import { stripeSdk, stripeProvider, verifiedEvent } from "./adapter";
import { stripeConfiguration, STRIPE_API_VERSION } from "./config";
import { activationSchema, changePlanSchema } from "./validation";
afterEach(() => vi.unstubAllGlobals());
describe("Stripe adapter boundary", () => {
  it("pins API version, test key, stable idempotency and encoded calendar parameters", async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ id: "sub_test", livemode: false }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "request-id": "req_test",
        },
      });
    });
    const provider = stripeProvider(
      stripeSdk("sk_test_fixture"),
      "acct_fixture",
    );
    await provider.execute(
      "subscription",
      {
        customer: "cus_test",
        items: [{ price: "price_test", quantity: 1 }],
        billing_cycle_anchor_config: {
          day_of_month: 31,
          hour: 11,
          minute: 0,
          second: 0,
        },
        proration_behavior: "create_prorations",
      },
      "stable-key",
    );
    const headers = new Headers(requests[0].init!.headers);
    expect(headers.get("stripe-version")).toBe(STRIPE_API_VERSION);
    expect(headers.get("idempotency-key")).toBe("stable-key");
    expect(requests[0].url).toBe("https://api.stripe.com/v1/subscriptions");
    const params = new URLSearchParams(String(requests[0].init!.body));
    expect(params.get("billing_cycle_anchor_config[day_of_month]")).toBe("31");
    expect(params.get("billing_cycle_anchor_config[hour]")).toBe("11");
    expect(params.get("proration_behavior")).toBe("create_prorations");
  });
  it("verifies raw signed payloads and rejects tampering, old signatures, live and connected events", async () => {
    const sdk = stripeSdk("sk_test_fixture");
    const secret = "whsec_fixture";
    const body = JSON.stringify({
      id: "evt_test",
      type: "customer.subscription.updated",
      livemode: false,
      data: { object: { id: "sub_test" } },
    });
    const signature = sdk.webhooks.generateTestHeaderString({
      payload: body,
      secret,
    });
    expect((await verifiedEvent(sdk, body, signature, secret)).id).toBe(
      "evt_test",
    );
    await expect(
      verifiedEvent(sdk, body + " ", signature, secret),
    ).rejects.toThrow();
    const old = sdk.webhooks.generateTestHeaderString({
      payload: body,
      secret,
      timestamp: Math.floor(Date.now() / 1000) - 301,
    });
    await expect(verifiedEvent(sdk, body, old, secret)).rejects.toThrow();
    for (const extra of [{ livemode: true }, { account: "acct_other" }]) {
      const payload = JSON.stringify({ ...JSON.parse(body), ...extra });
      await expect(
        verifiedEvent(
          sdk,
          payload,
          sdk.webhooks.generateTestHeaderString({ payload, secret }),
          secret,
        ),
      ).rejects.toThrow();
    }
  });
  it("keeps test and live Stripe configuration isolated by environment", () => {
    const valid = {
      STRIPE_TEST_ENABLED: "true",
      STRIPE_SECRET_KEY: "sk_test_fixture",
      STRIPE_ACCOUNT_ID: "acct_fixture",
      APP_ENV: "test",
    };
    expect(stripeConfiguration(valid).accountId).toBe("acct_fixture");
    expect(stripeConfiguration(valid).mode).toBe("test");
    for (const patch of [
      { STRIPE_TEST_ENABLED: "false" },
      { STRIPE_SECRET_KEY: "sk_live_fixture" },
      { APP_ENV: "production" },
      { STRIPE_SECRET_KEY: "sk_test_REPLACE" },
    ])
      expect(() => stripeConfiguration({ ...valid, ...patch })).toThrow();
    expect(() => stripeSdk("sk_live_fixture")).toThrow();
    const live = stripeConfiguration({
      APP_ENV: "production",
      STRIPE_LIVE_ENABLED: "true",
      STRIPE_SECRET_KEY: "sk_live_fixture",
      STRIPE_ACCOUNT_ID: "acct_fixture",
    });
    expect(live.mode).toBe("live");
    expect(() => stripeSdk(live.secretKey, live.mode)).not.toThrow();
    expect(() =>
      stripeConfiguration({ ...live, STRIPE_TEST_ENABLED: "true" }),
    ).toThrow();
  });
  it("rejects browser supplied provider IDs and invalid payment deadlines", () => {
    const base = { requestKey: crypto.randomUUID(), revision: "1" };
    expect(
      activationSchema.safeParse({ ...base, daysUntilDue: "0" }).success,
    ).toBe(false);
    expect(
      activationSchema.safeParse({ ...base, stripeCustomerId: "cus_x" })
        .success,
    ).toBe(false);
    expect(
      changePlanSchema.safeParse({
        ...base,
        planPriceVersionId: crypto.randomUUID(),
        proration_behavior: "none",
      }).success,
    ).toBe(false);
  });
});
