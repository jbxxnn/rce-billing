import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { customers, plans, planPriceVersions } from "../../src/db/schema";

/** Synthetic, non-billable development fixtures. No provider IDs or credentials. */
export async function seedDevelopment(connectionString: string) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
  });
  try {
    await client.connect();
    await drizzle(client).transaction(async (tx) => {
      await tx
        .insert(customers)
        .values({
          id: "00000000-0000-4000-8000-000000000001",
          fullName: "Example Customer",
          email: "billing@example.invalid",
          billingDay: 15,
          status: "DRAFT",
        })
        .onConflictDoNothing();
      for (const [i, type] of (
        ["FIXED", "METERED", "UNMETERED", "OTHER"] as const
      ).entries()) {
        const planId = `00000000-0000-4000-8000-00000000001${i}`;
        await tx
          .insert(plans)
          .values({
            id: planId,
            name: `Example ${type.toLowerCase()} plan`,
            planType: type,
            baseAmountMinor: 10000n,
            active: false,
          })
          .onConflictDoNothing();
        await tx
          .insert(planPriceVersions)
          .values({
            id: `00000000-0000-4000-8000-00000000002${i}`,
            planId,
            version: 1,
            pricingConfiguration: {
              fixture: true,
              approvedForBilling: false,
              baseAmountMinor: "10000",
              currency: "USD",
              planType: type,
            },
            activeFrom: new Date("2026-01-01T00:00:00Z"),
          })
          .onConflictDoNothing();
      }
    });
  } finally {
    await client.end();
  }
}
