import type Stripe from "stripe";
import { TestStripe } from "../stripe/test-provider";
import { TestFlowroute } from "../flowroute/test-provider";
import { flowrouteExportService } from "../flowroute/service";
import { FlowrouteError } from "../flowroute/contracts";
import { loadFlowrouteCredentials } from "../flowroute/credentials";
import {
  discoverFlowrouteWork,
  markFlowrouteJobEnqueued,
  processFlowrouteJob,
  replayFlowrouteJob,
} from "../jobs/flowroute";
import { calculateBillingRun } from "../jobs/billing";
import { stripeService } from "../stripe/service";
import { stripeRequest, bindStripeAccount } from "../stripe/requests";
import { processStripeEvent } from "../stripe/webhooks";
import { planManagementRepository } from "./repositories/plan-management";
import { planSchema } from "../plans/validation";
import { customerManagementRepository } from "./repositories/customer-management";
import {
  credentialKeys,
  encryptCredential,
  decryptCredential,
} from "../security/credentials";
import { profileSchema } from "../customers/validation";
import { AuthenticationService } from "../auth/service";
import { hashPassword, digest, newSessionToken } from "../auth/crypto";
import { authenticationRepository } from "./repositories/authentication";
import { manageAdministrator } from "../../scripts/auth/manage-admin";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { migrateDatabase } from "../../scripts/db/migrate";
import { seedDevelopment } from "../../scripts/db/seed";
import { withDatabase } from "./client";
import * as schema from "./schema";
import {
  createBillingRunRepository,
  createCustomerRepository,
  createStripeEventRepository,
  createUsageRepository,
} from "./repositories";

const maintenanceUrl = process.env.TEST_DATABASE_URL;
if (!maintenanceUrl)
  throw new Error(
    "TEST_DATABASE_URL is required; use a disposable PostgreSQL server with CREATEDB permission",
  );
const databaseName = `rce_test_${randomUUID().replaceAll("-", "")}`;
const target = new URL(maintenanceUrl);
target.pathname = `/${databaseName}`;
const source = { connectionString: target.toString() };
const admin = new Client({ connectionString: maintenanceUrl });
const client = new Client(source);
const db = drizzle(client, { schema });
let databaseCreated = false;
const actorId = randomUUID();
const period = { periodStart: "2026-08-01", periodEnd: "2026-09-01" };
async function customer() {
  return createCustomerRepository(db).create(
    {
      fullName: "Fixture Customer",
      email: "fixture@example.invalid",
      billingDay: 15,
    },
    { appUserId: actorId },
  );
}
async function snapshot(customerId: string) {
  const usageExport = await createUsageRepository(db).ensureExport({
    customerId,
    ...period,
  });
  const [row] = await db
    .insert(schema.usageSnapshots)
    .values({
      customerId,
      usageExportId: usageExport.id,
      ...period,
      providerCostExact: "12.345678901234",
      rawPayloadHash: "a".repeat(64),
      capturedAt: new Date(),
    })
    .returning();
  return row;
}
async function expectSqlFailure(
  query: string,
  params: unknown[],
  code: string,
) {
  await expect(client.query(query, params)).rejects.toMatchObject({ code });
}

beforeAll(async () => {
  await admin.connect();
  // Identifier consists only of a fixed prefix and random hex, never user SQL.
  await admin.query(`CREATE DATABASE ${databaseName}`);
  databaseCreated = true;
  await Promise.all([
    migrateDatabase(source.connectionString),
    migrateDatabase(source.connectionString),
  ]);
  await client.connect();
  await db
    .insert(schema.appUsers)
    .values({ id: actorId, email: "admin@example.invalid" });
});
afterAll(async () => {
  await client.end();
  if (databaseCreated)
    await admin.query(`DROP DATABASE ${databaseName} WITH (FORCE)`);
  await admin.end();
});

describe("PostgreSQL foundation", () => {
  it("builds all core tables and reapplying migrations is a no-op", async () => {
    await migrateDatabase(source.connectionString);
    const result = await client.query(
      "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",
    );
    expect(result.rows[0].count).toBe(21);
  });
  it("seeds synthetic fixtures idempotently without active billing or provider credentials", async () => {
    await seedDevelopment(source.connectionString);
    await seedDevelopment(source.connectionString);
    const result = await client.query(
      "SELECT count(*)::int AS count FROM plans WHERE name LIKE 'Example %' AND active=false",
    );
    expect(result.rows[0].count).toBe(4);
    expect(
      (
        await client.query(
          "SELECT count(*)::int AS count FROM customer_provider_credentials",
        )
      ).rows[0].count,
    ).toBe(0);
  });
  it("enforces billing days, real timezones, case-insensitive admin identities, and foreign keys", async () => {
    await expectSqlFailure(
      "INSERT INTO customers(full_name,email,billing_day) VALUES ('Test','test@example.invalid',32)",
      [],
      "23514",
    );
    await expectSqlFailure(
      "INSERT INTO customers(full_name,email,billing_day,billing_timezone) VALUES ('Test','test@example.invalid',1,'Mars/Olympus')",
      [],
      "23514",
    );
    await expectSqlFailure(
      "INSERT INTO app_users(email) VALUES ('ADMIN@example.invalid')",
      [],
      "23505",
    );
    await expectSqlFailure(
      "INSERT INTO usage_exports(customer_id,period_start,period_end) VALUES ($1,'2026-08-01','2026-09-01')",
      [randomUUID()],
      "23503",
    );
  });
  it("creates a customer and audit together and validates page bounds", async () => {
    const row = await customer();
    const audit = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.entityId, row.id));
    expect(audit).toHaveLength(1);
    expect(audit[0].actorId).toBe(actorId);
    const repo = createCustomerRepository(db);
    expect(await repo.findById(row.id)).toMatchObject({
      paymentStatus: "CURRENT",
      status: "DRAFT",
    });
    const first = await repo.list({ limit: 1 });
    const second = await repo.list({ limit: 1, afterId: first[0].id });
    expect(first[0].id).not.toBe(second[0].id);
    await expect(repo.list({ limit: 101 })).rejects.toThrow("Page size");
    await expect(
      repo.create(
        {
          fullName: "Rejected",
          email: "rejected@example.invalid",
          billingDay: 1,
        },
        { appUserId: randomUUID() },
      ),
    ).rejects.toThrow("active administrator");
    expect(
      (
        await client.query(
          "SELECT count(*)::int AS count FROM customers WHERE email='rejected@example.invalid'",
        )
      ).rows[0].count,
    ).toBe(0);
  });
  it("reserves one run under concurrent retries, even when subscription is null and formulas differ", async () => {
    const c = await customer();
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        withDatabase(source, (tx) =>
          createBillingRunRepository(tx).ensure({
            customerId: c.id,
            ...period,
            formulaVersion: `legacy-${i}`,
            triggerType: "SCHEDULED",
          }),
        ),
      ),
    );
    expect(new Set(results.map((r) => r.run.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.run.formulaVersion)).size).toBe(1);
    await expect(
      createBillingRunRepository(db).ensure({
        customerId: c.id,
        ...period,
        formulaVersion: "v2",
        triggerType: "MANUAL",
      }),
    ).rejects.toThrow("administrator");
    const manual = await createBillingRunRepository(db).ensure(
      {
        customerId: c.id,
        ...period,
        formulaVersion: "v2",
        triggerType: "MANUAL",
      },
      { appUserId: actorId },
    );
    expect(manual.created).toBe(false);
  });
  it("accepts only whole calendar months for billing and holds uncalculated invoices", async () => {
    const c = await customer();
    await expectSqlFailure(
      "INSERT INTO billing_runs(customer_id,period_start,period_end,formula_version,trigger_type) VALUES ($1,'2026-08-15','2026-09-15','v1','SCHEDULED')",
      [c.id],
      "23514",
    );
    const { run } = await createBillingRunRepository(db).ensure({
      customerId: c.id,
      ...period,
      formulaVersion: "v1",
      triggerType: "SCHEDULED",
    });
    await expectSqlFailure(
      "UPDATE billing_runs SET status='SYNCING_STRIPE' WHERE id=$1",
      [run.id],
      "23514",
    );
  });
  it("deduplicates usage exports and retains exact fractional provider costs", async () => {
    const c = await customer();
    const rows = await Promise.all(
      Array.from({ length: 4 }, () =>
        withDatabase(source, (tx) =>
          createUsageRepository(tx).ensureExport({
            customerId: c.id,
            ...period,
          }),
        ),
      ),
    );
    expect(new Set(rows.map((r) => r.id)).size).toBe(1);
    const s = await snapshot(c.id);
    expect(s.providerCostExact).toBe("12.345678901234");
    expect(
      (
        await createUsageRepository(db).findSnapshot({
          customerId: c.id,
          ...period,
        })
      )?.id,
    ).toBe(s.id);
    expect(
      await createUsageRepository(db).findSnapshot({
        customerId: c.id,
        periodStart: "2026-07-01",
        periodEnd: "2026-08-01",
      }),
    ).toBeNull();
    await expectSqlFailure(
      "UPDATE usage_snapshots SET provider_cost_exact=99 WHERE id=$1",
      [s.id],
      "23514",
    );
    await expectSqlFailure(
      "DELETE FROM usage_snapshots WHERE id=$1",
      [s.id],
      "23514",
    );
  });
  it("rejects usage and subscription links belonging to another customer", async () => {
    const c = await customer();
    const other = await customer();
    const s = await snapshot(other.id);
    const { run } = await createBillingRunRepository(db).ensure({
      customerId: c.id,
      ...period,
      formulaVersion: "v1",
      triggerType: "SCHEDULED",
    });
    await expectSqlFailure(
      "UPDATE billing_runs SET usage_snapshot_id=$1 WHERE id=$2",
      [s.id, run.id],
      "23503",
    );
    await expectSqlFailure(
      "INSERT INTO usage_snapshots(customer_id,usage_export_id,period_start,period_end,provider_cost_minor,raw_payload_hash,captured_at) VALUES ($1,$2,'2026-08-01','2026-09-01',100,$3,now())",
      [c.id, s.usageExportId, "b".repeat(64)],
      "23503",
    );
    const [sub] = await db
      .insert(schema.subscriptions)
      .values({
        customerId: other.id,
        planPriceVersionId: "00000000-0000-4000-8000-000000000020",
        billingDay: 15,
      })
      .returning();
    const third = await customer();
    await expectSqlFailure(
      "INSERT INTO billing_runs(customer_id,subscription_id,plan_price_version_id,period_start,period_end,formula_version,trigger_type) VALUES ($1,$2,$3,'2026-08-01','2026-09-01','v1','SCHEDULED')",
      [third.id, sub.id, sub.planPriceVersionId],
      "23503",
    );
  });
  it("seals original calculations, retains bigint precision and stores adjustments separately", async () => {
    const c = await customer();
    const s = await snapshot(c.id);
    const { run } = await createBillingRunRepository(db).ensure({
      customerId: c.id,
      ...period,
      formulaVersion: "v1",
      triggerType: "SCHEDULED",
    });
    const amount = 9007199254740993n;
    const [line] = await db
      .insert(schema.billingLineItems)
      .values({
        billingRunId: run.id,
        code: "USAGE",
        description: "Fixture",
        quantity: "1",
        unitAmountMinor: amount,
        amountMinor: amount,
        calculationMetadata: {},
      })
      .returning();
    expect(line.amountMinor).toBe(amount);
    await expectSqlFailure(
      "UPDATE billing_runs SET calculation_snapshot='{}',subtotal_minor=1,usage_snapshot_id=$1 WHERE id=$2",
      [s.id, run.id],
      "23514",
    );
    await db
      .update(schema.billingRuns)
      .set({
        usageSnapshotId: s.id,
        calculationSnapshot: { fixture: true },
        subtotalMinor: amount,
        status: "CALCULATED",
      })
      .where(eq(schema.billingRuns.id, run.id));
    await expectSqlFailure(
      "UPDATE billing_runs SET subtotal_minor=0 WHERE id=$1",
      [run.id],
      "23514",
    );
    await expectSqlFailure(
      "UPDATE billing_line_items SET amount_minor=0 WHERE id=$1",
      [line.id],
      "23514",
    );
    await expectSqlFailure(
      "INSERT INTO billing_line_items(billing_run_id,code,description,quantity,unit_amount_minor,amount_minor,calculation_metadata) VALUES ($1,'EXTRA','Late',1,1,1,'{}')",
      [run.id],
      "23514",
    );
    await db.insert(schema.billingRunAdjustments).values({
      billingRunId: run.id,
      amountMinor: -100n,
      reason: "Fixture correction",
      createdByAppUserId: actorId,
    });
    const [original] = await db
      .select()
      .from(schema.billingRuns)
      .where(eq(schema.billingRuns.id, run.id));
    expect(original.subtotalMinor).toBe(amount);
    await expectSqlFailure(
      "UPDATE billing_run_adjustments SET reason='Changed' WHERE billing_run_id=$1",
      [run.id],
      "23514",
    );
    await db
      .update(schema.billingRuns)
      .set({ status: "COMPLETED", completedAt: new Date() })
      .where(eq(schema.billingRuns.id, run.id));
    expect(
      (
        await createBillingRunRepository(db).ensure(
          {
            customerId: c.id,
            ...period,
            formulaVersion: "new-formula",
            triggerType: "MANUAL",
          },
          { appUserId: actorId },
        )
      ).created,
    ).toBe(false);
  });
  it("preserves price economics, audit history, and active service on past due accounts", async () => {
    await expectSqlFailure(
      "UPDATE plan_price_versions SET pricing_configuration='{}' WHERE id=$1",
      ["00000000-0000-4000-8000-000000000020"],
      "23514",
    );
    const c = await customer();
    await db
      .update(schema.customers)
      .set({ status: "ACTIVE", paymentStatus: "PAST_DUE" })
      .where(eq(schema.customers.id, c.id));
    expect(await createCustomerRepository(db).findById(c.id)).toMatchObject({
      status: "ACTIVE",
      paymentStatus: "PAST_DUE",
    });
    await expectSqlFailure(
      "DELETE FROM audit_events WHERE entity_id=$1",
      [c.id],
      "23514",
    );
    await expectSqlFailure("TRUNCATE audit_events", [], "23514");
  });
  it("deduplicates webhook delivery without losing pending processing state", async () => {
    const input = {
      stripeEventId: `evt_${randomUUID()}`,
      eventType: "invoice.paid",
      livemode: false,
      payload: { fixture: true },
    };
    const rows = await Promise.all(
      Array.from({ length: 4 }, () =>
        withDatabase(source, (tx) =>
          createStripeEventRepository(tx).record(input),
        ),
      ),
    );
    expect(new Set(rows.map((r) => r.id)).size).toBe(1);
    expect(rows.filter((r) => r.inserted)).toHaveLength(1);
    expect(rows.every((r) => r.processingStatus === "PENDING")).toBe(true);
  });
});

it("runs the real repositories in workerd through a local Hyperdrive binding", async () => {
  const worker = spawn(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "dev",
      "--config",
      "wrangler.db-test.jsonc",
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      "8794",
      "--inspector-port",
      "0",
    ],
    {
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: "false",
        CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE:
          source.connectionString,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  // Capture readiness, but never print logs that could contain connection bindings.
  let ready = false;
  worker.stdout.on("data", (chunk) => {
    if (String(chunk).includes("Ready on")) ready = true;
  });
  worker.stderr.resume();
  try {
    const deadline = Date.now() + 20_000;
    while (!ready && worker.exitCode === null && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 100));
    if (!ready) throw new Error("Local database Worker did not start");
    const response = await fetch("http://127.0.0.1:8794/", {
      signal: AbortSignal.timeout(10_000),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", activePlanCount: 0 });
    const email = `worker-${randomUUID()}@example.invalid`;
    const password = "worker-password-fixture-only";
    await db
      .insert(schema.appUsers)
      .values({ email, passwordHash: await hashPassword(password) });
    const login = await fetch("http://127.0.0.1:8794/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(10_000),
    });
    expect(await login.json()).toEqual({ authenticated: true });
  } finally {
    if (worker.exitCode === null) {
      const exited = once(worker, "exit");
      worker.kill("SIGTERM");
      await exited;
    }
  }
}, 40_000);

describe("administrator authentication", () => {
  const password = "fixture-admin-password-only";
  let passwordHash: string;
  beforeAll(async () => {
    passwordHash = await hashPassword(password);
  });
  async function identity() {
    const email = `auth-${randomUUID()}@example.invalid`;
    const [user] = await db
      .insert(schema.appUsers)
      .values({ email, passwordHash })
      .returning();
    return user;
  }
  const service = () => new AuthenticationService(authenticationRepository(db));
  it("creates hashed sessions, rotates existing sessions and revokes on logout", async () => {
    const user = await identity();
    const token = await service().login(user.email, password);
    expect(token).toBeTruthy();
    expect(await service().administrator(token!)).toEqual({
      id: user.id,
      email: user.email,
      role: "ADMIN",
    });
    const [stored] = await db
      .select()
      .from(schema.appSessions)
      .where(eq(schema.appSessions.appUserId, user.id));
    expect(stored.tokenHash).toBe(await digest(token!));
    expect(stored.tokenHash).not.toBe(token);
    const second = await service().login(user.email, password, token!);
    expect(second).not.toBe(token);
    expect(await service().administrator(token!)).toBeNull();
    await service().logout(second!);
    expect(await service().administrator(second!)).toBeNull();
  });
  it("rejects invalid credentials and unknown accounts without issuing sessions", async () => {
    const user = await identity();
    expect(await service().login(user.email, "wrong-password")).toBeNull();
    expect(
      await service().login(
        `missing-${randomUUID()}@example.invalid`,
        password,
      ),
    ).toBeNull();
    expect(await service().administrator(newSessionToken())).toBeNull();
    expect(await service().administrator("malformed")).toBeNull();
  });
  it("expires sessions and immediately revokes them when accounts are disabled", async () => {
    const user = await identity();
    const token = await service().login(user.email, password);
    await client.query(
      "UPDATE app_sessions SET created_at=now()-interval '10 hours',expires_at=now()-interval '1 hour' WHERE app_user_id=$1",
      [user.id],
    );
    expect(await service().administrator(token!)).toBeNull();
    const second = await service().login(user.email, password);
    await db
      .update(schema.appUsers)
      .set({ status: "DISABLED" })
      .where(eq(schema.appUsers.id, user.id));
    expect(await service().administrator(second!)).toBeNull();
    expect(await service().login(user.email, password)).toBeNull();
  });
  it("enforces attempt limits atomically across connections", async () => {
    const key = await digest(randomUUID());
    const attempts = await Promise.all(
      Array.from({ length: 10 }, () =>
        withDatabase(source, (tx) =>
          authenticationRepository(tx).consumeAttempt(key, 5, 900),
        ),
      ),
    );
    expect(attempts.filter(Boolean)).toHaveLength(5);
    await client.query(
      "UPDATE auth_rate_limits SET expires_at=now()-interval '1 second' WHERE key=$1",
      [key],
    );
    expect(await authenticationRepository(db).consumeAttempt(key, 5, 900)).toBe(
      true,
    );
  });
  it("provisions explicitly, resets passwords without reactivating disabled accounts, and rejects stale verification", async () => {
    const email = `cli-${randomUUID()}@example.invalid`;
    await manageAdministrator(
      source.connectionString,
      "create",
      email,
      password,
    );
    const token = await service().login(email, password);
    const identity = await authenticationRepository(db).findIdentity(email);
    await manageAdministrator(
      source.connectionString,
      "reset",
      email,
      "a replacement test password",
    );
    expect(await service().administrator(token!)).toBeNull();
    expect(
      await authenticationRepository(db).createSession(
        identity!.id,
        identity!.passwordHash!,
        await digest(newSessionToken()),
        28800,
      ),
    ).toBe(false);
    await manageAdministrator(source.connectionString, "disable", email);
    await manageAdministrator(
      source.connectionString,
      "reset",
      email,
      password,
    );
    expect(await service().login(email, password)).toBeNull();
  });
});

describe("customer management", () => {
  const input = profileSchema.parse({
    fullName: "Customer fixture",
    email: "manage@example.invalid",
    billingDay: 15,
    billingTimezone: "UTC",
  });
  const actor = { appUserId: actorId };
  const repo = () => customerManagementRepository(db);
  const keys = credentialKeys({
    FLOWROUTE_ENCRYPTION_KEY_VERSION: "test1",
    FLOWROUTE_ENCRYPTION_KEYS: JSON.stringify({
      test1: btoa(String.fromCharCode(...new Uint8Array(32).fill(3))),
    }),
  });
  it("audits edits, rejects stale revisions and paginates literal search results", async () => {
    const c = await repo().create(
      { ...input, fullName: "Literal% match" },
      actor,
    );
    const updated = await repo().update(
      c.id,
      c.revision,
      { ...input, fullName: "Literal% changed" },
      actor,
    );
    expect(updated.revision).toBe(c.revision + 1);
    await expect(
      repo().update(c.id, c.revision, input, actor),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const found = await repo().list({ q: "%" });
    expect(found.items.map((c) => c.id)).toContain(c.id);
    expect(found.items.every((c) => c.fullName.includes("%"))).toBe(true);
    const first = await repo().list({ limit: 1 });
    expect(first.next).toBeTruthy();
    const second = await repo().list({ limit: 1, after: first.next! });
    expect(second.items[0].id).not.toBe(first.items[0].id);
    const detail = await repo().detail(c.id);
    expect(
      detail!.history.some((event) => event.action === "customer.updated"),
    ).toBe(true);
  });
  it("stores authenticated ciphertext, excludes it from reads/audits, disables and archives safely", async () => {
    const c = await repo().create(input, actor);
    const accessKeyEncrypted = await encryptCredential(
      "fixture-access",
      "" + c.id,
      "accessKey",
      keys,
    );
    const secretKeyEncrypted = await encryptCredential(
      "fixture-secret",
      c.id,
      "secretKey",
      keys,
    );
    await repo().saveCredentials(
      c.id,
      c.revision,
      {
        accessKeyEncrypted,
        secretKeyEncrypted,
        encryptionKeyVersion: keys.currentVersion,
      },
      actor,
    );
    const [stored] = await db
      .select()
      .from(schema.customerProviderCredentials)
      .where(eq(schema.customerProviderCredentials.customerId, c.id));
    expect(stored.status).toBe("UNVERIFIED");
    expect(
      await decryptCredential(
        stored.secretKeyEncrypted,
        c.id,
        "secretKey",
        stored.encryptionKeyVersion,
        keys,
      ),
    ).toBe("fixture-secret");
    const detail = await repo().detail(c.id);
    const safe = JSON.stringify(detail);
    expect(safe).not.toContain("fixture-secret");
    expect(safe).not.toContain(secretKeyEncrypted);
    expect(safe).not.toContain(accessKeyEncrypted);
    await repo().revokeCredentials(c.id, detail!.customer.revision, actor);
    const revoked = await repo().detail(c.id);
    expect(revoked!.credentials!.status).toBe("REVOKED");
    await repo().archive(c.id, revoked!.customer.revision, actor);
    const archived = await repo().detail(c.id);
    expect(archived!.customer.status).toBe("ARCHIVED");
    await expect(
      createBillingRunRepository(db).ensure({
        customerId: c.id,
        ...period,
        formulaVersion: "v1",
        triggerType: "SCHEDULED",
      }),
    ).rejects.toThrow();

    await expect(
      repo().update(c.id, archived!.customer.revision, input, actor),
    ).rejects.toMatchObject({ code: "ARCHIVED" });
    await repo().restore(c.id, archived!.customer.revision, actor);
    expect((await repo().detail(c.id))!.customer.status).toBe("DRAFT");
    expect((await repo().detail(c.id))!.credentials!.status).toBe("REVOKED");
  });
  it("blocks archive and billing-date changes for linked subscriptions and unresolved billing", async () => {
    const c = await repo().create(input, actor);
    await db.insert(schema.subscriptions).values({
      customerId: c.id,
      planPriceVersionId: "00000000-0000-4000-8000-000000000020",
      billingDay: 15,
      status: "ACTIVE",
    });
    await expect(repo().archive(c.id, c.revision, actor)).rejects.toMatchObject(
      { code: "LINKED_BILLING" },
    );
    await expect(
      repo().update(c.id, c.revision, { ...input, billingDay: 16 }, actor),
    ).rejects.toMatchObject({ code: "LINKED_BILLING" });
    const other = await repo().create(input, actor);
    await createBillingRunRepository(db).ensure({
      customerId: other.id,
      ...period,
      formulaVersion: "v1",
      triggerType: "SCHEDULED",
    });
    await expect(
      repo().archive(other.id, other.revision, actor),
    ).rejects.toMatchObject({ code: "LINKED_BILLING" });
  });
  it("permits only one concurrent edit and rejects disabled administrators", async () => {
    const c = await repo().create(input, actor);
    const edits = await Promise.allSettled(
      ["One", "Two"].map((fullName) =>
        withDatabase(source, (db) =>
          customerManagementRepository(db).update(
            c.id,
            c.revision,
            { ...input, fullName },
            actor,
          ),
        ),
      ),
    );
    expect(
      edits.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const [disabled] = await db
      .insert(schema.appUsers)
      .values({
        email: `disabled-${randomUUID()}@example.invalid`,
        status: "DISABLED",
      })
      .returning();
    await expect(
      repo().create(input, { appUserId: disabled.id }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("plan versions and subscription drafts", () => {
  const actor = { appUserId: actorId };
  const input = planSchema.parse({
    name: "Exact plan",
    planType: "FIXED",
    baseAmount: "12.34",
    includedMinutes: "10.123456789012",
    additionalMinuteAmount: "0.01",
    includedNumbers: 1,
    numberAmount: "2.00",
    includedChannels: 2,
    channelAmount: "3.00",
  });
  async function fixture() {
    const repo = planManagementRepository(db);
    const p = await repo.createPlan(input, actor);
    const detail = (await repo.planDetail(p.id))!;
    const c = await customer();
    return {
      repo,
      p,
      detail,
      c,
      args: {
        creationKey: randomUUID(),
        customerId: c.id,
        planPriceVersionId: detail.versions[0].id,
        collectionMethod: "send_invoice" as const,
      },
    };
  }
  it("preserves assigned pricing when the catalog changes and records audits", async () => {
    const { repo, p, detail, args } = await fixture();
    const draft = await repo.createDraft(args, actor);
    await repo.updatePlan(
      p.id,
      detail.plan.revision,
      { ...input, baseAmount: "20.00" },
      actor,
    );
    const updated = (await repo.planDetail(p.id))!;
    expect(updated.versions).toHaveLength(2);
    expect(updated.versions[0].configuration.baseAmountMinor).toBe("2000");
    expect(updated.versions[1].configuration.baseAmountMinor).toBe("1234");
    expect(updated.versions[1].activeUntil).not.toBeNull();
    expect((await repo.subscriptionDetail(draft.id))!.priceVersionId).toBe(
      args.planPriceVersionId,
    );
    await expect(repo.updatePlan(p.id, 1, input, actor)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(
      repo.createDraft({ ...args, creationKey: randomUUID() }, actor),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.entityId, p.id));
    expect(events.map((e) => e.action)).toEqual([
      "plan.created",
      "plan.price_version_created",
    ]);
  });
  it("deduplicates concurrent creation and persists the confirmed anchor policy", async () => {
    const { args, c } = await fixture();
    await db
      .update(schema.customers)
      .set({ billingDay: 31 })
      .where(eq(schema.customers.id, c.id));
    const results = await Promise.all(
      [1, 2].map(() =>
        withDatabase(source, (d) =>
          planManagementRepository(d).createDraft(args, actor),
        ),
      ),
    );
    expect(results[0].id).toBe(results[1].id);
    const [s] = await db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.id, results[0].id));
    expect(s.billingDay).toBe(31);
    expect(s.proposedBillingAnchor!.getUTCHours()).toBe(11);
    expect(s.billingPolicyVersion).toBe("monthly-last-day-1100utc-v1");
    expect(s.stripeSubscriptionId).toBeNull();
    expect(s.currentPeriodStart).toBeNull();
  });
  it("serializes competing edits and rejects inactive plans and archived customers", async () => {
    const { repo, p, detail, args, c } = await fixture();
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        withDatabase(source, (d) =>
          planManagementRepository(d).updatePlan(
            p.id,
            detail.plan.revision,
            input,
            actor,
          ),
        ),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const current = (await repo.planDetail(p.id))!;
    await repo.setPlanActive(p.id, current.plan.revision, false, actor);
    await expect(
      repo.createDraft(
        { ...args, planPriceVersionId: current.versions[0].id },
        actor,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await db
      .update(schema.customers)
      .set({ status: "ARCHIVED" })
      .where(eq(schema.customers.id, c.id));
    await expect(repo.createDraft(args, actor)).rejects.toMatchObject({
      code: "ARCHIVED",
    });
  });
  it("allows audited draft updates and discard but never local live changes", async () => {
    const { repo, args } = await fixture();
    const draft = await repo.createDraft(args, actor);
    await repo.updateDraft(
      draft.id,
      1,
      { ...args, collectionMethod: "charge_automatically" },
      actor,
    );
    await expect(repo.discardDraft(draft.id, 1, actor)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await repo.discardDraft(draft.id, 2, actor);
    expect((await repo.subscriptionDetail(draft.id))!.status).toBe("CANCELED");
    const live = await repo.createDraft(
      { ...args, creationKey: randomUUID() },
      actor,
    );
    await db
      .update(schema.subscriptions)
      .set({ status: "ACTIVE", stripeSubscriptionId: `sub_${randomUUID()}` })
      .where(eq(schema.subscriptions.id, live.id));
    await expect(
      repo.updateDraft(live.id, 2, args, actor),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(repo.discardDraft(live.id, 2, actor)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});

describe("durable Stripe sandbox workflows", () => {
  const actor = { appUserId: actorId };
  async function fixture() {
    const provider = new TestStripe();
    const repo = planManagementRepository(db);
    const p = await repo.createPlan(
      planSchema.parse({
        name: "Stripe test plan",
        planType: "FIXED",
        baseAmount: "12.34",
        includedMinutes: "0",
        additionalMinuteAmount: "0",
        includedNumbers: 0,
        numberAmount: "0",
        includedChannels: 0,
        channelAmount: "0",
      }),
      actor,
    );
    const price = (await repo.planDetail(p.id))!.versions[0];
    const c = await customer();
    const draft = await repo.createDraft(
      {
        creationKey: randomUUID(),
        customerId: c.id,
        planPriceVersionId: price.id,
        collectionMethod: "send_invoice",
      },
      actor,
    );
    return {
      provider,
      repo,
      p,
      price,
      c,
      draft,
      service: stripeService(db, provider),
      command: { requestKey: randomUUID(), revision: 1, daysUntilDue: 30 },
    };
  }
  function event(
    type: string,
    object: Record<string, unknown>,
    id = `evt_${randomUUID()}`,
  ) {
    return {
      id,
      type,
      livemode: false,
      data: { object },
    } as unknown as Stripe.Event;
  }
  it("activates once and maps exact pricing/calendar policy after a lost Stripe response", async () => {
    const f = await fixture();
    f.provider.failAfter = "subscription";
    await expect(
      f.service.start(f.draft.id, "activate", f.command, actor),
    ).rejects.toMatchObject({ code: "RETRY" });
    const pending = (await f.repo.subscriptionDetail(f.draft.id))!;
    expect(pending.pendingStripeWorkflowId).toBeTruthy();
    await expect(
      f.repo.discardDraft(f.draft.id, pending.revision, actor),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await f.service.retry(f.draft.id, pending.pendingStripeWorkflowId!, actor);
    await f.service.start(f.draft.id, "activate", f.command, actor);
    const saved = (await f.repo.subscriptionDetail(f.draft.id))!;
    expect(saved.status).toBe("ACTIVE");
    expect(saved.pendingStripeWorkflowId).toBeNull();
    expect(
      f.provider.writes.filter((w) => w.kind === "subscription"),
    ).toHaveLength(1);
    const request = f.provider.writes.find(
      (w) => w.kind === "subscription",
    )!.input;
    expect(request.billing_cycle_anchor_config).toEqual({
      day_of_month: 15,
      hour: 11,
      minute: 0,
      second: 0,
    });
    expect(request.days_until_due).toBe(30);
    expect(request.proration_behavior).toBe("create_prorations");
    expect(
      f.provider.writes.find((w) => w.kind === "price")!.input.unit_amount,
    ).toBe(1234);
  });
  it("applies a new price with Stripe proration, schedules cancellation, and keeps old snapshots", async () => {
    const f = await fixture();
    await f.service.start(f.draft.id, "activate", f.command, actor);
    const first = (await f.repo.subscriptionDetail(f.draft.id))!;
    const detail = (await f.repo.planDetail(f.p.id))!;
    const { id: _id, revision, active: _active, ...input } = detail.plan;
    void _id;
    void _active;
    await f.repo.updatePlan(
      f.p.id,
      revision,
      { ...input, baseAmount: "20.00" },
      actor,
    );
    const version = (await f.repo.planDetail(f.p.id))!.versions[0];
    await f.service.start(
      f.draft.id,
      "change",
      {
        requestKey: randomUUID(),
        revision: first.revision,
        planPriceVersionId: version.id,
      },
      actor,
    );
    const changed = (await f.repo.subscriptionDetail(f.draft.id))!;
    expect(changed.priceVersionId).toBe(version.id);
    expect(
      f.provider.writes.find((w) => w.kind === "change")!.input
        .proration_behavior,
    ).toBe("create_prorations");
    expect(
      (await f.repo.planDetail(f.p.id))!.versions[1].configuration
        .baseAmountMinor,
    ).toBe("1234");
    await f.service.start(
      f.draft.id,
      "cancel",
      { requestKey: randomUUID(), revision: changed.revision },
      actor,
    );
    const canceled = (await f.repo.subscriptionDetail(f.draft.id))!;
    expect(canceled.status).toBe("ACTIVE");
    expect(canceled.cancelAtPeriodEnd).toBe(true);
    const state = f.provider.states.get(canceled.stripeSubscriptionId!)!;
    state.status = "canceled";
    state.canceledAt = state.periodEnd;
    await processStripeEvent(
      db,
      f.provider,
      event("customer.subscription.deleted", { id: state.id }),
    );
    expect((await f.repo.subscriptionDetail(f.draft.id))!.status).toBe(
      "CANCELED",
    );
  });
  it("deduplicates webhooks and retrieves current state for old event payloads", async () => {
    const f = await fixture();
    await f.service.start(f.draft.id, "activate", f.command, actor);
    const s = (await f.repo.subscriptionDetail(f.draft.id))!;
    const state = f.provider.states.get(s.stripeSubscriptionId!)!;
    state.status = "past_due";
    const e = event("customer.subscription.updated", {
      id: state.id,
      status: "active",
    });
    await processStripeEvent(db, f.provider, e);
    await processStripeEvent(db, f.provider, e);
    expect((await f.repo.subscriptionDetail(f.draft.id))!.status).toBe(
      "PAST_DUE",
    );
    const [customerRow] = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, f.c.id));
    expect(customerRow.status).toBe("ACTIVE");
    expect(customerRow.paymentStatus).toBe("PAST_DUE");
    const audits = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.actorId, e.id));
    expect(audits).toHaveLength(1);
    state.status = "active";
    await processStripeEvent(
      db,
      f.provider,
      event("customer.subscription.updated", {
        id: state.id,
        status: "past_due",
      }),
    );
    expect((await f.repo.subscriptionDetail(f.draft.id))!.status).toBe(
      "ACTIVE",
    );
  });
  it("holds draft invoices and does not clear another invoice's delinquency on payment", async () => {
    const f = await fixture();
    await f.service.start(f.draft.id, "activate", f.command, actor);
    const s = (await f.repo.subscriptionDetail(f.draft.id))!;
    const state = f.provider.states.get(s.stripeSubscriptionId!)!;
    const invoice = (id: string) => ({
      id,
      customerId: state.customerId,
      subscriptionId: state.id,
      status: "draft",
      attemptCount: 0,
      collectionMethod: "send_invoice",
      currency: "USD",
      total: 1234,
      amountPaid: 0,
      amountDue: 1234,
      amountRemaining: 1234,
      dueDate: null,
      paidAt: null,
      createdAt: 1789988400,
      autoAdvance: true,
    });
    const one = invoice(`in_${randomUUID()}`);
    f.provider.invoices.set(one.id, one);
    const payload = (id: string) => ({
      id,
      parent: { subscription_details: { subscription: state.id } },
    });
    await processStripeEvent(
      db,
      f.provider,
      event("invoice.created", payload(one.id)),
    );
    expect(one.autoAdvance).toBe(false);
    one.status = "open";
    one.attemptCount = 1;
    await processStripeEvent(
      db,
      f.provider,
      event("invoice.payment_failed", payload(one.id)),
    );
    const two = invoice(`in_${randomUUID()}`);
    two.status = "paid";
    two.amountRemaining = 0;
    f.provider.invoices.set(two.id, two);
    await processStripeEvent(
      db,
      f.provider,
      event("invoice.paid", payload(two.id)),
    );
    let [c] = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, f.c.id));
    expect(c.paymentStatus).toBe("PAST_DUE");
    expect(c.status).toBe("ACTIVE");
    one.status = "paid";
    one.amountRemaining = 0;
    await processStripeEvent(
      db,
      f.provider,
      event("invoice.paid", payload(one.id)),
    );
    [c] = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, f.c.id));
    expect(c.paymentStatus).toBe("CURRENT");
  });
  it("stops uncertain writes after the provider retry window and prevents account mixing", async () => {
    const provider = new TestStripe();
    const key = `expired:${randomUUID()}`;
    await db.insert(schema.stripeRequests).values({
      operationKey: key,
      kind: "customer",
      input: { name: "Original" },
      firstAttemptAt: new Date(Date.now() - 24 * 3600 * 1000),
    });
    await expect(
      stripeRequest(db, provider, key, "customer", { name: "Changed" }),
    ).rejects.toMatchObject({ code: "NEEDS_REVIEW" });
    expect(provider.writes).toHaveLength(0);
    provider.accountId = "acct_other";
    await expect(bindStripeAccount(db, provider)).rejects.toMatchObject({
      code: "NEEDS_REVIEW",
    });
  });
  it("rejects conflicting commands, missing due terms, and unauthorized actors before writes", async () => {
    const f = await fixture();
    await expect(
      f.service.start(
        f.draft.id,
        "activate",
        { requestKey: randomUUID(), revision: 1 },
        actor,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      f.service.start(f.draft.id, "activate", f.command, {
        appUserId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(f.provider.writes).toHaveLength(0);
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        withDatabase(source, (d) =>
          stripeService(d, f.provider).start(
            f.draft.id,
            "activate",
            { ...f.command, requestKey: randomUUID() },
            actor,
          ),
        ),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      f.provider.writes.filter((w) => w.kind === "subscription"),
    ).toHaveLength(1);
  });
});

describe("durable Flowroute usage exports", () => {
  const fixtureCredentials = {
    accessKey: "flowroute-access-fixture",
    secretKey: "flowroute-secret-fixture",
  };

  async function fixture() {
    const c = await customer();
    const exportRecord = await createUsageRepository(db).ensureExport({
      customerId: c.id,
      periodStart: "2026-08-01",
      periodEnd: "2026-09-01",
    });
    const provider = new TestFlowroute();
    let current = new Date("2026-09-02T00:00:00.000Z");
    const service = flowrouteExportService(db, provider, {
      now: () => current,
      loadCredentials: async () => ({
        credentials: fixtureCredentials,
        status: "UNVERIFIED",
      }),
    });
    return {
      c,
      exportRecord,
      provider,
      service,
      advance(seconds: number) {
        current = new Date(current.getTime() + seconds * 1000);
      },
    };
  }

  it("creates one export, polls outside locks, and seals a sanitized immutable snapshot", async () => {
    const f = await fixture();
    await expect(f.service.process(f.exportRecord.id)).resolves.toMatchObject({
      status: "PROCESSING",
    });
    expect(f.provider.created).toBe(1);
    const [requested] = await db
      .select()
      .from(schema.usageExports)
      .where(eq(schema.usageExports.id, f.exportRecord.id));
    expect(requested).toMatchObject({
      status: "REQUESTED",
      providerExportId: "9001",
      processingToken: null,
    });
    expect(f.provider.credentials).toEqual([fixtureCredentials]);
    await expect(f.service.process(f.exportRecord.id)).rejects.toMatchObject({
      code: "BUSY",
    });
    f.advance(61);
    f.provider.next = {
      id: "9001",
      status: "completed",
      totalCost: "12.345678901234",
      billedMinutes: "17",
      raw: {
        id: "9001",
        status: "completed",
        totalCost: "12.345678901234",
        billedMinutes: "17",
        download_url: "https://temporary.example/credential-bearing-url",
      },
    };
    await expect(f.service.process(f.exportRecord.id)).resolves.toMatchObject({
      status: "COMPLETED",
    });
    const [completed] = await db
      .select()
      .from(schema.usageExports)
      .where(eq(schema.usageExports.id, f.exportRecord.id));
    expect(completed.status).toBe("COMPLETED");
    const [snapshot] = await db
      .select()
      .from(schema.usageSnapshots)
      .where(eq(schema.usageSnapshots.usageExportId, f.exportRecord.id));
    expect(snapshot).toMatchObject({
      providerCostExact: "12.345678901234",
      usageQuantity: "17.000000000000",
    });
    expect(snapshot.rawPayloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(snapshot.rawPayload)).not.toContain("download_url");
    await expect(
      client.query("UPDATE usage_snapshots SET raw_payload='{}' WHERE id=$1", [
        snapshot.id,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("decrypts stored credentials only in the provider service boundary", async () => {
    const c = await customer();
    const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(21)));
    const keys = credentialKeys({
      FLOWROUTE_ENCRYPTION_KEY_VERSION: "flowroute-test",
      FLOWROUTE_ENCRYPTION_KEYS: JSON.stringify({ "flowroute-test": key }),
    });
    const oldKeys = process.env.FLOWROUTE_ENCRYPTION_KEYS;
    const oldVersion = process.env.FLOWROUTE_ENCRYPTION_KEY_VERSION;
    try {
      await db.insert(schema.customerProviderCredentials).values({
        customerId: c.id,
        accessKeyEncrypted: await encryptCredential(
          "stored-access",
          c.id,
          "accessKey",
          keys,
        ),
        secretKeyEncrypted: await encryptCredential(
          "stored-secret",
          c.id,
          "secretKey",
          keys,
        ),
        encryptionKeyVersion: "flowroute-test",
      });
      process.env.FLOWROUTE_ENCRYPTION_KEYS = JSON.stringify({
        "flowroute-test": key,
      });
      process.env.FLOWROUTE_ENCRYPTION_KEY_VERSION = "flowroute-test";
      await expect(loadFlowrouteCredentials(db, c.id)).resolves.toEqual({
        status: "UNVERIFIED",
        credentials: { accessKey: "stored-access", secretKey: "stored-secret" },
      });
      await db
        .update(schema.customerProviderCredentials)
        .set({ status: "REVOKED" })
        .where(eq(schema.customerProviderCredentials.customerId, c.id));
      await expect(loadFlowrouteCredentials(db, c.id)).resolves.toBeNull();
    } finally {
      if (oldKeys === undefined) delete process.env.FLOWROUTE_ENCRYPTION_KEYS;
      else process.env.FLOWROUTE_ENCRYPTION_KEYS = oldKeys;
      if (oldVersion === undefined)
        delete process.env.FLOWROUTE_ENCRYPTION_KEY_VERSION;
      else process.env.FLOWROUTE_ENCRYPTION_KEY_VERSION = oldVersion;
    }
  });

  it("allows only one concurrent provider creation", async () => {
    const f = await fixture();
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        withDatabase(source, (connection) =>
          flowrouteExportService(connection, f.provider, {
            loadCredentials: async () => ({
              credentials: fixtureCredentials,
              status: "UNVERIFIED",
            }),
          }).process(f.exportRecord.id),
        ),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(f.provider.created).toBe(1);
  });

  it("normalizes authentication, temporary, and terminal export failures", async () => {
    const f = await fixture();
    f.provider.failure = new FlowrouteError(
      "AUTHENTICATION_FAILED",
      "not shown to the administrator",
    );
    await expect(f.service.process(f.exportRecord.id)).rejects.toMatchObject({
      code: "NEEDS_REVIEW",
    });
    let [failed] = await db
      .select()
      .from(schema.usageExports)
      .where(eq(schema.usageExports.id, f.exportRecord.id));
    expect(failed).toMatchObject({
      status: "FAILED_PERMANENT",
      lastErrorCode: "AUTHENTICATION_FAILED",
      lastErrorMessage: "AUTHENTICATION_FAILED",
    });
    const noCredentials = await customer();
    const missing = await createUsageRepository(db).ensureExport({
      customerId: noCredentials.id,
      periodStart: "2026-07-01",
      periodEnd: "2026-08-01",
    });
    const service = flowrouteExportService(db, new TestFlowroute(), {
      loadCredentials: async () => null,
    });
    await expect(service.process(missing.id)).rejects.toMatchObject({
      code: "NEEDS_REVIEW",
    });
    [failed] = await db
      .select()
      .from(schema.usageExports)
      .where(eq(schema.usageExports.id, missing.id));
    expect(failed.lastErrorCode).toBe("AUTHENTICATION_FAILED");
  });

  it("backs off retryable failures and stops after the bounded attempt count", async () => {
    const f = await fixture();
    f.provider.failure = new FlowrouteError(
      "RATE_LIMITED",
      "provider detail omitted",
      600,
    );
    await expect(f.service.process(f.exportRecord.id)).rejects.toMatchObject({
      code: "RETRY",
    });
    let [row] = await db
      .select()
      .from(schema.usageExports)
      .where(eq(schema.usageExports.id, f.exportRecord.id));
    expect(row.status).toBe("FAILED_RETRYABLE");
    expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(
      Date.parse("2026-09-02T00:09:00.000Z"),
    );
    await db
      .update(schema.usageExports)
      .set({ attemptCount: 7, nextAttemptAt: null })
      .where(eq(schema.usageExports.id, f.exportRecord.id));
    f.advance(601);
    await expect(f.service.process(f.exportRecord.id)).rejects.toMatchObject({
      code: "NEEDS_REVIEW",
    });
    [row] = await db
      .select()
      .from(schema.usageExports)
      .where(eq(schema.usageExports.id, f.exportRecord.id));
    expect(row.status).toBe("FAILED_PERMANENT");
  });
});

describe("Billing calculation", () => {
  it("seals usage, the reserved price, applicable adjustments, and one immutable line", async () => {
    const c = await customer();
    const [plan] = await db
      .insert(schema.plans)
      .values({ name: "Calculation fixture", planType: "OTHER", active: true })
      .returning();
    const [price] = await db
      .insert(schema.planPriceVersions)
      .values({
        planId: plan.id,
        version: 1,
        activeFrom: new Date("2026-01-01T00:00:00.000Z"),
        pricingConfiguration: {
          schemaVersion: 1,
          currency: "USD",
          planType: "OTHER",
          baseAmountMinor: "100",
          includedNumbers: 0,
          numberAmountMinor: "0",
          includedChannels: 0,
          channelAmountMinor: "0",
        },
      })
      .returning();
    const [subscription] = await db
      .insert(schema.subscriptions)
      .values({
        customerId: c.id,
        planPriceVersionId: price.id,
        billingDay: 15,
        status: "ACTIVE",
      })
      .returning();
    const usage = await snapshot(c.id);
    await db.insert(schema.customerBillingAdjustments).values({
      customerId: c.id,
      code: "METERED_SIP_TRUNK_USAGE",
      amountMinor: 50n,
      reason: "Fixture SIP charge",
      createdByAppUserId: actorId,
      validFrom: new Date("2026-08-01T00:00:00.000Z"),
    });
    const { run } = await createBillingRunRepository(db).ensure({
      customerId: c.id,
      subscriptionId: subscription.id,
      planPriceVersionId: price.id,
      ...period,
      formulaVersion: "legacy-v1",
      triggerType: "SCHEDULED",
    });
    await db
      .update(schema.billingRuns)
      .set({ status: "CALCULATING" })
      .where(eq(schema.billingRuns.id, run.id));
    await expect(calculateBillingRun(db, run.id)).resolves.toEqual({
      status: "CALCULATED",
    });
    await expect(calculateBillingRun(db, run.id)).resolves.toEqual({
      status: "IGNORED",
    });
    const [saved] = await db
      .select()
      .from(schema.billingRuns)
      .where(eq(schema.billingRuns.id, run.id));
    expect(saved).toMatchObject({
      status: "CALCULATED",
      planPriceVersionId: price.id,
      usageSnapshotId: usage.id,
      subtotalMinor: 1350n,
    });
    const lines = await db
      .select()
      .from(schema.billingLineItems)
      .where(eq(schema.billingLineItems.billingRunId, run.id));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      code: "LEGACY_V1_OTHER_USAGE",
      amountMinor: 1350n,
    });
  });
});

describe("Flowroute background work", () => {
  it("discovers once, reserves durable work, and holds the run for review on a terminal usage failure", async () => {
    // Keep this fixture focused on one due subscription; earlier integration
    // fixtures intentionally leave several active subscription records behind.
    await client.query("UPDATE subscriptions SET status='DRAFT'");
    const c = await customer();
    await db
      .update(schema.customers)
      .set({ status: "ACTIVE" })
      .where(eq(schema.customers.id, c.id));
    await db.insert(schema.subscriptions).values({
      customerId: c.id,
      planPriceVersionId: "00000000-0000-4000-8000-000000000020",
      billingDay: 15,
      status: "ACTIVE",
    });
    const now = new Date("2026-09-15T11:05:00.000Z");
    const discovered = await Promise.all([
      discoverFlowrouteWork(db, now),
      withDatabase(source, (connection) =>
        discoverFlowrouteWork(connection, now),
      ),
    ]);
    expect(discovered.some((result) => result.discovered === 1)).toBe(true);
    const [job] = await db
      .select()
      .from(schema.backgroundJobs)
      .where(eq(schema.backgroundJobs.status, "PENDING"));
    expect(job).toBeTruthy();
    await markFlowrouteJobEnqueued(db, job.id, now);
    await expect(
      processFlowrouteJob(db, new TestFlowroute(), job.id, now),
    ).resolves.toMatchObject({ status: "NEEDS_REVIEW" });
    const [savedJob] = await db
      .select()
      .from(schema.backgroundJobs)
      .where(eq(schema.backgroundJobs.id, job.id));
    expect(savedJob.status).toBe("NEEDS_REVIEW");
    const [run] = await db
      .select()
      .from(schema.billingRuns)
      .where(eq(schema.billingRuns.id, job.billingRunId!));
    expect(run.status).toBe("NEEDS_REVIEW");
    await expect(replayFlowrouteJob(db, job.id, now)).resolves.toMatchObject({
      status: "PENDING",
    });
    const [replayedExport] = await db
      .select()
      .from(schema.usageExports)
      .where(eq(schema.usageExports.id, job.usageExportId));
    expect(replayedExport).toMatchObject({
      status: "PENDING",
      attemptCount: 0,
    });
    const [replayedRun] = await db
      .select()
      .from(schema.billingRuns)
      .where(eq(schema.billingRuns.id, job.billingRunId!));
    expect(replayedRun.status).toBe("WAITING_FOR_USAGE");
  });
});
