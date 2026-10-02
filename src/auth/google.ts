import "server-only";
import { base64url, createRemoteJWKSet, jwtVerify } from "jose";
import type { AuthConfiguration } from "../config/auth";
import type { googleAuthConfiguration } from "../config/google-auth";

type GoogleConfiguration = ReturnType<typeof googleAuthConfiguration>;
type State = {
  state: string;
  nonce: string;
  verifier: string;
  createdAt: number;
};

const encoder = new TextEncoder();
const cookieName = "rce-google-oauth";
const jwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

function randomValue() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url.encode(bytes);
}

async function key(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function buffer(value: Uint8Array) {
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
}

async function signState(value: State, secret: string) {
  const payload = base64url.encode(JSON.stringify(value));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await key(secret),
    encoder.encode(payload),
  );
  return `${payload}.${base64url.encode(new Uint8Array(signature))}`;
}

async function cookieState(
  value: string | undefined,
  secret: string,
): Promise<State | null> {
  if (!value) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra) return null;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await key(secret),
    buffer(base64url.decode(signature)),
    encoder.encode(payload),
  );
  if (!valid) return null;
  try {
    const parsed = JSON.parse(
      new TextDecoder().decode(base64url.decode(payload)),
    ) as State;
    if (
      typeof parsed.state !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.verifier !== "string" ||
      typeof parsed.createdAt !== "number" ||
      Date.now() - parsed.createdAt > 600_000 ||
      parsed.createdAt > Date.now() + 60_000
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}

async function challenge(verifier: string) {
  return base64url.encode(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(verifier)),
    ),
  );
}

export async function googleAuthorization(configuration: GoogleConfiguration) {
  const state: State = {
    state: randomValue(),
    nonce: randomValue(),
    verifier: randomValue(),
    createdAt: Date.now(),
  };
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: configuration.clientId,
    redirect_uri: configuration.callbackUrl,
    response_type: "code",
    scope: "openid email profile",
    state: state.state,
    nonce: state.nonce,
    code_challenge: await challenge(state.verifier),
    code_challenge_method: "S256",
    hd: configuration.workspaceDomain,
    prompt: "select_account",
  }).toString();
  return {
    url: url.toString(),
    state: await signState(state, configuration.clientSecret),
  };
}

export function oauthStateCookie(
  value: string,
  configuration: AuthConfiguration,
) {
  return {
    name: configuration.secure ? "__Host-rce-google-oauth" : cookieName,
    value,
    options: {
      httpOnly: true,
      secure: configuration.secure,
      sameSite: "lax" as const,
      path: "/",
      maxAge: 600,
    },
  };
}

export function readOauthStateCookie(
  cookies: { get(name: string): { value: string } | undefined },
  configuration: AuthConfiguration,
) {
  return cookies.get(
    configuration.secure ? "__Host-rce-google-oauth" : cookieName,
  )?.value;
}

export async function authenticatedGoogleEmail(input: {
  code: string;
  state: string | null;
  stateCookie?: string;
  configuration: GoogleConfiguration;
}) {
  const stored = await cookieState(
    input.stateCookie,
    input.configuration.clientSecret,
  );
  if (!stored || !input.state || stored.state !== input.state)
    throw new Error("Invalid Google sign-in state");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.configuration.clientId,
      client_secret: input.configuration.clientSecret,
      redirect_uri: input.configuration.callbackUrl,
      code_verifier: stored.verifier,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Google token exchange failed");
  const token: unknown = await response.json();
  if (
    !token ||
    typeof token !== "object" ||
    typeof (token as { id_token?: unknown }).id_token !== "string"
  )
    throw new Error("Google did not return an identity token");
  const { payload } = await jwtVerify(
    (token as { id_token: string }).id_token,
    jwks,
    {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: input.configuration.clientId,
      algorithms: ["RS256"],
    },
  );
  const email =
    typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (
    payload.nonce !== stored.nonce ||
    payload.email_verified !== true ||
    payload.hd !== input.configuration.workspaceDomain ||
    !email.endsWith(`@${input.configuration.workspaceDomain}`)
  )
    throw new Error("Google Workspace identity was not accepted");
  return email;
}
