# Migration progress

## Phase 0 — Application foundation

Completed on 2026-09-22.

### Completed

- Initialized the repository on `migration/nextjs-cloudflare` (no commit or remote created).
- Added Next.js 16 App Router, strict TypeScript, a foundation page, and a liveness endpoint.
- Added vinext/Cloudflare Workers build and local preview while retaining standard Next.js development and builds.
- Added ESLint, Prettier, Vitest, runtime configuration boundary tests, and GitHub Actions CI.
- Added placeholder secret templates, architecture documentation, pinned dependencies, and lockfile.
- Left legacy PHP untouched and excluded it from Git and tooling.
- Saved the compatibility report in `docs/verification/vinext-check.txt`.

### Open issues

- vinext is beta. The compatibility checker reports 93% compatibility, zero unsupported issues, and partial App Router support for `reactStrictMode`. Standard Next.js retains its Strict Mode behavior. Recheck as application features are added.
- vinext reports unknown static/dynamic classification for the homepage; the built page was successfully served in the Workers runtime.
- Local verification used the machine's Node.js 26.8.2; CI targets Node.js 24 LTS and has not run remotely.
- ESLint 9 installation reports end of support; a later tooling refresh should validate ESLint 10 with the chosen Next.js lint configuration.
- The production database schema and historical billing fixtures remain outstanding inputs for later phases.

### Schema changes

None. PostgreSQL schema, migrations, and repositories are Phase 1.

### Behavior decisions

- No operational billing functionality or provider mutation is enabled in this phase.
- The health endpoint reports liveness only and disables caching.
- Public Workers URLs are disabled, and CI contains no deployment step.
- Section 23 of the migration plan remains authoritative for business behavior.

### New assumptions

- The new application lives at the repository root; the legacy directory remains a local reference outside source control.
- Cloudflare account, deployment environments, and production authentication will be configured in later phases.

### Manual verification required

- Run the checked-in CI workflow after connecting a remote repository.
- Validate target Cloudflare account/access configuration before any staging deployment.
- Revalidate authentication, Hyperdrive, queues, workflows, and provider integrations as they are implemented; the current build does not prove compatibility for those future features.

### Commands and tests run

- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm test` — passed, 2 configuration-boundary tests.
- `npx --no-install vinext check` — passed with the documented partial Strict Mode support; output saved.
- `npm run build` — passed; Workers output includes `dist/server/wrangler.json`.
- `npm run build:next` — passed.
- `npm run preview -- --host 127.0.0.1 --port 4173` — local Workers runtime started.
- HTTP smoke checks — homepage returned successfully with expected content; `/api/health` returned HTTP 200, expected JSON, and `Cache-Control: no-store`.
- npm installation audit after upgrading React, React DOM, and React Server DOM Webpack together to 19.3.0 — zero vulnerabilities.
- `git check-ignore fbc.versal.tech/settings/user_config.php` — confirms legacy configuration is excluded.

### Next phase

Design and implement the PostgreSQL schema and repository boundaries, refining the proposed constraints to enforce the confirmed billing rules. In particular, duplicate protection must hold across formula-version changes and nullable subscription references.

## Phase 1 — PostgreSQL foundation

Completed locally on 2026-09-22.

### Completed

- Added Drizzle/pg, strict typed schema, and two checked-in migrations covering 14 tables and financial-history guards.
- Added request-scoped server-only connection handling compatible with Hyperdrive.
- Added repository contracts and implementations for customers, catalog reads, run reservation, usage lookup/reservation, and webhook deduplication.
- Added direct-connection migration runner with concurrency locking and opted-in, idempotent synthetic seeds.
- Added PostgreSQL integration tests, local workerd/Hyperdrive repository test, and PostgreSQL 16 CI service.
- Added database setup guide and ADR 0002.
- Updated type checking to regenerate Next.js route types before TypeScript, avoiding stale shared generated types after switching build targets.

### Open issues

- Actual production schema and historical invoices remain unavailable; no legacy records have been imported.
- Deployed Hyperdrive, runtime role grants, authentication, encryption, workflow state machines, formula characterization, and invoice hold/finalization controls require their later phases.
- Billing-period dates identify calendar months; provider timestamp boundaries still depend on the unresolved timezone policy.
- Exceptional duplicate-billing overrides are intentionally unavailable until a privileged, audited service is designed.

### Schema changes

- Added the 13 proposed core tables plus separate `billing_run_adjustments`.
- Uniqueness is customer + usage month; nullable subscription and formula version cannot bypass it.
- Added composite foreign keys for customer/subscription/usage consistency.
- Added separate payment status, exact fractional source cost, non-floating-point amounts, immutable history, and monthly date constraints.
- Manual adjustments require actor and reason; pricing snapshots preserve historical economics.

### Behavior decisions

See ADR 0002. Retry APIs return existing records unchanged. No formula constants, rounding, negative-charge behavior, payment collection mode, billing-day fallback, or cancellation/proration policy has been implemented or reinterpreted.

### New assumptions

- PostgreSQL 16 is the minimum tested database version.
- Operational migration/seed commands use explicit shell environment variables and a direct migration login.
- Local Hyperdrive testing requires a password field and port 8794; production pooling/caching behavior requires staging verification.

### Manual verification required

- Run remote CI once the repository is connected.
- Provision and verify separate migration/runtime roles and a real Hyperdrive binding with query caching disabled.
- Validate database backup/restore and TLS before production.

### Commands/tests run

- `npm run db:generate` — generated the foundation; subsequent generation reports no schema drift.
- `npm run test:db` against isolated PostgreSQL 16.10 — 12 passed, including concurrent migration replay, duplicate billing/webhooks, cross-customer constraints, exact numeric values, immutable history, repeatable seeding, and repository execution through local workerd/Hyperdrive.
- `npm test` — 2 unit tests passed.
- `npm run lint`, `npm run typecheck`, `npm run format:check` — verified for this phase.
- `npm run build` and `npm run build:next` — passed.
- Dependency installation audit — zero vulnerabilities after scoped migration-tool dependency override.
- Static vinext compatibility report updated separately in `docs/verification/vinext-check.txt`; beta compatibility limitations remain documented.

### Next phase

Phase 2: centralized administrator authentication, secure sessions, authorization guards, and protected dashboard routes.

## Phase 2 — Administrator authentication and authorization

Completed locally on 2026-09-22.

### Completed

- Added administrator login, logout, protected dashboard layout/page, and safe error UI.
- Added cost-12 password hashing, explicit CLI provisioning/reset/disable, and bounded authentication cleanup.
- Added opaque eight-hour sessions stored only as digests, immediate database-triggered revocation, and current role/status checks.
- Added Origin-based CSRF protection, bounded form parsing, atomic database login throttling, secure cookie configuration, and security headers.
- Added separate Next.js/Workers database adapters and HTTP tests for both runtimes.

### Schema changes

- Added `app_sessions` and `auth_rate_limits` (16 application tables total).
- Added session-revocation trigger on identity password, role, and status changes.
- Added indexes for account/session lookup and expired-record cleanup.

### Behavior decisions

- Email is the sign-in identifier; only explicitly provisioned ADMIN accounts may sign in.
- No public registration or seeded credentials.
- Reset revokes sessions without reactivating disabled accounts.
- Sessions have an absolute eight-hour lifetime; authorization checks current database status/role.
- Account lockout uses five attempts per 15 minutes; a global 100-attempt/five-minute limit bounds expensive password verification.
- See ADR 0003 for runtime/hash choices and authentication boundaries.

### New assumptions and open issues

- Production requires explicit HTTPS APP_ORIGIN, an uncached Hyperdrive binding, and provisioned administrator credentials.
- Legacy password-hash migration is deferred; this phase provisions new hashes rather than silently accepting legacy cost settings.
- No hosted account/database/Hyperdrive configuration has been changed.
- Fine-grained non-admin roles are outside the current administrator-only scope.

### Manual verification required

- Provision application administrator accounts using the documented CLI after configuring the target database.
- Verify runtime database permissions (including session deletion), production origin/TLS, Hyperdrive cache settings, and password-hashing load/edge throttling in staging.
- Schedule expired-record cleanup with the background-job phase.

### Commands/tests run

- Unit security/configuration suite: 7 passed.
- PostgreSQL/Workers integration suite: 17 passed.
- Production Next.js/local Workers HTTP authentication suite: 8 passed.
- Migration generation reports no schema drift.
- Lint, strict type checking, formatting, and both production builds are checked for this phase.

### Next phase

Phase 3: customer management, validation, encrypted Flowroute credential storage, audited changes, and pagination/search.

## Phase 3 — Customer management and encrypted credentials

Completed locally on 2026-09-22.

### Completed

- Added protected customer directory, create/detail/edit forms, search/status filtering, cursor pagination, and paged audit history.
- Added validated administrator-only mutations with Origin checks, bounded payloads, and strict field allowlists.
- Added optimistic revision checks, row locking, atomic audit entries, archive/restore, and ongoing-billing blockers.
- Added AES-256-GCM access/secret-key encryption with customer/field/version authentication, retained key-ring versions, write-only replacement, and local disablement.
- Added encrypted-only database checks and explicit UNVERIFIED credential status.

### Schema changes

- Migration 0004: customer revision and unverified credential state/default.
- Migration 0005: automatic revision increments and ciphertext-envelope constraint.
- Migration 0006: serialize/reject subscription and run activity for archived customers.
- Application table count remains 16.

### Behavior decisions

- New records are drafts; no provider objects are created by customer CRUD.
- Archive preserves history and disables local key use; ongoing subscriptions/runs must be resolved first.
- Restore returns to draft without re-enabling stored keys.
- Linked subscription billing dates require coordinated subscription management.
- Saved keys are unverified until the provider integration is implemented.
- See ADR 0004 and `docs/CUSTOMERS.md` for encryption and rotation decisions.

### New assumptions and open issues

- Production must provide a versioned 32-byte encryption key ring before credential writes.
- Bulk master-key re-encryption and provider verification are not implemented in this phase; retained key versions support existing ciphertext.
- Short-month billing-day fallback, billing formulas, and production legacy import remain unresolved as previously documented.

### Manual verification required

- Apply migrations and provision encryption secrets in the target environment.
- Verify key backup/retention and access controls before storing real credentials.
- Verify deployed Hyperdrive remains uncached.

### Commands/tests run

- Unit suite: 11 passed, including authenticated encryption and strict form validation.
- PostgreSQL/Workers integration suite: 21 passed, including concurrent edits, archive blockers, audit atomicity, literal search, and safe credential reads.
- HTTP suite: 10 passed across Next.js and Workers, including customer lifecycle and no credential disclosure.
- Both production builds, lint, strict type checking, formatting, and migration generation checked for this phase.

### Next phase

Phase 4: plan and subscription domain, immutable price versions, plan management UI, and billing-anchor calculations with edge-case tests.

## Phase 4 — Plans and subscriptions domain

Completed locally on 2026-09-22.

### Completed

- Protected plan directory, search/pagination, create/edit forms, availability controls, and read-only price history.
- Immutable price versions with exact bigint-cent conversion and JSON-safe snapshots; existing subscription references remain unchanged by catalog edits.
- Customer-linked subscription directory, draft creation/edit/discard, paginated active-plan selection, and subscription detail.
- Strict shared administrator mutation boundary, atomic audit writes, revision checks, serialized edits, and duplicate draft-request protection.
- UTC billing-anchor calculator and previous-calendar-month usage periods, with leap-year and boundary tests.

### Schema changes

- Migration 0007 adds plan/subscription revisions and proposed anchor/policy fields.
- Migration 0008 adds unique draft creation identity and one-current-price-per-plan enforcement.
- Migration 0009 adds automatic revision increments and anchor/policy consistency constraints.
- Application table count remains 16; schema generation reports no drift.

### Confirmed decisions

- Product owner confirmed: missing billing days 29–31 use the last day of the month, retaining the configured day for later months.
- Product owner confirmed: retain 11:00 UTC billing anchors.
- These resolve the corresponding Phase 3 open calendar questions and migration-plan questions 23.11.8–9. See ADR 0005 and `docs/PLANS.md`.

### Assumptions and remaining work

- Draft anchors are proposed; provider activation must recalculate them and preserve actual Stripe periods separately.
- Draft operations make no provider calls. Live edits/cancellation require Phase 5's immediate proration and end-of-period cancellation workflows.
- Legacy billing formulas, real provider integration, and production data import remain outstanding.

### Manual verification required

- Apply migrations to the target environment before using the new screens.
- Verify production data compatibility with the single-current-version constraint before importing legacy prices.
- Complete Stripe test-mode integration before enabling activation or live changes.

### Commands/tests run

- Unit suite: 28 passed, including exact money conversion and billing-calendar edge cases.
- PostgreSQL/Workers integration suite: 25 passed, including migration replay, immutable assigned pricing, competing edits, request deduplication, and live-mutation guards.
- HTTP suite: 12 passed across production Next.js and local Workers, including authenticated plan/draft workflows and prior customer/auth regressions.
- Both production builds, strict type checking, lint, formatting, and migration generation passed.

### Next phase

Phase 5: Stripe adapter, ensure-customer workflow, subscription activation, webhook verification/deduplication, provider idempotency, and test-mode integration tests.

## Phase 5 — Stripe test integration

Implemented and verified locally on 2026-09-22. Real sandbox verification remains pending credentials, as requested by the product owner.

### Completed

- Official Stripe SDK adapter with fetch/Web Crypto support, pinned API version, timeouts, explicit test-mode enablement, and immutable sandbox account binding.
- Durable ensure-customer/product/price steps and subscription activation, immediate prorated plan changes, and period-end cancellation.
- Administrator controls for activation/change/cancel and resuming an incomplete saved operation; conflicting draft actions are blocked.
- Exact persisted provider requests, stable idempotency keys, expiring ownership claims, atomic completion/audit, and review after an uncertain 23-hour retry window.
- Verified raw-body webhook endpoint with bounded payloads, duplicate event handling, current-state retrieval, revision race detection, and transactional state/audit completion.
- Per-invoice delinquency aggregation; payment failure preserves customer service status. Draft invoices have automatic advancement disabled.
- Bounded operator replay command and an opt-in real Stripe sandbox lifecycle suite.

### Schema changes

- Migration 0010: `stripe_connection`, `stripe_workflows`, `stripe_requests`, `stripe_invoices`, and subscription workflow reservation.
- Migration 0011: pending-workflow foreign key and immutable operation/account identity guards.
- Application table count is now 20. Drizzle generation reports no drift; custom trigger/foreign-key SQL is tracked in migrations.

### Decisions and assumptions

- Owner confirmed sandbox credentials are not yet configured and requested test values in `.env.local`. Added ignored, disabled placeholders; no real credentials were reused from legacy source.
- Owner asked Stripe to handle proration. Initial setup and immediate plan changes use Stripe's `create_prorations` behavior. Plan-change proration timestamp is frozen with the request.
- Emailed invoice terms remain an explicit administrator field; no arbitrary global deadline is selected.
- One monthly recurring subscription item maps to the versioned base price. Usage calculation/metering, payment-method collection, production import, and invoice release remain separate phases.
- See ADR 0006 and `docs/STRIPE.md`.

### Remaining verification and production blockers

- Supply valid sandbox credentials and run the opt-in real-provider lifecycle suite. It was skipped here, not counted as passed.
- Configure the signed event destination for API version `2026-08-26.dahlia`; verify external delivery and retries in staging.
- Direct Stripe subscription creation can finalize the first invoice before a webhook holds it. Production and live keys are blocked until the complete usage/invoice pipeline guarantees the required whole-invoice hold.
- Background scheduling of replay/reconciliation remains Phase 8. Review dunning settings before production so payment delinquency does not terminate service.

### Commands/tests run

- Unit suite: 32 passed, including SDK request encoding/version/idempotency and signed-event verification.
- PostgreSQL/local Workers integration suite: 31 passed, including lost-response recovery, competing commands, old/duplicate webhooks, immutable pricing, cancellation, and multiple-invoice delinquency.
- HTTP suite: 14 passed across Next.js and Workers, including missing/tampered/expired/live webhook rejection, payload limits, and previous auth/customer/plan regressions.
- Real Stripe sandbox suite: 1 skipped because credentials and opt-in are absent.
- Both production builds, type checking, lint, formatting, schema drift check, and compatibility check passed. The existing vinext App Router Strict Mode partial-support caveat remains unchanged.

### Next phase

Phase 6: Flowroute adapter, asynchronous export creation/status APIs, normalized errors, mocked provider contracts, and encrypted credential use. Real Stripe sandbox verification can follow once credentials are available.

## Phase 6 — Flowroute usage export integration

Completed locally on 2026-09-23 with mocked provider contracts. No real Flowroute credentials or calls were used.

### Completed

- Added a server-only Flowroute CDR Export v2 adapter for asynchronous create/status requests, with HTTP Basic authentication, JSON:API headers, a ten-second timeout, strict response validation, and normalized provider errors.
- Added durable export processing: short-lived database claims, no external calls inside transactions, bounded backoff, retry exhaustion, explicit permanent-review states, and one logical export per customer/calendar period.
- Added encrypted credential loading only in the provider boundary. Successful use promotes credentials to ACTIVE; authentication rejection marks them INVALID; revoked credentials are never decrypted.
- Added immutable, sanitized source snapshots for exact Flowroute totals and billed minutes. Download URLs and raw record files are not requested or retained.
- Added a guarded manual processor command for one saved export. Scheduled discovery, queueing, and automatic retry delivery remain Phase 7.

### Schema changes

- Migration 0012 adds recoverable processing token/lease fields to `usage_exports`.
- Migration 0013 makes export identity, stored provider IDs, and completed state immutable. Application table count remains 20.

### Assumptions and open issues

- The provider API is called with previous-full-calendar-month UTC bounds. The business meaning of Flowroute `total_cost` and its relationship to customer charges remains unresolved; the values are source evidence only.
- No callback URL is set; the next phase will schedule status checks rather than poll during a web request.
- A real Flowroute integration test requires newly created restricted test credentials. Legacy credentials remain prohibited.

### Commands/tests run

- Unit suite: 35 passed, including Flowroute request shape, error mapping, malformed responses, and no download URL persistence.
- PostgreSQL/Workers integration suite: 36 passed, including concurrent exports, leases, encrypted credential use, retry/backoff exhaustion, authentication failures, immutable snapshots, and prior database workflows.
- Lint, formatting, and strict type checking passed.

### Next phase

Phase 7: scheduled discovery, queue/workflow delivery, retry scheduling, dead-letter/manual replay, and operational status surfaces.

## Phase 7 — Background Flowroute job delivery

Implemented locally on 2026-09-23. No Cloudflare Queue, Hyperdrive binding, or provider credentials have been provisioned or used.

### Completed

- Added a custom vinext Worker entry that delegates HTTP requests to the App Router and handles an hourly UTC Cron Trigger plus a Cloudflare Queue consumer.
- Discovery identifies due active subscriptions at the retained 11:00 UTC anchor, clamps billing days to each month’s final day, and reserves the previous full calendar month exactly once.
- Added durable Queue outbox records with dispatch leases. Queue delivery is advisory: duplicate, delayed, or lost messages recover from PostgreSQL without duplicate provider calls.
- Provider work runs only in the Queue consumer. Retry timing stays in the existing Flowroute export state; permanent usage failures put the outbox job and its whole billing run into `NEEDS_REVIEW`.
- Declared bounded Queue retries and a dead-letter queue in `wrangler.jsonc`. Invalid messages are acknowledged without retry.
- Added a trusted-server, audit-backed replay command that only resets reviewed non-completed jobs; completed usage remains immutable.

### Schema changes

- Migration 0014 adds `background_jobs` and its dispatch index. Application table count is now 21.

### Remaining verification and production blockers

- Provision the declared Cloudflare Queue, dead-letter queue, Hyperdrive binding, and newly issued restricted Flowroute test credentials in a non-production account.
- Exercise the real scheduled endpoint and Queue delivery in staging. No real provider call or deployment has been performed.
- Operator-facing review and replay screens will be added with the billing workflow after formula behavior is characterized.

### Commands/tests run

- Unit suite: 36 passed, including the versioned Queue-message contract.
- PostgreSQL integration suite: 37 passed, including concurrent discovery, durable job reservation, and a terminal usage failure holding the billing run for review.

### Next phase

Phase 8: characterize the legacy formulas, build the pure billing calculation engine, and connect a completed usage snapshot to immutable billing line items.

## Phase 8 — Legacy formula characterization

In progress locally on 2026-09-23.

- Owner confirmed legacy parity: use Flowroute `total_cost`, rounded up, rather than billed minutes.
- Owner confirmed negative formula results are charged as $0, without creating credits.
- Added a pure `legacy-v1` calculator and characterization tests for custom, metered, and unmetered paths. The constants `0.35` and `4` remain explicit.
- Corrected the metered formula's minor-unit conversion and added a positive-charge regression test.
- Added a transactional calculation worker. It uses the completed Flowroute snapshot, the plan-price version reserved when the run was discovered, and active period-relevant customer adjustments; it writes one immutable line item, calculation snapshot, and subtotal before marking the run `CALCULATED`.
- A malformed or incomplete calculation input moves the run to `NEEDS_REVIEW` with an audit event. Re-running an already calculated run is a no-op.

### Schema changes

- Migration 0015 adds `billing_runs.plan_price_version_id`, preserving the exact immutable price version chosen when the billing run was reserved.

### Remaining work

- Run the PostgreSQL/Workers integration suite against an available disposable PostgreSQL server. The local server used in earlier phases was not running during this update.
- Added a separate durable Stripe billing-sync outbox, Queue configuration, short database leases, and retry/review state handling. Stripe failures no longer share Flowroute retry handling.
- Complete the whole-invoice hold: Stripe must be prevented from finalizing the first or later invoice before the calculated usage line items are attached and verified. The current webhook hold remains a safety net, not proof that the first-invoice race is closed.
- Direct automatic-collection activation is now blocked until a Subscription Schedule phase model preserves the required billing-day and 11:00 UTC anchor while beginning with a held draft invoice. See ADR 0009.
- Added and unit-tested a deterministic two-phase schedule model: an immediate initial phase ending at the next anchor, followed by one complete anchored month before release to the recurring subscription. Provider activation and sandbox verification remain pending.
- Automatic-collection activation now persists a Stripe Subscription Schedule request, records both schedule and underlying subscription IDs, and requires any initial invoice reported by Stripe to be a draft before holding its automatic advancement. Stripe sandbox verification remains pending credentials.
- Add Stripe reconciliation and operator screens for billing-run, queue, and manual-review visibility.
