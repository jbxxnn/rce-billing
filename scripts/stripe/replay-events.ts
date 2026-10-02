import { asc, inArray } from "drizzle-orm";
import { withDatabase } from "../../src/db/client";
import { stripeEvents } from "../../src/db/schema";
import { configuredStripe } from "../../src/stripe/server";
import { processStripeEvent } from "../../src/stripe/webhooks";
import type Stripe from "stripe";
try {
  if (!process.env.DATABASE_URL) throw new Error("Database not configured");
  const runtime = configuredStripe();
  await withDatabase(
    { connectionString: process.env.DATABASE_URL },
    async (db) => {
      const rows = await db
        .select()
        .from(stripeEvents)
        .where(
          inArray(stripeEvents.processingStatus, [
            "PENDING",
            "FAILED_RETRYABLE",
          ]),
        )
        .orderBy(asc(stripeEvents.receivedAt))
        .limit(25);
      for (const row of rows) {
        try {
          await processStripeEvent(
            db,
            runtime.provider,
            row.payload as unknown as Stripe.Event,
          );
          console.log(`${row.stripeEventId}: reconciled`);
        } catch {
          console.error(
            `${row.stripeEventId}: remains pending; inspect the saved error code`,
          );
          process.exitCode = 1;
        }
      }
    },
  );
} catch {
  console.error(
    "Stripe replay failed. Check sandbox/database configuration. No credentials were logged.",
  );
  process.exitCode = 1;
}
