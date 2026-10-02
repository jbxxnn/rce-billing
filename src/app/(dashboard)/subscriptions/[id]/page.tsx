import Link from "next/link";
import { stripeMode, stripeReady } from "@/stripe/server";
import {
  ActivateStripe,
  CancelStripe,
  ChangeToAutomaticCollection,
  DeleteUnstartedDraft,
  RetryStripe,
} from "@/stripe/forms";
import { notFound } from "next/navigation";
import { z } from "zod";
import { withPlans } from "@/plans/server";
import { PricePicker } from "@/plans/price-picker";
import { DiscardDraft } from "@/plans/forms";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, CalendarDays, CreditCard, ShieldCheck } from "lucide-react";

function moneyFromMinor(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount / 100);
}

function dateTime(value: Date | null) {
  if (!value) return "Awaiting Stripe confirmation";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const query = await searchParams;
  const data = await withPlans((r) => r.subscriptionDetail(id));
  if (!data) notFound();
  const ready = stripeReady();
  const mode = stripeMode();
  const modeLabel = mode === "live" ? "live" : "test";
  const editable =
    data.status === "DRAFT" &&
    !data.stripeSubscriptionId &&
    !data.pendingStripeWorkflowId;
  const live =
    Boolean(data.stripeSubscriptionId) &&
    ["ACTIVE", "TRIALING", "PAST_DUE", "UNPAID"].includes(data.status) &&
    !data.pendingStripeWorkflowId;
  const pricing = data.pricing as Record<string, unknown>;
  const pricingTerms = [
    ["Plan type", String(pricing.planType ?? "—").replaceAll("_", " ")],
    ["Monthly base", moneyFromMinor(pricing.baseAmountMinor)],
    pricing.planType === "METERED"
      ? ["Included minutes", String(pricing.includedMinutes ?? "0")]
      : null,
    pricing.planType === "METERED"
      ? ["Additional minute", moneyFromMinor(pricing.additionalMinuteAmountMinor)]
      : null,
    ["Included phone numbers", String(pricing.includedNumbers ?? "0")],
    ["Additional phone number", moneyFromMinor(pricing.numberAmountMinor)],
    pricing.planType === "UNMETERED"
      ? ["Included channels", String(pricing.includedChannels ?? "0")]
      : null,
    pricing.planType === "UNMETERED"
      ? ["Additional channel", moneyFromMinor(pricing.channelAmountMinor)]
      : null,
  ].filter((term): term is [string, string] => term !== null);
  return (
    <main className="flex w-full flex-1 flex-col gap-6 p-4 md:p-6">
      <Link className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline" href={`/subscriptions?customerId=${data.customerId}`}>
        <ArrowLeft className="size-4" aria-hidden="true" /> Subscriptions
      </Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h1 className="text-3xl font-semibold tracking-tight text-foreground">{data.planName}</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        <Link href={`/customers/${data.customerId}`}>{data.customerName}</Link>{" "}
        · Price version {data.version}
      </p></div><Badge variant={data.status === "ACTIVE" ? "default" : data.status === "DRAFT" ? "outline" : "secondary"}>{data.status.replaceAll("_", " ")}</Badge></div>
      {query.saved && <p role="status" className="rounded-md border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary">Changes saved.</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-input bg-card p-6">
          <div className="flex items-center gap-2"><CalendarDays className="size-5 text-primary" aria-hidden="true" /><h2 className="text-lg font-semibold">Subscription summary</h2></div>
          <dl className="mt-5 divide-y divide-border">
            <div className="flex items-center justify-between gap-5 py-3 text-sm"><dt className="text-muted-foreground">Customer</dt><dd className="font-medium"><Link className="text-primary hover:underline" href={`/customers/${data.customerId}`}>{data.customerName}</Link></dd></div>
            <div className="flex items-center justify-between gap-5 py-3 text-sm"><dt className="text-muted-foreground">Billing day</dt><dd className="font-medium">Day {data.billingDay} at 11:00 UTC</dd></div>
            <div className="flex items-center justify-between gap-5 py-3 text-sm"><dt className="text-muted-foreground">Collection</dt><dd className="font-medium">{data.collectionMethod === "send_invoice" ? "Send invoice" : "Charge automatically"}</dd></div>
          </dl>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">Short months use their final calendar day.</p>
        </section>
        <section className="rounded-lg border border-input bg-card p-6"><h2 className="text-lg font-semibold">Assigned pricing</h2>
          <dl className="mt-4 divide-y divide-border">
            {pricingTerms.map(([label, value]) => <div className="flex items-center justify-between gap-5 py-3 text-sm" key={label}><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium">{value}</dd></div>)}
          </dl>
        </section>
      </div>
      {data.anchor && !data.stripeSubscriptionId && (
        <div className="rounded-lg border border-input bg-muted/30 px-5 py-4 text-sm leading-6 text-muted-foreground">
          <span className="font-semibold text-foreground">Proposed first renewal:</span> {dateTime(data.anchor)}. Stripe recalculates this when you activate the subscription.
        </div>
      )}
      {data.cancelAtPeriodEnd && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-5 py-4 text-sm leading-6 text-destructive">
          <span className="font-semibold">Cancellation scheduled:</span> service remains active until {dateTime(data.currentPeriodEnd)}.
        </div>
      )}
      <section className="rounded-lg border border-input bg-card p-6"><div className="flex items-start justify-between gap-4"><div className="flex items-center gap-2"><CreditCard className="size-5 text-primary" aria-hidden="true" /><h2 className="text-lg font-semibold">Stripe {modeLabel} mode</h2></div><span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{mode === "live" ? "Live" : "Sandbox"}</span></div>
        {!ready ? (
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            Configure Stripe credentials to enable subscription activation and
            changes.
          </p>
        ) : (
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            {mode === "live" ? "These actions create or change live Stripe billing." : "These actions use Stripe test mode. No live payments are collected."}
          </p>
        )}
        {data.pendingStripeWorkflowId ? (
          <div className="mt-5 rounded-lg border border-input bg-muted/30 p-4">
            <p className="text-sm leading-6 text-muted-foreground">
              <span className="font-semibold text-foreground">Stripe operation: {data.workflow?.status ?? "PENDING"}.</span>{" "}
              {data.workflow?.errorCode === "RECONCILIATION_REQUIRED"
                ? "The provider result needs manual reconciliation before another action."
                : data.workflow?.errorCode === "PAYMENT_METHOD_REQUIRED"
                  ? <>Add a payment method in <Link className="font-medium text-primary hover:underline" href={`/customers/${data.customerId}`}>this customer&apos;s profile</Link>, then retry this saved operation.</>
                  : "Finish this operation before editing the subscription."}
            </p>
            {ready && data.workflow?.status !== "NEEDS_REVIEW" && (
              <RetryStripe id={id} workflowId={data.pendingStripeWorkflowId} />
            )}
            {data.status === "DRAFT" && !data.stripeSubscriptionId && (
              <div className="mt-5 border-t border-input pt-5">
                <p className="text-sm leading-6 text-muted-foreground">
                  No longer need this subscription? Delete the unfinished draft
                  instead of completing its Stripe activation.
                </p>
                <DeleteUnstartedDraft
                  id={id}
                  workflowId={data.pendingStripeWorkflowId}
                />
              </div>
            )}
          </div>
        ) : ready && editable ? (
          <div className="mt-5 rounded-lg border border-primary/20 bg-primary/5 p-5"><div className="flex gap-3"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" /><div><h3 className="font-semibold">Ready to activate</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">Review the collection settings below, then explicitly create this {modeLabel} subscription in Stripe.</p></div></div><ActivateStripe id={id} revision={data.revision} requestKey={crypto.randomUUID()} sendInvoice={data.collectionMethod === "send_invoice"} mode={modeLabel} /></div>
        ) : ready && live ? (
          <>
            {data.collectionMethod === "send_invoice" && (
              <div className="mt-5 rounded-lg border border-input bg-muted/30 p-5">
                <h3 className="font-semibold">Move to automatic charging</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  The invoice already processed keeps its existing payment method. Future invoices will charge the customer&apos;s saved Stripe payment method on the same billing day.
                </p>
                <ChangeToAutomaticCollection
                  id={id}
                  revision={data.revision}
                  requestKey={crypto.randomUUID()}
                />
              </div>
            )}
            {!data.cancelAtPeriodEnd && (
              <>
                <h3>Change plan</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  The new plan takes effect immediately. Stripe calculates
                  prorated charges or credits.
                </p>
                <PricePicker
                  query={query}
                  customerId={data.customerId}
                  path={`/subscriptions/${id}`}
                  draft={data}
                  live
                />
                <CancelStripe
                  id={id}
                  revision={data.revision}
                  requestKey={crypto.randomUUID()}
                />
              </>
            )}
          </>
        ) : null}
      </section>
      {data.stripeSubscriptionId && (
        <section className="rounded-lg border border-input bg-card p-5">
          <div className="flex items-start gap-3"><CalendarDays className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" /><div><h2 className="font-semibold">Current billing period</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">This period ends {dateTime(data.currentPeriodEnd)}.</p></div></div>
        </section>
      )}
      {editable ? (
        <>
          <section className="rounded-lg border border-input bg-card p-6"><h2 className="text-lg font-semibold">Edit subscription draft</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">You can change the plan or collection method until activation in Stripe.</p>
            <PricePicker
              query={query}
              customerId={data.customerId}
              path={`/subscriptions/${id}`}
              draft={data}
            />
          </section>
          <section className="rounded-lg border border-input bg-card p-6"><h2 className="text-lg font-semibold">Discard draft</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Use this only if this subscription will not be activated.</p>
            <DiscardDraft
              key={data.revision}
              id={id}
              revision={data.revision}
            />
          </section>
        </>
      ) : null}
    </main>
  );
}
