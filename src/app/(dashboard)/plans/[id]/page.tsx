import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { withPlans } from "@/plans/server";
import { PlanForm, PlanAvailability } from "@/plans/forms";
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
  const parsed = z.coerce
    .number()
    .int()
    .min(0)
    .max(10000)
    .safeParse(query.page ?? 0);
  const page = parsed.success ? parsed.data : 0;
  const data = await withPlans((r) => r.planDetail(id, page));
  if (!data) notFound();
  return (
    <main className="flex w-full flex-1 flex-col gap-6 p-4 md:p-6">
      <Link
        className="text-sm font-medium text-primary hover:underline"
        href="/plans"
      >
        ← Plans
      </Link>
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          {data.plan.name}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {data.plan.active ? "Active" : "Inactive"}
        </p>
      </div>
      {query.saved && (
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
            <h2 className="text-lg font-semibold mb-8">Plan configuration</h2>
            <PlanForm key={data.plan.revision} plan={data.plan} />
          </section>
        </div>
        <div className="flex flex-col gap-6">
          <section className="rounded-lg border border-input bg-card p-6">
            <h2 className="text-lg font-semibold">Availability</h2>
            <PlanAvailability {...data.plan} />
          </section>
          <section className="rounded-lg border border-input bg-card p-6">
            <h2 className="text-lg font-semibold">Price history</h2>
            {data.versions.map((v) => (
              <details key={v.id}>
                <summary>
                  Version {v.version} · {v.activeUntil ? "Retired" : "Current"}{" "}
                  · {v.activeFrom.toISOString()}
                </summary>
                <pre className="mt-3 overflow-wrap-anywhere whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                  {JSON.stringify(v.configuration, null, 2)}
                </pre>
              </details>
            ))}
            <nav className="mt-5 flex justify-between gap-6 text-sm font-medium text-primary">
              {page > 0 && (
                <Link href={`/plans/${id}?page=${page - 1}`}>
                  Newer versions
                </Link>
              )}
              {data.moreVersions && (
                <Link href={`/plans/${id}?page=${page + 1}`}>
                  Older versions
                </Link>
              )}
            </nav>
          </section>
        </div>
      </div>
    </main>
  );
}
