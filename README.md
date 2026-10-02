# RCE Billing

Migration foundation for the Flowroute + Stripe administration platform described in [the migration plan](CODEX_MIGRATION_PLAN.md).

## Local development

Use Node.js 24 LTS (`nvm use`), then `npm ci` and `npm run dev`. The Next.js server listens on http://localhost:3000. Copy `.env.example` to `.env.local` when local configuration is needed.

For the Workers runtime, copy `.dev.vars.example` to `.dev.vars` and run `npm run dev:workers`. Use the address printed by the server. `npm run build` builds the Workers application; `npm run preview` serves its production output locally. `npm run build:next` verifies standard Next.js compatibility.

## Administrator access

The home page redirects to the protected dashboard. Configure the database, apply migrations, set `APP_ORIGIN` to the exact browser origin, and provision an administrator with `npm run auth:admin -- create admin@example.com`. Password entry is hidden. See [authentication setup](docs/AUTHENTICATION.md) for reset/disable operations, Workers configuration, and security boundaries. No public registration or default login exists.

## Customer management

Administrators can create, search, edit, archive, and restore customers at `/customers`. Flowroute keys are stored encrypted and are never displayed after saving. Configure the key ring before credential writes; see [customer management and credential setup](docs/CUSTOMERS.md).

## Plans and Stripe test mode

Manage versioned plans and subscription drafts at `/plans` and `/subscriptions`. Configure sandbox credentials to activate test subscriptions, apply Stripe-prorated plan changes, and schedule period-end cancellation. See [plan management](docs/PLANS.md) and [Stripe setup and retry handling](docs/STRIPE.md). Production billing remains disabled until the complete usage/invoice workflow is ready.

## Flowroute usage collection

The server-only Flowroute adapter creates and checks asynchronous CDR exports using each customer's encrypted credentials. It records immutable source usage but does not calculate or invoice it. See [Flowroute usage exports](docs/FLOWROUTE.md). Queue-based collection and billing calculations remain future phases.

## Validation

With a disposable PostgreSQL server configured, run `npm run test:db`. After building both targets, run `npm run test:auth` for full sign-in/logout HTTP tests. Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run check:compatibility`, `npm run build`, and `npm run build:next`. CI runs these checks without provider credentials or deployment permissions.

The health route `/api/health` reports process liveness only. It does not claim database or provider readiness.

## Architecture

- `src/app`: App Router pages and HTTP boundaries.
- `src/config`: validated runtime configuration.
- `src/domain/billing`: exact money and confirmed UTC billing-calendar rules; versioned usage formulas remain future work.
- `src/db/schema`, `src/db/migrations`, and `src/db/repositories`: typed schema, reviewable migrations, and persistence boundaries.
- `src/stripe`: provider adapter, durable sandbox workflows, and verified webhook reconciliation.
- Future `jobs`: durable usage collection, billing, and reconciliation.

PostgreSQL is the workflow system of record, accessed through Drizzle repositories and the request-scoped `pg` client. The schema, versioned SQL migrations, development fixtures, and integration tests are implemented. See [database setup](docs/db/README.md) for local migration, seeding, and Hyperdrive configuration. Production databases and provider clients remain unconfigured.

## Secrets and legacy reference

`fbc.versal.tech/` remains untouched on disk and is excluded from Git, linting, formatting, and builds. The migration plan identifies exposed credentials in that archive; it must not be committed. Store the original in an approved restricted location for other developers. Local secret files are ignored; templates contain placeholders only. Production application secrets belong in Cloudflare Secrets, and customer Flowroute credentials will be encrypted before storage.

## Deployment boundary

The Workers build uses vinext and the Cloudflare Vite plugin. Public Workers URLs are disabled in `wrangler.jsonc`. No deployment runs in CI. Before staging deployment, configure the target account/environment and access policy, then validate the deployment against that environment. Administrator authentication is implemented. Production provider bindings and real billing remain future phases.

See [the architecture decision](docs/adr/0001-application-foundation.md) and [migration progress](docs/MIGRATION_PROGRESS.md).
# rce-billing
