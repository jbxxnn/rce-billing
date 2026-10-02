import { databaseSource } from "@runtime/database";
import { withDatabase } from "@/db/client";
import { configuredStripe } from "@/stripe/server";
import { verifiedEvent } from "@/stripe/adapter";
import { processStripeEvent } from "@/stripe/webhooks";
export async function POST(request: Request) {
  let runtime: ReturnType<typeof configuredStripe>;
  try {
    runtime = configuredStripe();
    if (
      !runtime.config.webhookSecret?.startsWith("whsec_") ||
      runtime.config.webhookSecret.includes("REPLACE")
    )
      throw new Error();
  } catch {
    return Response.json(
      { error: "Webhook is not configured" },
      { status: 503 },
    );
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature || !request.body)
    return Response.json({ error: "Invalid webhook" }, { status: 400 });
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1024 * 1024) {
        await reader.cancel();
        return Response.json(
          { error: "Webhook is too large" },
          { status: 413 },
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const raw = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.length;
  }
  let event;
  try {
    event = await verifiedEvent(
      runtime.sdk,
      new TextDecoder().decode(raw),
      signature,
      runtime.config.webhookSecret!,
      runtime.config.mode,
    );
  } catch {
    return Response.json(
      { error: "Invalid webhook signature or mode" },
      { status: 400 },
    );
  }
  try {
    await withDatabase(databaseSource(), (db) =>
      processStripeEvent(db, runtime.provider, event, runtime.config.mode),
    );
    return Response.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook processing failed", {
      eventId: event.id,
      eventType: event.type,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return Response.json(
      { error: "Webhook processing will be retried" },
      { status: 503 },
    );
  }
}
