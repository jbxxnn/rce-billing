export type RequestKind =
  | "customer"
  | "product"
  | "price"
  | "subscription"
  | "change"
  | "cancel"
  | "hold"
  | "release"
  | "finalize"
  | "send"
  | "invoice_item"
  | "schedule";
export type SubscriptionState = {
  id: string;
  customerId: string;
  priceId: string;
  itemId: string;
  status: string;
  collectionMethod: string;
  periodStart: number;
  periodEnd: number;
  cancelAtPeriodEnd: boolean;
  canceledAt: number | null;
  internalId: string;
  customerInternalId: string;
  latestInvoiceId: string | null;
};
export type InvoiceState = {
  id: string;
  customerId: string;
  subscriptionId: string | null;
  status: string;
  attemptCount: number;
  collectionMethod: string;
  currency: string;
  total: number;
  amountPaid: number;
  amountDue: number;
  amountRemaining: number;
  billingPeriodStart?: number | null;
  billingPeriodEnd?: number | null;
  dueDate: number | null;
  paidAt: number | null;
  createdAt: number;
  autoAdvance: boolean;
};
export interface StripeProvider {
  account(): Promise<string>;
  execute(
    kind: RequestKind,
    input: Record<string, unknown>,
    key: string,
  ): Promise<string>;
  subscription(id: string): Promise<SubscriptionState>;
  invoice(id: string): Promise<InvoiceState>;
  hasDefaultPaymentMethod(customerId: string): Promise<boolean>;
  scheduleSubscription(id: string): Promise<string>;
}
export class StripeWorkflowError extends Error {
  constructor(
    public readonly code: "BUSY" | "NEEDS_REVIEW" | "RETRY",
    message: string,
  ) {
    super(message);
  }
}
