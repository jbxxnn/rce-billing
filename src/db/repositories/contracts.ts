// Application-facing contracts deliberately contain no ORM or provider client types.
export interface AuditActor {
  appUserId: string;
  requestId?: string;
}
export interface CustomerRecord {
  id: string;
  fullName: string;
  email: string;
  billingDay: number;
  billingTimezone: string;
  status: string;
  paymentStatus: string;
}
export interface CustomerRepository {
  findById(id: string): Promise<CustomerRecord | null>;
  list(input?: { afterId?: string; limit?: number }): Promise<CustomerRecord[]>;
  create(
    input: {
      fullName: string;
      email: string;
      billingDay: number;
      billingTimezone?: string;
    },
    actor: AuditActor,
  ): Promise<CustomerRecord>;
}
export interface PlanRecord {
  id: string;
  name: string;
  planType: string;
  currency: string;
  active: boolean;
}
export interface SubscriptionRecord {
  id: string;
  customerId: string;
  planPriceVersionId: string;
  status: string;
  cancelAtPeriodEnd: boolean;
}
export interface CatalogRepository {
  listActivePlans(limit?: number): Promise<PlanRecord[]>;
  listSubscriptions(
    customerId: string,
    limit?: number,
  ): Promise<SubscriptionRecord[]>;
}
export interface BillingRunRecord {
  id: string;
  customerId: string;
  planPriceVersionId: string | null;
  periodStart: string;
  periodEnd: string;
  status: string;
  formulaVersion: string;
}
export interface BillingRunRepository {
  ensure(
    input: {
      customerId: string;
      subscriptionId?: string;
      planPriceVersionId?: string;
      periodStart: string;
      periodEnd: string;
      formulaVersion: string;
      triggerType: "SCHEDULED" | "MANUAL" | "REPLAY";
    },
    actor?: AuditActor,
  ): Promise<{ run: BillingRunRecord; created: boolean }>;
  findById(id: string): Promise<BillingRunRecord | null>;
}
export interface UsageExportRecord {
  id: string;
  customerId: string;
  periodStart: string;
  periodEnd: string;
  status: string;
}
export interface UsageSnapshotRecord {
  id: string;
  providerCostMinor: bigint | null;
  providerCostExact: string | null;
  usageQuantity: string | null;
  currency: string;
}
export interface UsageRepository {
  ensureExport(input: {
    customerId: string;
    periodStart: string;
    periodEnd: string;
  }): Promise<UsageExportRecord>;
  findSnapshot(input: {
    customerId: string;
    periodStart: string;
    periodEnd: string;
  }): Promise<UsageSnapshotRecord | null>;
}
export interface StripeEventRepository {
  record(input: {
    stripeEventId: string;
    eventType: string;
    livemode: boolean;
    payload: Record<string, unknown>;
  }): Promise<{ id: string; inserted: boolean; processingStatus: string }>;
}
