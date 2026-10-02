import "server-only";
import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  auditEvents,
  customerProviderCredentials,
  usageExports,
  usageSnapshots,
} from "../db/schema";
import { loadFlowrouteCredentials } from "./credentials";
import {
  FlowrouteError,
  type FlowrouteCredentials,
  type FlowrouteExport,
  type FlowrouteProvider,
} from "./contracts";

const MAX_ATTEMPTS = 8;
const RETRY_SECONDS = [60, 300, 900, 3600, 14_400, 43_200, 86_400, 86_400];
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export class FlowrouteWorkflowError extends Error {
  constructor(
    public readonly code: "BUSY" | "NEEDS_REVIEW" | "RETRY",
    message: string,
  ) {
    super(message);
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function payloadHash(payload: Record<string, unknown>) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical(payload)),
  );
  return Array.from(new Uint8Array(bytes), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

function sanitizedPayload(payload: Record<string, unknown>) {
  const allowed = [
    "id",
    "status",
    "requestedAt",
    "createdAt",
    "expiresAt",
    "totalCost",
    "billedMinutes",
    "numCalls",
    "filterParameters",
  ];
  return Object.fromEntries(
    allowed
      .filter((key) => Object.hasOwn(payload, key))
      .map((key) => [key, payload[key]]),
  );
}

function nextRetry(attempt: number, now: Date, retryAfter?: number) {
  const seconds = Math.max(
    retryAfter ?? 0,
    RETRY_SECONDS[Math.min(attempt - 1, RETRY_SECONDS.length - 1)],
  );
  return new Date(now.getTime() + seconds * 1000);
}

function retryable(error: FlowrouteError) {
  return [
    "RATE_LIMITED",
    "TEMPORARY_PROVIDER_ERROR",
    "UNKNOWN_PROVIDER_ERROR",
  ].includes(error.code);
}

async function audit(
  tx: Tx,
  exportId: string,
  customerId: string,
  action: string,
  afterJson: Record<string, unknown>,
) {
  await tx.insert(auditEvents).values({
    actorType: "SYSTEM",
    action,
    entityType: "usage_export",
    entityId: exportId,
    afterJson: { customerId, provider: "FLOWROUTE", ...afterJson },
  });
}

type ClaimedExport = {
  id: string;
  customerId: string;
  periodStart: string;
  periodEnd: string;
  providerExportId: string | null;
  processingToken: string;
  attemptCount: number;
};

type CompletedExport = { id: string; completed: true };

async function claim(
  db: Database,
  id: string,
  now: Date,
): Promise<ClaimedExport | CompletedExport> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(usageExports)
      .where(eq(usageExports.id, id))
      .for("update");
    if (!row)
      throw new FlowrouteWorkflowError(
        "NEEDS_REVIEW",
        "Usage export not found",
      );
    if (row.status === "COMPLETED") return { id: row.id, completed: true };
    if (row.status === "FAILED_PERMANENT")
      throw new FlowrouteWorkflowError(
        "NEEDS_REVIEW",
        "Usage export requires manual review",
      );
    if (row.nextAttemptAt && row.nextAttemptAt > now)
      throw new FlowrouteWorkflowError(
        "BUSY",
        "Usage export is scheduled for a later retry",
      );
    if (row.processingUntil && row.processingUntil > now)
      throw new FlowrouteWorkflowError(
        "BUSY",
        "Usage export is already being processed",
      );
    const processingToken = crypto.randomUUID();
    const attemptCount = row.attemptCount + 1;
    await tx
      .update(usageExports)
      .set({
        status: "PROCESSING",
        processingToken,
        processingUntil: new Date(now.getTime() + 120_000),
        attemptCount,
        nextAttemptAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      })
      .where(eq(usageExports.id, id));
    return {
      id: row.id,
      customerId: row.customerId,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      providerExportId: row.providerExportId,
      processingToken,
      attemptCount,
    };
  });
}

async function fail(
  db: Database,
  claimed: ClaimedExport,
  error: FlowrouteError,
  now: Date,
  invalidateCredentials = true,
): Promise<never> {
  const canRetry = retryable(error) && claimed.attemptCount < MAX_ATTEMPTS;
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ processingToken: usageExports.processingToken })
      .from(usageExports)
      .where(eq(usageExports.id, claimed.id))
      .for("update");
    if (!row || row.processingToken !== claimed.processingToken) return;
    await tx
      .update(usageExports)
      .set({
        status: canRetry ? "FAILED_RETRYABLE" : "FAILED_PERMANENT",
        processingToken: null,
        processingUntil: null,
        nextAttemptAt: canRetry
          ? nextRetry(claimed.attemptCount, now, error.retryAfterSeconds)
          : null,
        lastErrorCode: error.code,
        lastErrorMessage: error.code,
      })
      .where(eq(usageExports.id, claimed.id));
    if (error.code === "AUTHENTICATION_FAILED" && invalidateCredentials)
      await tx
        .update(customerProviderCredentials)
        .set({ status: "INVALID" })
        .where(eq(customerProviderCredentials.customerId, claimed.customerId));
    await audit(
      tx,
      claimed.id,
      claimed.customerId,
      canRetry ? "flowroute.export_retry_scheduled" : "flowroute.export_failed",
      { errorCode: error.code, attempt: claimed.attemptCount },
    );
  });
  throw new FlowrouteWorkflowError(
    canRetry ? "RETRY" : "NEEDS_REVIEW",
    canRetry
      ? "Flowroute export will retry later"
      : "Flowroute export requires manual review",
  );
}

async function complete(
  db: Database,
  claimed: ClaimedExport,
  providerExport: FlowrouteExport,
  now: Date,
) {
  if (!providerExport.totalCost && !providerExport.billedMinutes)
    throw new FlowrouteError(
      "UNKNOWN_PROVIDER_ERROR",
      "Completed Flowroute export has no usage totals",
    );
  const rawPayload = sanitizedPayload(providerExport.raw);
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(usageExports)
      .where(eq(usageExports.id, claimed.id))
      .for("update");
    if (!row || row.processingToken !== claimed.processingToken)
      throw new FlowrouteWorkflowError(
        "BUSY",
        "Usage export ownership changed",
      );
    if (row.providerExportId && row.providerExportId !== providerExport.id)
      throw new FlowrouteWorkflowError(
        "NEEDS_REVIEW",
        "Flowroute export identity changed",
      );
    await tx
      .insert(usageSnapshots)
      .values({
        customerId: claimed.customerId,
        usageExportId: claimed.id,
        periodStart: claimed.periodStart,
        periodEnd: claimed.periodEnd,
        providerCostExact: providerExport.totalCost ?? null,
        usageQuantity: providerExport.billedMinutes ?? null,
        rawPayload,
        rawPayloadHash: await payloadHash(rawPayload),
        capturedAt: now,
      })
      .onConflictDoNothing();
    const [snapshot] = await tx
      .select({ id: usageSnapshots.id })
      .from(usageSnapshots)
      .where(
        and(
          eq(usageSnapshots.customerId, claimed.customerId),
          eq(usageSnapshots.periodStart, claimed.periodStart),
          eq(usageSnapshots.periodEnd, claimed.periodEnd),
        ),
      );
    if (!snapshot)
      throw new FlowrouteWorkflowError(
        "NEEDS_REVIEW",
        "Usage snapshot could not be recorded",
      );
    await tx
      .update(usageExports)
      .set({
        providerExportId: providerExport.id,
        status: "COMPLETED",
        completedAt: now,
        processingToken: null,
        processingUntil: null,
        nextAttemptAt: null,
      })
      .where(eq(usageExports.id, claimed.id));
    await tx
      .update(customerProviderCredentials)
      .set({ status: "ACTIVE" })
      .where(
        and(
          eq(customerProviderCredentials.customerId, claimed.customerId),
          eq(customerProviderCredentials.status, "UNVERIFIED"),
        ),
      );
    await audit(
      tx,
      claimed.id,
      claimed.customerId,
      "flowroute.export_completed",
      {
        providerExportId: providerExport.id,
        snapshotId: snapshot.id,
        attempt: claimed.attemptCount,
      },
    );
  });
}

export function flowrouteExportService(
  db: Database,
  provider: FlowrouteProvider,
  options: {
    now?: () => Date;
    loadCredentials?: (
      customerId: string,
    ) => Promise<{ credentials: FlowrouteCredentials; status: string } | null>;
  } = {},
) {
  const now = options.now ?? (() => new Date());
  const credentials =
    options.loadCredentials ?? ((id) => loadFlowrouteCredentials(db, id));
  return {
    async process(id: string) {
      const timestamp = now();
      const claimed = await claim(db, id, timestamp);
      if ("completed" in claimed)
        return { id: claimed.id, status: "COMPLETED" as const };
      let loaded: { credentials: FlowrouteCredentials; status: string } | null;
      try {
        loaded = await credentials(claimed.customerId);
      } catch {
        return fail(
          db,
          claimed,
          new FlowrouteError(
            "UNKNOWN_PROVIDER_ERROR",
            "Stored Flowroute credentials cannot be decrypted",
          ),
          timestamp,
        );
      }
      if (!loaded || loaded.status === "INVALID")
        return fail(
          db,
          claimed,
          new FlowrouteError(
            "AUTHENTICATION_FAILED",
            "Flowroute credentials are unavailable or invalid",
          ),
          timestamp,
          false,
        );
      try {
        const providerExport = claimed.providerExportId
          ? await provider.getCdrExport(
              loaded.credentials,
              claimed.providerExportId,
            )
          : await provider.createCdrExport(loaded.credentials, claimed);
        if (providerExport.status === "failed")
          return fail(
            db,
            claimed,
            new FlowrouteError("EXPORT_FAILED", "Flowroute export failed"),
            timestamp,
          );
        if (providerExport.status === "completed") {
          await complete(db, claimed, providerExport, timestamp);
          return { id, status: "COMPLETED" as const };
        }
        await db.transaction(async (tx) => {
          const [row] = await tx
            .select({ processingToken: usageExports.processingToken })
            .from(usageExports)
            .where(eq(usageExports.id, id))
            .for("update");
          if (!row || row.processingToken !== claimed.processingToken)
            throw new FlowrouteWorkflowError(
              "BUSY",
              "Usage export ownership changed",
            );
          await tx
            .update(usageExports)
            .set({
              providerExportId: providerExport.id,
              status: claimed.providerExportId ? "PROCESSING" : "REQUESTED",
              requestedAt: claimed.providerExportId ? undefined : timestamp,
              processingToken: null,
              processingUntil: null,
              nextAttemptAt: nextRetry(claimed.attemptCount, timestamp),
            })
            .where(eq(usageExports.id, id));
          await tx
            .update(customerProviderCredentials)
            .set({ status: "ACTIVE" })
            .where(
              and(
                eq(customerProviderCredentials.customerId, claimed.customerId),
                eq(customerProviderCredentials.status, "UNVERIFIED"),
              ),
            );
          await audit(
            tx,
            id,
            claimed.customerId,
            claimed.providerExportId
              ? "flowroute.export_processing"
              : "flowroute.export_requested",
            {
              providerExportId: providerExport.id,
              attempt: claimed.attemptCount,
            },
          );
        });
        return { id, status: "PROCESSING" as const };
      } catch (error) {
        if (error instanceof FlowrouteWorkflowError) throw error;
        return fail(
          db,
          claimed,
          error instanceof FlowrouteError
            ? error
            : new FlowrouteError(
                "UNKNOWN_PROVIDER_ERROR",
                "Flowroute export could not be processed",
              ),
          timestamp,
        );
      }
    },
  };
}
