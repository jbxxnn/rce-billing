const workspaceDomain = "re-circuit.com";

export function googleAuthConfiguration(input: {
  APP_ORIGIN?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
}) {
  const clientId = input.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = input.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const origin = input.APP_ORIGIN?.trim();
  if (!clientId || !clientSecret || !origin)
    throw new Error("Google Workspace sign-in is not configured");
  const callbackUrl = new URL("/api/auth/google/callback", origin).toString();
  return { clientId, clientSecret, callbackUrl, workspaceDomain };
}

export function googleAuthConfigured(
  input: Parameters<typeof googleAuthConfiguration>[0],
) {
  try {
    googleAuthConfiguration(input);
    return true;
  } catch {
    return false;
  }
}
