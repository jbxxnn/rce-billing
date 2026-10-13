import { stripeSdk } from "../stripe/adapter";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { migrateDatabase } from "../../scripts/db/migrate";
import { manageAdministrator } from "../../scripts/auth/manage-admin";
import { digest, newSessionToken } from "./crypto";

const maintenanceUrl = process.env.TEST_DATABASE_URL;
if (!maintenanceUrl)
  throw new Error(
    "TEST_DATABASE_URL is required for authentication HTTP tests",
  );
const fixtureKeys = JSON.stringify({
  test1: btoa(String.fromCharCode(...new Uint8Array(32).fill(11))),
});
const name = `rce_auth_${randomUUID().replaceAll("-", "")}`;
const url = new URL(maintenanceUrl);
url.pathname = `/${name}`;
const admin = new Client({ connectionString: maintenanceUrl });
let created = false;
beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  created = true;
  await migrateDatabase(url.toString());
});
afterAll(async () => {
  if (created) await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
  await admin.end();
});

describe.each(["next", "workers"] as const)(
  "%s authentication HTTP boundary",
  (runtime) => {
    const port = runtime === "next" ? 3119 : 3120;
    const origin = `http://127.0.0.1:${port}`;
    const email = `${runtime}-${randomUUID()}@example.invalid`;
    const password = "http-test-password-fixture";
    let server: ChildProcess;
    let configPath: string | undefined;
    beforeAll(async () => {
      await manageAdministrator(url.toString(), "create", email, password);
      let args: string[];
      if (runtime === "next")
        args = [
          "node_modules/next/dist/bin/next",
          "start",
          "--hostname",
          "127.0.0.1",
          "--port",
          String(port),
        ];
      else {
        const built = JSON.parse(
          await readFile("dist/server/wrangler.json", "utf8"),
        );
        const {
          configPath: _configPath,
          userConfigPath: _userConfigPath,
          topLevelName: _name,
          definedEnvironments: _environments,
          ...config
        } = built;
        void _configPath;
        void _userConfigPath;
        void _name;
        void _environments;
        await mkdir(".wrangler", { recursive: true });
        configPath = resolve(`.wrangler/auth-${randomUUID()}.json`);
        await writeFile(
          configPath,
          JSON.stringify({
            ...config,
            name: "rce-auth-http-test",
            main: resolve("dist/server/index.js"),
            assets: { ...config.assets, directory: resolve("dist/client") },
            vars: {
              APP_ENV: "test",
              STRIPE_TEST_ENABLED: "true",
              STRIPE_SECRET_KEY: "sk_test_fixture",
              STRIPE_ACCOUNT_ID: "acct_fixture",
              STRIPE_WEBHOOK_SECRET: "whsec_httpfixture",
              APP_ORIGIN: origin,
              GOOGLE_OAUTH_CLIENT_ID: "google-client-id",
              GOOGLE_OAUTH_CLIENT_SECRET: "google-client-secret",
              FLOWROUTE_ENCRYPTION_KEY_VERSION: "test1",
              FLOWROUTE_ENCRYPTION_KEYS: fixtureKeys,
            },
            hyperdrive: [
              { binding: "HYPERDRIVE", id: "00000000000000000000000000000000" },
            ],
          }),
        );
        args = [
          "node_modules/wrangler/bin/wrangler.js",
          "dev",
          "--config",
          configPath,
          "--local",
          "--ip",
          "127.0.0.1",
          "--port",
          String(port),
          "--inspector-port",
          "0",
        ];
      }
      server = spawn(process.execPath, args, {
        env: {
          ...process.env,
          NEXT_TELEMETRY_DISABLED: "1",
          WRANGLER_SEND_METRICS: "false",
          FLOWROUTE_ENCRYPTION_KEY_VERSION: "test1",
          FLOWROUTE_ENCRYPTION_KEYS: fixtureKeys,
          APP_ENV: "test",
          STRIPE_TEST_ENABLED: "true",
          STRIPE_SECRET_KEY: "sk_test_fixture",
          STRIPE_ACCOUNT_ID: "acct_fixture",
          STRIPE_WEBHOOK_SECRET: "whsec_httpfixture",
          APP_ORIGIN: origin,
          GOOGLE_OAUTH_CLIENT_ID: "google-client-id",
          GOOGLE_OAUTH_CLIENT_SECRET: "google-client-secret",
          DATABASE_URL: url.toString(),
          CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE:
            url.toString(),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      // Drain logs without exposing credentials or generated session values.
      server.stdout!.resume();
      server.stderr!.resume();
      const deadline = Date.now() + 25_000;
      while (server.exitCode === null && Date.now() < deadline) {
        try {
          const response = await fetch(`${origin}/api/health`, {
            signal: AbortSignal.timeout(500),
          });
          if (response.ok) return;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(
        "Authentication test server failed to start; build both targets first",
      );
    });
    afterAll(async () => {
      if (server && server.exitCode === null) {
        const exited = once(server, "exit");
        server.kill("SIGTERM");
        await exited;
      }
      if (configPath) await unlink(configPath);
    });
    const post = (
      path: string,
      body?: URLSearchParams,
      cookie?: string,
      requestOrigin = origin,
    ) =>
      fetch(`${origin}${path}`, {
        method: "POST",
        redirect: "manual",
        headers: {
          origin: requestOrigin,
          ...(cookie ? { cookie } : {}),
          ...(body
            ? { "content-type": "application/x-www-form-urlencoded" }
            : {}),
        },
        body,
      });
    const authenticatedCookie = async () => {
      const token = newSessionToken();
      const client = new Client({ connectionString: url.toString() });
      try {
        await client.connect();
        const created = await client.query(
          `INSERT INTO app_sessions(app_user_id, token_hash, expires_at)
           SELECT id, $2, now() + interval '1 hour' FROM app_users
           WHERE lower(email) = $1
           RETURNING id`,
          [email.toLowerCase(), await digest(token)],
        );
        if (!created.rowCount)
          throw new Error("Test administrator was not created");
      } finally {
        await client.end();
      }
      return `rce-session=${token}`;
    };
    it("redirects anonymous visitors and starts Google Workspace sign-in", async () => {
      const response = await fetch(`${origin}/dashboard`, {
        redirect: "manual",
      });
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toMatch(/\/login$/);
      const login = await fetch(`${origin}/login`);
      const html = await login.text();
      expect(html).toContain("Continue with Google");
      expect(html).toContain('href="/api/auth/google"');
      expect(login.headers.get("x-frame-options")).toBe("DENY");
      const google = await fetch(`${origin}/api/auth/google`, {
        redirect: "manual",
      });
      expect(google.status).toBe(302);
      expect(google.headers.get("location")).toMatch(
        /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/,
      );
      expect(google.headers.get("set-cookie")).toMatch(/httponly/i);
      expect(google.headers.get("set-cookie")).toMatch(/samesite=lax/i);
    });
    it("rejects unsigned, tampered, expired, and live Stripe webhooks before provider calls", async () => {
      const sdk = stripeSdk("sk_test_fixture");
      const secret = "whsec_httpfixture";
      const payload = JSON.stringify({
        id: "evt_http",
        type: "invoice.paid",
        livemode: false,
        data: { object: { id: "in_http" } },
      });
      const send = (body: string, signature?: string) =>
        fetch(`${origin}/api/stripe/webhook`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(signature ? { "stripe-signature": signature } : {}),
          },
          body,
        });
      expect((await send(payload)).status).toBe(400);
      const signature = sdk.webhooks.generateTestHeaderString({
        payload,
        secret,
      });
      expect((await send(payload + " ", signature)).status).toBe(400);
      expect(
        (
          await send(
            payload,
            sdk.webhooks.generateTestHeaderString({
              payload,
              secret,
              timestamp: Math.floor(Date.now() / 1000) - 3600,
            }),
          )
        ).status,
      ).toBe(400);
      const live = JSON.stringify({ ...JSON.parse(payload), livemode: true });
      expect(
        (
          await send(
            live,
            sdk.webhooks.generateTestHeaderString({ payload: live, secret }),
          )
        ).status,
      ).toBe(400);
      expect((await send("x".repeat(1024 * 1024 + 1), signature)).status).toBe(
        413,
      );
      expect(
        (
          await post(
            `/api/subscriptions/${randomUUID()}/activate`,
            new URLSearchParams({ requestKey: randomUUID(), revision: "1" }),
          )
        ).status,
      ).toBe(401);
    });
    it("rejects cross-origin sign-out and keeps password sign-in disabled", async () => {
      expect(
        (
          await post(
            "/api/auth/login",
            new URLSearchParams({ email, password }),
            undefined,
            "https://evil.example",
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await post(
            "/api/auth/logout",
            undefined,
            undefined,
            "https://evil.example",
          )
        ).status,
      ).toBe(403);
      const missing = await fetch(`${origin}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ email, password }),
      });
      expect(missing.status).toBe(404);
    });
    it("protects session cookies, cached data, and sign-out", async () => {
      const cookie = await authenticatedCookie();
      const dashboard = await fetch(`${origin}/dashboard`, {
        headers: { cookie },
      });
      expect(dashboard.status).toBe(200);
      expect(await dashboard.text()).toContain(email);
      expect(dashboard.headers.get("cache-control")).toMatch(/no-store/);
      const logout = await post("/api/auth/logout", undefined, cookie);
      expect(logout.status).toBe(303);
      expect(logout.headers.get("set-cookie")).toMatch(/max-age=0/i);
      const stale = await fetch(`${origin}/dashboard`, {
        headers: { cookie },
        redirect: "manual",
      });
      expect(stale.status).toBe(307);
    });
    it("protects customer mutations and manages encrypted credentials without disclosure", async () => {
      const profile = {
        fullName: `HTTP ${runtime} customer`,
        email: `customer-${runtime}@example.invalid`,
        billingDay: "15",
        billingTimezone: "UTC",
        countryCode: "US",
      };
      expect(
        (await post("/api/customers", new URLSearchParams(profile))).status,
      ).toBe(401);
      const cookie = await authenticatedCookie();
      expect(
        (
          await post(
            "/api/customers",
            new URLSearchParams(profile),
            cookie,
            "https://evil.example",
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await post(
            "/api/customers",
            new URLSearchParams({ ...profile, billingDay: "32" }),
            cookie,
          )
        ).status,
      ).toBe(400);
      const created = await post(
        "/api/customers",
        new URLSearchParams(profile),
        cookie,
      );
      expect(created.status).toBe(200);
      const { id } = await created.json();
      const pair = {
        revision: "1",
        accessKey: "http-fixture-access-key",
        secretKey: "http-fixture-secret-key",
      };
      const credentials = await post(
        `/api/customers/${id}/credentials`,
        new URLSearchParams(pair),
        cookie,
      );
      expect(credentials.status).toBe(200);
      const detail = await fetch(`${origin}/customers/${id}`, {
        headers: { cookie },
      });
      expect(detail.status).toBe(200);
      expect(detail.headers.get("cache-control")).toMatch(/no-store/);
      const html = await detail.text();
      expect(html).toContain("UNVERIFIED");
      expect(html).not.toContain(pair.accessKey);
      expect(html).not.toContain(pair.secretKey);
      const saved = await post(
        `/api/customers/${id}/update`,
        new URLSearchParams({
          ...profile,
          fullName: "Updated customer",
          revision: "2",
        }),
        cookie,
      );
      expect(saved.status).toBe(200);
      expect(
        (
          await post(
            `/api/customers/${id}/update`,
            new URLSearchParams({ ...profile, revision: "2" }),
            cookie,
          )
        ).status,
      ).toBe(409);
      const list = await fetch(`${origin}/customers?q=Updated`, {
        headers: { cookie },
      });
      expect(await list.text()).toContain("Updated customer");
      expect(
        (
          await post(
            `/api/customers/${id}/archive`,
            new URLSearchParams({ revision: "3" }),
            cookie,
          )
        ).status,
      ).toBe(200);
      expect(
        (await fetch(`${origin}/customers/${id}`, { headers: { cookie } }))
          .status,
      ).toBe(200);
      expect(
        (
          await post(
            `/api/customers/${id}/restore`,
            new URLSearchParams({ revision: "4" }),
            cookie,
          )
        ).status,
      ).toBe(200);
    });
    it("manages versioned plans and subscription drafts across the runtime boundary", async () => {
      const plan = {
        name: `HTTP ${runtime} plan`,
        planType: "FIXED",
        baseAmount: "12.34",
        includedMinutes: "100",
        additionalMinuteAmount: "0.01",
        includedNumbers: "1",
        numberAmount: "2.00",
        includedChannels: "1",
        channelAmount: "3.00",
      };
      expect((await post("/api/plans", new URLSearchParams(plan))).status).toBe(
        401,
      );
      const cookie = await authenticatedCookie();
      expect(
        (
          await post(
            "/api/plans",
            new URLSearchParams(plan),
            cookie,
            "https://evil.example",
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await post(
            "/api/plans",
            new URLSearchParams({ ...plan, baseAmount: "1.001" }),
            cookie,
          )
        ).status,
      ).toBe(400);
      const response = await post(
        "/api/plans",
        new URLSearchParams(plan),
        cookie,
      );
      expect(response.status).toBe(200);
      const { id: planId } = await response.json();
      const customer = await post(
        "/api/customers",
        new URLSearchParams({
          fullName: "Subscription fixture",
          email: "subscription@example.invalid",
          billingDay: "31",
          billingTimezone: "UTC",
          countryCode: "US",
        }),
        cookie,
      );
      expect(customer.status).toBe(200);
      const { id: customerId } = await customer.json();
      const page = await fetch(
        `${origin}/subscriptions/new?customerId=${customerId}`,
        { headers: { cookie } },
      );
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("11:00 UTC");
      const fixture = new Client({ connectionString: url.toString() });
      await fixture.connect();
      try {
        const versions = await fixture.query(
          "SELECT id FROM plan_price_versions WHERE plan_id=$1",
          [planId],
        );
        const planPriceVersionId = versions.rows[0].id;
        const draft = {
          creationKey: randomUUID(),
          customerId,
          planPriceVersionId,
          collectionMethod: "send_invoice",
        };
        const created = await post(
          "/api/subscriptions",
          new URLSearchParams(draft),
          cookie,
        );
        expect(created.status).toBe(200);
        const { id } = await created.json();
        const duplicate = await post(
          "/api/subscriptions",
          new URLSearchParams(draft),
          cookie,
        );
        expect(await duplicate.json()).toEqual({ id });
        expect(
          (
            await post(
              `/api/plans/${planId}/update`,
              new URLSearchParams({
                ...plan,
                baseAmount: "20.00",
                revision: "1",
              }),
              cookie,
            )
          ).status,
        ).toBe(200);
        const subscription = await fetch(`${origin}/subscriptions/${id}`, {
          headers: { cookie },
        });
        expect(subscription.status).toBe(200);
        const html = await subscription.text();
        expect(html).toContain("1234");
        expect(html).toContain("Proposed anchor");
        const next = await fixture.query(
          "SELECT id FROM plan_price_versions WHERE plan_id=$1 AND active_until IS NULL",
          [planId],
        );
        expect(
          (
            await post(
              `/api/subscriptions/${id}/update`,
              new URLSearchParams({
                revision: "1",
                planPriceVersionId: next.rows[0].id,
                collectionMethod: "charge_automatically",
              }),
              cookie,
            )
          ).status,
        ).toBe(200);
        expect(
          (
            await post(
              `/api/subscriptions/${id}/discard`,
              new URLSearchParams({ revision: "1" }),
              cookie,
            )
          ).status,
        ).toBe(409);
        expect(
          (
            await post(
              `/api/subscriptions/${id}/discard`,
              new URLSearchParams({ revision: "2" }),
              cookie,
            )
          ).status,
        ).toBe(200);
        for (const path of ["/plans", "/subscriptions", `/plans/${planId}`]) {
          const page = await fetch(`${origin}${path}`, { headers: { cookie } });
          expect(page.status).toBe(200);
          expect(page.headers.get("cache-control")).toContain("no-store");
        }
      } finally {
        await fixture.end();
      }
    });
    it("rejects an existing cookie after an administrator is disabled", async () => {
      const cookie = await authenticatedCookie();
      await manageAdministrator(url.toString(), "disable", email);
      expect(
        (
          await fetch(`${origin}/dashboard`, {
            headers: { cookie },
            redirect: "manual",
          })
        ).status,
      ).toBe(307);
    });
  },
);
