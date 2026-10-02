# Database development

## Schema and migrations

`src/db/schema/index.ts` defines 21 tables. `src/db/migrations/0000_core_billing_schema.sql` creates tables, indexes, enum types, checks, and foreign keys. `0001_history_guards.sql` adds append-only history, immutable calculation guards, automatic update timestamps, and timezone validation. `0002_administrator_sessions.sql` adds session and throttle records; `0003_revoke_changed_identities.sql` revokes sessions when credentials, role, or status change. Customer-management migrations 0004–0006 add revision checking, unverified credential state, encrypted-envelope checks, and guards against new billing activity on archived records. Migrations 0007–0009 add plan/subscription revisions and immutable price-version support. Migrations 0010–0011 add Stripe workflow/request records and their guards. Migrations 0012–0013 add recoverable Flowroute export claims and immutable export identity. Migration 0014 adds the durable Flowroute Queue outbox. Migration 0015 reserves the immutable plan-price version with each subscription-linked billing run. Drizzle's metadata records migration order. Do not edit an already-applied migration; generate a new one.

Use PostgreSQL 16 or later. Install dependencies with `npm ci`. Set the variables below in the shell or use an approved secret loader. The CLI does not automatically load `.env.local`.

```sh
export DATABASE_MIGRATION_URL='postgresql://MIGRATOR:PASSWORD@127.0.0.1:5432/rce_billing'
npm run db:migrate
```

The migration user must own the dedicated application schema and have DDL privileges. Use a **direct** connection for migrations: the advisory lock is session-scoped. Migration replay is safe; concurrent migration commands serialize. Migration commands never run automatically as part of application startup or CI deployment.

For schema changes, edit the TypeScript schema, then run `npm run db:generate -- --name=descriptive_name`. Review the generated SQL. For triggers or other handwritten SQL, use `npm run db:generate -- --custom --name=descriptive_name`. Run the full database suite after every migration change.

## Synthetic development fixtures

```sh
APP_ENV=development ALLOW_DEV_SEED=true npm run db:seed
```

This explicitly opted-in command uses `DATABASE_MIGRATION_URL`. Run it only on a development database. It is idempotent and inserts one draft customer plus four inactive example plans and immutable price snapshots. Fixtures cannot perform billing and contain no credentials. It does not provision an administrator login.

## Repository boundary

Use `withDatabase(source, async db => ...)` with repository factories from `src/db/repositories`. In Workers, pass `env.HYPERDRIVE`; in local Next.js, pass `{ connectionString: serverEnvironment.DATABASE_URL }`. Imports are guarded with `server-only`. The client is opened inside the request/job and closed in `finally`, including errors. Hyperdrive owns production connection pooling; no live client is reused across Worker requests. Avoid provider HTTP requests while holding a database transaction.

Repositories currently cover customer creation/read/pagination, plan/subscription reads, idempotent run and usage-export reservation, period-specific usage lookup, and webhook event deduplication. Mutation/state-machine APIs will be added with their application services. A duplicate webhook record can still be pending or failed; deduplication is not proof of successful processing.

## Integration tests

Provide a disposable PostgreSQL server and a user with `CREATEDB`. The URL must include a password for the local Hyperdrive emulator, even when local PostgreSQL uses trust authentication.

```sh
export TEST_DATABASE_URL='postgresql://TEST_USER:TEST_PASSWORD@127.0.0.1:5432/postgres'
npm run test:db
```

The suite creates a random `rce_test_<hex>` database, applies migrations concurrently and repeatedly, tests repositories and constraints, and drops only its own generated database on completion. It never clears tables in the database named in the URL. The final test starts a local-only Worker on port 8794 and queries through a Hyperdrive binding. `wrangler.db-test.jsonc` is solely for this test and must never be deployed. The Worker is stopped by the test. An interrupted test may leave its generated database for local cleanup.

CI provisions PostgreSQL 16 as a service and runs this suite in addition to unit tests and both builds. The public CI-only database password is not a production secret.

## Production provisioning to complete later

Provision a dedicated PostgreSQL database, a migration login, and a separate least-privilege runtime login. Runtime needs schema usage and SELECT/INSERT/UPDATE on operational tables, SELECT/INSERT on immutable history, and no DDL, TRUNCATE, superuser, or trigger-disabling privileges. Runtime additionally requires DELETE on `app_sessions` for logout/session revocation; cleanup requires DELETE on `auth_rate_limits`. Do not grant DELETE on business or financial-history tables. Explicitly include new tables when granting privileges. Do not grant runtime access to the Drizzle migration journal.

Create the Cloudflare Hyperdrive configuration for the runtime login, disable query caching for billing correctness, and add the actual binding to `wrangler.jsonc`:

```json
{
  "hyperdrive": [
    { "binding": "HYPERDRIVE", "id": "REPLACE_WITH_PROVISIONED_ID" }
  ]
}
```

For local Workers development, set `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` in the shell. Do not commit a real connection URL. Verify TLS/certificate settings with the selected provider; the client does not disable certificate verification.

No production account, database, Hyperdrive resource, provider integration, or application credential has been created or configured in this phase. Production validation must verify role permissions, caching settings, deployed connectivity, and backup/restore procedures.
