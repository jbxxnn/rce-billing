import { base64url, createRemoteJWKSet, jwtVerify } from "jose";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  digest,
  newSessionToken,
  SESSION_SECONDS,
  validSessionToken,
} from "../auth/crypto";
import { authenticationRepository } from "../db/repositories/authentication";
import { withDatabase, type DatabaseSource } from "../db/client";
import { mcpAuthorizationCodes } from "../db/schema";
import { createRceBillingMcpServer } from "./server";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const googleJwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
const scope = "rce-billing:read rce-billing:drafts";
const oauthCookie = "__Host-rce-mcp-oauth";

type Environment = {
  HYPERDRIVE?: DatabaseSource;
  APP_ORIGIN?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
};
type PendingAuthorization = {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  resource: string;
  scope: string;
  googleState: string;
  googleNonce: string;
  googleVerifier: string;
  createdAt: number;
};

function source(env: Environment) {
  if (!env.HYPERDRIVE?.connectionString)
    throw new Error("Hyperdrive is not configured");
  return env.HYPERDRIVE;
}

function origin(env: Environment, request: Request) {
  const configured = env.APP_ORIGIN?.trim();
  const value = configured || new URL(request.url).origin;
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") throw new Error("MCP requires HTTPS");
  return parsed.origin;
}

function resource(env: Environment, request: Request) {
  return `${origin(env, request)}/mcp`;
}

function randomValue() {
  return base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
}

function invalid(message: string, status = 400) {
  return Response.json(
    { error: "invalid_request", error_description: message },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function redirectError(uri: string, state: string, error: string) {
  const target = new URL(uri);
  target.searchParams.set("error", error);
  target.searchParams.set("state", state);
  return Response.redirect(target, 303);
}

async function hmacKey(secret: string) {
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

async function signPending(value: PendingAuthorization, secret: string) {
  const payload = base64url.encode(JSON.stringify(value));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    encoder.encode(payload),
  );
  return `${payload}.${base64url.encode(new Uint8Array(signature))}`;
}

async function readPending(value: string | null, secret: string) {
  if (!value) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra) return null;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    buffer(base64url.decode(signature)),
    encoder.encode(payload),
  );
  if (!valid) return null;
  try {
    const pending = JSON.parse(
      decoder.decode(base64url.decode(payload)),
    ) as PendingAuthorization;
    if (
      typeof pending.clientId !== "string" ||
      typeof pending.redirectUri !== "string" ||
      typeof pending.state !== "string" ||
      typeof pending.codeChallenge !== "string" ||
      typeof pending.resource !== "string" ||
      typeof pending.scope !== "string" ||
      typeof pending.googleState !== "string" ||
      typeof pending.googleNonce !== "string" ||
      typeof pending.googleVerifier !== "string" ||
      typeof pending.createdAt !== "number" ||
      Date.now() - pending.createdAt > 600_000 ||
      pending.createdAt > Date.now() + 60_000
    )
      return null;
    return pending;
  } catch {
    return null;
  }
}

async function sha256(value: string) {
  return base64url.encode(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  );
}

function clearPending(response: Response) {
  response.headers.append(
    "set-cookie",
    `${oauthCookie}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  );
  response.headers.set("cache-control", "no-store");
  return response;
}

function credentials(env: Environment) {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret)
    throw new Error("Google Workspace sign-in is not configured");
  return { clientId, clientSecret };
}

function validateAuthorize(input: URL, canonicalResource: string) {
  const responseType = input.searchParams.get("response_type");
  const clientId = input.searchParams.get("client_id");
  const redirectUri = input.searchParams.get("redirect_uri");
  const state = input.searchParams.get("state");
  const codeChallenge = input.searchParams.get("code_challenge");
  const method = input.searchParams.get("code_challenge_method");
  const requestedResource = input.searchParams.get("resource");
  if (
    responseType !== "code" ||
    !clientId ||
    !redirectUri ||
    !state ||
    !codeChallenge
  )
    throw new Error(
      "response_type, client_id, redirect_uri, state, and code_challenge are required",
    );
  if (method !== "S256") throw new Error("code_challenge_method must be S256");
  if (requestedResource !== canonicalResource)
    throw new Error("resource does not match this MCP server");
  if (
    clientId.length > 2_048 ||
    redirectUri.length > 2_048 ||
    state.length > 2_048 ||
    codeChallenge.length > 256
  )
    throw new Error("OAuth parameter is too long");
  const redirect = new URL(redirectUri);
  const local =
    redirect.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1"].includes(redirect.hostname);
  if (redirect.protocol !== "https:" && !local)
    throw new Error("redirect_uri must use HTTPS");
  return { clientId, redirectUri: redirect.toString(), state, codeChallenge };
}

export function protectedResourceMetadata(env: Environment, request: Request) {
  const base = origin(env, request);
  return Response.json({
    resource: resource(env, request),
    authorization_servers: [base],
    scopes_supported: scope.split(" "),
    resource_documentation: `${base}/mcp`,
  });
}

export function authorizationServerMetadata(
  env: Environment,
  request: Request,
) {
  const base = origin(env, request);
  return Response.json({
    issuer: base,
    authorization_response_iss_parameter_supported: true,
    authorization_endpoint: `${base}/mcp/oauth/authorize`,
    token_endpoint: `${base}/mcp/oauth/token`,
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: scope.split(" "),
  });
}

export async function authorizeMcp(env: Environment, request: Request) {
  try {
    const canonicalResource = resource(env, request);
    const authorization = validateAuthorize(
      new URL(request.url),
      canonicalResource,
    );
    const google = credentials(env);
    const googleState = randomValue();
    const googleNonce = randomValue();
    const googleVerifier = randomValue();
    const pending: PendingAuthorization = {
      ...authorization,
      resource: canonicalResource,
      scope,
      googleState,
      googleNonce,
      googleVerifier,
      createdAt: Date.now(),
    };
    const callback = `${origin(env, request)}/mcp/oauth/google/callback`;
    const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    googleUrl.search = new URLSearchParams({
      client_id: google.clientId,
      redirect_uri: callback,
      response_type: "code",
      scope: "openid email profile",
      state: googleState,
      nonce: googleNonce,
      code_challenge: await sha256(googleVerifier),
      code_challenge_method: "S256",
      hd: "re-circuit.com",
      prompt: "select_account",
    }).toString();
    const response = Response.redirect(googleUrl, 302);
    response.headers.set(
      "set-cookie",
      `${oauthCookie}=${await signPending(pending, google.clientSecret)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    );
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    return invalid(
      error instanceof Error ? error.message : "Invalid authorization request",
    );
  }
}

export async function completeGoogleAuthorization(
  env: Environment,
  request: Request,
) {
  const google = credentials(env);
  const pending = await readPending(
    request.headers
      .get("cookie")
      ?.match(new RegExp(`(?:^|;\\s*)${oauthCookie}=([^;]+)`))?.[1] ?? null,
    google.clientSecret,
  );
  if (!pending)
    return clearPending(invalid("Google sign-in session expired", 400));
  const input = new URL(request.url);
  const failure = input.searchParams.get("error");
  const code = input.searchParams.get("code");
  if (
    failure ||
    !code ||
    input.searchParams.get("state") !== pending.googleState
  )
    return clearPending(
      redirectError(pending.redirectUri, pending.state, "access_denied"),
    );
  try {
    const callback = `${origin(env, request)}/mcp/oauth/google/callback`;
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: google.clientId,
        client_secret: google.clientSecret,
        redirect_uri: callback,
        code_verifier: pending.googleVerifier,
        grant_type: "authorization_code",
      }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Google token exchange failed");
    const token = (await response.json()) as { id_token?: unknown };
    if (typeof token.id_token !== "string")
      throw new Error("Google did not return an identity token");
    const verified = await jwtVerify(token.id_token, googleJwks, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: google.clientId,
      algorithms: ["RS256"],
    });
    const email =
      typeof verified.payload.email === "string"
        ? verified.payload.email.trim().toLowerCase()
        : "";
    if (
      verified.payload.nonce !== pending.googleNonce ||
      verified.payload.email_verified !== true ||
      verified.payload.hd !== "re-circuit.com" ||
      !email.endsWith("@re-circuit.com")
    )
      throw new Error("Google Workspace identity was not accepted");
    const appUserId = await withDatabase(source(env), async (db) =>
      authenticationRepository(db).authorizeGoogleWorkspaceIdentity(email),
    );
    const authorizationCode = newSessionToken();
    const codeHash = await digest(authorizationCode);
    await withDatabase(source(env), async (db) => {
      await db.insert(mcpAuthorizationCodes).values({
        codeHash,
        appUserId,
        clientId: pending.clientId,
        redirectUri: pending.redirectUri,
        codeChallenge: pending.codeChallenge,
        resource: pending.resource,
        scope: pending.scope,
        expiresAt: new Date(Date.now() + 5 * 60_000),
      });
    });
    const target = new URL(pending.redirectUri);
    target.searchParams.set("code", authorizationCode);
    target.searchParams.set("state", pending.state);
    target.searchParams.set("iss", origin(env, request));
    return clearPending(Response.redirect(target, 303));
  } catch {
    return clearPending(
      redirectError(pending.redirectUri, pending.state, "access_denied"),
    );
  }
}

export async function exchangeMcpToken(env: Environment, request: Request) {
  if (request.method !== "POST") return invalid("Use POST", 405);
  const body = await request.formData().catch(() => null);
  const code = body?.get("code");
  const verifier = body?.get("code_verifier");
  const clientId = body?.get("client_id");
  const redirectUri = body?.get("redirect_uri");
  const requestedResource = body?.get("resource");
  if (
    body?.get("grant_type") !== "authorization_code" ||
    typeof code !== "string" ||
    typeof verifier !== "string" ||
    typeof clientId !== "string" ||
    typeof redirectUri !== "string"
  )
    return invalid("A PKCE authorization-code exchange is required");
  if (
    requestedResource !== null &&
    requestedResource !== resource(env, request)
  )
    return invalid("resource does not match this MCP server");
  try {
    const codeHash = await digest(code);
    const codeChallenge = await sha256(verifier);
    const value = await withDatabase(source(env), async (db) =>
      db.transaction(async (tx) => {
        const [authorization] = await tx
          .select()
          .from(mcpAuthorizationCodes)
          .where(
            and(
              eq(mcpAuthorizationCodes.codeHash, codeHash),
              eq(mcpAuthorizationCodes.clientId, clientId),
              eq(mcpAuthorizationCodes.redirectUri, redirectUri),
              eq(mcpAuthorizationCodes.resource, resource(env, request)),
              eq(mcpAuthorizationCodes.codeChallenge, codeChallenge),
              isNull(mcpAuthorizationCodes.consumedAt),
              gt(mcpAuthorizationCodes.expiresAt, sql`now()`),
            ),
          )
          .for("update");
        if (!authorization) return null;
        await tx
          .update(mcpAuthorizationCodes)
          .set({ consumedAt: new Date() })
          .where(eq(mcpAuthorizationCodes.id, authorization.id));
        const token = newSessionToken();
        const tokenHash = await digest(token);
        const session = await authenticationRepository(tx).createGoogleSession(
          authorization.appUserId,
          tokenHash,
          SESSION_SECONDS,
        );
        return session ? { token, scope: authorization.scope } : null;
      }),
    );
    if (!value) return invalid("Authorization code is invalid or expired", 400);
    return Response.json(
      {
        access_token: value.token,
        token_type: "Bearer",
        expires_in: SESSION_SECONDS,
        scope: value.scope,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return invalid("Authorization code is invalid or expired", 400);
  }
}

function unauthorized(env: Environment, request: Request) {
  return new Response("Authentication required", {
    status: 401,
    headers: {
      "www-authenticate": `Bearer resource_metadata=\"${origin(env, request)}/.well-known/oauth-protected-resource\", scope=\"${scope}\"`,
      "cache-control": "no-store",
    },
  });
}

export async function handleRemoteMcp(env: Environment, request: Request) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!token || !validSessionToken(token)) return unauthorized(env, request);
  const user = await withDatabase(source(env), async (db) =>
    authenticationRepository(db).getActiveUser(await digest(token)),
  );
  if (!user) return unauthorized(env, request);
  const server = createRceBillingMcpServer({
    databaseSource: source(env),
    actor: { appUserId: user.id, requestId: crypto.randomUUID() },
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const response = await transport.handleRequest(request);
  await server.close();
  return response;
}
