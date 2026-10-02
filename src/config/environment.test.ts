import { describe, expect, it } from "vitest";
import { parseEnvironment } from "./environment";
describe("runtime configuration boundary", () => {
  it("does not expose unrelated secret bindings", () => {
    expect(
      parseEnvironment({
        APP_ENV: "staging",
        STRIPE_SECRET_KEY: "sentinel-secret",
      }),
    ).toEqual({ APP_ENV: "staging" });
  });
  it("rejects invalid environment values without echoing their contents", () => {
    expect(() => parseEnvironment({ APP_ENV: "sentinel-secret" })).toThrow(
      "Invalid application environment configuration",
    );
  });
});
