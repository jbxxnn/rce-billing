import { describe, expect, it } from "vitest";
import {
  credentialKeys,
  decryptCredential,
  encryptCredential,
} from "./credentials";
const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const config = credentialKeys({
  FLOWROUTE_ENCRYPTION_KEY_VERSION: "key1",
  FLOWROUTE_ENCRYPTION_KEYS: JSON.stringify({ key1: key }),
});
describe("encrypted provider credentials", () => {
  it("randomizes ciphertext and authenticates customer, field, version and contents", async () => {
    const one = await encryptCredential(
      "sensitive fixture",
      "customer-a",
      "secretKey",
      config,
    );
    const two = await encryptCredential(
      "sensitive fixture",
      "customer-a",
      "secretKey",
      config,
    );
    expect(one).not.toBe(two);
    expect(one).not.toContain("sensitive fixture");
    expect(
      await decryptCredential(one, "customer-a", "secretKey", "key1", config),
    ).toBe("sensitive fixture");
    await expect(
      decryptCredential(one, "customer-b", "secretKey", "key1", config),
    ).rejects.toThrow("decryption failed");
    await expect(
      decryptCredential(one, "customer-a", "accessKey", "key1", config),
    ).rejects.toThrow("decryption failed");
    const parts = one.split(".");
    const bytes = Uint8Array.from(atob(parts[2]), (c) => c.charCodeAt(0));
    bytes[0] ^= 1;
    parts[2] = btoa(String.fromCharCode(...bytes));
    await expect(
      decryptCredential(
        parts.join("."),
        "customer-a",
        "secretKey",
        "key1",
        config,
      ),
    ).rejects.toThrow("decryption failed");
  });
  it("supports retained old keys and fails closed for invalid or missing keys", async () => {
    expect(() => credentialKeys({})).toThrow("not configured");
    expect(() =>
      credentialKeys({
        FLOWROUTE_ENCRYPTION_KEY_VERSION: "v1",
        FLOWROUTE_ENCRYPTION_KEYS: '{"v1":"bad"}',
      }),
    ).toThrow("not configured");
    const encrypted = await encryptCredential(
      "old value",
      "a",
      "accessKey",
      config,
    );
    const next = {
      currentVersion: "key2",
      keys: {
        ...config.keys,
        key2: btoa(String.fromCharCode(...new Uint8Array(32).fill(9))),
      },
    };
    expect(
      await decryptCredential(encrypted, "a", "accessKey", "key1", next),
    ).toBe("old value");
    await expect(
      decryptCredential(encrypted, "a", "accessKey", "key2", next),
    ).rejects.toThrow();
  });
});
