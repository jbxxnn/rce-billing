import { and, eq } from "drizzle-orm";
import { withDatabase } from "../../src/db/client";
import { appUsers, customers, planPriceVersions, plans, subscriptions } from "../../src/db/schema";
import { planManagementRepository } from "../../src/db/repositories/plan-management";
import { configuredStripe } from "../../src/stripe/server";
import { stripeService } from "../../src/stripe/service";

const customerEmail = "aisha@re-circuit.com";
const planName = "Aisha reconciliation custom plan";
const creationKey = "95bd6f6a-c4d1-4f83-a4b2-8b6b456fb165";
const activationKey = "0e7bcbe4-c7c2-4c8d-bbfb-59ff57a5743f";
const changeKey = "bb9ccbe3-a38f-4dd4-bc09-6c797d328577";
const supersededKeys = [
  "aisha-july-2026-reconciliation-v1",
  "aisha-august-2026-reconciliation-v1",
];

const invoices = [
  {
    key: "aisha-august-2026-reconciliation-v2",
    period: "August 2026 billing run",
    amount: 41_500,
    description: "Flowroute usage (76 × $2.50) + Metered SIP Trunk Usage ($225.00) — August 2026 reconciliation",
  },
  {
    key: "aisha-september-2026-reconciliation-v2",
    period: "September 2026 billing run",
    amount: 40_250,
    description: "Flowroute usage (71 × $2.50) + Metered SIP Trunk Usage ($225.00) — September 2026 reconciliation",
  },
] as const;

try {
  if (process.env.STRIPE_TEST_ENABLED !== "true")
    throw new Error("Stripe test mode must be enabled");
  await withDatabase({ connectionString: process.env.DATABASE_URL! }, async (db) => {
    const [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.email, customerEmail));
    const [admin] = await db
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(and(eq(appUsers.status, "ACTIVE"), eq(appUsers.role, "ADMIN")))
      .limit(1);
    if (!customer || !admin) throw new Error("Aisha or an active administrator was not found");
    const actor = { appUserId: admin.id, requestId: "aisha-reconciliation-test" };

    let [plan] = await db.select().from(plans).where(eq(plans.name, planName));
    if (!plan) {
      const created = await planManagementRepository(db).createPlan({
        name: planName,
        description: "Stripe test-only reconciliation plan for historical Aisha usage.",
        planType: "OTHER",
        baseAmount: "2.50",
        includedMinutes: "0",
        additionalMinuteAmount: "0",
        includedNumbers: 0,
        numberAmount: "0",
        includedChannels: 0,
        channelAmount: "0",
      }, actor);
      [plan] = await db.select().from(plans).where(eq(plans.id, created.id));
    }
    const [price] = await db
      .select()
      .from(planPriceVersions)
      .where(eq(planPriceVersions.planId, plan.id))
      .orderBy(planPriceVersions.version)
      .limit(1);
    if (!price) throw new Error("Test plan price was not created");

    let [subscription] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.creationKey, creationKey));
    if (!subscription) {
      const draft = await planManagementRepository(db).createDraft({
        creationKey,
        customerId: customer.id,
        planPriceVersionId: price.id,
        collectionMethod: "send_invoice",
      }, actor);
      [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.id, draft.id));
    }
    if (!subscription) throw new Error("Test subscription draft was not created");
    const runtime = configuredStripe();
    if (!subscription.stripeSubscriptionId)
      await stripeService(db, runtime.provider).start(
        subscription.id,
        "activate",
        {
          requestKey: activationKey,
          revision: subscription.revision,
          collectionMethod: "send_invoice",
          daysUntilDue: 30,
        },
        actor,
      );
    const [activatedSubscription] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, subscription.id));
    if (!activatedSubscription?.stripeSubscriptionId)
      throw new Error("Stripe test subscription was not created");
    if (activatedSubscription.planPriceVersionId !== price.id)
      await stripeService(db, runtime.provider).start(
        activatedSubscription.id,
        "change",
        {
          requestKey: changeKey,
          revision: activatedSubscription.revision,
          planPriceVersionId: price.id,
          collectionMethod: "send_invoice",
          daysUntilDue: 30,
        },
        actor,
      );
    const [freshCustomer] = await db.select().from(customers).where(eq(customers.id, customer.id));
    if (!freshCustomer?.stripeCustomerId) throw new Error("Stripe test customer was not created");
    const existingInvoices = (await runtime.sdk.invoices.list({ customer: freshCustomer.stripeCustomerId, limit: 100 })).data;
    for (const oldInvoice of existingInvoices) {
      if (
        supersededKeys.includes(oldInvoice.metadata?.reconciliation_key ?? "") &&
        oldInvoice.status === "open"
      )
        await runtime.sdk.invoices.voidInvoice(oldInvoice.id, {}, {
          idempotencyKey: `rce:test:${oldInvoice.id}:void`,
        });
    }

    const results: Array<{ period: string; invoiceId: string; total: string }> = [];
    for (const item of invoices) {
      const existing = (await runtime.sdk.invoices.list({ customer: freshCustomer.stripeCustomerId, limit: 100 })).data.find(
        (invoice) => invoice.metadata?.reconciliation_key === item.key,
      );
      if (existing) {
        results.push({ period: item.period, invoiceId: existing.id, total: `$${(existing.total / 100).toFixed(2)}` });
        continue;
      }
      const invoice = await runtime.sdk.invoices.create({
        customer: freshCustomer.stripeCustomerId,
        collection_method: "send_invoice",
        days_until_due: 30,
        auto_advance: false,
        metadata: { reconciliation_key: item.key, usage_period: item.period, test_only: "true" },
      }, { idempotencyKey: `rce:test:${item.key}:invoice` });
      await runtime.sdk.invoiceItems.create({
        customer: freshCustomer.stripeCustomerId,
        invoice: invoice.id,
        amount: item.amount,
        currency: "usd",
        description: item.description,
        metadata: { reconciliation_key: item.key, usage_period: item.period },
      }, { idempotencyKey: `rce:test:${item.key}:line` });
      const finalized = await runtime.sdk.invoices.finalizeInvoice(invoice.id, {}, { idempotencyKey: `rce:test:${item.key}:finalize` });
      if (finalized.livemode) throw new Error("Live Stripe invoice was rejected");
      results.push({ period: item.period, invoiceId: finalized.id, total: `$${(finalized.total / 100).toFixed(2)}` });
    }
    console.log(JSON.stringify(results));
  });
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Aisha reconciliation invoices were not created: ${message}`);
  process.exitCode = 1;
}
