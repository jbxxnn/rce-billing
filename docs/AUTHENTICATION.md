# Administrator authentication

## Setup

Apply all database migrations with `npm run db:migrate`. Set `DATABASE_URL` for local Next.js and `APP_ORIGIN` to the exact origin opened in the browser, including port. Example: `http://localhost:3000`. Local environment files are supported by Next.js; operational CLI commands use exported shell environment variables.

Use the privileged direct database connection in `DATABASE_MIGRATION_URL` to provision an account:

```sh
npm run auth:admin -- create admin@example.com
```

The CLI prompts for a password and confirmation without echoing it. Passwords require at least 15 characters and at most 72 UTF-8 bytes. Use a password manager. Do not put passwords in command arguments or shell history. Piped standard input is supported for approved secret-manager integrations. There is no public registration, seeded login, or password-reset email flow.

Start the app with `npm run dev` and visit `/login`. The root URL redirects to `/dashboard`, which requires an active administrator session.

For Workers, provision the Hyperdrive binding described in the database guide. `vite.config.ts` selects the Worker database adapter; Next.js selects the local server adapter through TypeScript paths. Set `APP_ENV` and `APP_ORIGIN` as Worker configuration values. Hyperdrive query caching **must be disabled** for session revocation, rate-limit consistency, and financial correctness. The test suite verifies a local binding; verify the deployed configuration before production.

For staging and production, set `APP_ENV=staging` or `production` and an HTTPS `APP_ORIGIN`. A production Node process defaults to production authentication settings if `APP_ENV` is absent. The origin is never inferred from request Host or forwarded headers. Local HTTP is accepted only for loopback origins in development/test mode. The origin in `.dev.vars.example` must be adjusted if the Workers dev server uses another port.

## Account operations

```sh
npm run auth:admin -- reset admin@example.com
npm run auth:admin -- disable admin@example.com
```

Reset prompts for a new password and revokes all existing sessions. Reset does not reactivate a disabled account. Disable immediately invalidates sessions. The CLI records account operations in the immutable audit log and requires administrative database credentials; it is not exposed as a public route. Initial account provisioning is not performed automatically by the application.

`npm run auth:cleanup` removes up to 1,000 expired sessions and 1,000 expired throttle records using the operational connection. Repeat if needed. Expiration is enforced on every read regardless of cleanup. Schedule this bounded operation when background jobs are implemented.

## Session and request security

- Passwords use bcrypt with cost 12, tested in both Node and workerd. Input is checked by UTF-8 byte length to avoid bcrypt truncation. Existing PHP password hashes are not automatically migrated; legacy accounts require an explicit migration/reset policy.
- A login generates a fresh 256-bit opaque token; only its SHA-256 digest is stored in PostgreSQL. Sessions expire after eight hours without sliding renewal.
- HTTPS cookies use `__Host-rce-session`, Secure, HttpOnly, SameSite=Strict, Path=/, and no Domain. Local HTTP uses `rce-session` without Secure so development remains usable.
- Protected pages resolve the session against current database account status and role. Disabling the user, changing their password or role, or logging out invalidates the session. A trigger enforces revocation even for direct database account changes.
- Login and logout are POST-only and require the configured Origin. Cross-site or originless requests are rejected. Login parsing accepts a bounded URL-encoded body and rejects duplicate credential fields.
- Throttling is persisted and atomic: five attempts per normalized email per 15 minutes and 100 global attempts per five minutes. Unknown/disabled users use a dummy password hash; failure messages do not identify account existence. Global limiting intentionally favors protecting the low-volume administrator portal; production edge rate limiting and load testing should complement it.
- Database failures return generic errors. Sessions, passwords, raw credential payloads, and connection strings are not added to audit records.
- Responses include frame protection, content-type protection, and same-origin form restrictions. Auth responses and dashboard content are not cacheable.

## Authorization boundary

Call `requireAdministrator()` inside every protected page and future mutation/service entry point. The dashboard layout is a secondary guard, not the sole protection. Never trust a supplied user ID or client role. The only currently provisioned role is ADMIN; the schema rejects other role names. Session reads return only administrator ID, email, and role.

Financial actions are still unimplemented. Their later services must call the authorization guard and validate inputs before calling repositories. This phase does not add customer notifications, self-service registration, or billing mutations.

## Tests

With `TEST_DATABASE_URL` pointing to a disposable PostgreSQL service:

```sh
npm test
npm run test:db
npm run build
npm run build:next
npm run test:auth
```

Database tests cover concurrent attempt limiting, invalid passwords, session hashing/rotation/expiry/logout, disabled users, stale verification, and administrative password changes. HTTP tests launch both production Next.js and a local workerd instance against a generated database, checking redirects, forms, CSRF, cookies, dashboard caching, logout, and password-reset revocation. They use ports 3119 and 3120 and remove their temporary database/configuration afterward. CI runs the same checks.
