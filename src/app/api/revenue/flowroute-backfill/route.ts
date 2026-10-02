import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminMutation } from "@/admin/http";
import { requestFlowrouteUsageBackfill } from "@/flowroute/backfill";

export async function POST(request: NextRequest) {
  return adminMutation(request, (fields, db, actor) =>
    requestFlowrouteUsageBackfill(
      db,
      {
        customerId: z.uuid().parse(fields.customerId),
        usageSnapshotId: z.uuid().parse(fields.usageSnapshotId),
      },
      actor,
    ),
  );
}
