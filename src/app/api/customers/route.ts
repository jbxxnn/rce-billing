import type { NextRequest } from "next/server";
import { customerMutation } from "@/customers/http";
import { profileSchema } from "@/customers/validation";
export async function POST(request: NextRequest) {
  return customerMutation(request, async (fields, repository, actor) => {
    const customer = await repository.create(profileSchema.parse(fields), actor);
    return { id: customer.id, revision: customer.revision };
  });
}
