import { nextBillingAnchor } from "../domain/billing/calendar";

export type HeldInvoiceScheduleInput = {
  customerId: string;
  priceId: string;
  billingDay: number;
  collectionMethod: "charge_automatically" | "send_invoice";
  subscriptionId: string;
  internalCustomerId: string;
  quantity: number;
  now?: Date;
};

/**
 * The first phase begins immediately and ends at the customer's next 11:00
 * UTC billing anchor. Stripe schedules begin with a draft invoice; the second
 * phase resets the recurring monthly anchor at that boundary. Releasing after
 * its first complete cycle leaves a normal subscription on that same anchor.
 */
export function heldInvoiceSchedule(input: HeldInvoiceScheduleInput) {
  const now = input.now ?? new Date();
  const firstAnchor = nextBillingAnchor(now, input.billingDay);
  const nextMonth = new Date(firstAnchor.getTime() + 1);
  const releaseAnchor = nextBillingAnchor(nextMonth, input.billingDay);
  const metadata = {
    internal_customer_id: input.internalCustomerId,
    subscription_id: input.subscriptionId,
  };
  return {
    customer: input.customerId,
    start_date: "now" as const,
    end_behavior: "release" as const,
    metadata,
    phases: [
      {
        items: [{ price: input.priceId, quantity: input.quantity }],
        end_date: Math.floor(firstAnchor.getTime() / 1000),
        collection_method: input.collectionMethod,
        metadata,
      },
      {
        items: [{ price: input.priceId, quantity: input.quantity }],
        end_date: Math.floor(releaseAnchor.getTime() / 1000),
        collection_method: input.collectionMethod,
        billing_cycle_anchor: "phase_start" as const,
        metadata,
      },
    ],
  };
}
