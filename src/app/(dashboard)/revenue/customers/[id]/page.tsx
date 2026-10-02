import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CircleDollarSign, Clock3, WalletCards } from "lucide-react";
import { customerIdSchema } from "@/customers/validation";
import { revenueCustomerDetail } from "@/revenue/server";
import { RequestFlowrouteBackfill } from "@/revenue/request-flowroute-backfill";
import { SyncStripeHistory } from "@/revenue/sync-stripe-history";
import { Button } from "@/components/ui/button";

function money(value: bigint, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    Number(value) / 100,
  );
}

function exactMoney(value: string | null, currency: string) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    Number(value),
  );
}

function usageQuantity(value: string | null) {
  if (value === null) return null;
  const quantity = Number(value);
  if (!Number.isFinite(quantity)) return null;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(quantity);
}

function date(value: Date | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

function statusClass(status: string) {
  if (status === "PAID") return "bg-primary/10 text-primary";
  if (["OVERDUE", "UNCOLLECTIBLE"].includes(status))
    return "bg-destructive/10 text-destructive";
  if (status === "OPEN")
    return "bg-amber-500/15 text-amber-800 dark:text-amber-300";
  return "bg-muted text-muted-foreground";
}

export default async function RevenueCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!customerIdSchema.safeParse(id).success) notFound();
  const data = await revenueCustomerDetail(id);
  if (!data) notFound();
  const { customer } = data;
  const cards = [
    {
      label: "Total billed",
      value: money(data.totals.billedMinor),
      detail: "All synced Stripe invoices",
      icon: CircleDollarSign,
    },
    {
      label: "Total paid",
      value: money(data.totals.paidMinor),
      detail: "Payments Stripe recorded",
      icon: WalletCards,
    },
    {
      label: "Open balance",
      value: money(data.totals.openBalanceMinor),
      detail: "Still owed on non-void invoices",
      icon: Clock3,
    },
    {
      label: "Overdue or uncollectible",
      value: money(data.totals.overdueBalanceMinor),
      detail: "Requires collection follow-up",
      icon: Clock3,
    },
  ];

  return (
    <main className="flex w-full flex-1 flex-col gap-6 p-4 md:p-6">
      <Link
        href="/dashboard"
        className="inline-flex w-fit items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> Dashboard
      </Link>
      <header className="flex flex-col gap-4 border-b border-input pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="text-xs font-semibold tracking-widest text-muted-foreground">
            CUSTOMER LEDGER
          </span>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
            {customer.name}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {customer.email} · Billing day {customer.billingDay}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <Link href={`/customers/${customer.id}`}>Update customer</Link>
          </Button>
          {customer.stripeCustomerId ? (
            <SyncStripeHistory customerId={customer.id} />
          ) : null}
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, detail, icon: Icon }) => (
          <article
            key={label}
            className="rounded-xl border border-input bg-card p-5"
          >
            <div className="flex items-start justify-between gap-4">
              <p className="text-sm font-medium text-muted-foreground">
                {label}
              </p>
              <Icon className="size-4 text-primary" aria-hidden="true" />
            </div>
            <p className="mt-4 text-3xl font-semibold tracking-tight text-foreground">
              {value}
            </p>
            <p className="mt-3 text-sm leading-5 text-muted-foreground">
              {detail}
            </p>
          </article>
        ))}
      </section>

      <section className="overflow-hidden rounded-xl border border-input bg-card">
        <div className="border-b border-input px-5 py-5">
          <h2 className="text-lg font-semibold text-foreground">
            Stripe invoice history
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every synced invoice, what was paid, and what remains.
          </p>
        </div>
        {data.invoices.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-input bg-muted">
                  {[
                    "Invoice",
                    "Created",
                    "Flowroute cost",
                    "Total",
                    "Paid",
                    "Balance",
                    "Due date",
                    "Status",
                  ].map((heading) => (
                    <th
                      key={heading}
                      className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((invoice) => (
                  <tr
                    key={invoice.id}
                    className="border-b border-input last:border-b-0 hover:bg-muted/40"
                  >
                    <td className="px-5 py-4 font-mono text-xs text-muted-foreground">
                      {invoice.id}
                    </td>
                    <td className="px-5 py-4">
                      {date(invoice.invoiceCreatedAt)}
                    </td>
                    <td className="px-5 py-4 font-medium">
                      {invoice.flowroute
                        ? invoice.flowroute.providerCostMinor === null
                          ? exactMoney(
                              invoice.flowroute.providerCostExact,
                              invoice.flowroute.currency,
                            )
                          : money(
                              invoice.flowroute.providerCostMinor,
                              invoice.flowroute.currency,
                            )
                        : "—"}
                      {invoice.flowroute ? (
                        <span className="mt-1 block text-xs font-normal text-muted-foreground">
                          {invoice.flowroute.periodStart} –{" "}
                          {invoice.flowroute.periodEnd}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-5 py-4 font-medium">
                      {money(invoice.totalMinor, invoice.currency)}
                    </td>
                    <td className="px-5 py-4">
                      {money(invoice.amountPaidMinor, invoice.currency)}
                      {invoice.paidAt ? (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {date(invoice.paidAt)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-5 py-4 font-medium">
                      {money(invoice.amountRemainingMinor, invoice.currency)}
                    </td>
                    <td className="px-5 py-4">{date(invoice.dueAt)}</td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass(invoice.collectionStatus)}`}
                      >
                        {invoice.collectionStatus}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {invoice.collectionMethod.replaceAll("_", " ")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">
            No Stripe invoices have been synced yet. Use Sync Stripe history to
            load them.
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-input bg-card">
        <div className="border-b border-input px-5 py-5">
          <h2 className="text-lg font-semibold text-foreground">
            Flowroute cost history
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use this beside invoice totals to understand why a month changed.
          </p>
        </div>
        {data.usage.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead>
                <tr className="border-b border-input bg-muted">
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Billing period
                  </th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Flowroute usage quantity
                  </th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Flowroute cost
                  </th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Historical usage
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.usage.map((usage) => (
                  <tr
                    key={usage.id}
                    className="border-b border-input last:border-b-0"
                  >
                    <td className="px-5 py-4">
                      {usage.periodStart} – {usage.periodEnd}
                    </td>
                    <td className="px-5 py-4 text-muted-foreground">
                      {usageQuantity(
                        usage.usageQuantity ??
                          usage.backfill?.usageQuantity ??
                          null,
                      ) ?? (
                        <span title="The legacy record only included Flowroute cost, not usage quantity.">
                          Not captured in legacy record
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 font-medium">
                      {usage.providerCostMinor === null
                        ? exactMoney(usage.providerCostExact, usage.currency)
                        : money(usage.providerCostMinor, usage.currency)}
                    </td>
                    <td className="px-5 py-4">
                      {usage.usageQuantity === null &&
                      data.backfillAvailable ? (
                        <RequestFlowrouteBackfill
                          customerId={customer.id}
                          usageSnapshotId={usage.id}
                          status={usage.backfill?.status}
                        />
                      ) : usage.usageQuantity !== null ? (
                        <span className="text-xs text-muted-foreground">
                          Captured
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Unavailable
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">
            No Flowroute records are available for this customer.
          </div>
        )}
      </section>
    </main>
  );
}
