import Link from "next/link";
import {
  ArrowRight,
  CircleDollarSign,
  CreditCard,
  TriangleAlert,
  WalletCards,
} from "lucide-react";
import { revenueOverview } from "@/revenue/server";
import { SyncStripeHistory } from "@/revenue/sync-stripe-history";

function money(value: bigint, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    Number(value) / 100,
  );
}

function usageMoney(value: string | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(value));
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

export default async function RevenuePage() {
  const data = await revenueOverview();
  const cards = [
    {
      label: "Billed in the last 30 days",
      value: money(data.billedLast30Days),
      detail: "Invoices created in Stripe",
      icon: CircleDollarSign,
    },
    {
      label: "Payments in the last 30 days",
      value: money(data.paidLast30Days),
      detail: "Money Stripe recorded as paid",
      icon: WalletCards,
    },
    {
      label: "Open balance",
      value: money(data.outstandingMinor),
      detail: "Still outstanding across Stripe invoices",
      icon: CreditCard,
    },
    {
      label: "Overdue or uncollectible",
      value: money(data.overdueMinor),
      detail: "Balances that need follow-up",
      icon: TriangleAlert,
    },
  ];

  return (
    <main className="flex w-full flex-1 flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-col gap-4 border-b border-input pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="text-xs font-semibold tracking-widest text-muted-foreground">
            RCE / FINANCE
          </span>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
            Revenue &amp; collections
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Actual Stripe invoices and payments, alongside the latest Flowroute
            cost for each customer.
          </p>
        </div>
        <SyncStripeHistory />
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
        <div className="flex flex-col gap-3 border-b border-input px-5 py-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Customer collections
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {data.invoiceCount
                ? `${data.invoiceCount} Stripe invoice${data.invoiceCount === 1 ? "" : "s"} synced${data.latestSyncedAt ? ` · last synced ${date(data.latestSyncedAt)}` : ""}`
                : "Sync Stripe invoice history to begin."}
            </p>
          </div>
          <p className="max-w-lg text-sm leading-5 text-muted-foreground">
            Compare the newest invoice with the previous one. A lower Flowroute
            cost often explains a lower invoice, while an open or overdue
            balance needs follow-up.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-left text-sm">
            <thead>
              <tr className="border-b border-input bg-muted">
                {[
                  "Customer",
                  "Latest invoice",
                  "Previous invoice",
                  "Change",
                  "Latest Flowroute cost",
                  "Balance",
                  "Collection status",
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
              {data.customers.map((customer) => {
                const invoice = customer.latestInvoice;
                return (
                  <tr
                    key={customer.id}
                    className="border-b border-input transition-colors last:border-b-0 hover:bg-muted/40"
                  >
                    <td className="p-0">
                      <Link
                        href={`/revenue/customers/${customer.id}`}
                        className="block px-5 py-4"
                      >
                        <span className="font-medium text-primary hover:underline">
                          {customer.name}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {customer.email}
                        </span>
                      </Link>
                    </td>
                    <td className="p-0">
                      <Link
                        href={`/revenue/customers/${customer.id}`}
                        className="block px-5 py-4"
                      >
                        <span className="font-medium">
                          {invoice
                            ? money(invoice.totalMinor, invoice.currency)
                            : "—"}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {invoice
                            ? date(invoice.invoiceCreatedAt)
                            : "No Stripe invoice"}
                        </span>
                      </Link>
                    </td>
                    <td className="p-0">
                      <Link
                        href={`/revenue/customers/${customer.id}`}
                        className="block px-5 py-4 text-muted-foreground"
                      >
                        {customer.previousInvoice
                          ? money(
                              customer.previousInvoice.totalMinor,
                              customer.previousInvoice.currency,
                            )
                          : "—"}
                      </Link>
                    </td>
                    <td className="p-0">
                      <Link
                        href={`/revenue/customers/${customer.id}`}
                        className="block px-5 py-4 font-medium"
                      >
                        {customer.invoiceChangeMinor === null
                          ? "—"
                          : `${customer.invoiceChangeMinor > 0n ? "+" : ""}${money(customer.invoiceChangeMinor, invoice?.currency)}`}
                      </Link>
                    </td>
                    <td className="p-0">
                      <Link
                        href={`/revenue/customers/${customer.id}`}
                        className="block px-5 py-4"
                      >
                        <span className="font-medium">
                          {usageMoney(
                            customer.latestUsage?.providerCostExact ?? null,
                          )}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {customer.latestUsage
                            ? `${customer.latestUsage.periodStart} – ${customer.latestUsage.periodEnd}`
                            : "No Flowroute record"}
                        </span>
                      </Link>
                    </td>
                    <td className="p-0">
                      <Link
                        href={`/revenue/customers/${customer.id}`}
                        className="block px-5 py-4 font-medium"
                      >
                        {invoice
                          ? money(
                              invoice.amountRemainingMinor,
                              invoice.currency,
                            )
                          : "—"}
                      </Link>
                    </td>
                    <td className="p-0">
                      <Link
                        href={`/revenue/customers/${customer.id}`}
                        className="block px-5 py-4"
                      >
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass(customer.collectionStatus)}`}
                        >
                          {customer.collectionStatus}
                        </span>
                        {invoice?.dueAt ? (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            Due {date(invoice.dueAt)}
                          </span>
                        ) : null}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {data.customers.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">
            No customers yet.
          </div>
        ) : null}
      </section>

      <Link
        href="/customers"
        className="inline-flex w-fit items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        Open customer directory{" "}
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </main>
  );
}
