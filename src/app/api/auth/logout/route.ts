import { NextRequest, NextResponse } from "next/server";
import { configuration, withAuthentication } from "@/auth/server";
import { validOrigin } from "@/auth/http";
export async function POST(request: NextRequest) {
  try {
    const config = configuration();
    if (!validOrigin(request, config))
      return new Response("Request not permitted", {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      });
    const token = request.cookies.get(config.cookieName)?.value;
    if (token) await withAuthentication((auth) => auth.logout(token));
    const response = NextResponse.redirect(
      new URL("/login", config.origin),
      303,
    );
    response.headers.set("Cache-Control", "no-store");
    response.cookies.set(config.cookieName, "", {
      ...config.cookieOptions,
      maxAge: 0,
    });
    return response;
  } catch {
    return new Response(
      "Sign-out is temporarily unavailable. Please try again.",
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
