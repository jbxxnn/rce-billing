import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { databaseSource } from "@runtime/database";
import { withDatabase } from "../db/client";
import { authenticationRepository } from "../db/repositories/authentication";
import { authConfiguration } from "../config/auth";
import { AuthenticationService } from "./service";
export function configuration() {
  return authConfiguration({
    APP_ENV:
      process.env.APP_ENV ??
      (process.env.NODE_ENV === "production" ? "production" : "development"),
    APP_ORIGIN: process.env.APP_ORIGIN,
  });
}
export async function withAuthentication<T>(
  work: (auth: AuthenticationService) => Promise<T>,
) {
  return withDatabase(databaseSource(), (db) =>
    work(new AuthenticationService(authenticationRepository(db))),
  );
}
/** Call at every protected page/service/action; a layout alone is not authorization. */
export async function requireAdministrator() {
  const token = (await cookies()).get(configuration().cookieName)?.value;
  if (!token) redirect("/login");
  const admin = await withAuthentication((auth) => auth.administrator(token));
  if (!admin) redirect("/login");
  return admin;
}
