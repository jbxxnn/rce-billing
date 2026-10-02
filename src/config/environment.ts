import { z } from "zod";
const environmentSchema = z.object({
  APP_ENV: z
    .enum(["development", "test", "staging", "production"])
    .default("development"),
});
/** Accept server runtime configuration explicitly; never serialize secret bindings. */
export function parseEnvironment(input: Record<string, unknown>) {
  const result = environmentSchema.safeParse(input);
  if (!result.success)
    throw new Error("Invalid application environment configuration");
  return result.data;
}
