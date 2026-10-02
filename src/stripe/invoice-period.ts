import type Stripe from "stripe";

function identifier(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : (value?.id ?? null);
}

type LegacyInvoice = Stripe.Invoice & {
  subscription?: string | { id: string } | null;
};

/**
 * Stripe invoices created under earlier API versions store the subscription on
 * `invoice.subscription`; newer invoices use `parent.subscription_details`.
 */
export function invoiceSubscriptionId(invoice: Stripe.Invoice) {
  return (
    identifier(invoice.parent?.subscription_details?.subscription) ??
    identifier((invoice as LegacyInvoice).subscription)
  );
}

/**
 * Subscription line items have likewise existed in two shapes. Accept either
 * API representation before comparing it with the invoice subscription.
 */
export function lineSubscriptionId(line: Stripe.InvoiceLineItem) {
  const parentSubscription =
    line.parent?.type === "subscription_item_details"
      ? line.parent.subscription_item_details?.subscription
      : line.parent?.type === "invoice_item_details"
        ? line.parent.invoice_item_details?.subscription
        : null;
  return identifier(parentSubscription) ?? identifier(line.subscription);
}

export function isSubscriptionLine(
  line: Stripe.InvoiceLineItem,
  subscriptionId: string | null,
) {
  if (subscriptionId) return lineSubscriptionId(line) === subscriptionId;
  return (
    line.parent?.type === "subscription_item_details" ||
    (line as Stripe.InvoiceLineItem & { type?: string }).type === "subscription"
  );
}
