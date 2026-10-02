import Link from "next/link";
import { ArrowLeft, CalendarDays, ShieldCheck } from "lucide-react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { withCustomers } from "@/customers/server";
import { PricePicker } from "@/plans/price-picker";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const query = await searchParams;
  const parsed = z.uuid().safeParse(query.customerId);
  if (!parsed.success) notFound();
  const data = await withCustomers((r) => r.detail(parsed.data));
  if (!data) notFound();
  const customer = data.customer;
  return (
    <main className="flex w-full flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Link className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline" href={`/customers/${parsed.data}`}><ArrowLeft className="size-4" aria-hidden="true" /> {customer.fullName}</Link>
        <span className="text-xs font-semibold tracking-widest text-muted-foreground">NEW SUBSCRIPTION</span>
      </div>
      <div className="grid overflow-hidden rounded-xl border bg-card lg:grid-cols-[minmax(0,0.92fr)_minmax(360px,0.68fr)]">
        <section className="border-0 p-6 shadow-none md:p-8">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Set up subscription</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Choose a plan and collection method. You can review it before activation.</p>
          {customer.status === "ARCHIVED" ? (
            <p className="mt-5 text-sm text-destructive">Restore this customer before creating a subscription.</p>
          ) : (
            <PricePicker query={query} customerId={parsed.data} path="/subscriptions/new" />
          )}
        </section>
        <aside className="flex flex-col border-t bg-muted/40 p-6 md:p-8 lg:border-t-0 lg:border-l">
          <span className="text-xs font-semibold tracking-widest text-muted-foreground">SUBSCRIPTION SUMMARY</span>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">{customer.fullName}</h2>
          <div className="mt-6 overflow-hidden rounded-lg border bg-card">
            <div className="flex justify-between gap-5 border-b px-4 py-4 text-sm"><span className="inline-flex items-center gap-2 text-muted-foreground"><CalendarDays className="size-4" aria-hidden="true" /> Billing day</span><strong className="text-right text-xs">Day {customer.billingDay} at 11:00 UTC</strong></div>
            <div className="flex justify-between gap-5 px-4 py-4 text-sm"><span className="inline-flex items-center gap-2 text-muted-foreground"><ShieldCheck className="size-4" aria-hidden="true" /> Activation</span><strong className="text-right text-xs">Configured Stripe environment</strong></div>
          </div>
          <p className="mt-auto pt-6 text-sm leading-6 text-muted-foreground">The draft does not create a Stripe subscription. Activation is a separate, visible step.</p>
        </aside>
      </div>
    </main>
  );
}
