import type { NextRequest } from "next/server";
import { adminMutation } from "@/admin/http";
import { planSchema } from "@/plans/validation";
import { planManagementRepository } from "@/db/repositories/plan-management";
export async function POST(request: NextRequest) {
  return adminMutation(request, (fields, db, actor) =>
    planManagementRepository(db).createPlan(planSchema.parse(fields), actor),
  );
}
