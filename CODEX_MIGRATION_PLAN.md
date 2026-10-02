# Flow Billing System — Next.js + Cloudflare Migration Plan for Codex

> **Status:** Implementation specification based on an audit of the legacy PHP archive `fbc.versal.tech.zip`.
>
> **Primary objective:** Rebuild the existing Flowroute + Stripe billing application as a secure, typed, observable, scalable Next.js application designed for Cloudflare Workers and PostgreSQL, while preserving verified billing behavior and avoiding a risky big-bang cutover.
>
> **Critical instruction to Codex:** This is **not** a line-by-line PHP-to-TypeScript conversion. Treat the PHP application as evidence of current business behavior. Re-design the implementation around clear domain boundaries, background jobs, idempotency, database constraints, auditability, and tests.

---

## 1. Executive Summary

The legacy application performs several jobs in one PHP codebase:

1. Admin authentication and role checks.
2. Customer creation and management.
3. Storage of Flowroute API credentials per customer.
4. Stripe customer creation.
5. Stripe product/price creation.
6. Stripe subscription creation with customer-specific billing days.
7. Monthly Flowroute CDR export requests.
8. Polling Flowroute until an export completes.
9. Storing monthly usage/cost values.
10. Calculating additional charges using several subscription-type-specific formulas.
11. Creating Stripe invoice items / usage records.
12. Fixed-charge subscription creation.
13. Manual invoice sending.
14. Configuration editing from the web UI.
15. Scheduled billing through PHP/cron/`exec()`.

The legacy system works, but its responsibilities are tightly coupled and its schema has drifted over time. The rebuild must separate UI, domain logic, persistence, external-provider integrations, and background execution.

The target architecture is:

```text
Browser / Admin UI
        |
        v
Next.js application on Cloudflare Workers
        |
        +--> Auth / RBAC
        |
        +--> Application services
        |      +--> Customers
        |      +--> Plans
        |      +--> Subscriptions
        |      +--> Billing
        |      +--> Usage
        |
        +--> Stripe adapter
        +--> Flowroute adapter
        |
        +--> Cloudflare Queues / Workflows
        |      +--> usage collection
        |      +--> billing calculation
        |      +--> Stripe synchronization
        |      +--> retries / dead-letter handling
        |
        +--> Cloudflare Cron Triggers
        |
        +--> Cloudflare Hyperdrive
               |
               v
           PostgreSQL
```

Cloudflare currently recommends **vinext** for new full-stack Next.js applications on Workers. It is currently beta, so compatibility must be validated before production deployment. PostgreSQL should remain an external managed database connected through Cloudflare Hyperdrive.

---

## 2. Non-Negotiable Migration Principles

Codex must follow these rules throughout implementation.

### 2.1 Preserve behavior, not implementation

Do not mechanically translate PHP files into equivalent route handlers. First identify the business behavior, then implement it in the correct domain/service.

### 2.2 Billing correctness has priority over convenience

Any operation that can create a charge, invoice item, subscription, or customer in Stripe must be:

- idempotent;
- auditable;
- retry-safe;
- protected against concurrent execution;
- tested;
- traceable to a billing run and customer;
- executed server-side only.

### 2.3 Money must never use floating-point arithmetic

The PHP application uses decimal/floating-point operations and later multiplies by 100 in several places. Do not copy that pattern.

Use one of:

- integer minor units (`amountCents BIGINT`) for USD; or
- exact PostgreSQL `NUMERIC` and a decimal arithmetic library where fractional-unit calculations genuinely require precision.

All final Stripe amounts must be integer minor units.

### 2.4 Do not store provider secrets in source code

The uploaded legacy archive contains credentials/secrets in source files. The new project must never commit secrets.

Use:

- Cloudflare Secrets for application-level secrets;
- encrypted-at-rest storage for customer-specific Flowroute credentials;
- `.env.example` containing placeholders only;
- separate development, staging, and production credentials.

All currently exposed legacy credentials must be treated as compromised and rotated before production migration.

### 2.5 Never run long polling in an HTTP request

The legacy Flowroute job polls every 60 seconds in a `while (true)` loop. Do not recreate this inside a Worker request.

Use an asynchronous state machine / queue / workflow:

```text
Create Flowroute export
        |
        v
Persist export ID + status
        |
        v
schedule/requeue status check
        |
        +-- pending --> retry later
        |
        +-- completed --> persist usage snapshot --> billing calculation
        |
        +-- failed --> failed state + alert/retry policy
```

### 2.6 Database is the system of record for workflow state

Do not rely on memory, request state, or queue delivery alone to know whether something was billed.

Persist states such as:

- usage export requested;
- usage export completed;
- calculation completed;
- Stripe operation pending;
- Stripe operation completed;
- billing run completed;
- billing run failed.

### 2.7 Do not delete the PHP application during migration

The legacy app remains the reference implementation until parity and reconciliation are complete.

---

## 3. Legacy Codebase Audit

### 3.1 Scope inspected

The uploaded archive contains approximately 576 files, although most are vendored Stripe PHP SDK files. The application-owned PHP code is approximately 2,766 lines across the root application, `settings/`, `stripe/`, `user/`, and `APITaskRunner/`.

Primary application files include:

```text
/
├── index.php
├── add_user.php
├── submit_user.php
├── registration.php
├── login.php
├── sign-in.php
├── logout.php
├── user/user.php
│
├── settings/
│   ├── user_config.php
│   ├── config_form.php
│   ├── save_config.php
│   ├── add_database.php
│   └── cdr_database.sql.gz
│
├── APITaskRunner/
│   ├── config.php
│   ├── scheduler.php
│   ├── main.php
│   └── Main_test.php
│
└── stripe/
    ├── index.php
    ├── add_product.php
    ├── create_product.php
    ├── customer_stripe.php
    ├── add_subscription.php
    ├── fixed_billing.php
    ├── updatestripe.php
    ├── updatestripe_metered.php
    ├── updatestripe_unmetered.php
    ├── send_invoice.php
    └── senderto.php
```

### 3.2 Important legacy inconsistencies

The new system must resolve these instead of reproducing them.

#### Database names

Different PHP files reference different databases, including legacy names equivalent to:

- `...cdr_data`
- `...flowbill`

Use one PostgreSQL database with migrations.

#### Customer tables

The archive contains or references both:

- `users`
- `customers`

The bundled SQL dump contains `users`, while newer PHP code frequently reads `customers`. This indicates schema evolution outside the included dump.

Create one canonical `customers` table.

#### Subscription tables

The code references both:

- `user_subscriptions`
- `customers_subscription`

Create one canonical `subscriptions` table.

#### Billing day field

Older code uses `number`; newer code uses `billing_day`.

Create one `billing_day` field with validation.

#### Stripe customer field

Legacy tables and scripts use different naming assumptions (`customer_id` vs `stripe_customer_id`).

The new model must clearly separate internal IDs from provider IDs:

- `customers.id` = internal UUID
- `customers.stripe_customer_id` = Stripe ID
- never overload one field for both meanings.

### 3.3 Legacy SQL dump tables

The bundled SQL dump exposes these tables:

```text
cdr_records
members
monthly_data
products
users
user_subscriptions
```

Observed columns include:

```text
cdr_records:
  id
  customer_id
  billing_period_start
  billing_period_end
  flowroute_usage

members:
  id
  username
  email
  password
  reg_date
  role

monthly_data:
  data_id
  user_id
  month
  data
  data_date

products:
  id
  stripe_product_id
  name
  description
  price_id
  price

users:
  id
  name
  email
  phone
  access_key
  secret_key
  number
  reg_date
  customer_id
  subscription_id
  product_id
  street_address
  city
  state
  zip_code

user_subscriptions:
  id
  user_id
  subscription_id
  status
  start_date
  current_period_start
  current_period_end
  sub_item_id
```

Newer PHP code indicates additional live-schema fields/tables not represented by the bundled SQL dump, including fields such as:

- `customers.fullname`
- `customers.billing_day`
- `customers.subscription_type`
- `customers.metered_sip_trunk_usage`
- `customers.cloud_server_hosting_subscription`
- `customers.extra_numbers`
- `customers.product_id`
- `price_plans.plan_type`
- `price_plans.included_minutes`
- `price_plans.additional_minutes`
- `price_plans.included_numbers`
- `price_plans.number_cost`
- `price_plans.included_channels`
- `price_plans.channel_cost`

**Therefore:** do not assume the bundled SQL dump is the production schema. Obtain/export the actual current production schema before final data migration.

---

## 4. Legacy Behavior Mapping

### 4.1 Admin/member authentication

Legacy files:

- `registration.php`
- `login.php`
- `sign-in.php`
- `logout.php`
- repeated `session_start()` / role queries in admin pages

Observed behavior:

- users authenticate by username/password;
- passwords are hashed with PHP `password_hash`;
- session stores username/member ID;
- some routes verify `role === admin`;
- protection is inconsistent across pages.

Target behavior:

- centralized authentication middleware;
- centralized authorization/RBAC;
- no per-page custom role query boilerplate;
- all admin mutations require authenticated administrator privileges;
- session cookies must be secure, HTTP-only, same-site protected;
- registration should not be publicly available unless explicitly required.

### 4.2 Customer management

Legacy files:

- `index.php`
- `add_user.php`
- `submit_user.php`
- `user/user.php`

Observed behavior:

- list customers;
- display customer details;
- create customer records;
- collect address/phone/email;
- collect Flowroute access + secret keys;
- choose billing day;
- choose billing plan/product;
- capture extra/additional charge fields;
- initiate Stripe customer/subscription actions from customer screen.

Target behavior:

- `/customers`
- `/customers/new`
- `/customers/[id]`
- schema-validated forms;
- server-side mutations;
- customer status (`draft`, `active`, `suspended`, `archived`);
- separate provider credential management from general customer fields;
- audit every administrative change affecting billing.

### 4.3 Stripe customer creation

Legacy file:

- `stripe/customer_stripe.php`

Observed behavior:

- query customer;
- call Stripe Customer create API;
- send email/name/phone/shipping address;
- write returned Stripe customer ID back to database.

Target behavior:

Implement service:

```ts
stripeCustomerService.ensureCustomer(customerId)
```

Requirements:

1. Return existing Stripe customer if already linked.
2. Otherwise create it using a deterministic idempotency key.
3. Include internal customer ID in Stripe metadata.
4. Persist `stripe_customer_id` in a DB transaction-aware flow.
5. If Stripe succeeds but DB persistence fails, reconciliation must discover and repair the linkage.
6. Never create a second Stripe customer on an HTTP retry.

Suggested idempotency key format:

```text
customer:create:<internal-customer-uuid>:v1
```

### 4.4 Product/plan creation

Legacy files:

- `stripe/index.php`
- `stripe/add_product.php`
- `stripe/create_product.php`

Observed behavior:

- admins create Stripe products and metered prices;
- local plan table stores Stripe product/price IDs and billing attributes;
- plan data includes minutes, plan type, additional minutes, included numbers, number cost, channels, channel cost.

Target behavior:

Create a canonical `plans` model.

Do not let an arbitrary browser request directly define Stripe billing objects without validation and an audit record.

Separate:

- plan definition in application DB;
- Stripe synchronization status;
- Stripe immutable price versions.

Important: Stripe Prices should be treated as versioned/immutable billing definitions. If billing economics change, create a new price/version rather than silently rewriting historical meaning.

### 4.5 Subscription creation

Legacy file:

- `stripe/add_subscription.php`

Observed behavior:

- customer has a billing day;
- code computes next billing anchor at approximately 11:00 UTC;
- creates Stripe subscription;
- uses `collection_method = send_invoice` in one path;
- stores Stripe subscription ID, item ID, status and period dates.

Target behavior:

Implement:

```ts
subscriptionService.createSubscription(customerId, planId, options)
```

The service must:

- verify Stripe customer exists;
- verify plan is active;
- calculate billing anchor through one tested function;
- define timezone semantics explicitly;
- handle billing days 29/30/31 in short months;
- use a Stripe idempotency key;
- persist subscription state;
- synchronize lifecycle through webhooks;
- not assume `active` is the only acceptable creation state;
- never depend on Stripe response alone as permanent truth.

### 4.6 Fixed billing

Legacy file:

- `stripe/fixed_billing.php`

Observed behavior:

- creates a Stripe subscription with quantity 1;
- calculates billing-cycle anchor based on configured day;
- stores it in `user_subscriptions`.

Target behavior:

Fixed billing should be represented as a plan/pricing strategy, not a completely separate persistence model.

Use one subscription domain and distinguish pricing mode:

```text
FIXED
METERED
UNMETERED
CUSTOM/OTHER
```

Do not create separate subscription tables for each mode.

### 4.7 Flowroute usage collection

Legacy files:

- `APITaskRunner/scheduler.php`
- `APITaskRunner/main.php`

Observed flow:

```text
scheduler
  -> find customers billed tomorrow
  -> exec PHP process per customer
  -> POST Flowroute CDR export for previous month
  -> poll export every 60 seconds
  -> on completion read total_cost
  -> insert total into monthly_data
```

Problems:

- `exec()` fan-out;
- long-running polling;
- credentials passed as CLI arguments;
- no durable job state;
- limited retry policy;
- possible duplicate monthly rows;
- previous-month range may not actually match every customer's subscription period;
- billing tomorrow and querying previous calendar month are different concepts;
- no clear deduplication key.

Target design:

Create `usage_exports` with a unique natural key:

```text
(customer_id, provider, period_start, period_end)
```

State machine:

```text
PENDING
REQUESTED
PROCESSING
COMPLETED
FAILED_RETRYABLE
FAILED_PERMANENT
```

Persist provider export ID and timestamps.

Use queue/workflow steps instead of sleeping.

### 4.8 Usage storage

Legacy table:

- `monthly_data`

Observed behavior:

- stores a generic `data` value;
- different code assumes `customer_id` or `user_id`;
- latest row is used for billing.

Target behavior:

Do not use a generic `data` column or “latest row” semantics.

Use explicit period snapshots:

```text
usage_snapshots
  id
  customer_id
  provider
  period_start
  period_end
  total_provider_cost_minor
  raw_usage_units (optional numeric)
  currency
  source_export_id
  captured_at
  raw_payload_hash
  created_at
```

Use a uniqueness constraint to prevent duplicate snapshots for the same customer/period/provider.

### 4.9 Legacy custom/other billing formula

Legacy file:

- `stripe/updatestripe.php`

Observed behavior approximately:

```text
usageQuantity = ceil(latest Flowroute data)
productPrice = plan price looked up from Stripe price ID
meteredSipCharge = customer.metered_sip_trunk_usage
hostingCharge = customer.cloud_server_hosting_subscription

usageInvoiceAmount = usageQuantity * productPrice + meteredSipCharge
hostingInvoiceAmount = hostingCharge
```

The script then deletes existing invoice items associated with the subscription, recreates invoice items, and writes a usage record of `0`.

**Migration rule:** preserve this as a documented legacy formula only. Do not deploy it as authoritative until historical invoices are reconciled.

### 4.10 Legacy metered billing formula

Legacy file:

- `stripe/updatestripe_metered.php`

Observed behavior:

```text
usageQuantity = ceil(latest Flowroute data)
productPrice = local plan price
percentageOfPricePerMonth = 0.35 * productPrice
firstPart = (usageQuantity - percentageOfPricePerMonth) * 4
secondPart = (extraNumbers - includedNumbers) * numberCost
result = firstPart + secondPart
```

Then an invoice item is created for `result` and a legacy Stripe usage record is set to `1`.

Potential issues requiring explicit business confirmation/tests:

- `productPrice` appears mixed into a usage-unit formula.
- Negative values are possible when usage is lower than the computed threshold.
- `extraNumbers - includedNumbers` can be negative.
- constants `0.35` and `4` are unexplained magic numbers.
- unit/currency semantics are not encoded.

**Codex must not “clean up” or change these constants silently.** Represent them as named legacy billing parameters and write characterization tests first.

### 4.11 Legacy unmetered billing formula

Legacy file:

- `stripe/updatestripe_unmetered.php`

Observed behavior:

```text
firstPart = includedChannels * channelCost
secondPart = (extraNumbers - includedNumbers) * numberCost
result = firstPart + secondPart
```

The code retrieves Flowroute usage but the final observed formula is not based on that usage.

This should be treated as a legacy rule requiring historical invoice verification.

### 4.12 Manual invoice sending

Legacy file:

- `stripe/send_invoice.php`

Observed behavior:

- admin endpoint fetches customer/subscription;
- creates invoice;
- sends invoice.

Target behavior:

Use a controlled admin action with:

- confirmation UI;
- audit event;
- idempotency/deduplication;
- visible current invoice status;
- permission check;
- no raw provider errors leaked to browser.

---

## 5. Target Technology Stack

Use the following as the default target unless compatibility tests demonstrate a blocker.

### Application

- Next.js 16+ App Router
- TypeScript with `strict: true`
- React Server Components by default
- Client Components only where interactivity requires them
- Zod (or equivalent) for runtime input validation
- server-side actions / route handlers for mutations

### Cloudflare

- Cloudflare Workers for full-stack execution
- vinext as current recommended Next.js-on-Workers path
- Cloudflare Cron Triggers for periodic orchestration
- Cloudflare Queues and/or Workflows for durable background billing processes
- Hyperdrive for PostgreSQL connectivity
- Cloudflare Secrets for application secrets

Because vinext is currently beta, create a compatibility gate before production:

```bash
npx vinext check
```

Do not assume compatibility; verify all dependencies.

### Database

- PostgreSQL
- UUID primary keys for application-owned domain entities
- migrations checked into source control
- preferred typed data layer: Drizzle ORM, provided it passes Workers/vinext integration tests
- isolate database access behind repositories so ORM replacement does not leak into domain services

### Stripe

Use the current Stripe Node SDK.

New code must use current supported Stripe Billing concepts. Legacy `createUsageRecord` behavior should not be copied automatically. Evaluate Stripe Billing Meters / Meter Events for usage-based billing where the business model fits.

Use Stripe idempotency keys for all retryable POST operations.

### Testing

- Vitest for unit/service tests
- integration tests against PostgreSQL test database
- Stripe test-mode integration tests
- deterministic mocked Flowroute tests
- Playwright for critical admin workflows

---

## 6. Proposed PostgreSQL Schema

This schema is a starting contract. Codex may refine naming, but must preserve the domain boundaries and constraints.

### 6.1 `app_users`

```text
id uuid PK
email text UNIQUE NOT NULL
username text UNIQUE NULL
password_hash text NULL
role enum/admin-role NOT NULL
status text NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
last_login_at timestamptz NULL
```

If external/Cloudflare authentication replaces passwords, keep identity mapping separate from business customer records.

### 6.2 `customers`

```text
id uuid PK
legacy_id bigint UNIQUE NULL
full_name text NOT NULL
email text NOT NULL
phone text NULL
status text NOT NULL
billing_day smallint NOT NULL CHECK 1..31
billing_timezone text NOT NULL DEFAULT 'UTC'
subscription_type text NULL
stripe_customer_id text UNIQUE NULL
street_address text NULL
city text NULL
state text NULL
postal_code text NULL
country_code text NOT NULL DEFAULT 'US'
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
archived_at timestamptz NULL
```

Index:

```text
(status, billing_day)
stripe_customer_id
email
```

### 6.3 `customer_provider_credentials`

Do not keep raw credentials on `customers`.

```text
id uuid PK
customer_id uuid FK
provider text NOT NULL       // FLOWROUTE
access_key_encrypted text NOT NULL
secret_key_encrypted text NOT NULL
encryption_key_version text NOT NULL
status text NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
rotated_at timestamptz NULL
UNIQUE(customer_id, provider)
```

Credentials must be encrypted before persistence.

### 6.4 `plans`

```text
id uuid PK
legacy_id bigint UNIQUE NULL
name text NOT NULL
description text NULL
plan_type text NOT NULL
currency char(3) NOT NULL DEFAULT 'USD'
base_amount_minor bigint NULL
included_minutes numeric NULL
additional_minute_amount_minor bigint NULL
included_numbers integer NOT NULL DEFAULT 0
number_amount_minor bigint NOT NULL DEFAULT 0
included_channels integer NOT NULL DEFAULT 0
channel_amount_minor bigint NOT NULL DEFAULT 0
active boolean NOT NULL DEFAULT true
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

### 6.5 `plan_price_versions`

```text
id uuid PK
plan_id uuid FK
version integer NOT NULL
stripe_product_id text NULL
stripe_price_id text UNIQUE NULL
pricing_configuration jsonb NOT NULL
active_from timestamptz NOT NULL
active_until timestamptz NULL
created_at timestamptz NOT NULL
UNIQUE(plan_id, version)
```

This preserves historical billing meaning when plan economics change.

### 6.6 `subscriptions`

```text
id uuid PK
legacy_id bigint UNIQUE NULL
customer_id uuid FK NOT NULL
plan_price_version_id uuid FK NOT NULL
stripe_subscription_id text UNIQUE NULL
stripe_subscription_item_id text NULL
status text NOT NULL
collection_method text NULL
billing_day smallint NOT NULL
current_period_start timestamptz NULL
current_period_end timestamptz NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
cancel_at_period_end boolean NOT NULL DEFAULT false
cancellation_requested_at timestamptz NULL
canceled_at timestamptz NULL
```

### 6.7 `customer_billing_adjustments`

Replace scattered customer numeric columns with typed adjustments where appropriate.

```text
id uuid PK
customer_id uuid FK
code text NOT NULL
amount_minor bigint NULL
quantity numeric NULL
metadata jsonb NOT NULL DEFAULT '{}'
reason text NULL
created_by_app_user_id uuid FK NULL
active boolean NOT NULL DEFAULT true
valid_from timestamptz NOT NULL
valid_until timestamptz NULL
created_at timestamptz NOT NULL
```

Examples:

```text
METERED_SIP_TRUNK_USAGE
CLOUD_SERVER_HOSTING
EXTRA_NUMBERS
```

### 6.8 `usage_exports`

```text
id uuid PK
customer_id uuid FK NOT NULL
provider text NOT NULL
period_start timestamptz NOT NULL
period_end timestamptz NOT NULL
provider_export_id text NULL
status text NOT NULL
attempt_count integer NOT NULL DEFAULT 0
next_attempt_at timestamptz NULL
last_error_code text NULL
last_error_message text NULL
requested_at timestamptz NULL
completed_at timestamptz NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
UNIQUE(customer_id, provider, period_start, period_end)
```

### 6.9 `usage_snapshots`

```text
id uuid PK
customer_id uuid FK NOT NULL
usage_export_id uuid FK NOT NULL
authoritative_period_start timestamptz NOT NULL
authoritative_period_end timestamptz NOT NULL
provider_cost_minor bigint NULL
usage_quantity numeric NULL
currency char(3) NOT NULL DEFAULT 'USD'
raw_payload jsonb NULL
raw_payload_hash text NULL
captured_at timestamptz NOT NULL
created_at timestamptz NOT NULL
UNIQUE(customer_id, authoritative_period_start, authoritative_period_end)
```

If raw payloads are large, store them in R2 and persist an object key + hash instead.

### 6.10 `billing_runs`

This is one of the most important new tables.

```text
id uuid PK
customer_id uuid FK NOT NULL
subscription_id uuid FK NULL
period_start timestamptz NOT NULL
period_end timestamptz NOT NULL
status text NOT NULL
trigger_type text NOT NULL        // SCHEDULED | MANUAL | REPLAY
formula_version text NOT NULL
usage_snapshot_id uuid FK NULL
calculation_snapshot jsonb NULL
subtotal_minor bigint NULL
currency char(3) NOT NULL DEFAULT 'USD'
stripe_invoice_id text NULL
stripe_invoice_item_ids jsonb NULL
attempt_count integer NOT NULL DEFAULT 0
error_code text NULL
error_message text NULL
started_at timestamptz NULL
completed_at timestamptz NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
UNIQUE(customer_id, subscription_id, period_start, period_end, formula_version)
```

### 6.11 `billing_line_items`

```text
id uuid PK
billing_run_id uuid FK NOT NULL
code text NOT NULL
description text NOT NULL
quantity numeric NOT NULL
unit_amount_minor bigint NOT NULL
amount_minor bigint NOT NULL
calculation_metadata jsonb NOT NULL
stripe_invoice_item_id text NULL
created_at timestamptz NOT NULL
```

Store the exact inputs used to calculate every line item.

### 6.12 `stripe_events`

```text
id uuid PK
stripe_event_id text UNIQUE NOT NULL
event_type text NOT NULL
livemode boolean NOT NULL
payload jsonb NOT NULL
processing_status text NOT NULL
received_at timestamptz NOT NULL
processed_at timestamptz NULL
error_message text NULL
```

Webhook handler must first insert/deduplicate event, then dispatch processing.

### 6.13 `audit_events`

```text
id uuid PK
actor_type text NOT NULL
actor_id text NULL
action text NOT NULL
entity_type text NOT NULL
entity_id text NULL
before_json jsonb NULL
after_json jsonb NULL
request_id text NULL
created_at timestamptz NOT NULL
```

Every billing-affecting admin change must create an audit event.

---

## 7. Suggested Next.js Project Structure

```text
src/
├── app/
│   ├── (auth)/
│   │   └── login/
│   ├── (dashboard)/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── customers/
│   │   │   ├── page.tsx
│   │   │   ├── new/page.tsx
│   │   │   └── [id]/page.tsx
│   │   ├── plans/
│   │   ├── subscriptions/
│   │   ├── billing-runs/
│   │   ├── usage/
│   │   └── settings/
│   └── api/
│       ├── stripe/webhook/route.ts
│       └── health/route.ts
│
├── domain/
│   ├── billing/
│   │   ├── calculator.ts
│   │   ├── formulas/
│   │   │   ├── legacy-metered-v1.ts
│   │   │   ├── legacy-unmetered-v1.ts
│   │   │   ├── legacy-other-v1.ts
│   │   │   └── fixed-v1.ts
│   │   ├── types.ts
│   │   └── errors.ts
│   ├── customers/
│   ├── plans/
│   ├── subscriptions/
│   └── usage/
│
├── services/
│   ├── billing.service.ts
│   ├── customer.service.ts
│   ├── plan.service.ts
│   ├── subscription.service.ts
│   └── usage.service.ts
│
├── integrations/
│   ├── stripe/
│   │   ├── client.ts
│   │   ├── customers.ts
│   │   ├── subscriptions.ts
│   │   ├── invoices.ts
│   │   ├── meters.ts
│   │   └── webhooks.ts
│   └── flowroute/
│       ├── client.ts
│       ├── exports.ts
│       ├── types.ts
│       └── errors.ts
│
├── db/
│   ├── schema/
│   ├── migrations/
│   ├── repositories/
│   └── client.ts
│
├── jobs/
│   ├── billing-discovery.job.ts
│   ├── flowroute-export-create.job.ts
│   ├── flowroute-export-check.job.ts
│   ├── billing-calculate.job.ts
│   ├── stripe-billing-sync.job.ts
│   └── reconciliation.job.ts
│
├── auth/
├── validation/
├── observability/
├── config/
└── test/
```

Avoid generic `utils.ts` dumping grounds. Domain logic belongs in named modules.

---

## 8. Billing Domain Design

### 8.1 Billing period must be explicit

Never calculate billing based simply on “latest monthly data.”

Every calculation receives:

```ts
type BillingContext = {
  customerId: string;
  subscriptionId: string;
  periodStart: Date;
  periodEnd: Date;
  usageSnapshotId?: string;
  formulaVersion: string;
};
```

### 8.2 Formula interface

```ts
interface BillingFormula<Input> {
  version: string;
  calculate(input: Input): BillingCalculation;
}

type BillingCalculation = {
  currency: 'USD';
  lineItems: Array<{
    code: string;
    description: string;
    quantity: string;
    unitAmountMinor: bigint;
    amountMinor: bigint;
    metadata: Record<string, unknown>;
  }>;
  totalMinor: bigint;
};
```

Calculators must be pure functions: no database calls and no Stripe calls.

### 8.3 Characterization tests before changing formulas

For each existing pricing mode:

1. Gather at least several historical customers/invoices.
2. Record old input values.
3. Record actual Stripe invoice results.
4. Encode these as fixture-based characterization tests.
5. Implement `legacy-*-v1` formula until fixtures match.
6. Only then introduce corrected/new formula versions.

This prevents an “optimization” from silently changing customer bills.

### 8.4 Clamp/negative behavior must be a business decision

Legacy formulas can yield negative charges. Do not arbitrarily apply `Math.max(0, result)` unless confirmed as intended.

Instead:

- characterization tests document current behavior;
- a new formula version can implement corrected behavior once approved.

---

## 9. Scalable Background Billing Workflow

### 9.1 Daily discovery job

Cron should not perform all billing itself.

Cron responsibility:

```text
once per day/hour
  -> query active subscriptions due for processing
  -> create/reuse billing_run rows
  -> enqueue one message per customer/run
```

A unique DB constraint prevents duplicate runs.

### 9.2 Flowroute export creation worker

For each billing run:

1. Load encrypted customer credentials.
2. Decrypt only in server execution context.
3. Create or reuse `usage_export`.
4. Call Flowroute.
5. Persist provider export ID.
6. Schedule/requeue status check.

### 9.3 Export status worker

1. Load export record.
2. If already `COMPLETED`, return safely.
3. Query Flowroute status.
4. If pending, schedule later check.
5. If completed, persist immutable usage snapshot.
6. Advance billing run.
7. If retryable failure, exponential backoff with a bounded retry policy.
8. If retries are exhausted or usage remains invalid/incomplete, transition the billing run to `NEEDS_REVIEW`.
9. Hold the entire invoice, including fixed recurring charges, until usage is resolved or manually reviewed.

Never busy-wait. Do not send app-originated billing notifications; surface the review state in the admin UI and audit trail.

### 9.4 Billing calculation worker

1. Lock/select billing run.
2. Exit if already calculated/completed.
3. Confirm the usage snapshot covers the **previous full calendar month** for this billing run, independent of the customer's `billing_day`.
4. Load immutable pricing inputs/snapshot required to reproduce the historical calculation.
5. Load usage snapshot.
6. Load relevant customer adjustments effective for period.
7. Execute pure billing formula.
8. Persist line items + calculation snapshot.
9. Mark calculation complete.
10. Enqueue Stripe synchronization.

### 9.5 Stripe synchronization worker

1. Load billing run and line items.
2. Exit if Stripe synchronization already completed.
3. Use deterministic idempotency key per operation.
4. Create required Stripe invoice items/meter events.
5. Persist provider IDs.
6. Verify resulting state.
7. Mark synchronization complete.

Do **not** delete arbitrary existing invoice items as the legacy scripts do. Only mutate provider objects created by this billing run and identified by metadata/idempotency records.

### 9.6 Recommended metadata

Attach metadata wherever Stripe supports it:

```text
internal_customer_id
billing_run_id
subscription_id
formula_version
billing_period_start
billing_period_end
```

This significantly improves reconciliation.

---

## 10. Stripe Webhooks

Implement a single verified webhook endpoint:

```text
POST /api/stripe/webhook
```

Requirements:

1. Verify Stripe signature using raw request body.
2. Insert event ID into `stripe_events` with unique constraint.
3. If duplicate event, return success without reprocessing.
4. Process event asynchronously where appropriate.
5. Update subscription/invoice/payment state.
6. Never trust browser callbacks as proof of payment.
7. Return quickly; expensive work belongs in background jobs.
8. On payment failure, mark the local account/subscription `PAST_DUE` (or equivalent), retain service as active, and rely on Stripe's configured retry/dunning behavior.
9. On end-of-period cancellation updates, keep service active until the current Stripe period actually ends, then transition local service state.
10. Reconcile plan changes and proration results from Stripe without rewriting historical billing calculations.
11. Do not send billing notifications from this application in this migration.

At minimum consider handling relevant events around:

- customer updates/deletion;
- subscription created/updated/deleted;
- invoice created/finalized/sent/paid/payment_failed;
- payment intent failures where applicable.

Event set must be based on the final Stripe integration design, not blindly hardcoded from this list.

---

## 11. Flowroute Integration Layer

Create one provider adapter. No Flowroute API calls should appear directly inside UI routes.

Suggested interface:

```ts
interface FlowrouteClient {
  createCdrExport(input: {
    credentials: FlowrouteCredentials;
    startTime: Date;
    endTime: Date;
  }): Promise<{ exportId: string }>;

  getCdrExport(
    credentials: FlowrouteCredentials,
    exportId: string
  ): Promise<
    | { status: 'processing' }
    | { status: 'completed'; totalCost: string; raw: unknown }
    | { status: 'failed'; reason?: string }
  >;
}
```

Provider errors must be normalized into application errors:

```text
AUTHENTICATION_FAILED
RATE_LIMITED
TEMPORARY_PROVIDER_ERROR
INVALID_REQUEST
EXPORT_FAILED
UNKNOWN_PROVIDER_ERROR
```

Never log secret keys.

---

## 12. Security Requirements

### 12.1 Immediate legacy remediation

Before production cutover:

- rotate the Stripe secret key exposed in the uploaded legacy archive;
- rotate database credentials exposed in PHP source;
- rotate any Flowroute credentials hardcoded in test/config files;
- remove secrets from repository history where applicable;
- disable obsolete credentials after cutover.

### 12.2 New application

Must implement:

- no secrets in Git;
- secure Cloudflare bindings/secrets;
- encryption of per-customer Flowroute credentials;
- CSRF-safe mutation pattern;
- strict authorization checks server-side;
- input validation;
- output encoding;
- rate limiting for sensitive endpoints;
- security headers;
- least-privilege database credentials;
- separate staging/prod Stripe keys;
- no provider stack traces or SQL errors returned to end users;
- audit trail for sensitive changes.

### 12.3 Credential display

Once a Flowroute secret is entered, the UI should not display the full existing secret again. Support replacement/rotation rather than retrieval in plaintext.

---

## 13. Observability

Every request/job should have a correlation/request ID.

Structured logs should include safe identifiers such as:

```text
request_id
job_id
billing_run_id
customer_id
provider
provider_request_id
status
attempt
latency_ms
```

Never include:

```text
Stripe secret key
Flowroute secret key
database password
full payment data
password hashes
```

Build admin visibility for:

- failed usage exports;
- failed billing runs;
- Stripe synchronization failures;
- webhook processing failures;
- jobs requiring manual replay;
- customers due for billing but lacking a valid provider/Stripe setup.

---

## 14. Performance and Scale Requirements

The rebuild should remain efficient if customer count grows substantially.

### 14.1 No N+1 billing discovery

Do not run many sequential SQL lookups per customer like the PHP scripts currently do.

Use appropriate joins/batched repository queries.

### 14.2 Paginate admin tables

Customer, billing-run, invoice, usage and audit lists must be cursor/page based. Never load all records.

### 14.3 Queue per-customer work

Do not run one global loop that processes every customer synchronously.

One customer failure must not fail unrelated customers.

### 14.4 Concurrency control

Use DB uniqueness + transaction/locking strategies to ensure two workers cannot produce duplicate bills for one customer/period.

### 14.5 External API rate control

Queues should support controlled concurrency and retry/backoff for Flowroute and Stripe.

### 14.6 Index based on access patterns

At minimum index:

```text
customers(status, billing_day)
subscriptions(customer_id, status)
subscriptions(status, billing_day)
usage_exports(status, next_attempt_at)
billing_runs(status, created_at)
billing_runs(customer_id, period_start, period_end)
stripe_events(stripe_event_id)
audit_events(entity_type, entity_id, created_at)
```

Use `EXPLAIN ANALYZE` for large-list queries before production.

---

## 15. UI Requirements

The existing PHP UI can be redesigned rather than visually copied.

### Dashboard

Show:

- active customers;
- customers due for billing;
- billing runs pending/failed/completed;
- Flowroute export failures;
- Stripe sync failures;
- recent invoices/payments where available.

### Customers list

Columns:

- name;
- email;
- status;
- billing day;
- plan;
- subscription status;
- provider connection status;
- last billing run;
- next billing date.

### Customer detail

Sections:

- profile;
- billing configuration;
- Flowroute integration status;
- Stripe customer/subscription links;
- adjustments;
- usage history;
- billing-run history;
- invoices;
- audit log.

Actions must be explicit. Avoid buttons like “Create Fixed Charge” that hide multiple state-changing operations without context.

Required admin billing behavior:

- allow a privileged admin to manually trigger/re-run a customer billing run;
- block an already-successful customer+period combination by default;
- require an explicit privileged override for any exceptional duplicate attempt, with reason and audit event;
- preserve original calculations when recording manual adjustments;
- do not provide refund/credit issuance controls; refunds remain handled directly in Stripe;
- expose `NEEDS_REVIEW` and `PAST_DUE` states without sending app-originated billing notifications.

### Plans

Allow viewing and changing customer plans. A customer plan change takes effect immediately and should use Stripe proration semantics. Changing a plan must not rewrite historical billing inputs. Do not build a dedicated grandfathering-management feature unless it becomes necessary for legacy compatibility; preserve immutable pricing snapshots/version references internally for auditability.

### Billing runs

Detailed drill-down must expose:

```text
period
usage snapshot
formula version
formula inputs
calculated line items
Stripe object IDs
status history
errors/retries
```

This page is essential for debugging billing disputes.

---

## 16. Data Migration Strategy

Do not migrate directly from PHP DB into production PostgreSQL with an ad-hoc script.

### Phase A — Export and profile

Obtain a read-only export of the **actual production database**, not only the bundled SQL file.

Profile:

- table counts;
- null rates;
- duplicate emails;
- duplicate Stripe IDs;
- duplicate subscription IDs;
- malformed billing days;
- orphaned subscription rows;
- missing plan references;
- customers without Flowroute credentials;
- customers without Stripe customer IDs;
- conflicting `users`/`customers` records.

Produce a migration report before import.

### Phase B — Mapping

Create deterministic legacy mapping tables/columns:

```text
legacy source table
legacy primary key
new UUID
migration timestamp
```

Never rely on names/emails alone for identity matching.

### Phase C — Transform

Write an idempotent migration program that:

- imports users/admin identities;
- imports customers;
- imports provider credentials encrypted;
- imports plans;
- imports subscriptions;
- imports historical monthly usage where meaningful;
- imports provider IDs;
- validates referential integrity.

### Phase D — Reconcile

Compare imported Stripe customer/subscription IDs against Stripe test/live metadata using read-only reconciliation tooling.

Generate exceptions for manual review.

### Phase E — Repeatability

Migration must be rerunnable in staging from a fresh database. No manual SQL edits should be required to get a successful migration.

---

## 17. Implementation Phases for Codex

Codex should work in these phases and make each phase build/test cleanly before proceeding.

### Phase 0 — Repository bootstrap

Deliverables:

- Next.js TypeScript project;
- lint/format/typecheck/test scripts;
- Cloudflare/vinext compatibility setup;
- Wrangler config without committed secrets;
- `.env.example`;
- CI pipeline;
- architecture README.

Gate:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npx vinext check
```

### Phase 1 — PostgreSQL foundation

Deliverables:

- schema/migrations;
- Hyperdrive-compatible connection layer;
- repositories;
- seed/dev fixtures;
- migration smoke test.

No Stripe mutations yet.

### Phase 2 — Authentication / authorization

Deliverables:

- login;
- secure session handling;
- admin role middleware/guards;
- protected dashboard routes;
- authorization tests.

### Phase 3 — Customer management

Deliverables:

- customer CRUD;
- validation;
- encrypted Flowroute credentials;
- audit events;
- pagination/search.

### Phase 4 — Plans and subscriptions domain

Deliverables:

- plan schema/UI;
- price versioning;
- subscription records;
- billing-anchor calculator with edge-case tests;
- no live Stripe mutations until service tests exist.

### Phase 5 — Stripe integration

Deliverables:

- Stripe client adapter;
- ensure-customer workflow;
- subscription creation;
- webhook endpoint;
- idempotency key policy;
- event deduplication;
- test-mode integration tests.

### Phase 6 — Flowroute integration

Deliverables:

- Flowroute API adapter;
- export creation/status APIs;
- normalized errors;
- mocked contract tests;
- encrypted credential usage.

### Phase 7 — Background job architecture

Deliverables:

- Cron discovery;
- queue/workflow handlers;
- retry/backoff policy;
- durable state transitions;
- dead-letter/manual-replay strategy.

### Phase 8 — Billing formulas

Deliverables:

- pure calculation engine;
- legacy formula versions;
- characterization fixtures;
- money precision tests;
- negative/edge-case documentation.

No production Stripe billing until historical reconciliation passes.

### Phase 9 — Stripe billing synchronization

Deliverables:

- billing line item synchronization;
- deterministic idempotency keys;
- metadata linkage;
- no broad deletion of existing invoice items;
- reconciliation service.

### Phase 10 — Operational UI

Deliverables:

- dashboard;
- billing-run detail;
- failure/replay screens;
- usage history;
- audit history.

### Phase 11 — Legacy data migration

Deliverables:

- production schema profiler;
- import script;
- mapping report;
- validation report;
- repeatable staging import.

### Phase 12 — Shadow billing

For at least one or more billing cycles if practical:

- new system calculates bills without charging;
- compare new calculated results to legacy/actual Stripe results;
- investigate every discrepancy;
- sign off formula versions.

### Phase 13 — Controlled cutover

Cutover order:

1. freeze billing-affecting configuration edits in legacy app;
2. final incremental data sync;
3. enable new scheduler in dry-run mode;
4. disable legacy cron billing;
5. enable new Stripe mutations for a small cohort;
6. validate;
7. expand cohort;
8. retain rollback ability;
9. decommission PHP only after stable operation.

---

## 18. Test Plan

### 18.1 Billing-day tests

Cover:

- days 1–28;
- day 29 in leap/non-leap February;
- day 30 in February;
- day 31 in 30-day months;
- before/after configured daily billing time;
- UTC vs configured customer timezone;
- month/year boundaries.

Define exact fallback behavior for unavailable calendar days and test it.

### 18.2 Money tests

Cover:

- cents precision;
- fractional provider costs;
- rounding policy;
- zero usage;
- very large usage;
- negative intermediate formula values;
- overflow protection.

### 18.3 Idempotency tests

Simulate:

- HTTP request retried twice;
- queue message delivered twice;
- Worker crashes after Stripe success but before DB update;
- DB update succeeds then response times out;
- webhook delivered repeatedly;
- two workers begin same billing run concurrently.

Expected result: one logical bill.

### 18.4 Flowroute failure tests

Cover:

- invalid credentials;
- API timeout;
- rate limit;
- export remains processing;
- export fails;
- malformed response;
- duplicate export request.

### 18.5 Stripe failure tests

Cover:

- rate limit;
- network failure;
- invalid price;
- deleted customer;
- duplicate operation retry;
- failed invoice/payment;
- webhook arrives before local request finishes;
- webhook out-of-order delivery.

### 18.6 Migration tests

On a sanitized production snapshot:

- source row counts;
- target row counts;
- referential integrity;
- provider ID uniqueness;
- plan mappings;
- sample invoice reconciliation.

---

## 19. Definition of Done

The migration is not complete merely because the PHP pages exist in Next.js.

It is complete only when:

- all active customers have canonical records;
- provider secrets are removed from source code;
- exposed legacy secrets are rotated;
- PostgreSQL migrations build a fresh database deterministically;
- billing formulas have characterization tests;
- background jobs are retry-safe;
- duplicate queue deliveries cannot duplicate charges;
- Stripe POST mutations use deterministic idempotency;
- webhook processing is deduplicated;
- Flowroute polling does not hold HTTP requests open;
- every bill has a traceable billing run and line-item calculation;
- previous-calendar-month usage is enforced independently of customer billing day;
- unresolved Flowroute usage holds the entire invoice and can transition to manual review;
- failed Stripe payments become visible as past due without automatic service suspension;
- end-of-period cancellation and immediate prorated plan changes are tested;
- duplicate manual billing is blocked by default;
- manual adjustments preserve the original calculation and actor/reason;
- admin actions are authenticated/authorized;
- key billing changes are audited;
- monitoring surfaces failures;
- shadow billing matches approved historical/legacy behavior;
- rollback procedure is documented and tested;
- production build runs successfully on the chosen Cloudflare deployment path.

---

## 20. Explicit Anti-Patterns — Codex Must Not Do These

Do **not**:

- copy each PHP file into a same-named Next.js endpoint;
- put Stripe/Flowroute logic directly in React components;
- put database queries throughout page files;
- pass Flowroute credentials in command-line arguments;
- store plaintext provider secrets in Git;
- use JavaScript floating-point math for money;
- use `sleep()`/busy polling inside Workers;
- load every customer into one request/job;
- let one failed customer abort all billing;
- query “latest usage row” without a billing-period key;
- delete all pending invoice items before recreating them;
- create a Stripe customer/subscription without idempotency;
- trust client input for price or billing totals;
- expose raw SQL/provider errors to the browser;
- silently modify legacy formulas;
- use one generic `data` column for billing information;
- overload internal IDs and Stripe IDs;
- rely on Stripe alone as the application database;
- create separate tables for every billing mode;
- modify historical plan economics in place;
- remove the legacy system before reconciliation/cutover is complete.

---

## 21. Legacy-to-New Mapping

| Legacy file | Legacy responsibility | New destination |
|---|---|---|
| `index.php` | Customer list | `app/(dashboard)/customers/page.tsx` + customer repository |
| `add_user.php` | Customer form | `customers/new` + validated server mutation |
| `submit_user.php` | Customer persistence | `customer.service.ts` + repository |
| `user/user.php` | Customer detail/actions | `customers/[id]` |
| `registration.php` | Admin registration | centralized auth/admin provisioning |
| `login.php` | Login | centralized auth |
| `settings/user_config.php` | DB/Stripe secrets/config | Cloudflare secrets + typed config |
| `settings/save_config.php` | Writes config PHP file | remove; controlled settings store where needed |
| `settings/add_database.php` | Executes SQL file | remove; versioned migrations |
| `APITaskRunner/config.php` | DB/provider config | `config/`, DB client, integration clients |
| `APITaskRunner/scheduler.php` | Find due customers and `exec` jobs | Cron discovery + queue/workflow |
| `APITaskRunner/main.php` | Create/poll Flowroute export | Flowroute jobs + `usage_exports` |
| `stripe/customer_stripe.php` | Create Stripe customer | Stripe customer service |
| `stripe/create_product.php` | Create Stripe product/price | plan service + Stripe catalog adapter |
| `stripe/add_subscription.php` | Create usage subscription | subscription service |
| `stripe/fixed_billing.php` | Create fixed subscription | same subscription service + fixed plan mode |
| `stripe/updatestripe.php` | Custom billing update | `legacy-other-v1` formula + billing workflow |
| `stripe/updatestripe_metered.php` | Metered billing update | `legacy-metered-v1` formula + billing workflow |
| `stripe/updatestripe_unmetered.php` | Unmetered billing update | `legacy-unmetered-v1` formula + billing workflow |
| `stripe/send_invoice.php` | Manual invoice | admin billing action + Stripe invoice adapter |

---

## 22. First Implementation Tasks for Codex

When Codex receives this document, start with the following exact sequence:

1. Create a new Git branch for the migration.
2. Do **not** edit or delete the legacy PHP archive.
3. Create the Next.js TypeScript application.
4. Configure strict TypeScript, linting, formatting, tests and CI.
5. Configure Cloudflare Workers/vinext in a way that still allows normal local development.
6. Run and save the output of `npx vinext check`.
7. Add PostgreSQL schema and migrations for the core tables in this document.
8. Add repository interfaces before UI pages make direct database calls.
9. Implement money helpers using integer minor units.
10. Implement the billing formula interface and characterization fixtures before Stripe billing mutations.
11. Implement secure configuration/secrets handling.
12. Build customer CRUD and admin auth.
13. Build Stripe and Flowroute adapters behind interfaces.
14. Build asynchronous usage export flow.
15. Build `billing_runs` state machine.
16. Build Stripe webhook deduplication.
17. Add shadow billing and reconciliation tooling.
18. Only then enable real billing mutations in staging/test mode.

At the end of every phase, Codex must update a migration progress document with:

```text
completed
open issues
schema changes
behavior decisions
new assumptions
manual verification required
commands/tests run
```

---

## 23. Resolved Business Decisions

The following decisions were confirmed with the product owner on September 22, 2026. Codex must treat these as requirements, not implementation suggestions. Do not silently change them during migration.

### 23.1 Billing cycle and usage period

- Keep an **individual monthly `billing_day` per customer**. Do not move all customers to one global billing date.
- The usage period remains the **previous full calendar month**, regardless of the customer's individual billing day.
- Example: a customer whose billing day is September 15 is billed using usage from August 1 through August 31.
- Prepare billing ahead of the customer's billing date, but do not redefine the usage period to billing-day-to-billing-day.

### 23.2 Flowroute failure and invoice hold behavior

- If Flowroute usage is unavailable, incomplete, or delayed, **do not guess usage and do not finalize the invoice**.
- Retry automatically using bounded retries with backoff.
- If valid usage still cannot be obtained after the retry policy is exhausted, mark the billing run `NEEDS_REVIEW` (or equivalent explicit review state).
- The **entire invoice must remain on hold**, including fixed recurring charges, until the usage issue is resolved or manually reviewed.
- The application should expose the failure/review state internally. Outbound billing notifications remain outside this application for now.

### 23.3 Failed Stripe payment behavior

- Let Stripe handle its configured automatic payment retries/dunning.
- Record the customer/account as `PAST_DUE` (or equivalent) internally when Stripe reports payment failure.
- Keep the customer active; **do not automatically suspend service** as part of this migration.
- Surface the condition in the admin UI/audit history. Do not build app-originated billing notifications yet.

### 23.4 Cancellation behavior

- Customer cancellation takes effect at the **end of the current billing period**, not immediately.
- The customer remains active until the current period ends.
- Implement this using Stripe's end-of-period cancellation semantics where appropriate, while keeping local state synchronized through webhooks/reconciliation.

### 23.5 Plan changes

- A customer plan change takes effect **immediately**.
- Apply prorated charges or credits for the remainder of the current billing period using the final Stripe integration design.
- Historical billing records must remain immutable and auditable.
- Do not add a separate grandfathering/product-version-management feature in the admin UI as part of this migration unless required to preserve existing billing history. Internal immutable pricing snapshots/version references may still be used for auditability and reproducible calculations.

### 23.6 Audit trail and manual adjustments

- Keep a permanent audit trail sufficient to reconstruct every customer bill.
- Preserve the original Flowroute usage snapshot, formula/version, formula inputs, calculated amount, Stripe object IDs, retries, state transitions, and manual actions.
- A manual adjustment must **not overwrite the original calculation**. Store it as a separate adjustment with amount/quantity, reason, timestamp, and acting admin.

### 23.7 Manual billing and duplicate protection

- Admins may manually trigger or re-run billing for an individual customer outside the normal schedule.
- Manual runs must use the same idempotent workflow as scheduled runs and must be audited.
- If the same customer and billing period were already successfully billed, **block duplicate billing by default**.
- Any exceptional override must be an explicit privileged admin action and must be written to the audit trail; never bypass duplicate protection implicitly.

### 23.8 Refunds and credits

- Refunds and Stripe-level credits remain managed **directly in Stripe** for now.
- Do not build refund issuance into the new admin application in this migration.
- The application may ingest/reconcile resulting Stripe state through webhooks and reconciliation so local billing history remains accurate.

### 23.9 Notifications

- Do not build customer/admin billing notification delivery into the application yet.
- The app must still maintain explicit internal statuses for payment failure, billing hold, retry exhaustion, and manual review so external operational processes can act on them.

### 23.10 Explicitly out of scope for this migration

The following proposed features were intentionally skipped and should not be invented by Codex:

- special invoice-splitting behavior for multiple numbers/channels/resources;
- a dedicated plan-grandfathering management feature;
- in-app refund issuance;
- in-app billing notification delivery.

### 23.11 Remaining legacy characterization questions

These are still technical/domain ambiguities in the old PHP and must be resolved from production data, historical invoices, or stakeholder confirmation before live cutover. They do not override the business decisions above.

1. Does Flowroute `total_cost` represent the billable customer usage quantity, provider cost, or another unit?
2. What exactly do the legacy metered constants `0.35` and `4` represent?
3. Should overage calculations clamp at zero?
4. Does `extra_numbers` mean total numbers or numbers above included quantity?
5. Does `included_channels * channel_cost` intentionally charge included channels in the unmetered formula?
6. Are `metered_sip_trunk_usage` and `cloud_server_hosting_subscription` dollar amounts, cents, rates, or quantities?
7. Which plans use `send_invoice` versus automatic charging?
8. Resolved 2026-09-22: days 29/30/31 use the last day of a shorter month; preserve the configured day for subsequent months.
9. Resolved 2026-09-22: retain 11:00 UTC for subscription billing anchors. See ADR 0005.
10. How far before the billing day should the previous-calendar-month Flowroute usage retrieval begin?
11. Is Stripe expected to calculate usage-based amounts, or should this application calculate final invoice amounts and send them to Stripe?
12. Which current production table (`customers` or `users`) is authoritative?
13. Which current subscription table is authoritative?
14. Is the PHP SQL dump older than the live schema? Evidence strongly suggests yes.

Record every resolved item as an ADR or billing-rule decision in the new repository.

---

## 24. Recommended Operational States

Use explicit states rather than booleans.

### Billing run

```text
DISCOVERED
WAITING_FOR_USAGE
NEEDS_REVIEW
CALCULATING
CALCULATED
SYNCING_STRIPE
PAYMENT_PENDING
PAST_DUE
COMPLETED
FAILED_RETRYABLE
FAILED_PERMANENT
CANCELED
```

### Usage export

```text
PENDING
REQUESTED
PROCESSING
COMPLETED
FAILED_RETRYABLE
FAILED_PERMANENT
```

### Stripe synchronization

```text
NOT_STARTED
IN_PROGRESS
COMPLETED
FAILED_RETRYABLE
FAILED_PERMANENT
```

State transitions should be implemented in services and validated. Do not allow arbitrary UI writes to status fields.

---

## 25. Reconciliation Requirements

Create a recurring reconciliation job that can compare:

```text
local customer <-> Stripe customer
local subscription <-> Stripe subscription
local plan price version <-> Stripe price
local billing run <-> Stripe invoice/invoice items
local webhook history <-> known provider state
```

Reconciliation should **report** inconsistencies before automatically modifying financial state.

Examples:

- local subscription active but Stripe canceled;
- Stripe subscription exists but local row missing;
- billing run says completed but Stripe invoice item missing;
- duplicate Stripe customers mapped to one internal customer;
- customer has no Flowroute credentials;
- provider export completed but no usage snapshot exists.

---

## 26. Source Audit Notes

The migration plan was derived from direct inspection of the uploaded legacy archive. Important observed facts include:

- database/Stripe credentials are embedded in source configuration;
- Flowroute credentials also appear in legacy/test contexts;
- billing jobs are executed through PHP CLI `exec()`;
- Flowroute export completion is polled using a long-running loop and `sleep(60)`;
- the codebase mixes `users` and `customers` naming;
- the codebase mixes `user_subscriptions` and `customers_subscription` naming;
- database setup is performed from application PHP in some paths;
- some routes use prepared statements while others interpolate values or construct SQL strings;
- role checks are repeated and inconsistent;
- old and newer schema concepts coexist;
- custom billing formulas contain unexplained constants and mixed units;
- Stripe invoice items are broadly enumerated/deleted before recreation in some billing paths;
- legacy Stripe usage-record APIs appear in the code and should be evaluated against current Stripe Billing Meters rather than copied blindly.

These findings are reasons for the domain redesign above.

---

## 27. External Platform Assumptions (September 2026)

Before implementation or when dependencies change, Codex should verify these against current official documentation:

- Cloudflare currently recommends vinext for Next.js on Workers; vinext is beta and provides compatibility checking.
- Cloudflare Hyperdrive supports PostgreSQL connections from Workers.
- Cloudflare Cron Triggers support scheduled Worker execution.
- Cloudflare Queues/Workflows should be preferred over long-running synchronous polling for asynchronous billing jobs.
- Stripe supports idempotency keys for POST requests.
- Stripe Billing supports current usage-based billing via meters/meter events; do not assume the legacy usage-record API is the best design for a new implementation.

If any platform behavior differs at implementation time, update this plan through an ADR rather than silently deviating.

---

# End State

The desired end result is not merely “the PHP app rewritten in Next.js.”

It is a billing platform where a developer can answer, for any customer and billing period:

> What usage did we receive, which pricing rule/version did we apply, exactly how was every line item calculated, what did we send to Stripe, did Stripe accept it, what retries occurred, and can we prove that running the job again will not double-charge the customer?

If the new system cannot answer those questions reliably, the migration is not finished.
