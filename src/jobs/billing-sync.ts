import "server-only";
import { and, eq, inArray, lte } from "drizzle-orm";
import type { Database } from "../db/client";
import { auditEvents, billingRuns, billingSyncJobs } from "../db/schema";
import { configuredStripe } from "../stripe/server";
import { syncBillingRun } from "../stripe/billing-sync";
import { StripeWorkflowError } from "../stripe/contracts";
import type { BillingSyncJobMessage } from "./contracts";

const LEASE_MS = 120_000;
const RETRY_SECONDS = [60, 300, 900, 3600, 14_400, 43_200, 86_400];

function later(now: Date, seconds: number) {
  return new Date(now.getTime() + seconds * 1000);
}

export function billingSyncJobMessage(jobId: string): BillingSyncJobMessage {
  return { version: 1, kind: "BILLING_SYNC", jobId };
}

export async function dispatchableBillingSyncJobs(
  db: Database,
  now = new Date(),
  limit = 100,
) {
  return db
    .select({ id: billingSyncJobs.id })
    .from(billingSyncJobs)
    .where(
      and(
        inArray(billingSyncJobs.status, ["PENDING", "ENQUEUED"]),
        lte(billingSyncJobs.nextAttemptAt, now),
      ),
    )
    .limit(limit);
}

export async function markBillingSyncJobEnqueued(
  db: Database,
  jobId: string,
  now = new Date(),
) {
  await db
    .update(billingSyncJobs)
    .set({
      status: "ENQUEUED",
      nextAttemptAt: new Date(now.getTime() + LEASE_MS),
    })
    .where(eq(billingSyncJobs.id, jobId));
}

export async function processBillingSyncJob(
  db: Database,
  jobId: string,
  now = new Date(),
) {
  const token = crypto.randomUUID();
  const job = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(billingSyncJobs)
      .where(eq(billingSyncJobs.id, jobId))
      .for("update");
    if (!row || row.status === "COMPLETED" || row.status === "NEEDS_REVIEW")
      return null;
    if (row.processingUntil && row.processingUntil > now) return null;
    await tx
      .update(billingSyncJobs)
      .set({
        status: "ENQUEUED",
        processingToken: token,
        processingUntil: new Date(now.getTime() + LEASE_MS),
      })
      .where(eq(billingSyncJobs.id, row.id));
    return row;
  });
  if (!job) return { status: "IGNORED" as const };
  try {
    const result = await syncBillingRun(
      db,
      configuredStripe().provider,
      job.billingRunId,
    );
    await db.transaction(async (tx) => {
      await tx
        .update(billingSyncJobs)
        .set({
          status: "COMPLETED",
          completedAt: now,
          processingToken: null,
          processingUntil: null,
          lastErrorCode: null,
        })
        .where(
          and(
            eq(billingSyncJobs.id, job.id),
            eq(billingSyncJobs.processingToken, token),
          ),
        );
      await tx.insert(auditEvents).values({
        actorType: "SYSTEM",
        action: "billing_sync.completed",
        entityType: "billing_sync_job",
        entityId: job.id,
        afterJson: { billingRunId: job.billingRunId, status: result.status },
      });
    });
    return result;
  } catch (error) {
    const review =
      error instanceof StripeWorkflowError && error.code === "NEEDS_REVIEW";
    const code = review ? "RECONCILIATION_REQUIRED" : "STRIPE_RETRY_REQUIRED";
    await db.transaction(async (tx) => {
      await tx
        .update(billingSyncJobs)
        .set({
          status: review ? "NEEDS_REVIEW" : "PENDING",
          attemptCount: job.attemptCount + 1,
          nextAttemptAt: review
            ? now
            : later(
                now,
                RETRY_SECONDS[
                  Math.min(job.attemptCount, RETRY_SECONDS.length - 1)
                ],
              ),
          processingToken: null,
          processingUntil: null,
          lastErrorCode: code,
        })
        .where(
          and(
            eq(billingSyncJobs.id, job.id),
            eq(billingSyncJobs.processingToken, token),
          ),
        );
      await tx
        .update(billingRuns)
        .set({
          status: review ? "NEEDS_REVIEW" : "CALCULATED",
          errorCode: code,
        })
        .where(eq(billingRuns.id, job.billingRunId));
    });
    return { status: review ? ("NEEDS_REVIEW" as const) : ("RETRY" as const) };
  }
}
