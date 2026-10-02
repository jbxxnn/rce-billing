import type { NextRequest } from "next/server";
import { z } from "zod";
import { configuredStripe } from "@/stripe/server";
import { stripeService } from "@/stripe/service";
import {
  activationSchema,
  changeCollectionMethodSchema,
  changePlanSchema,
  cancellationSchema,
  retrySchema,
} from "@/stripe/validation";
import { adminMutation } from "@/admin/http";
import { draftUpdateSchema, draftDiscardSchema } from "@/plans/validation";
import { planManagementRepository } from "@/db/repositories/plan-management";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; operation: string }> },
) {
  const { id, operation } = await params;
  return adminMutation(request, (fields, db, actor) => {
    z.uuid().parse(id);
    if (
      [
        "activate",
        "change-plan",
        "change-collection-method",
        "cancel-at-period-end",
        "retry-stripe",
        "delete-unstarted-draft",
      ].includes(operation)
    ) {
      const runtime = configuredStripe();
      const service = stripeService(db, runtime.provider);
      if (operation === "activate")
        return service.start(
          id,
          "activate",
          activationSchema.parse(fields),
          actor,
        );
      if (operation === "change-plan")
        return service.start(
          id,
          "change",
          changePlanSchema.parse(fields),
          actor,
        );
      if (operation === "change-collection-method")
        return service.start(
          id,
          "change",
          changeCollectionMethodSchema.parse(fields),
          actor,
        );
      if (operation === "cancel-at-period-end")
        return service.start(
          id,
          "cancel",
          cancellationSchema.parse(fields),
          actor,
        );
      if (operation === "delete-unstarted-draft")
        return service.abandonUnstartedDraft(
          id,
          retrySchema.parse(fields).workflowId,
          actor,
        );
      return service.retry(id, retrySchema.parse(fields).workflowId, actor);
    }
    const repo = planManagementRepository(db);
    if (operation === "update") {
      const { revision, ...input } = draftUpdateSchema.parse(fields);
      return repo.updateDraft(id, revision, input, actor);
    }
    z.literal("discard").parse(operation);
    const { revision } = draftDiscardSchema.parse(fields);
    return repo.discardDraft(id, revision, actor);
  });
}
