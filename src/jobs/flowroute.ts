import "server-only";
import { and, eq, gte, inArray, lte, notExists, or, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  auditEvents,
  backgroundJobs,
  billingSyncJobs,
  billingRuns,
  customers,
  subscriptions,
  usageExports,
} from "../db/schema";
import {
  FlowrouteWorkflowError,
  flowrouteExportService,
} from "../flowroute/service";
import type { FlowrouteProvider } from "../flowroute/contracts";
import { usagePeriodForBillingDate } from "../domain/billing/calendar";
import type { FlowrouteJobMessage } from "./contracts";
import { calculateBillingRun } from "./billing";

const DISCOVERY_LIMIT = 100;
const DISPATCH_LEASE_SECONDS = 10 * 60;
const BUSY_RETRY_SECONDS = 60;
const FORMULA_VERSION = "legacy-v1";

function monthAnchor(now: Date, billingDay: number) {
  const lastDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      Math.min(billingDay, lastDay),
      11,
    ),
  );
}

function later(now: Date, seconds: number) {
  return new Date(now.getTime() + seconds * 1000);
}

async function audit(
  db: Pick<Database, "insert">,
  action: string,
  entityType: string,
  entityId: string,
  afterJson: Record<string, unknown>,
) {
  await db.insert(auditEvents).values({
    actorType: "SYSTEM",
    action,
    entityType,
    entityId,
    afterJson,
  });
}

/**
 * Creates/reuses the database work for subscriptions whose monthly 11:00 UTC
 * anchor has passed. It performs no provider or queue operation.
 */
export async function discoverFlowrouteWork(db: Database, now = new Date()) {
  const day = now.getUTCDate();
  const lastDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  ).getUTCDate();
  if (now.getUTCHours() < 11) return { candidates: 0, discovered: 0 };
  const period = usagePeriodForBillingDate(now);
  const dueDay =
    day === lastDay
      ? or(
          lte(subscriptions.billingDay, day),
          gte(subscriptions.billingDay, day),
        )
      : lte(subscriptions.billingDay, day);
  const candidates = await db
    .select({
      customerId: customers.id,
      billingDay: subscriptions.billingDay,
      subscriptionId: subscriptions.id,
      planPriceVersionId: subscriptions.planPriceVersionId,
    })
    .from(subscriptions)
    .innerJoin(customers, eq(customers.id, subscriptions.customerId))
    .where(
      and(
        eq(customers.status, "ACTIVE"),
        inArray(subscriptions.status, ["ACTIVE", "PAST_DUE", "TRIALING"]),
        dueDay,
        notExists(
          db
            .select({ one: sql`1` })
            .from(billingRuns)
            .where(
              and(
                eq(billingRuns.customerId, subscriptions.customerId),
                eq(billingRuns.periodStart, period.periodStart),
                eq(billingRuns.periodEnd, period.periodEnd),
              ),
            ),
        ),
      ),
    )
    .orderBy(subscriptions.id)
    .limit(DISCOVERY_LIMIT);
  let discovered = 0;
  for (const candidate of candidates) {
    if (now < monthAnchor(now, candidate.billingDay)) continue;
    await db.transaction(async (tx) => {
      const [newRun] = await tx
        .insert(billingRuns)
        .values({
          customerId: candidate.customerId,
          subscriptionId: candidate.subscriptionId,
          planPriceVersionId: candidate.planPriceVersionId,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          status: "WAITING_FOR_USAGE",
          triggerType: "SCHEDULED",
          formulaVersion: FORMULA_VERSION,
        })
        .onConflictDoNothing({
          target: [
            billingRuns.customerId,
            billingRuns.periodStart,
            billingRuns.periodEnd,
          ],
        })
        .returning({ id: billingRuns.id });
      const [run] = newRun
        ? [newRun]
        : await tx
            .select({ id: billingRuns.id })
            .from(billingRuns)
            .where(
              and(
                eq(billingRuns.customerId, candidate.customerId),
                eq(billingRuns.periodStart, period.periodStart),
                eq(billingRuns.periodEnd, period.periodEnd),
              ),
            );
      if (!run) throw new Error("Billing run reservation failed");
      const [createdExport] = await tx
        .insert(usageExports)
        .values({
          customerId: candidate.customerId,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
        })
        .onConflictDoNothing({
          target: [
            usageExports.customerId,
            usageExports.provider,
            usageExports.periodStart,
            usageExports.periodEnd,
          ],
        })
        .returning({ id: usageExports.id });
      const [usageExport] = createdExport
        ? [createdExport]
        : await tx
            .select({ id: usageExports.id })
            .from(usageExports)
            .where(
              and(
                eq(usageExports.customerId, candidate.customerId),
                eq(usageExports.periodStart, period.periodStart),
                eq(usageExports.periodEnd, period.periodEnd),
              ),
            );
      if (!usageExport) throw new Error("Usage export reservation failed");
      const [job] = await tx
        .insert(backgroundJobs)
        .values({ usageExportId: usageExport.id, billingRunId: run.id })
        .onConflictDoNothing({ target: backgroundJobs.usageExportId })
        .returning({ id: backgroundJobs.id });
      if (newRun || job) {
        discovered += 1;
        await tx.insert(auditEvents).values({
          actorType: "SYSTEM",
          action: newRun
            ? "billing_run.usage_discovered"
            : "flowroute.job_discovered",
          entityType: "background_job",
          entityId: job?.id ?? usageExport.id,
          afterJson: { billingRunId: run.id, usageExportId: usageExport.id },
        });
      }
    });
  }
  return { candidates: candidates.length, discovered };
}

export async function dispatchableFlowrouteJobs(
  db: Database,
  now = new Date(),
  limit = DISCOVERY_LIMIT,
) {
  return db
    .select({ id: backgroundJobs.id })
    .from(backgroundJobs)
    .where(
      and(
        inArray(backgroundJobs.status, ["PENDING", "ENQUEUED"]),
        lte(backgroundJobs.nextAttemptAt, now),
      ),
    )
    .limit(limit);
}

export async function markFlowrouteJobEnqueued(
  db: Database,
  jobId: string,
  now = new Date(),
) {
  await db
    .update(backgroundJobs)
    .set({
      status: "ENQUEUED",
      enqueuedAt: now,
      nextAttemptAt: later(now, DISPATCH_LEASE_SECONDS),
      deliveryAttemptCount: sql`${backgroundJobs.deliveryAttemptCount} + 1`,
    })
    .where(eq(backgroundJobs.id, jobId));
}

export async function processFlowrouteJob(
  db: Database,
  provider: FlowrouteProvider,
  jobId: string,
  now = new Date(),
) {
  const [job] = await db
    .select()
    .from(backgroundJobs)
    .where(eq(backgroundJobs.id, jobId));
  if (!job || job.status === "COMPLETED" || job.status === "NEEDS_REVIEW")
    return { status: "IGNORED" as const };
  try {
    const result = await flowrouteExportService(db, provider, {
      now: () => now,
    }).process(job.usageExportId);
    if (result.status === "COMPLETED") {
      await db.transaction(async (tx) => {
        await tx
          .update(backgroundJobs)
          .set({ status: "COMPLETED", completedAt: now, nextAttemptAt: now })
          .where(eq(backgroundJobs.id, job.id));
        if (job.billingRunId)
          await tx
            .update(billingRuns)
            .set({ status: "CALCULATING" })
            .where(
              and(
                eq(billingRuns.id, job.billingRunId),
                inArray(billingRuns.status, [
                  "DISCOVERED",
                  "WAITING_FOR_USAGE",
                ]),
              ),
            );
        await audit(tx, "flowroute.job_completed", "background_job", job.id, {
          usageExportId: job.usageExportId,
          billingRunId: job.billingRunId,
        });
      });
      if (job.billingRunId) {
        const calculation = await calculateBillingRun(db, job.billingRunId);
        if (calculation.status === "CALCULATED")
          await db
            .insert(billingSyncJobs)
            .values({ billingRunId: job.billingRunId })
            .onConflictDoNothing();
      }
      return { status: "COMPLETED" as const };
    }
    const [exportRecord] = await db
      .select({ nextAttemptAt: usageExports.nextAttemptAt })
      .from(usageExports)
      .where(eq(usageExports.id, job.usageExportId));
    await db
      .update(backgroundJobs)
      .set({
        status: "PENDING",
        nextAttemptAt:
          exportRecord?.nextAttemptAt ?? later(now, BUSY_RETRY_SECONDS),
      })
      .where(eq(backgroundJobs.id, job.id));
    return { status: "PROCESSING" as const };
  } catch (error) {
    if (!(error instanceof FlowrouteWorkflowError)) throw error;
    if (error.code === "NEEDS_REVIEW") {
      await db.transaction(async (tx) => {
        await tx
          .update(backgroundJobs)
          .set({ status: "NEEDS_REVIEW", lastErrorCode: "NEEDS_REVIEW" })
          .where(eq(backgroundJobs.id, job.id));
        if (job.billingRunId)
          await tx
            .update(billingRuns)
            .set({ status: "NEEDS_REVIEW", errorCode: "FLOWROUTE_USAGE" })
            .where(eq(billingRuns.id, job.billingRunId));
        await audit(
          tx,
          "flowroute.job_needs_review",
          "background_job",
          job.id,
          { usageExportId: job.usageExportId, billingRunId: job.billingRunId },
        );
      });
      return { status: "NEEDS_REVIEW" as const };
    }
    await db
      .update(backgroundJobs)
      .set({
        status: "PENDING",
        nextAttemptAt: later(now, BUSY_RETRY_SECONDS),
        lastErrorCode: error.code,
      })
      .where(eq(backgroundJobs.id, job.id));
    return {
      status: error.code === "BUSY" ? ("BUSY" as const) : ("RETRY" as const),
    };
  }
}

/** An operator-only recovery action. Completed usage can never be replayed. */
export async function replayFlowrouteJob(
  db: Database,
  jobId: string,
  now = new Date(),
) {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(backgroundJobs)
      .where(eq(backgroundJobs.id, jobId))
      .for("update");
    if (!job) throw new Error("Background job not found");
    if (job.status !== "NEEDS_REVIEW")
      throw new Error("Only a job requiring review can be replayed");
    const [usageExport] = await tx
      .select()
      .from(usageExports)
      .where(eq(usageExports.id, job.usageExportId))
      .for("update");
    if (!usageExport || usageExport.status === "COMPLETED")
      throw new Error("Completed usage cannot be replayed");
    await tx
      .update(usageExports)
      .set({
        status: "PENDING",
        attemptCount: 0,
        nextAttemptAt: now,
        processingToken: null,
        processingUntil: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      })
      .where(eq(usageExports.id, usageExport.id));
    await tx
      .update(backgroundJobs)
      .set({
        status: "PENDING",
        nextAttemptAt: now,
        lastErrorCode: "MANUAL_REPLAY",
        completedAt: null,
      })
      .where(eq(backgroundJobs.id, job.id));
    if (job.billingRunId)
      await tx
        .update(billingRuns)
        .set({
          status: "WAITING_FOR_USAGE",
          errorCode: null,
          errorMessage: null,
        })
        .where(eq(billingRuns.id, job.billingRunId));
    await audit(tx, "flowroute.job_replayed", "background_job", job.id, {
      usageExportId: job.usageExportId,
      billingRunId: job.billingRunId,
    });
    return { id: job.id, status: "PENDING" as const };
  });
}

export function flowrouteJobMessage(jobId: string): FlowrouteJobMessage {
  return { version: 1, jobId };
}
