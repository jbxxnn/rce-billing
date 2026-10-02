import "server-only";
import { and, eq } from "drizzle-orm";
import type { AuditActor } from "@/db/repositories/contracts";
import type { Database } from "@/db/client";
import {
  auditEvents,
  backgroundJobs,
  flowrouteUsageBackfills,
  usageExports,
  usageSnapshots,
} from "@/db/schema";
import { calendarMonthBefore } from "./backfill-calendar";

export async function requestFlowrouteUsageBackfill(
  db: Database,
  input: { customerId: string; usageSnapshotId: string },
  actor: AuditActor,
) {
  return db.transaction(async (tx) => {
    const [legacySnapshot] = await tx
      .select({
        id: usageSnapshots.id,
        customerId: usageSnapshots.customerId,
        periodEnd: usageSnapshots.periodEnd,
        usageQuantity: usageSnapshots.usageQuantity,
      })
      .from(usageSnapshots)
      .where(
        and(
          eq(usageSnapshots.id, input.usageSnapshotId),
          eq(usageSnapshots.customerId, input.customerId),
        ),
      )
      .for("update");
    if (!legacySnapshot) throw new Error("Flowroute record was not found");
    if (legacySnapshot.usageQuantity !== null)
      throw new Error("This Flowroute record already has usage quantity");

    const period = calendarMonthBefore(legacySnapshot.periodEnd);
    const [createdExport] = await tx
      .insert(usageExports)
      .values({ customerId: input.customerId, ...period })
      .onConflictDoNothing({
        target: [
          usageExports.customerId,
          usageExports.provider,
          usageExports.periodStart,
          usageExports.periodEnd,
        ],
      })
      .returning({ id: usageExports.id, status: usageExports.status });
    const usageExport =
      createdExport ??
      (
        await tx
          .select({ id: usageExports.id, status: usageExports.status })
          .from(usageExports)
          .where(
            and(
              eq(usageExports.customerId, input.customerId),
              eq(usageExports.provider, "FLOWROUTE"),
              eq(usageExports.periodStart, period.periodStart),
              eq(usageExports.periodEnd, period.periodEnd),
            ),
          )
      )[0];
    if (!usageExport) throw new Error("Flowroute export could not be reserved");

    const [createdBackfill] = await tx
      .insert(flowrouteUsageBackfills)
      .values({
        customerId: input.customerId,
        legacyUsageSnapshotId: legacySnapshot.id,
        usageExportId: usageExport.id,
        createdByAppUserId: actor.appUserId,
      })
      .onConflictDoNothing({
        target: flowrouteUsageBackfills.legacyUsageSnapshotId,
      })
      .returning({ id: flowrouteUsageBackfills.id });

    const backfill =
      createdBackfill ??
      (
        await tx
          .select({ id: flowrouteUsageBackfills.id })
          .from(flowrouteUsageBackfills)
          .where(
            eq(
              flowrouteUsageBackfills.legacyUsageSnapshotId,
              legacySnapshot.id,
            ),
          )
      )[0];
    if (!backfill) throw new Error("Flowroute backfill could not be reserved");

    if (usageExport.status !== "COMPLETED")
      await tx
        .insert(backgroundJobs)
        .values({ usageExportId: usageExport.id, kind: "FLOWROUTE_BACKFILL" })
        .onConflictDoNothing({ target: backgroundJobs.usageExportId });

    await tx.insert(auditEvents).values({
      actorType: "ADMIN",
      actorId: actor.appUserId,
      action: "flowroute.usage_backfill_requested",
      entityType: "flowroute_usage_backfill",
      entityId: backfill.id,
      afterJson: {
        customerId: input.customerId,
        legacyUsageSnapshotId: legacySnapshot.id,
        usageExportId: usageExport.id,
        ...period,
      },
      requestId: actor.requestId,
    });
    return { ...period, status: usageExport.status };
  });
}
