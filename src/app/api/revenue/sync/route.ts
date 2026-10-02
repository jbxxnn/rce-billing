import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminMutation } from "@/admin/http";
import { syncStripeInvoiceHistory } from "@/stripe/invoice-history";

export async function POST(request: NextRequest) {
  return adminMutation(request, async (fields, db, actor) => {
    const customerId = fields.customerId
      ? z.uuid().parse(fields.customerId)
      : undefined;
    return syncStripeInvoiceHistory(db, actor, customerId);
  });
}
