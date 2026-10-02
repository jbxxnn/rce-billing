export function authConfiguration(input: {
  APP_ENV?: string;
  APP_ORIGIN?: string;
}) {
  const environment = input.APP_ENV ?? "development";
  if (!["development", "test", "staging", "production"].includes(environment))
    throw new Error("Invalid authentication configuration");
  const raw =
    input.APP_ORIGIN ??
    (environment === "development" || environment === "test"
      ? "http://localhost:3000"
      : undefined);
  if (!raw) throw new Error("APP_ORIGIN is required");
  const origin = new URL(raw);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    (origin.protocol !== "https:" &&
      !(
        local &&
        ["development", "test"].includes(environment) &&
        origin.protocol === "http:"
      ))
  )
    throw new Error("Invalid authentication origin");
  const secure = origin.protocol === "https:";
  return {
    origin: origin.origin,
    secure,
    cookieName: secure ? "__Host-rce-session" : "rce-session",
    cookieOptions: {
      httpOnly: true,
      secure,
      // Google returns through a top-level cross-site redirect. Lax keeps
      // cookies protected from cross-site POSTs while allowing the session
      // created by that redirect to reach the dashboard immediately.
      sameSite: "lax" as const,
      path: "/",
    },
  };
}
export type AuthConfiguration = ReturnType<typeof authConfiguration>;
