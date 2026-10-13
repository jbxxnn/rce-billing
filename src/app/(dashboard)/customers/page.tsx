import Link from "next/link";
import { withCustomers } from "@/customers/server";
import { searchSchema } from "@/customers/validation";
import { CustomerDataTable } from "@/customers/customer-data-table";
export const dynamic = "force-dynamic";
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const parsed = searchSchema.safeParse(await searchParams);
  const filter = parsed.success ? parsed.data : searchSchema.parse({});
  const result = await withCustomers((repository) => repository.list(filter));
  const next = new URLSearchParams({
    q: filter.q,
    status: filter.status,
    ...(result.next ? { after: result.next } : {}),
  });
  return (
    <main className="flex w-full flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Customers
        </h1>
        <Link
          className="inline-flex h-10 items-center justify-center rounded-md bg-foreground px-4 text-sm font-medium text-background hover:bg-foreground/90"
          href="/customers/new"
        >
          New customer
        </Link>
      </div>
      <CustomerDataTable
        data={result.items}
        initialSearch={filter.q}
        initialStatus={filter.status}
      />
      {!result.items.length && (
        <section className="rounded-lg border border-input bg-card p-6">
          <h2 className="text-lg font-semibold">No customers found</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Try another search, or create your first customer.
          </p>
        </section>
      )}
      <nav
        className="flex justify-between gap-6 text-sm font-medium text-primary"
        aria-label="Customer pages"
      >
        {filter.after && (
          <Link
            href={`/customers?${new URLSearchParams({ q: filter.q, status: filter.status })}`}
          >
            First page
          </Link>
        )}
        {result.next && <Link href={`/customers?${next}`}>Next page →</Link>}
      </nav>
    </main>
  );
}
