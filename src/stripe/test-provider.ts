import type {
  StripeProvider,
  RequestKind,
  SubscriptionState,
  InvoiceState,
} from "./contracts";
/** Stateful contract fixture. Never imported by application/runtime code. */
export class TestStripe implements StripeProvider {
  accountId = "acct_fixture";
  states = new Map<string, SubscriptionState>();
  invoices = new Map<string, InvoiceState>();
  schedules = new Map<string, string>();
  keys = new Map<string, string>();
  writes: { kind: RequestKind; input: Record<string, unknown>; key: string }[] =
    [];
  failAfter: RequestKind | null = null;
  async account() {
    return this.accountId;
  }
  async execute(
    kind: RequestKind,
    input: Record<string, unknown>,
    key: string,
  ) {
    const cached = this.keys.get(key);
    if (cached) return cached;
    const id =
      kind === "change" || kind === "cancel" || kind === "hold" || kind === "release" || kind === "finalize" || kind === "send"
        ? String(input.id)
        : `${{ customer: "cus", product: "prod", price: "price", subscription: "sub", invoice_item: "ii", schedule: "sub_sched" }[kind]}_${crypto.randomUUID().replaceAll("-", "")}`;
    this.writes.push({ kind, input: structuredClone(input), key });
    this.keys.set(key, id);
    if (kind === "subscription" || kind === "schedule") {
      const metadata = input.metadata as Record<string, string>;
      const collectionMethod =
        kind === "schedule"
          ? String(
              (input.phases as { collection_method: string }[])[0]
                .collection_method,
            )
          : String(input.collection_method);
      const items = (
        kind === "schedule"
          ? (input.phases as { items: { price: string }[] }[])[0].items
          : input.items
      ) as { price: string }[];
      const subscriptionId =
        kind === "schedule"
          ? `sub_${crypto.randomUUID().replaceAll("-", "")}`
          : id;
      this.states.set(subscriptionId, {
        id: subscriptionId,
        customerId: String(input.customer),
        priceId: items[0].price,
        itemId: `si_${crypto.randomUUID()}`,
        status: "active",
        collectionMethod,
        periodStart: 1789988400,
        periodEnd: 1792580400,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        internalId: metadata.subscription_id,
        customerInternalId: metadata.internal_customer_id,
        latestInvoiceId: null,
      });
      if (kind === "schedule") this.schedules.set(id, subscriptionId);
    } else if (kind === "change") {
      this.states.get(id)!.priceId = (
        input.items as { price: string }[]
      )[0].price;
    } else if (kind === "cancel") this.states.get(id)!.cancelAtPeriodEnd = true;
    else if (kind === "hold") this.invoices.get(id)!.autoAdvance = false;
    else if (kind === "release") this.invoices.get(id)!.autoAdvance = true;
    else if (kind === "finalize") this.invoices.get(id)!.status = "open";
    else if (kind === "send") this.invoices.get(id)!.status = "open";
    if (this.failAfter === kind) {
      this.failAfter = null;
      throw new Error("Simulated response lost AFTER Stripe accepted request");
    }
    return id;
  }
  async subscription(id: string) {
    const state = this.states.get(id);
    if (!state) throw new Error("Unknown test subscription");
    return structuredClone(state);
  }
  async invoice(id: string) {
    const state = this.invoices.get(id);
    if (!state) throw new Error("Unknown test invoice");
    return structuredClone(state);
  }
  async hasDefaultPaymentMethod() {
    return true;
  }
  async scheduleSubscription(id: string) {
    const subscriptionId = this.schedules.get(id);
    if (!subscriptionId) throw new Error("Unknown test schedule");
    return subscriptionId;
  }
}
