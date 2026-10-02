import { expect, it } from "vitest";
import {
  credentialsSchema,
  profileSchema,
  searchSchema,
  updateSchema,
} from "./validation";
const valid = {
  fullName: " Example ",
  email: "BILLING@example.com",
  billingDay: "31",
  billingTimezone: "UTC",
};
it("normalizes profiles and rejects client-controlled state and invalid billing settings", () => {
  expect(profileSchema.parse(valid)).toMatchObject({
    fullName: "Example",
    email: "billing@example.com",
    billingDay: 31,
    countryCode: "US",
  });
  for (const input of [
    { ...valid, billingDay: 0 },
    { ...valid, billingDay: 32 },
    { ...valid, billingTimezone: "Invalid/Zone" },
    { ...valid, status: "ACTIVE" },
    { ...valid, stripeCustomerId: "cus_injected" },
  ])
    expect(profileSchema.safeParse(input).success).toBe(false);
  expect(updateSchema.safeParse({ ...valid, revision: 0 }).success).toBe(false);
});
it("bounds searches and requires both replacement keys", () => {
  expect(searchSchema.safeParse({ q: "a".repeat(101) }).success).toBe(false);
  expect(
    credentialsSchema.safeParse({
      revision: 1,
      accessKey: "access",
      secretKey: "",
    }).success,
  ).toBe(false);
});
