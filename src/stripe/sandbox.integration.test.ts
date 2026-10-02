import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateDatabase } from "../../scripts/db/migrate";
import { stripeConfiguration } from "./config";
import { stripeSdk, stripeProvider } from "./adapter";
import { stripeService } from "./service";
import { planManagementRepository } from "../db/repositories/plan-management";
import { planSchema } from "../plans/validation";
import * as schema from "../db/schema";
// Explicit opt-in. Normal CI uses contract fixtures and never contacts Stripe.
describe.skipIf(process.env.RUN_STRIPE_SANDBOX_TESTS !== "true")(
  "real Stripe sandbox lifecycle",
  () => {
    const name = `rce_stripe_${randomUUID().replaceAll("-", "")}`;
    let maintenance: Client;
    let client: Client;
    let sdk: ReturnType<typeof stripeSdk>;
    let accountId: string;
    let created = false;
    const customerIds: string[] = [];
    const subscriptionIds: string[] = [];
    const priceIds: string[] = [];
    const productIds: string[] = [];
    beforeAll(async () => {
      const config = stripeConfiguration(process.env);
      sdk = stripeSdk(config.secretKey);
      accountId = config.accountId;
      if (!process.env.TEST_DATABASE_URL)
        throw new Error(
          "TEST_DATABASE_URL must name a disposable PostgreSQL server",
        );
      const target = new URL(process.env.TEST_DATABASE_URL);
      maintenance = new Client({ connectionString: target.toString() });
      await maintenance.connect();
      await maintenance.query(`CREATE DATABASE ${name}`);
      created = true;
      target.pathname = `/${name}`;
      await migrateDatabase(target.toString());
      client = new Client({ connectionString: target.toString() });
      await client.connect();
    });
    afterAll(async () => {
      // Cleanup only IDs produced by this isolated test run; never enumerate an account.
      if (client) {
        const db = drizzle(client, { schema });
        for (const c of await db.select().from(schema.customers))
          if (c.stripeCustomerId) customerIds.push(c.stripeCustomerId);
        for (const s of await db.select().from(schema.subscriptions))
          if (s.stripeSubscriptionId)
            subscriptionIds.push(s.stripeSubscriptionId);
        for (const p of await db.select().from(schema.planPriceVersions)) {
          if (p.stripePriceId) priceIds.push(p.stripePriceId);
          if (p.stripeProductId) productIds.push(p.stripeProductId);
        }
      }
      const cleanup: Promise<unknown>[] = [];
      for (const id of subscriptionIds)
        cleanup.push(sdk.subscriptions.cancel(id));
      await Promise.allSettled(cleanup);
      for (const id of customerIds) await sdk.customers.del(id);
      for (const id of priceIds) await sdk.prices.update(id, { active: false });
      for (const id of productIds)
        await sdk.products.update(id, { active: false });
      await client?.end();
      if (created)
        await maintenance.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await maintenance?.end();
    });
    it("creates exactly one test subscription, changes price, and schedules cancellation", async () => {
      const db = drizzle(client, { schema });
      const actorId = randomUUID();
      await db
        .insert(schema.appUsers)
        .values({ id: actorId, email: `admin-${actorId}@example.invalid` });
      const actor = { appUserId: actorId };
      const [customer] = await db
        .insert(schema.customers)
        .values({
          fullName: "RCE sandbox integration fixture",
          email: `stripe-${randomUUID()}@example.invalid`,
          billingDay: 31,
        })
        .returning();
      const repo = planManagementRepository(db);
      const input = planSchema.parse({
        name: `RCE test ${randomUUID()}`,
        planType: "FIXED",
        baseAmount: "1.00",
        includedMinutes: "0",
        additionalMinuteAmount: "0",
        includedNumbers: 0,
        numberAmount: "0",
        includedChannels: 0,
        channelAmount: "0",
      });
      const plan = await repo.createPlan(input, actor);
      const version = (await repo.planDetail(plan.id))!.versions[0];
      const draft = await repo.createDraft(
        {
          creationKey: randomUUID(),
          customerId: customer.id,
          planPriceVersionId: version.id,
          collectionMethod: "send_invoice",
        },
        actor,
      );
      const service = stripeService(db, stripeProvider(sdk, accountId));
      const command = {
        requestKey: randomUUID(),
        revision: 1,
        daysUntilDue: 30,
      };
      await service.start(draft.id, "activate", command, actor);
      await service.start(draft.id, "activate", command, actor);
      const active = (await repo.subscriptionDetail(draft.id))!;
      expect(active.status).toBe("ACTIVE");
      await repo.updatePlan(
        plan.id,
        1,
        { ...input, baseAmount: "2.00" },
        actor,
      );
      const next = (await repo.planDetail(plan.id))!.versions[0];
      await service.start(
        draft.id,
        "change",
        {
          requestKey: randomUUID(),
          revision: active.revision,
          planPriceVersionId: next.id,
        },
        actor,
      );
      const changed = (await repo.subscriptionDetail(draft.id))!;
      expect(changed.priceVersionId).toBe(next.id);
      await service.start(
        draft.id,
        "cancel",
        { requestKey: randomUUID(), revision: changed.revision },
        actor,
      );
      expect((await repo.subscriptionDetail(draft.id))!.cancelAtPeriodEnd).toBe(
        true,
      );
    });
  },
);
