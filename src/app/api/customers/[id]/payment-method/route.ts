import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminMutation } from "@/admin/http";
import { configuration } from "@/auth/server";
import { configuredStripe } from "@/stripe/server";
import { createPaymentMethodPortalLink } from "@/stripe/payment-methods";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return adminMutation(request, async (_fields, db, actor) => {
    const customerId = z.uuid().parse(id);
    const runtime = configuredStripe();
    return createPaymentMethodPortalLink(
      db,
      runtime.sdk,
      runtime.provider,
      customerId,
      actor,
      `${configuration().origin}/customers/${customerId}?paymentMethod=returned`,
      runtime.config.mode,
    );
  });
}
