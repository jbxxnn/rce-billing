import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type Stripe from "stripe";
import type { Database } from "../db/client";
import { auditEvents, customers } from "../db/schema";
import type { AuditActor } from "../db/repositories/contracts";
import { CustomerError } from "../customers/validation";
import { bindStripeAccount, stripeRequest } from "./requests";
import { stripeAuthorize } from "./service";
import type { StripeProvider } from "./contracts";
import type { StripeMode } from "./config";

export async function createPaymentMethodPortalLink(
  db: Database,
  sdk: Stripe,
  provider: StripeProvider,
  customerId: string,
  actor: AuditActor,
  returnUrl: string,
  mode: StripeMode,
) {
  await bindStripeAccount(db, provider);
  const customer = await db.transaction(async (tx) => {
    await stripeAuthorize(tx, actor);
    const [row] = await tx
      .select()
      .from(customers)
      .where(eq(customers.id, customerId))
      .for("update");
    if (!row) throw new CustomerError("NOT_FOUND", "Customer not found");
    if (row.status === "ARCHIVED")
      throw new CustomerError(
        "ARCHIVED",
        "Restore this customer before requesting a payment method.",
      );
    return row;
  });
  let stripeCustomerId = customer.stripeCustomerId;
  if (!stripeCustomerId) {
    stripeCustomerId = await stripeRequest(
      db,
      provider,
      `customer:${customer.id}`,
      "customer",
      {
        name: customer.fullName,
        email: customer.email,
        metadata: { internal_customer_id: customer.id },
      },
    );
    const changed = await db
      .update(customers)
      .set({ stripeCustomerId })
      .where(
        and(
          eq(customers.id, customer.id),
          sql`${customers.stripeCustomerId} IS NULL`,
        ),
      )
      .returning({ stripeCustomerId: customers.stripeCustomerId });
    if (!changed.length && customer.stripeCustomerId !== stripeCustomerId)
      throw new CustomerError(
        "CONFLICT",
        "Stripe customer mapping changed. Refresh and try again.",
      );
  }
  const session = await sdk.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
  });
  if (session.livemode !== (mode === "live") || !session.url)
    throw new Error(
      "Stripe did not create a payment-method link in the expected mode",
    );
  await db.transaction(async (tx) => {
    await tx.insert(auditEvents).values({
      actorType: "ADMIN",
      actorId: actor.appUserId,
      requestId: actor.requestId,
      entityType: "customer",
      entityId: customer.id,
      action: "stripe.payment_method_link_created",
      afterJson: { stripeCustomerId },
    });
  });
  return { url: session.url };
}
