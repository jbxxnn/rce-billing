import { describe, expect, it } from "vitest";
import { authConfiguration } from "../config/auth";
import {
  digest,
  hashPassword,
  newSessionToken,
  validNewPassword,
  validSessionToken,
  verifyPassword,
} from "./crypto";
import { loginFields, validOrigin } from "./http";

describe("authentication security boundaries", () => {
  it("requires HTTPS outside local development and uses host-only secure cookies", () => {
    expect(() => authConfiguration({ APP_ENV: "production" })).toThrow();
    expect(() =>
      authConfiguration({
        APP_ENV: "production",
        APP_ORIGIN: "http://example.com",
      }),
    ).toThrow();
    expect(() =>
      authConfiguration({ APP_ORIGIN: "https://user:secret@example.com" }),
    ).toThrow();
    const config = authConfiguration({
      APP_ENV: "production",
      APP_ORIGIN: "https://billing.example.com",
    });
    expect(config.cookieName).toBe("__Host-rce-session");
    expect(config.cookieOptions).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
  });
  it("rejects missing, forged and cross-site origins", () => {
    const config = authConfiguration({ APP_ORIGIN: "http://localhost:3000" });
    expect(
      validOrigin(
        new Request(config.origin, { headers: { origin: config.origin } }),
        config,
      ),
    ).toBe(true);
    for (const headers of [
      {},
      { origin: "https://evil.example" },
      { origin: config.origin, "sec-fetch-site": "cross-site" },
    ])
      expect(
        validOrigin(
          new Request(config.origin, {
            headers: headers as Record<string, string>,
          }),
          config,
        ),
      ).toBe(false);
  });
  it("bounds form parsing and rejects ambiguous duplicate fields", async () => {
    const request = (body: string) =>
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
    expect(
      await loginFields(request("email=a%40example.com&password=a%26b")),
    ).toEqual({ email: "a@example.com", password: "a&b" });
    expect(await loginFields(request("email=a&email=b&password=x"))).toBeNull();
    expect(
      await loginFields(request(`email=a&password=${"x".repeat(5000)}`)),
    ).toBeNull();
    expect(
      await loginFields(
        new Request("http://localhost", { method: "POST", body: "{}" }),
      ),
    ).toBeNull();
  });
  it("hashes passwords with individual salts and rejects byte truncation", async () => {
    const password = "a sufficiently long password";
    const one = await hashPassword(password);
    const two = await hashPassword(password);
    expect(one).not.toBe(two);
    expect(await verifyPassword(password, one)).toBe(true);
    expect(await verifyPassword("wrong-password", one)).toBe(false);
    expect(validNewPassword("short")).toBe(false);
    expect(validNewPassword("😀".repeat(19))).toBe(false);
    expect(await verifyPassword("a".repeat(73), one)).toBe(false);
  });
  it("uses unpredictable opaque tokens and one-way digests", async () => {
    const one = newSessionToken();
    const two = newSessionToken();
    expect(one).not.toBe(two);
    expect(validSessionToken(one)).toBe(true);
    expect(validSessionToken("bad")).toBe(false);
    expect(await digest(one)).toMatch(/^[a-f0-9]{64}$/);
    expect(await digest(one)).not.toBe(one);
  });
});
