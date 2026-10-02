import "server-only";
import { env } from "cloudflare:workers";
export function databaseSource() {
  if (!env.HYPERDRIVE?.connectionString)
    throw new Error("Hyperdrive is not configured");
  return env.HYPERDRIVE;
}
