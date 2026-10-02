import "server-only";
import { StripeWorkflowError } from "../stripe/contracts";
import type { NextRequest } from "next/server";
import { databaseSource } from "@runtime/database";
import { withDatabase } from "../db/client";
import { configuration, withAuthentication } from "../auth/server";
import { validOrigin } from "../auth/http";
import { CustomerError } from "../customers/validation";
import type { Database } from "../db/client";
import type { AuditActor } from "../db/repositories/contracts";
import { ZodError } from "zod";
export function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
export async function adminMutation(
  request: NextRequest,
  work: (
    fields: Record<string, string>,
    db: Database,
    actor: AuditActor,
  ) => Promise<unknown>,
) {
  try {
    const config = configuration();
    if (!validOrigin(request, config))
      return json({ error: "Request not permitted" }, 403);
    const admin = await withAuthentication((auth) =>
      auth.administrator(request.cookies.get(config.cookieName)?.value),
    );
    if (!admin) return json({ error: "Sign in to continue" }, 401);
    if (
      request.headers
        .get("content-type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() !== "application/x-www-form-urlencoded" ||
      !request.body
    )
      return json({ error: "Invalid form submission" }, 400);
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16384) {
          await reader.cancel();
          return json({ error: "Form is too large" }, 413);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const params = new URLSearchParams(new TextDecoder().decode(bytes));
    const fields: Record<string, string> = Object.create(null);
    for (const [key, value] of params) {
      if (Object.hasOwn(fields, key))
        return json({ error: "Duplicate form field" }, 400);
      fields[key] = value;
    }
    const result = await withDatabase(databaseSource(), (db) =>
      work(fields, db, {
        appUserId: admin.id,
        requestId: crypto.randomUUID(),
      }),
    );
    return json(result);
  } catch (error) {
    if (error instanceof ZodError)
      return json(
        {
          error: "Check the highlighted fields",
          fields: error.flatten().fieldErrors,
        },
        400,
      );
    if (error instanceof StripeWorkflowError)
      return json({ error: error.message }, error.code === "RETRY" ? 503 : 409);
    if (error instanceof CustomerError)
      return json(
        { error: error.message },
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "UNAUTHORIZED"
            ? 403
            : 409,
      );
    return json(
      {
        error:
          "Unable to save changes. Check the application configuration or try again later.",
      },
      503,
    );
  }
}
