import { NextRequest, NextResponse } from "next/server";
import {
  authenticatedGoogleEmail,
  oauthStateCookie,
  readOauthStateCookie,
} from "@/auth/google";
import { SESSION_SECONDS } from "@/auth/crypto";
import { configuration, withAuthentication } from "@/auth/server";
import { googleAuthConfiguration } from "@/config/google-auth";

function finish(url: URL, config: ReturnType<typeof configuration>) {
  const response = NextResponse.redirect(url, 303);
  const cookie = oauthStateCookie("", config);
  response.cookies.set(cookie.name, "", { ...cookie.options, maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: NextRequest) {
  const config = configuration();
  try {
    const code = request.nextUrl.searchParams.get("code");
    if (!code || request.nextUrl.searchParams.has("error"))
      return finish(new URL("/login?error=google", config.origin), config);
    const email = await authenticatedGoogleEmail({
      code,
      state: request.nextUrl.searchParams.get("state"),
      stateCookie: readOauthStateCookie(request.cookies, config),
      configuration: googleAuthConfiguration({
        APP_ORIGIN: process.env.APP_ORIGIN,
        GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
        GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      }),
    });
    const token = await withAuthentication((auth) =>
      auth.googleLogin(email, request.cookies.get(config.cookieName)?.value),
    );
    const response = finish(
      new URL(
        token ? "/dashboard" : "/login?error=unauthorized",
        config.origin,
      ),
      config,
    );
    if (token)
      response.cookies.set(config.cookieName, token, {
        ...config.cookieOptions,
        maxAge: SESSION_SECONDS,
      });
    return response;
  } catch {
    return finish(new URL("/login?error=google", config.origin), config);
  }
}
