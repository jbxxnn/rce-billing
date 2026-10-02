import "server-only";
import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { stripeConnection, stripeRequests } from "../db/schema";
import {
  StripeWorkflowError,
  type RequestKind,
  type StripeProvider,
} from "./contracts";
export async function bindStripeAccount(
  db: Database,
  provider: StripeProvider,
) {
  const accountId = await provider.account();
  await db
    .insert(stripeConnection)
    .values({ id: "test", accountId })
    .onConflictDoNothing();
  const [bound] = await db
    .select()
    .from(stripeConnection)
    .where(eq(stripeConnection.id, "test"));
  if (bound.accountId !== accountId)
    throw new StripeWorkflowError(
      "NEEDS_REVIEW",
      "This database is linked to a different Stripe sandbox.",
    );
}
/** Persist the exact input BEFORE any external write. Claims never hold DB locks over HTTP. */
export async function stripeRequest(
  db: Database,
  provider: StripeProvider,
  operationKey: string,
  kind: RequestKind,
  input: Record<string, unknown>,
  now = () => new Date(),
): Promise<string> {
  await db
    .insert(stripeRequests)
    .values({ operationKey, kind, input })
    .onConflictDoNothing();
  const token = crypto.randomUUID();
  const claim = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(stripeRequests)
      .where(eq(stripeRequests.operationKey, operationKey))
      .for("update");
    if (row.kind !== kind)
      throw new StripeWorkflowError(
        "NEEDS_REVIEW",
        "Provider request identity mismatch.",
      );
    if (row.status === "SUCCEEDED") return { row, ready: true };
    if (
      row.status === "NEEDS_REVIEW" ||
      (row.firstAttemptAt &&
        now().getTime() - row.firstAttemptAt.getTime() >= 23 * 60 * 60 * 1000)
    ) {
      await tx
        .update(stripeRequests)
        .set({ status: "NEEDS_REVIEW", leaseToken: null, leaseUntil: null })
        .where(eq(stripeRequests.id, row.id));
      return { row, expired: true };
    }
    if (row.leaseUntil && row.leaseUntil > now())
      throw new StripeWorkflowError(
        "BUSY",
        "This Stripe request is already running. Retry shortly.",
      );
    await tx
      .update(stripeRequests)
      .set({
        leaseToken: token,
        leaseUntil: new Date(now().getTime() + 60_000),
        firstAttemptAt: row.firstAttemptAt ?? now(),
      })
      .where(eq(stripeRequests.id, row.id));
    return { row };
  });
  if (claim.ready) return claim.row.providerId!;
  if (claim.expired)
    throw new StripeWorkflowError(
      "NEEDS_REVIEW",
      "A Stripe result is uncertain beyond the safe retry window. Reconcile it before continuing.",
    );
  try {
    const providerId = await provider.execute(
      kind,
      claim.row.input,
      `rce:test:${claim.row.id}`,
    );
    const changed = await db
      .update(stripeRequests)
      .set({
        providerId,
        status: "SUCCEEDED",
        completedAt: now(),
        leaseToken: null,
        leaseUntil: null,
      })
      .where(
        and(
          eq(stripeRequests.id, claim.row.id),
          eq(stripeRequests.leaseToken, token),
        ),
      )
      .returning({ id: stripeRequests.id });
    if (!changed.length)
      throw new StripeWorkflowError(
        "BUSY",
        "Stripe request ownership changed. Retry to load the saved result.",
      );
    return providerId;
  } catch (error) {
    await db
      .update(stripeRequests)
      .set({ leaseToken: null, leaseUntil: null })
      .where(
        and(
          eq(stripeRequests.id, claim.row.id),
          eq(stripeRequests.leaseToken, token),
        ),
      );
    throw error;
  }
}
