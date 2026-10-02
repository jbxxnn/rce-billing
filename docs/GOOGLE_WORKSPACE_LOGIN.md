# Google Workspace administrator sign-in

The billing application signs administrators in through Google Workspace. A
Google account must meet both conditions:

1. Its verified hosted domain is `re-circuit.com`.
2. Its email already belongs to an active administrator in the billing database.

Google Workspace membership alone never grants billing administration access.

## Google Cloud setup

In the Google Cloud Console, create an **OAuth client ID** of type **Web
application**. Configure the consent screen for the `re-circuit.com`
Workspace organization. Add these values for each environment:

| Environment       | Authorized JavaScript origin | Authorized redirect URI                                       |
| ----------------- | ---------------------------- | ------------------------------------------------------------- |
| Local development | `http://localhost:3000`      | `http://localhost:3000/api/auth/google/callback`              |
| Staging           | the HTTPS staging origin     | the staging origin followed by `/api/auth/google/callback`    |
| Production        | the HTTPS production origin  | the production origin followed by `/api/auth/google/callback` |

The redirect URI must exactly match the URL configured in the application’s
`APP_ORIGIN` value. Do not commit the downloaded client-secret file.

## Application configuration

Set these server-only values in `.env.local` for local development and in the
environment secret store for staging/production:

```dotenv
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
```

Restart the application after changing the values. The login page then shows
**Continue with Google**. The authorization request uses OpenID Connect,
authorization-code exchange, PKCE, a signed anti-forgery state cookie, and
Google ID-token signature/audience/issuer/nonce/hosted-domain validation.

The former password endpoint is disabled. Existing administrator records are
retained as the allowlist for Workspace sign-in.
