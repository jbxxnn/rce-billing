import Link from "next/link";
import { withPlans } from "@/plans/server";
import { PlanDataTable } from "@/plans/plan-data-table";
import { z } from "zod";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const query = await searchParams;
  const q = (query.q ?? "").slice(0, 160);
  const after = z.uuid().safeParse(query.after);
  const data = await withPlans((r) =>
    r.listPlans({ q, after: after.success ? after.data : undefined }),
  );
  return (
    <main className="flex w-full flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Plans</h1>
        <Link href="/plans/new" className="inline-flex h-10 items-center justify-center rounded-md bg-foreground px-4 text-sm font-medium text-background hover:bg-foreground/90">
          New plan
        </Link>
      </div>
      <PlanDataTable data={data.items} initialSearch={q} />
      {!data.items.length && <p className="text-sm text-muted-foreground">No plans found.</p>}
      <nav className="flex justify-between gap-6 text-sm font-medium text-primary">
        {query.after && (
          <Link href={`/plans?q=${encodeURIComponent(q)}`}>First page</Link>
        )}
        {data.next && (
          <Link href={`/plans?q=${encodeURIComponent(q)}&after=${data.next}`}>
            Next page
          </Link>
        )}
      </nav>
    </main>
  );
}
