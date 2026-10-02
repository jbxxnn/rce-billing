import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminMutation } from "@/admin/http";
import { planUpdateSchema, planStatusSchema } from "@/plans/validation";
import { planManagementRepository } from "@/db/repositories/plan-management";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; operation: string }> },
) {
  const { id, operation } = await params;
  return adminMutation(request, (fields, db, actor) => {
    z.uuid().parse(id);
    const repo = planManagementRepository(db);
    if (operation === "update") {
      const { revision, ...input } = planUpdateSchema.parse(fields);
      return repo.updatePlan(id, revision, input, actor);
    }
    z.literal("availability").parse(operation);
    const { revision, active } = planStatusSchema.parse(fields);
    return repo.setPlanActive(id, revision, active, actor);
  });
}
