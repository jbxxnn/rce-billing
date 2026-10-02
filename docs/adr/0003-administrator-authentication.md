# ADR 0003: Administrator authentication and database sessions

Date: 2026-09-22
Status: Accepted for implementation; deployed environment validation pending.

## Decision

Implement an administrator-only email/password entry point with bcryptjs and opaque PostgreSQL-backed sessions. Keep identities in `app_users`, separate from business customers. Provision/reset/disable accounts via a restricted operational CLI. No public registration is exposed.

Use an explicit database adapter per runtime: Next.js reads the server-only `DATABASE_URL`; vinext aliases the adapter to `cloudflare:workers` and the Hyperdrive binding. This keeps Cloudflare-only imports out of Next.js builds. Both adapter paths are exercised by HTTP tests.

Bcrypt cost 12 is portable to both runtimes without native addons; password inputs are limited to 72 UTF-8 bytes and require 15 characters for provisioning. This is an explicit runtime compatibility choice. Evaluate production CPU capacity and the chosen password policy during staging. Legacy hash import is deferred to data migration; hashes with other cost settings are not silently accepted.

Session cookies contain random 256-bit tokens. Store only their digest, user ID, creation time, and absolute eight-hour expiry. Check current role/status during every authorization lookup. Database triggers revoke sessions on password/status/role changes. Session creation locks the user and verifies the exact hash that was checked to prevent a concurrent reset from being bypassed.

## Request protection

Authentication handlers compare Origin to configured APP_ORIGIN, not untrusted Host headers. They accept no GET mutations and limit login request body size. Database-backed attempt counters coordinate rate limiting across Worker instances. Unknown accounts undergo dummy password verification, with uniform failure messages. Require secure host-only cookies on HTTPS; allow local development cookies only on loopback HTTP.

Keep authorization at data/action boundaries as advised by the [Next.js authentication guide](https://nextjs.org/docs/app/guides/authentication) and [mutation guidance](https://nextjs.org/docs/app/getting-started/mutating-data). A layout check alone is insufficient. The current dashboard checks both layout and page; future services must explicitly enforce the same guard.

## Consequences

Authentication availability depends on PostgreSQL. Errors fail closed and do not fall back to anonymous access. Hyperdrive caching must remain disabled. An operational cleanup command removes expired records; expiry and revocation work before cleanup. Account operations and session lifecycle events are audited without passwords or raw session tokens.

No administrator was created in a real application database during implementation. Test users exist only in disposable databases. Production account provisioning, TLS/origin settings, runtime permissions, deployed Hyperdrive behavior, and edge rate limits require staging verification.
