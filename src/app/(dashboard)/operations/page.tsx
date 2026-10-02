import Link from "next/link";
import { AlertTriangle, CheckCircle2, CircleDollarSign, DatabaseZap, RefreshCw } from "lucide-react";
import { operationalOverview } from "@/operations/server";
import { ReplayFlowrouteJob } from "@/operations/replay-flowroute-job";

function money(minor: bigint | null, currency: string) {
  if (minor === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(minor) / 100);
}

function period(start: string, end: string) {
  const format = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${format.format(new Date(`${start}T00:00:00`))} – ${format.format(new Date(`${end}T00:00:00`))}`;
}

function dateTime(value: Date | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(value);
}

function statusClass(status: string) {
  if (["COMPLETED", "SUCCEEDED", "READY"].includes(status)) return "bg-primary/10 text-primary";
  if (["NEEDS_REVIEW", "FAILED", "CANCELED"].includes(status)) return "bg-destructive/10 text-destructive";
  return "bg-muted text-muted-foreground";
}

function Status({ value }: { value: string }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass(value)}`}>{value.replaceAll("_", " ")}</span>;
}

function Customer({ id, name }: { id: string | null; name: string | null }) {
  return id ? <Link className="font-medium text-primary hover:underline" href={`/customers/${id}`}>{name ?? "Unknown customer"}</Link> : <span>{name ?? "Unknown customer"}</span>;
}

export default async function OperationsPage() {
  const data = await operationalOverview();
  const reviewCount = data.flowrouteJobs.length + data.stripeJobs.length;
  const invoiceCount = data.runs.filter((run) => run.stripeInvoiceId).length;
  return (
    <main className="flex w-full flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><span className="text-xs font-semibold tracking-widest text-muted-foreground">BILLING OPERATIONS</span><h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Billing runs</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Monitor Flowroute usage collection, billing calculations, and Stripe synchronization.</p></div>
        <span className="inline-flex items-center gap-2 text-sm text-muted-foreground"><RefreshCw className="size-4" aria-hidden="true" /> Updated when the page loads</span>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-input bg-card p-5"><p className="text-sm text-muted-foreground">Recent billing runs</p><p className="mt-2 text-3xl font-semibold tracking-tight">{data.runs.length}</p><p className="mt-2 text-sm text-muted-foreground">Latest 25 runs</p></div>
        <div className="rounded-lg border border-input bg-card p-5"><p className="text-sm text-muted-foreground">Usage exports</p><p className="mt-2 text-3xl font-semibold tracking-tight">{data.exports.length}</p><p className="mt-2 text-sm text-muted-foreground">Latest 25 Flowroute exports</p></div>
        <div className="rounded-lg border border-input bg-card p-5"><p className="text-sm text-muted-foreground">Stripe invoices linked</p><p className="mt-2 text-3xl font-semibold tracking-tight">{invoiceCount}</p><p className="mt-2 text-sm text-muted-foreground">Among listed billing runs</p></div>
        <div className="rounded-lg border border-input bg-card p-5"><p className="text-sm text-muted-foreground">Needs review</p><p className={`mt-2 text-3xl font-semibold tracking-tight ${reviewCount ? "text-destructive" : "text-primary"}`}>{reviewCount}</p><p className="mt-2 text-sm text-muted-foreground">Flowroute or Stripe jobs</p></div>
      </section>

      {reviewCount > 0 ? <div className="flex gap-3 rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm leading-6 text-destructive"><AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" /><p><span className="font-semibold">Action required.</span> {reviewCount} background job{reviewCount === 1 ? " needs" : "s need"} review before billing can continue safely.</p></div> : <div className="flex gap-3 rounded-lg border border-primary/20 bg-primary/10 p-4 text-sm leading-6 text-primary"><CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" /><p><span className="font-semibold">No jobs need review.</span> The current operation queue is clear.</p></div>}

      <section className="rounded-lg border border-input bg-card">
        <div className="flex items-start justify-between gap-4 border-b border-input px-5 py-5"><div><div className="flex items-center gap-2"><CircleDollarSign className="size-5 text-primary" aria-hidden="true" /><h2 className="text-lg font-semibold">Billing runs</h2></div><p className="mt-1 text-sm text-muted-foreground">Calculated charges and their Stripe invoice connection.</p></div><span className="text-sm text-muted-foreground">{data.runs.length} shown</span></div>
        {data.runs.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-input">{["Customer", "Billing period", "Total", "Status", "Stripe invoice", ""].map((heading) => <th className="bg-muted px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground" key={heading}>{heading}</th>)}</tr></thead><tbody>{data.runs.map((run) => <tr className="border-b border-input transition-colors hover:bg-muted/40 last:border-b-0" key={run.id}><td className="px-4 py-3"><Customer id={run.customerId} name={run.customer} /></td><td className="px-4 py-3 text-muted-foreground">{period(run.periodStart, run.periodEnd)}</td><td className="px-4 py-3 font-medium">{money(run.subtotalMinor, run.currency)}</td><td className="px-4 py-3"><div className="flex flex-wrap items-center gap-2"><Status value={run.status} />{run.errorCode && <span className="text-xs text-destructive">{run.errorCode}</span>}</div></td><td className="px-4 py-3 font-mono text-xs text-muted-foreground">{run.stripeInvoiceId ?? "—"}</td><td className="px-4 py-3 text-right"><Link className="font-medium text-primary hover:underline" href={`/operations/${run.id}`}>Review</Link></td></tr>)}</tbody></table></div> : <p className="px-5 py-10 text-center text-sm text-muted-foreground">No billing runs have been created yet.</p>}
      </section>

      <section className="rounded-lg border border-input bg-card">
        <div className="flex items-start justify-between gap-4 border-b border-input px-5 py-5"><div><div className="flex items-center gap-2"><DatabaseZap className="size-5 text-primary" aria-hidden="true" /><h2 className="text-lg font-semibold">Flowroute usage exports</h2></div><p className="mt-1 text-sm text-muted-foreground">The provider exports used to calculate usage charges.</p></div><span className="text-sm text-muted-foreground">{data.exports.length} shown</span></div>
        {data.exports.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-input">{["Customer", "Usage period", "Status", "Attempts", "Provider export"].map((heading) => <th className="bg-muted px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground" key={heading}>{heading}</th>)}</tr></thead><tbody>{data.exports.map((item) => <tr className="border-b border-input transition-colors hover:bg-muted/40 last:border-b-0" key={item.id}><td className="px-4 py-3"><Customer id={item.customerId} name={item.customer} /></td><td className="px-4 py-3 text-muted-foreground">{period(item.periodStart, item.periodEnd)}</td><td className="px-4 py-3"><div className="flex flex-wrap items-center gap-2"><Status value={item.status} />{item.lastErrorCode && <span className="text-xs text-destructive">{item.lastErrorCode}</span>}</div></td><td className="px-4 py-3">{item.attemptCount}</td><td className="px-4 py-3 font-mono text-xs text-muted-foreground">{item.providerExportId ?? "—"}</td></tr>)}</tbody></table></div> : <p className="px-5 py-10 text-center text-sm text-muted-foreground">No Flowroute usage exports have been requested yet.</p>}
      </section>

      <section className="rounded-lg border border-input bg-card">
        <div className="border-b border-input px-5 py-5"><h2 className="text-lg font-semibold">Jobs requiring review</h2><p className="mt-1 text-sm text-muted-foreground">Replay a Flowroute job after correcting its cause. Stripe jobs require operator review.</p></div>
        {reviewCount ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-input">{["Provider", "Job", "Next attempt", "Error", "Action"].map((heading) => <th className="bg-muted px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground" key={heading}>{heading}</th>)}</tr></thead><tbody>{data.flowrouteJobs.map((job) => <tr className="border-b border-input last:border-b-0" key={job.id}><td className="px-4 py-3 font-medium">Flowroute</td><td className="px-4 py-3 font-mono text-xs text-muted-foreground">{job.id}</td><td className="px-4 py-3 text-muted-foreground">{dateTime(job.nextAttemptAt)}</td><td className="px-4 py-3 text-destructive">{job.lastErrorCode ?? "—"}</td><td className="px-4 py-3"><ReplayFlowrouteJob jobId={job.id} /></td></tr>)}{data.stripeJobs.map((job) => <tr className="border-b border-input last:border-b-0" key={job.id}><td className="px-4 py-3 font-medium">Stripe</td><td className="px-4 py-3 font-mono text-xs text-muted-foreground">{job.id}</td><td className="px-4 py-3 text-muted-foreground">{dateTime(job.nextAttemptAt)}</td><td className="px-4 py-3 text-destructive">{job.lastErrorCode ?? "—"}</td><td className="px-4 py-3 text-sm font-medium text-muted-foreground">Review required</td></tr>)}</tbody></table></div> : <p className="px-5 py-10 text-center text-sm text-muted-foreground">No jobs need review.</p>}
      </section>
    </main>
  );
}
