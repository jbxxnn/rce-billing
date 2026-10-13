import { sql } from "drizzle-orm";
import { withDatabase } from "../../src/db/client";
import { customers } from "../../src/db/schema";
import { createUsageRepository } from "../../src/db/repositories";
import { flowrouteProvider } from "../../src/flowroute/adapter";
import { flowrouteExportService } from "../../src/flowroute/service";

function usagePeriod(start: string, end: string, comparison: boolean) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end))
    throw new Error("Use dates in YYYY-MM-DD format");
  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T00:00:00.000Z`);
  if (
    Number.isNaN(startDate.getTime()) ||
    Number.isNaN(endDate.getTime()) ||
    startDate >= endDate
  )
    throw new Error("Use a valid start and end date");
  if (comparison) return;
  const expectedEnd = new Date(startDate);
  expectedEnd.setUTCMonth(expectedEnd.getUTCMonth() + 1);
  if (
    startDate.getUTCDate() !== 1 ||
    endDate.getTime() !== expectedEnd.getTime()
  )
    throw new Error(
      "Normal usage exports must cover one full calendar month. Use --comparison only for legacy reconciliation.",
    );
}

const arguments_ = process.argv.slice(2);
const comparison = arguments_[0] === "--comparison";
const [email, periodStart, periodEnd] = comparison
  ? arguments_.slice(1)
  : arguments_;

try {
  if (!process.env.DATABASE_URL || !email || !periodStart || !periodEnd)
    throw new Error(
      "Usage: request-export [--comparison] <customer-email> <period-start> <period-end>",
    );
  usagePeriod(periodStart, periodEnd, comparison);
  await withDatabase(
    { connectionString: process.env.DATABASE_URL },
    async (db) => {
      const [customer] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(sql`lower(${customers.email}) = lower(${email.trim()})`)
        .limit(1);
      if (!customer) throw new Error("Customer was not found");
      const usageExport = await createUsageRepository(db).ensureExport({
        customerId: customer.id,
        periodStart,
        periodEnd,
      });
      const result = await flowrouteExportService(
        db,
        flowrouteProvider(),
      ).process(usageExport.id);
      console.log(`${result.id}: ${result.status}`);
    },
  );
} catch {
  console.error(
    "Flowroute export request did not complete. Inspect the usage-export status; no credentials or provider response were logged.",
  );
  process.exitCode = 1;
}
