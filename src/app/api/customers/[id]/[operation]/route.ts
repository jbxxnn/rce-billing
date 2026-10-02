import type { NextRequest } from "next/server";
import { customerMutation } from "@/customers/http";
import {
  CustomerError,
  controlSchema,
  billingAdjustmentsSchema,
  credentialsSchema,
  customerIdSchema,
  updateSchema,
} from "@/customers/validation";
import { encryptFlowroutePair } from "@/security/credential-service";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; operation: string }> },
) {
  const { id, operation } = await params;
  return customerMutation(request, async (fields, repository, actor) => {
    customerIdSchema.parse(id);
    if (operation === "update") {
      const { revision, ...input } = updateSchema.parse(fields);
      await repository.update(id, revision, input, actor);
    } else if (operation === "credentials") {
      const input = credentialsSchema.parse(fields);
      const encrypted = await encryptFlowroutePair(
        id,
        input.accessKey,
        input.secretKey,
      );
      await repository.saveCredentials(id, input.revision, encrypted, actor);
    } else if (operation === "billing-adjustments") {
      const { revision, ...input } = billingAdjustmentsSchema.parse(fields);
      await repository.saveBillingAdjustments(id, revision, input, actor);
    } else {
      const { revision } = controlSchema.parse(fields);
      if (operation === "archive")
        await repository.archive(id, revision, actor);
      else if (operation === "restore")
        await repository.restore(id, revision, actor);
      else if (operation === "revoke-credentials")
        await repository.revokeCredentials(id, revision, actor);
      else throw new CustomerError("NOT_FOUND", "Unknown operation");
    }
    return { id };
  });
}
