export interface CredentialKeys {
  currentVersion: string;
  keys: Record<string, string>;
}
function encode(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}
function decode(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
export function credentialKeys(input: {
  FLOWROUTE_ENCRYPTION_KEYS?: string;
  FLOWROUTE_ENCRYPTION_KEY_VERSION?: string;
}): CredentialKeys {
  try {
    const currentVersion = input.FLOWROUTE_ENCRYPTION_KEY_VERSION;
    const keys: unknown = JSON.parse(input.FLOWROUTE_ENCRYPTION_KEYS ?? "{}");
    if (
      !currentVersion ||
      !/^[A-Za-z0-9_-]{1,40}$/.test(currentVersion) ||
      !keys ||
      typeof keys !== "object" ||
      Array.isArray(keys)
    )
      throw new Error();
    const entries = Object.entries(keys);
    if (
      !entries.length ||
      entries.length > 20 ||
      !Object.hasOwn(keys, currentVersion)
    )
      throw new Error();
    for (const [version, value] of entries)
      if (
        !/^[A-Za-z0-9_-]{1,40}$/.test(version) ||
        typeof value !== "string" ||
        decode(value).length !== 32 ||
        encode(decode(value)) !== value
      )
        throw new Error();
    return { currentVersion, keys: keys as Record<string, string> };
  } catch {
    throw new Error("Credential encryption is not configured");
  }
}
async function importKey(config: CredentialKeys, version: string) {
  if (!Object.hasOwn(config.keys, version))
    throw new Error("Credential key version unavailable");
  return crypto.subtle.importKey(
    "raw",
    decode(config.keys[version]),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
function context(customerId: string, field: string, version: string) {
  return new TextEncoder().encode(
    JSON.stringify(["FLOWROUTE", customerId, field, version]),
  );
}
export async function encryptCredential(
  value: string,
  customerId: string,
  field: "accessKey" | "secretKey",
  config: CredentialKeys,
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: context(customerId, field, config.currentVersion),
      tagLength: 128,
    },
    await importKey(config, config.currentVersion),
    new TextEncoder().encode(value),
  );
  return `v1.${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
}
/** Backend integration primitive only. Never return its output to an admin page. */
export async function decryptCredential(
  envelope: string,
  customerId: string,
  field: "accessKey" | "secretKey",
  version: string,
  config: CredentialKeys,
) {
  try {
    const [format, iv, ciphertext, ...extra] = envelope.split(".");
    if (
      format !== "v1" ||
      !iv ||
      !ciphertext ||
      extra.length ||
      decode(iv).length !== 12
    )
      throw new Error();
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decode(iv),
        additionalData: context(customerId, field, version),
        tagLength: 128,
      },
      await importKey(config, version),
      decode(ciphertext),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error("Credential decryption failed");
  }
}
