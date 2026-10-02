import Link from "next/link";
import { ArrowLeft, CircleCheck } from "lucide-react";
import { requireAdministrator } from "@/auth/server";
import { PlanForm } from "@/plans/forms";

export default async function Page() {
  await requireAdministrator();
  return (
    <main className="flex w-full flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Link className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline" href="/plans"><ArrowLeft className="size-4" aria-hidden="true" /> Plans</Link>
        <span className="text-xs font-semibold tracking-widest text-muted-foreground">NEW PLAN</span>
      </div>
      <div className="grid overflow-hidden rounded-xl border bg-card lg:grid-cols-[minmax(0,0.92fr)_minmax(360px,0.68fr)]">
        <section className="border-0 p-6 shadow-none md:p-8">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Create a plan</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Define the recurring charge and the usage settings for this service.</p>
          <PlanForm />
        </section>
        <aside className="flex flex-col border-t bg-muted/40 p-6 md:p-8 lg:border-t-0 lg:border-l">
          <span className="text-xs font-semibold tracking-widest text-muted-foreground">PLAN PREVIEW</span>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">Ready to review</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Your selected pricing settings will become an immutable version when you save.</p>
          <div className="mt-6 overflow-hidden rounded-lg border bg-card">
            <div className="flex justify-between gap-5 border-b px-4 py-4 text-sm"><span className="text-muted-foreground">Monthly billing</span><strong className="text-right text-xs">Configured at activation</strong></div>
            <div className="flex justify-between gap-5 border-b px-4 py-4 text-sm"><span className="text-muted-foreground">Usage handling</span><strong className="text-right text-xs">Flowroute verified</strong></div>
            <div className="flex justify-between gap-5 px-4 py-4 text-sm"><span className="text-muted-foreground">Price history</span><strong className="text-right text-xs">Preserved automatically</strong></div>
          </div>
          <p className="mt-auto flex gap-2 pt-6 text-sm leading-6 text-muted-foreground"><CircleCheck className="size-4 shrink-0 text-primary" aria-hidden="true" /> Existing subscriptions keep their previous price version.</p>
        </aside>
      </div>
    </main>
  );
}
