import { NextResponse } from "next/server";
import { googleAuthorization, oauthStateCookie } from "@/auth/google";
import { configuration } from "@/auth/server";
import { googleAuthConfiguration } from "@/config/google-auth";

export async function GET() {
  const auth = configuration();
  try {
    const request = await googleAuthorization(
      googleAuthConfiguration({
        APP_ORIGIN: process.env.APP_ORIGIN,
        GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
        GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      }),
    );
    const response = NextResponse.redirect(request.url, 302);
    const cookie = oauthStateCookie(request.state, auth);
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return NextResponse.redirect(
      new URL("/login?error=google_configuration", auth.origin),
      303,
    );
  }
}
