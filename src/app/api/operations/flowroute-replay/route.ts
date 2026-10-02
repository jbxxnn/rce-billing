import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminMutation } from "@/admin/http";
import { replayFlowrouteJob } from "@/jobs/flowroute";

export async function POST(request: NextRequest) {
  return adminMutation(request, async (fields, db) => {
    const jobId = z.uuid().parse(fields.jobId);
    return replayFlowrouteJob(db, jobId);
  });
}
