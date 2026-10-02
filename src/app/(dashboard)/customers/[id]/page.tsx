import Link from "next/link";
import { notFound } from "next/navigation";
import { withCustomers } from "@/customers/server";
import { customerIdSchema, searchSchema } from "@/customers/validation";
import {
  CustomerControl,
  CustomerForm,
  CredentialsForm,
  BillingAdjustmentsForm,
} from "@/customers/forms";
import { PaymentMethodLink } from "@/customers/payment-method-link";
import { SyncStripeHistory } from "@/revenue/sync-stripe-history";
import { stripeMode, stripeReady } from "@/stripe/server";

function auditTitle(action: string) {
  const value = action.replace(/^customer\./, "").replaceAll("_", " ");
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function auditTime(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function periodLabel(start: string | Date, end: string | Date) {
  const format = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const toDate = (value: string | Date) =>
    typeof value === "string" ? new Date(`${value}T00:00:00`) : value;
  return `${format.format(toDate(start))} – ${format.format(toDate(end))}`;
}

function dateLabel(value: Date | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

function money(value: bigint | number | null, currency: string) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(Number(value) / 100);
}

function quantityLabel(value: string | number | null) {
  if (value === null) return "Usage unavailable";
  const quantity = Number(value);
  if (!Number.isFinite(quantity)) return "Usage unavailable";
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(quantity)} usage`;
}

function exactMoney(value: string | number | null, currency: string) {
  if (value === null) return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function adjustmentInput(value: bigint | null) {
  if (value === null) return "0.00";
  return (Number(value) / 100).toFixed(2);
}

function statusClass(status: string) {
  if (["ACTIVE", "COMPLETED", "PAID"].includes(status))
    return "bg-primary/10 text-primary";
  if (["PAST_DUE", "UNPAID", "FAILED", "NEEDS_REVIEW"].includes(status))
    return "bg-destructive/10 text-destructive";
  return "bg-muted text-muted-foreground";
}
export default async function CustomerDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  if (!customerIdSchema.safeParse(id).success) notFound();
  const query = await searchParams;
  const parsed = searchSchema.safeParse(query);
  const auditPage = parsed.success ? parsed.data.auditPage : 0;
  const data = await withCustomers((repository) =>
    repository.detail(id, auditPage),
  );
  if (!data) notFound();
  const { customer, credentials, account } = data;
  const latestSubscription = account.subscriptions[0];
  const latestInvoice = account.invoices[0];
  const stripeConfigured = stripeReady();
  const configuredStripeMode = stripeMode();
  const adjustments = new Map(
    account.adjustments.map((adjustment) => [adjustment.code, adjustment]),
  );
  const billingAdjustments = {
    meteredSipTrunkUsage: adjustmentInput(
      adjustments.get("METERED_SIP_TRUNK_USAGE")?.amountMinor ?? null,
    ),
    cloudServerHosting: adjustmentInput(
      adjustments.get("CLOUD_SERVER_HOSTING")?.amountMinor ?? null,
    ),
    extraNumbers: adjustments.get("EXTRA_NUMBERS")?.quantity ?? "0",
    extraChannels: adjustments.get("EXTRA_CHANNELS")?.quantity ?? "",
  };
  const profile = {
    id,
    revision: customer.revision,
    fullName: customer.fullName,
    email: customer.email,
    phone: customer.phone ?? "",
    streetAddress: customer.streetAddress ?? "",
    city: customer.city ?? "",
    state: customer.state ?? "",
    postalCode: customer.postalCode ?? "",
    countryCode: customer.countryCode,
    billingDay: customer.billingDay,
    billingTimezone: customer.billingTimezone,
  };
  return (
    <main className="flex w-full flex-1 flex-col gap-6 p-4 md:p-6">
      <Link
        className="text-sm font-medium text-primary hover:underline"
        href="/customers"
      >
        ← Customers
      </Link>
      <header className="flex flex-col gap-4 border-b border-input pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            {customer.fullName}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {customer.status} · Payment: {customer.paymentStatus} · Billing day{" "}
            {customer.billingDay}
          </p>
        </div>
        <Link
          href={`/revenue/customers/${id}`}
          className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
        >
          View invoices
        </Link>
      </header>
      {query.saved === "1" && (
        <p
          role="status"
          className="rounded-md border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary"
        >
          Changes saved.
        </p>
      )}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <section className="rounded-lg border border-input bg-card p-6">
            <h2 className="mb-8 text-lg font-semibold">Customer profile</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              <Link href={`/subscriptions?customerId=${id}`}>
                View subscriptions
              </Link>
              {customer.status !== "ARCHIVED" && (
                <>
                  {" "}
                  ·{" "}
                  <Link href={`/subscriptions/new?customerId=${id}`}>
                    New subscription draft
                  </Link>
                </>
              )}
            </p>
            {customer.status === "ARCHIVED" ? (
              <p>
                This customer is archived. Restore the customer to edit their
                profile.
              </p>
            ) : (
              <CustomerForm
                key={`profile-${customer.revision}`}
                customer={profile}
              />
            )}
          </section>
        </div>
        <div className="flex flex-col gap-6">
          <section className="rounded-lg border border-input bg-card p-6">
            <h2 className="text-lg font-semibold">Payment method</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Automatic charging requires a payment method saved on this
              customer’s Stripe profile. Card details are entered only on
              Stripe’s secure page.
            </p>
            {stripeConfigured ? (
              <PaymentMethodLink customerId={id} />
            ) : (
              <p className="mt-4 rounded-md border border-dashed border-input px-4 py-3 text-sm text-muted-foreground">
                Stripe credentials must be configured before you can create a
                payment-method link.
              </p>
            )}
            {stripeConfigured && configuredStripeMode === "test" ? (
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                This creates a sandbox payment-method link only.
              </p>
            ) : null}
          </section>
          <section className="rounded-lg border border-input bg-card p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Billing &amp; usage</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Recent Flowroute usage and Stripe billing activity.
                </p>
              </div>
              <div className="flex items-center gap-3">
                {stripeConfigured ? (
                  <SyncStripeHistory customerId={id} />
                ) : null}
                <Link
                  className="text-sm font-medium text-primary hover:underline"
                  href={`/subscriptions?customerId=${id}`}
                >
                  Subscriptions
                </Link>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-input bg-muted/30 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Stripe subscription
                </p>
                {latestSubscription ? (
                  <>
                    <div className="mt-2 flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass(latestSubscription.status)}`}
                      >
                        {latestSubscription.status.replaceAll("_", " ")}
                      </span>
                      {latestSubscription.cancelAtPeriodEnd && (
                        <span className="text-xs text-muted-foreground">
                          Cancels at period end
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {latestSubscription.stripeSubscriptionId
                        ? `Connected to Stripe · renews ${dateLabel(latestSubscription.currentPeriodEnd)}`
                        : "Draft subscription — not yet connected to Stripe"}
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No subscription has been created.
                  </p>
                )}
              </div>
              <div className="rounded-md border border-input bg-muted/30 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Latest Stripe invoice
                </p>
                {latestInvoice ? (
                  <>
                    <div className="mt-2 flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass(latestInvoice.status)}`}
                      >
                        {latestInvoice.status.replaceAll("_", " ")}
                      </span>
                      {latestInvoice.delinquent && (
                        <span className="text-xs font-medium text-destructive">
                          Payment needs attention
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Updated {dateLabel(latestInvoice.updatedAt)}
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No Stripe invoices have been recorded.
                  </p>
                )}
              </div>
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between gap-4">
                <h3 className="text-sm font-semibold">
                  Monthly Flowroute usage
                </h3>
                <span className="text-xs text-muted-foreground">
                  Last 6 periods
                </span>
              </div>
              {account.usage.length ? (
                <div className="mt-3 overflow-hidden rounded-md border border-input">
                  {account.usage.map((usage) => (
                    <div
                      className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-input px-4 py-3 text-sm last:border-b-0"
                      key={usage.id}
                    >
                      <span className="min-w-0 truncate font-medium">
                        {periodLabel(usage.periodStart, usage.periodEnd)}
                      </span>
                      <span className="text-muted-foreground">
                        {quantityLabel(usage.usageQuantity)}
                      </span>
                      <span className="font-medium">
                        {usage.providerCostMinor !== null
                          ? money(usage.providerCostMinor, usage.currency)
                          : exactMoney(usage.providerCostExact, usage.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 rounded-md border border-dashed border-input px-4 py-5 text-sm text-muted-foreground">
                  No Flowroute usage has been collected for this customer yet.
                </p>
              )}
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between gap-4">
                <h3 className="text-sm font-semibold">Recent billing runs</h3>
                <Link
                  className="text-sm font-medium text-primary hover:underline"
                  href="/operations"
                >
                  View operations
                </Link>
              </div>
              {account.runs.length ? (
                <div className="mt-3 overflow-hidden rounded-md border border-input">
                  {account.runs.map((run) => (
                    <div
                      className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-input px-4 py-3 text-sm last:border-b-0"
                      key={run.id}
                    >
                      <span className="min-w-0 truncate font-medium">
                        {periodLabel(run.periodStart, run.periodEnd)}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass(run.status)}`}
                      >
                        {run.status.replaceAll("_", " ")}
                      </span>
                      <span className="font-medium">
                        {money(run.subtotalMinor, run.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 rounded-md border border-dashed border-input px-4 py-5 text-sm text-muted-foreground">
                  No billing runs have been created for this customer yet.
                </p>
              )}
            </div>
          </section>
          <section className="rounded-lg border border-input bg-card p-6">
            <h2 className="text-lg font-semibold">Billing adjustments</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Set recurring customer-specific charges that are included in the
              legacy billing calculation.
            </p>
            {customer.status === "ARCHIVED" ? (
              <p className="mt-5 text-sm text-muted-foreground">
                Restore this customer before changing billing adjustments.
              </p>
            ) : (
              <BillingAdjustmentsForm
                key={`adjustments-${customer.revision}`}
                id={id}
                revision={customer.revision}
                values={billingAdjustments}
              />
            )}
          </section>
          <section className="rounded-lg border border-input bg-card p-6">
            <h2 className="text-lg font-semibold">Flowroute credentials</h2>
            <p className="mt-2 mb-8 text-sm leading-6 text-muted-foreground">
              Status: <strong>{credentials?.status ?? "NOT STORED"}</strong>
              {credentials
                ? ` · Updated ${credentials.updatedAt.toISOString().slice(0, 10)}`
                : ""}
            </p>
            {customer.status !== "ARCHIVED" && (
              <>
                <CredentialsForm
                  key={`keys-${customer.revision}`}
                  id={id}
                  revision={customer.revision}
                  hasStoredCredentials={Boolean(
                    credentials && credentials.status !== "REVOKED",
                  )}
                />
                {credentials && credentials.status !== "REVOKED" && (
                  <CustomerControl
                    key={`revoke-${customer.revision}`}
                    id={id}
                    revision={customer.revision}
                    operation="revoke-credentials"
                    label="Disable stored keys"
                    confirmation="Stop this application from using these keys. This does not revoke them at Flowroute."
                  />
                )}
              </>
            )}
          </section>
          <section className="rounded-lg border border-input bg-card p-6">
            <h2 className="text-lg font-semibold">Customer record</h2>
            {customer.status === "ARCHIVED" ? (
              <CustomerControl
                id={id}
                revision={customer.revision}
                operation="restore"
                label="Restore as draft"
                confirmation="Restore this record as a draft. Stored keys remain disabled."
              />
            ) : (
              <CustomerControl
                key={`archive-${customer.revision}`}
                id={id}
                revision={customer.revision}
                operation="archive"
                label="Archive customer"
                confirmation="Archive this customer and disable stored keys. History is preserved; ongoing billing must be resolved first."
              />
            )}
          </section>
          <section className="rounded-lg border border-input bg-card p-6">
            <h2 className="text-lg font-semibold">Audit history</h2>
            {!data.history.length && (
              <p className="mt-2 text-sm text-muted-foreground">
                No changes recorded.
              </p>
            )}
            <ol className="mt-4 space-y-3">
              {data.history.map((event) => (
                <li
                  className="rounded-md border border-input bg-muted/30 px-4 py-3"
                  key={event.id}
                >
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <strong className="text-sm text-foreground">
                      {auditTitle(event.action)}
                    </strong>
                    <span className="text-xs text-muted-foreground">
                      {auditTime(event.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {event.actorId ? "Administrator" : "System"}
                  </p>
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-medium text-primary hover:underline">
                      View recorded changes
                    </summary>
                    <pre className="mt-3 overflow-wrap-anywhere whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                      {JSON.stringify(
                        { before: event.beforeJson, after: event.afterJson },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </li>
              ))}
            </ol>
            <nav
              className="mt-5 flex justify-between gap-6 text-sm font-medium text-primary"
              aria-label="Audit pages"
            >
              {auditPage > 0 && (
                <Link href={`/customers/${id}?auditPage=${auditPage - 1}`}>
                  Newer changes
                </Link>
              )}
              {data.moreHistory && (
                <Link href={`/customers/${id}?auditPage=${auditPage + 1}`}>
                  Older changes
                </Link>
              )}
            </nav>
          </section>
        </div>
      </div>
    </main>
  );
}
