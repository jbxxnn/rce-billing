import type { NextRequest } from "next/server";
import { adminMutation } from "../admin/http";
import { customerManagementRepository } from "../db/repositories/customer-management";
import type { AuditActor } from "../db/repositories/contracts";
export { json } from "../admin/http";
export function customerMutation(
  request: NextRequest,
  work: (
    fields: Record<string, string>,
    repository: ReturnType<typeof customerManagementRepository>,
    actor: AuditActor,
  ) => Promise<unknown>,
) {
  return adminMutation(request, (fields, db, actor) =>
    work(fields, customerManagementRepository(db), actor),
  );
}
