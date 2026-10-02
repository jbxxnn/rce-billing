import { describe, expect, it } from "vitest";
import { googleAuthConfiguration, googleAuthConfigured } from "./google-auth";

describe("Google Workspace configuration", () => {
  it("requires both OAuth client values", () => {
    expect(() =>
      googleAuthConfiguration({ APP_ORIGIN: "https://billing.re-circuit.com" }),
    ).toThrow();
    expect(
      googleAuthConfigured({ APP_ORIGIN: "https://billing.re-circuit.com" }),
    ).toBe(false);
  });

  it("uses the fixed Workspace domain and callback path", () => {
    expect(
      googleAuthConfiguration({
        APP_ORIGIN: "https://billing.re-circuit.com",
        GOOGLE_OAUTH_CLIENT_ID: "client-id",
        GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
      }),
    ).toMatchObject({
      workspaceDomain: "re-circuit.com",
      callbackUrl: "https://billing.re-circuit.com/api/auth/google/callback",
    });
  });
});
