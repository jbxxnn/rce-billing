import Stripe from "stripe";
import { STRIPE_API_VERSION, type StripeMode } from "./config";
import type {
  InvoiceState,
  StripeProvider,
  RequestKind,
  SubscriptionState,
} from "./contracts";
import { invoiceSubscriptionId, isSubscriptionLine } from "./invoice-period";

function identifier(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : (value?.id ?? null);
}
export function stripeSdk(secretKey: string, mode: StripeMode = "test") {
  if (!secretKey.startsWith(mode === "test" ? "sk_test_" : "sk_live_"))
    throw new Error(`Stripe ${mode} secret key required`);
  return new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 0,
    timeout: 8000,
  });
}
async function invoiceBillingPeriod(
  sdk: Stripe,
  invoice: Stripe.Invoice,
  subscriptionId: string | null,
) {
  if (!subscriptionId) return { start: null, end: null };
  for await (const line of sdk.invoices.listLineItems(invoice.id, {
    limit: 100,
  })) {
    if (!isSubscriptionLine(line, subscriptionId)) continue;
    if (line.period.end <= line.period.start) continue;
    return { start: line.period.start, end: line.period.end };
  }
  return { start: null, end: null };
}
export function stripeProvider(
  sdk: Stripe,
  expectedAccount: string,
  mode: StripeMode = "test",
): StripeProvider {
  const expectedLiveMode = mode === "live";
  return {
    async account() {
      const account = await sdk.accounts.retrieve(null);
      if (account.id !== expectedAccount)
        throw new Error("Stripe account mismatch");
      return account.id;
    },
    async execute(
      kind: RequestKind,
      input: Record<string, unknown>,
      key: string,
    ) {
      const options = { idempotencyKey: key };
      const { id, ...params } = input;
      let result: { id: string; livemode?: boolean };
      switch (kind) {
        case "customer":
          result = await sdk.customers.create(
            input as Stripe.CustomerCreateParams,
            options,
          );
          break;
        case "product":
          result = await sdk.products.create(
            input as unknown as Stripe.ProductCreateParams,
            options,
          );
          break;
        case "price":
          result = await sdk.prices.create(
            input as unknown as Stripe.PriceCreateParams,
            options,
          );
          break;
        case "subscription":
          result = await sdk.subscriptions.create(
            input as unknown as Stripe.SubscriptionCreateParams,
            options,
          );
          break;
        case "change":
        case "cancel":
          result = await sdk.subscriptions.update(
            String(id),
            params as Stripe.SubscriptionUpdateParams,
            options,
          );
          break;
        case "hold":
          result = await sdk.invoices.update(
            String(id),
            { auto_advance: false },
            options,
          );
          break;
        case "release":
          result = await sdk.invoices.update(
            String(id),
            { auto_advance: true },
            options,
          );
          break;
        case "finalize":
          result = await sdk.invoices.finalizeInvoice(String(id), {}, options);
          break;
        case "send":
          result = await sdk.invoices.sendInvoice(String(id), {}, options);
          break;
        case "invoice_item":
          result = await sdk.invoiceItems.create(
            input as unknown as Stripe.InvoiceItemCreateParams,
            options,
          );
          break;
        case "schedule":
          result = await sdk.subscriptionSchedules.create(
            input as unknown as Stripe.SubscriptionScheduleCreateParams,
            options,
          );
          break;
      }
      if (result.livemode !== expectedLiveMode)
        throw new Error("Stripe response mode mismatch");
      return result.id;
    },
    async subscription(id) {
      const s = await sdk.subscriptions.retrieve(id);
      if (
        s.livemode !== expectedLiveMode ||
        s.items.data.length !== 1 ||
        s.items.has_more
      )
        throw new Error("Unsupported subscription shape");
      const item = s.items.data[0];
      const result: SubscriptionState = {
        id: s.id,
        customerId: identifier(s.customer)!,
        priceId: item.price.id,
        itemId: item.id,
        status: s.status,
        collectionMethod: s.collection_method,
        periodStart: item.current_period_start,
        periodEnd: item.current_period_end,
        cancelAtPeriodEnd: s.cancel_at_period_end,
        canceledAt: s.ended_at,
        internalId: s.metadata.subscription_id ?? "",
        customerInternalId: s.metadata.internal_customer_id ?? "",
        latestInvoiceId: identifier(s.latest_invoice),
      };
      // Metered subscription items can legitimately omit quantity. Quantity is
      // not used to reconcile a subscription, so only reject an invalid value
      // when Stripe supplies one.
      if (
        (item.quantity != null && item.quantity < 0) ||
        !result.customerId ||
        !result.periodStart ||
        result.periodEnd <= result.periodStart
      )
        throw new Error("Unsupported subscription state");
      return result;
    },
    async invoice(id) {
      const i = await sdk.invoices.retrieve(id);
      if (i.livemode !== expectedLiveMode)
        throw new Error("Stripe response mode mismatch");
      const subscriptionId = invoiceSubscriptionId(i);
      const period = await invoiceBillingPeriod(sdk, i, subscriptionId);
      const result: InvoiceState = {
        id: i.id,
        customerId: identifier(i.customer)!,
        subscriptionId,
        status: i.status ?? "draft",
        attemptCount: i.attempt_count,
        collectionMethod: i.collection_method,
        currency: i.currency.toUpperCase(),
        total: i.total,
        amountPaid: i.amount_paid,
        amountDue: i.amount_due,
        amountRemaining: i.amount_remaining,
        billingPeriodStart: period.start,
        billingPeriodEnd: period.end,
        dueDate: i.due_date,
        paidAt: i.status_transitions.paid_at,
        createdAt: i.created,
        autoAdvance: i.auto_advance ?? false,
      };
      return result;
    },
    async hasDefaultPaymentMethod(id) {
      const customer = await sdk.customers.retrieve(id);
      if (customer.deleted) return false;
      return Boolean(customer.invoice_settings.default_payment_method);
    },
    async scheduleSubscription(id) {
      const schedule = await sdk.subscriptionSchedules.retrieve(id);
      if (schedule.livemode !== expectedLiveMode || !schedule.subscription)
        throw new Error("Stripe schedule has no active subscription");
      return identifier(schedule.subscription)!;
    },
  };
}
export async function verifiedEvent(
  sdk: Stripe,
  body: string,
  signature: string,
  secret: string,
  mode: StripeMode = "test",
) {
  const event = await sdk.webhooks.constructEventAsync(
    body,
    signature,
    secret,
    300,
    Stripe.createSubtleCryptoProvider(),
  );
  if (event.livemode !== (mode === "live") || event.account)
    throw new Error("Stripe event mode or account mismatch");
  return event;
}
