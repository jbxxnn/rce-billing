import "server-only";
import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { customerProviderCredentials } from "../db/schema";
import { credentialKeys, decryptCredential } from "../security/credentials";
import type { FlowrouteCredentials } from "./contracts";

/** Only provider services may decrypt this pair; never return it to a page or route. */
export async function loadFlowrouteCredentials(
  db: Database,
  customerId: string,
): Promise<{ credentials: FlowrouteCredentials; status: string } | null> {
  const [row] = await db
    .select({
      accessKeyEncrypted: customerProviderCredentials.accessKeyEncrypted,
      secretKeyEncrypted: customerProviderCredentials.secretKeyEncrypted,
      encryptionKeyVersion: customerProviderCredentials.encryptionKeyVersion,
      status: customerProviderCredentials.status,
    })
    .from(customerProviderCredentials)
    .where(
      and(
        eq(customerProviderCredentials.customerId, customerId),
        eq(customerProviderCredentials.provider, "FLOWROUTE"),
      ),
    );
  if (!row || row.status === "REVOKED") return null;
  const keys = credentialKeys({
    FLOWROUTE_ENCRYPTION_KEYS: process.env.FLOWROUTE_ENCRYPTION_KEYS,
    FLOWROUTE_ENCRYPTION_KEY_VERSION:
      process.env.FLOWROUTE_ENCRYPTION_KEY_VERSION,
  });
  return {
    credentials: {
      accessKey: await decryptCredential(
        row.accessKeyEncrypted,
        customerId,
        "accessKey",
        row.encryptionKeyVersion,
        keys,
      ),
      secretKey: await decryptCredential(
        row.secretKeyEncrypted,
        customerId,
        "secretKey",
        row.encryptionKeyVersion,
        keys,
      ),
    },
    status: row.status,
  };
}
