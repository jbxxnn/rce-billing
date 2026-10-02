import "server-only";
import { credentialKeys, encryptCredential } from "./credentials";
export async function encryptFlowroutePair(
  customerId: string,
  accessKey: string,
  secretKey: string,
) {
  const keys = credentialKeys({
    FLOWROUTE_ENCRYPTION_KEYS: process.env.FLOWROUTE_ENCRYPTION_KEYS,
    FLOWROUTE_ENCRYPTION_KEY_VERSION:
      process.env.FLOWROUTE_ENCRYPTION_KEY_VERSION,
  });
  return {
    accessKeyEncrypted: await encryptCredential(
      accessKey,
      customerId,
      "accessKey",
      keys,
    ),
    secretKeyEncrypted: await encryptCredential(
      secretKey,
      customerId,
      "secretKey",
      keys,
    ),
    encryptionKeyVersion: keys.currentVersion,
  };
}
