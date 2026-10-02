import { z } from "zod";
const command = z.object({
  requestKey: z.uuid(),
  revision: z.coerce.number().int().positive(),
});
export const activationSchema = command
  .extend({ daysUntilDue: z.coerce.number().int().min(1).max(365).optional() })
  .strict();
export const changePlanSchema = command
  .extend({ planPriceVersionId: z.uuid() })
  .strict();
export const changeCollectionMethodSchema = command
  .extend({ collectionMethod: z.literal("charge_automatically") })
  .strict();
export const cancellationSchema = command.strict();
export const retrySchema = z.object({ workflowId: z.uuid() }).strict();
