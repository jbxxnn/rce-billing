import { z } from "zod";
import { parseUsd } from "../domain/billing/money";
const optionalText = (max: number) => z.string().trim().max(max).default("");
export const profileSchema = z
  .object({
    fullName: z.string().trim().min(1, "Name is required").max(160),
    email: z
      .email("Enter a valid email address")
      .max(254)
      .transform((value) => value.trim().toLowerCase()),
    phone: optionalText(40),
    streetAddress: optionalText(250),
    city: optionalText(100),
    state: optionalText(100),
    postalCode: optionalText(20),
    countryCode: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/, "Use a two-letter country code")
      .transform((value) => value.toUpperCase())
      .default("US"),
    billingDay: z.coerce.number().int().min(1).max(31),
    billingTimezone: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Enter a valid timezone"),
  })
  .strict();
export const revisionSchema = z.coerce.number().int().positive();
export const updateSchema = profileSchema.extend({ revision: revisionSchema });
export const credentialsSchema = z
  .object({
    revision: revisionSchema,
    accessKey: z.string().trim().min(1).max(512),
    secretKey: z.string().trim().min(1).max(2048),
  })
  .strict();
export const controlSchema = z.object({ revision: revisionSchema }).strict();
const adjustmentAmount = z
  .string()
  .trim()
  .max(21)
  .refine(
    (value) => {
      try {
        parseUsd(value);
        return true;
      } catch {
        return false;
      }
    },
    "Enter a non-negative USD amount with up to two decimals",
  );
export const billingAdjustmentsSchema = z
  .object({
    revision: revisionSchema,
    effectiveFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid effective date")
      .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime()), "Choose a valid effective date"),
    meteredSipTrunkUsage: adjustmentAmount,
    cloudServerHosting: adjustmentAmount,
    extraNumbers: z.coerce.number().int().min(0).max(2147483647),
    extraChannels: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.coerce.number().int().min(0).max(2147483647).optional(),
    ),
  })
  .strict();
export const customerIdSchema = z.uuid();
export const searchSchema = z.object({
  q: z.string().trim().max(100).default(""),
  status: z
    .enum(["ALL", "DRAFT", "ACTIVE", "SUSPENDED", "ARCHIVED"])
    .default("ALL"),
  after: z.uuid().optional(),
  auditPage: z.coerce.number().int().min(0).max(10000).default(0),
});
export type CustomerProfile = z.output<typeof profileSchema>;
export class CustomerError extends Error {
  constructor(
    public readonly code:
      "NOT_FOUND" | "CONFLICT" | "ARCHIVED" | "LINKED_BILLING" | "UNAUTHORIZED",
    message: string,
  ) {
    super(message);
  }
}
