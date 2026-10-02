import Link from "next/link";
import { z } from "zod";
import { withPlans } from "@/plans/server";
import { Badge } from "@/components/ui/badge";

function statusVariant(status: string) {
  if (status === "ACTIVE") return "default" as const;
  if (status === "DRAFT") return "outline" as const;
  return "secondary" as const;
}
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const query = await searchParams;
  const customer = z.uuid().safeParse(query.customerId);
  const after = z.uuid().safeParse(query.after);
  const customerId = customer.success ? customer.data : undefined;
  const data = await withPlans((r) =>
    r.listSubscriptions({
      customerId,
      after: after.success ? after.data : undefined,
    }),
  );
  const base = customerId
    ? `/subscriptions?customerId=${customerId}`
    : "/subscriptions?";
  return (
    <main className="flex w-full flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><span className="text-xs font-semibold tracking-widest text-muted-foreground">RCE / SUBSCRIPTIONS</span><h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Subscriptions</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Review every plan and billing day before sending anything to Stripe.</p></div>
        <Link
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          href={
            customerId
              ? `/subscriptions/new?customerId=${customerId}`
              : "/customers"
          }
        >
          {customerId ? "New subscription draft" : "Choose a customer"}
        </Link>
      </div>
      <div className="overflow-hidden rounded-lg border border-input bg-card">
        <div className="flex flex-col gap-2 border-b border-input px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">Subscription records</h2>
            <p className="mt-1 text-sm text-muted-foreground">{data.items.length} subscription{data.items.length === 1 ? "" : "s"} shown{customerId ? " for this customer" : ""}.</p>
          </div>
          {customerId && <Link className="text-sm font-medium text-primary hover:underline" href="/subscriptions">View all subscriptions</Link>}
        </div>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-input">
              {['Customer','Plan','Status','Billing day'].map((heading) => <th className="bg-muted px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground" key={heading}>{heading}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.items.map((s) => (
              <tr className="border-t border-input transition-colors hover:bg-muted/40" key={s.id}>
                <td className="p-0"><Link className="block px-4 py-3 font-medium text-primary hover:underline focus-visible:outline-none" href={`/subscriptions/${s.id}`}>{s.customerName}</Link></td>
                <td className="p-0"><Link className="block px-4 py-3 text-foreground focus-visible:outline-none" href={`/subscriptions/${s.id}`}>{s.planName} · v{s.version}</Link></td>
                <td className="p-0"><Link className="block px-4 py-3 focus-visible:outline-none" href={`/subscriptions/${s.id}`}><Badge variant={statusVariant(s.status)}>{s.status.replaceAll("_", " ")}</Badge></Link></td>
                <td className="p-0"><Link className="block px-4 py-3 text-foreground focus-visible:outline-none" href={`/subscriptions/${s.id}`}>Day {s.billingDay}</Link></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
      {!data.items.length && <div className="rounded-lg border border-dashed border-input px-5 py-10 text-center"><h2 className="text-base font-semibold">No subscriptions yet</h2><p className="mt-2 text-sm text-muted-foreground">Start with a customer, then select the plan and collection method for their first draft.</p><Link className="mt-4 inline-flex text-sm font-medium text-primary hover:underline" href="/customers">Choose a customer</Link></div>}
      <nav className="flex justify-between gap-6 text-sm font-medium text-primary">
        {query.after && <Link href={base}>First page</Link>}
        {data.next && (
          <Link href={`${base}&after=${data.next}`}>Next page</Link>
        )}
      </nav>
    </main>
  );
}
