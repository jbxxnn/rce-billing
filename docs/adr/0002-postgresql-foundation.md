# ADR 0002: PostgreSQL foundation and billing identity

Date: 2026-09-22
Status: Accepted for the foundation; business-rule characterization remains outstanding.

## Data layer

Use Drizzle ORM with `pg` and checked-in generated SQL migrations. The TypeScript schema is the table-definition source; custom SQL migrations implement history guards that Drizzle cannot express. Never use schema push against shared databases. Migrations run over a direct administrative connection with a session advisory lock; they never run during requests or builds.

Cloudflare's [PostgreSQL driver guide](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/) supports `pg` and Drizzle with Hyperdrive. Follow [Drizzle's generated migration workflow](https://orm.drizzle.team/docs/drizzle-kit-generate). Local integration tests run the repositories against PostgreSQL 16 in both Node and workerd. This does not validate a deployed Hyperdrive configuration.

## Billing identity and periods

Use one canonical billing run per customer and usage month, independent of subscription ID, formula version, or trigger type. The earlier proposed uniqueness key allowed duplicates when subscriptions were null or formulas changed. A retry returns the existing run unchanged. A successful run is never implicitly restarted. Exceptional additional charges require a later explicitly authorized design; no bypass API exists now.

Usage periods are half-open calendar dates: August is `[2026-08-01, 2026-09-01)`. Billing runs require a whole calendar month. This identifies the month without guessing the still-unconfirmed timezone or provider boundary semantics. Actual subscription periods and operational timestamps remain `timestamptz`. The later scheduler must select the previous full month independently of billing day and convert it into the approved provider request timestamps.

Composite foreign keys ensure that a run's subscription belongs to its customer and its usage snapshot belongs to the same customer and period. Snapshots reference their exact customer/provider/export/period. Flowroute is the only supported usage provider in this migration.

## Precision and history

Final money is PostgreSQL `bigint`, returned as JavaScript `bigint`. Fractional source cost and quantities use `numeric(30,12)` returned as strings. No rounding or billable-unit interpretation is introduced. JSON snapshots must encode monetary values as decimal strings; browser responses must explicitly serialize bigint values.

The original calculated subtotal must equal its stored line items. Sealing a calculation requires usage; lines serialize against that seal. Triggers preserve usage snapshots, audit records, original calculations, price-version economics, and adjustment history. Provider links may be attached once. Separate `billing_run_adjustments` capture manual corrections with actor, reason, amount, and time. Customer recurring adjustments can be expired, but their original values cannot be rewritten.

Account payment status is separate from service status, so `PAST_DUE` does not force service suspension. Full service state machines, Stripe invoice-finalization controls, authorization, encryption, formula validation, and scheduler behavior remain later phases.

## Deployment and scope

Repositories expose plain TypeScript contracts, not ORM query builders, to application services. Customer creation and run reservation write their audit entries atomically. Identity checks in repositories supplement the future authentication layer; knowing an administrator ID is not authentication.

Only synthetic draft customers and inactive example plans are seeded. No password, provider credential, live ID, approved formula, or billable subscription is seeded. Customer Flowroute encryption will be implemented before any credential writes.

The stable Drizzle Kit dependency brings an obsolete esbuild through `@esbuild-kit/core-utils`. A scoped override pins that nested esbuild to 0.25.12; migration generation was retested and npm reported zero vulnerabilities after installation. Remove the override when the upstream dependency is fixed.
