import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CircleDollarSign,
  DatabaseZap,
  FileText,
  ReceiptText,
} from "lucide-react";
import { operationalBillingRun } from "@/operations/server";
import { customerIdSchema } from "@/customers/validation";

function money(value: bigint | null | undefined, currency: string) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    Number(value) / 100,
  );
}

function exactMoney(value: string | null) {
  if (!value) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value));
}

function period(start: string, end: string) {
  const format = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return `${format.format(new Date(`${start}T00:00:00`))} – ${format.format(new Date(`${end}T00:00:00`))}`;
}

function statusClass(status: string) {
  if (["COMPLETED", "SUCCEEDED", "READY", "CALCULATED"].includes(status))
    return "bg-primary/10 text-primary";
  if (["NEEDS_REVIEW", "FAILED", "CANCELED"].includes(status))
    return "bg-destructive/10 text-destructive";
  return "bg-muted text-muted-foreground";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "—";
}

function Formula({ type }: { type: string }) {
  const text =
    type === "OTHER"
      ? "Rounded Flowroute cost × plan price + SIP charge + hosting charge"
      : type === "METERED"
        ? "(Rounded Flowroute cost − 35% of plan price) × 4 + phone-number adjustment"
        : type === "UNMETERED"
          ? "Customer channel quantity × channel cost + phone-number adjustment"
          : "Fixed plan price";
  return <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>;
}

export default async function BillingRunDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!customerIdSchema.safeParse(id).success) notFound();
  const data = await operationalBillingRun(id);
  if (!data) notFound();
  const { run, lines } = data;
  const snapshot = asRecord(run.calculationSnapshot);
  const pricing = asRecord(snapshot.pricing);
  const usage = asRecord(snapshot.usage);
  const adjustments = Array.isArray(snapshot.adjustments)
    ? snapshot.adjustments.map(asRecord)
    : [];
  const snapshotType = stringValue(pricing.planType);
  return (
    <main className="flex w-full flex-1 flex-col gap-6 p-4 md:p-6">
      <Link
        className="text-sm font-medium text-primary hover:underline"
        href="/operations"
      >
        ← Billing runs
      </Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="text-xs font-semibold tracking-widest text-muted-foreground">
            BILLING REVIEW
          </span>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
            {run.customer ?? "Customer"}’s billing run
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {period(run.periodStart, run.periodEnd)} ·{" "}
            {run.customerEmail ?? "No email recorded"}
          </p>
        </div>
        <span
          className={`inline-flex w-fit rounded-full px-3 py-1 text-sm font-semibold ${statusClass(run.status)}`}
        >
          {run.status.replaceAll("_", " ")}
        </span>
      </div>

      {run.errorCode && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <span className="font-semibold">{run.errorCode}</span>
          {run.errorMessage ? ` · ${run.errorMessage}` : ""}
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-input bg-card p-5">
          <p className="text-sm text-muted-foreground">Calculated total</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight">
            {money(run.subtotalMinor, run.currency)}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Immutable calculation result
          </p>
        </div>
        <div className="rounded-lg border border-input bg-card p-5">
          <p className="text-sm text-muted-foreground">Flowroute source cost</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight">
            {run.providerCostExact
              ? exactMoney(run.providerCostExact)
              : exactMoney(
                  typeof usage.providerCostExact === "string"
                    ? usage.providerCostExact
                    : null,
                )}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Exact provider value before rounding
          </p>
        </div>
        <div className="rounded-lg border border-input bg-card p-5">
          <p className="text-sm text-muted-foreground">Stripe invoice</p>
          <p className="mt-2 break-all font-mono text-sm font-semibold">
            {run.stripeInvoiceId ?? "Not synchronized"}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Finalization is controlled by the billing workflow
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-input bg-card p-6">
        <div className="flex items-start gap-3">
          <CircleDollarSign
            className="mt-0.5 size-5 text-primary"
            aria-hidden="true"
          />
          <div>
            <h2 className="text-lg font-semibold">Formula and inputs used</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              These values were locked into this run when it was calculated.
              Later customer or plan edits cannot change them.
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-md border border-input bg-muted/30 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Plan
            </p>
            <p className="mt-2 font-semibold">
              {run.planName ?? stringValue(pricing.name)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {snapshotType.replaceAll("_", " ")}
            </p>
          </div>
          <div className="rounded-md border border-input bg-muted/30 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Plan price
            </p>
            <p className="mt-2 font-semibold">
              {typeof pricing.baseAmountMinor === "string"
                ? money(BigInt(pricing.baseAmountMinor), run.currency)
                : "—"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Price version used
            </p>
          </div>
          <div className="rounded-md border border-input bg-muted/30 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Rounded usage
            </p>
            <p className="mt-2 font-semibold">
              {stringValue(
                snapshot.result && asRecord(snapshot.result).usageQuantity,
              )}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              From the Flowroute total
            </p>
          </div>
          <div className="rounded-md border border-input bg-muted/30 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Formula version
            </p>
            <p className="mt-2 font-semibold">{run.formulaVersion}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Locked for this run
            </p>
          </div>
        </div>
        <Formula type={snapshotType} />
      </section>

      <section className="rounded-lg border border-input bg-card">
        <div className="flex items-start gap-3 border-b border-input px-6 py-5">
          <ReceiptText
            className="mt-0.5 size-5 text-primary"
            aria-hidden="true"
          />
          <div>
            <h2 className="text-lg font-semibold">Calculated invoice lines</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              These are the exact line items that are eligible for Stripe
              synchronization.
            </p>
          </div>
        </div>
        {lines.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-input">
                  {["Description", "Formula code", "Amount", "Stripe item"].map(
                    (heading) => (
                      <th
                        className="bg-muted px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                        key={heading}
                      >
                        {heading}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr
                    className="border-b border-input last:border-b-0"
                    key={line.id}
                  >
                    <td className="px-5 py-4 font-medium">
                      {line.description}
                    </td>
                    <td className="px-5 py-4 font-mono text-xs text-muted-foreground">
                      {line.code}
                    </td>
                    <td className="px-5 py-4 font-semibold">
                      {money(line.amountMinor, run.currency)}
                    </td>
                    <td className="px-5 py-4 font-mono text-xs text-muted-foreground">
                      {line.stripeInvoiceItemId ?? "Not synchronized"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            This run has not been calculated yet, so there are no invoice lines
            to review.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-input bg-card p-6">
        <div className="flex items-start gap-3">
          <DatabaseZap
            className="mt-0.5 size-5 text-primary"
            aria-hidden="true"
          />
          <div>
            <h2 className="text-lg font-semibold">Customer adjustments used</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Only adjustments effective during this billing period are
              included.
            </p>
          </div>
        </div>
        {adjustments.length ? (
          <div className="mt-5 overflow-hidden rounded-md border border-input">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-input">
                  <th className="bg-muted px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Adjustment
                  </th>
                  <th className="bg-muted px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Value
                  </th>
                  <th className="bg-muted px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Reason
                  </th>
                </tr>
              </thead>
              <tbody>
                {adjustments.map((adjustment, index) => (
                  <tr
                    className="border-b border-input last:border-b-0"
                    key={`${stringValue(adjustment.id)}-${index}`}
                  >
                    <td className="px-4 py-3 font-medium">
                      {stringValue(adjustment.code).replaceAll("_", " ")}
                    </td>
                    <td className="px-4 py-3">
                      {typeof adjustment.amountMinor === "string"
                        ? money(BigInt(adjustment.amountMinor), run.currency)
                        : stringValue(adjustment.quantity)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {stringValue(adjustment.reason)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-5 rounded-md border border-dashed border-input px-4 py-5 text-sm text-muted-foreground">
            No customer adjustments were included in this run.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-input bg-card p-6">
        <div className="flex items-start gap-3">
          <FileText className="mt-0.5 size-5 text-primary" aria-hidden="true" />
          <div>
            <h2 className="text-lg font-semibold">Review rule</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Check the plan type, usage total, price, and adjustments against
              the customer record before releasing a calculated invoice to
              Stripe.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
