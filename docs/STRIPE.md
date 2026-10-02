# Stripe sandbox integration

Phase 5 supports test-mode subscription creation, immediate plan changes with Stripe-calculated proration, and cancellation at the end of the current period. Customer and immutable price mappings are created as needed. It does not enable production billing, collect payment methods, send application notifications, issue refunds, or release usage-held invoices.

## Configure local test mode

The ignored `.env.local` contains disabled placeholders. Replace these with values from one Stripe sandbox:

```dotenv
APP_ENV=development
STRIPE_TEST_ENABLED=true
STRIPE_SECRET_KEY=sk_test_...
STRIPE_ACCOUNT_ID=acct_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Use `.dev.vars` for Workers. Set the same account/key/signing configuration for that runtime. Configure the webhook destination for API version `2026-08-26.dahlia`, pointing to `POST /api/stripe/webhook`. Use a valid database connection and migrations 0010–0011. Never paste secrets into source control or the chat.

A database is bound to its first configured sandbox account. Use a separate database for another sandbox or future production setup. Keys can rotate within the same account.

From a subscription draft, activate in Stripe test mode. For `send_invoice`, enter the required payment deadline in days. For `charge_automatically`, provide the customer's test payment method in Stripe; an initial invoice requiring payment/action can leave the subscription INCOMPLETE. This phase does not provide a card collection or payment-confirmation UI.

On an active test subscription, choose a new price to apply immediately. Stripe generates prorated charges/credits for the ordinary invoice. Cancellation schedules the period end; webhooks confirm the eventual terminal state. Account payment status is independent from service status.

## Events and replay

Supported state events:

- `customer.subscription.created`, `updated`, `deleted`, `paused`, `resumed`.
- `invoice.created`, `updated`, `finalized`, `finalization_failed`, `paid`, `payment_failed`, `voided`, `marked_uncollectible`.
- `customer.deleted` is recorded for operator review; local history is retained.

Other events are acknowledged without updating business state. Payment-intent events are not needed for this phase because subscription invoice events are authoritative for the account status. Connect events and live-mode events are rejected.

The handler verifies the raw body and five-minute signature tolerance using the SDK. It bounds request size at 1 MiB. It retrieves the provider's current state, detects local revision races, then commits event completion and state/audit changes together. A repeat of a completed event produces no further local mutation.

If a workflow is pending, refresh the subscription page and use **Retry saved Stripe operation**. This reuses persisted requests, not a new subscription. A crashed worker's claim expires after three minutes; provider request claims expire after one minute. A request with an uncertain result older than 23 hours requires operator review. Inspect the recorded request, provider metadata and Stripe request logs; never clear the request ledger or invent a new key to retry blindly.

To retry up to 25 stored pending/failed events after fixing an operation or configuration:

```sh
npm run stripe:replay
```

This command reads `.env.local`, uses `DATABASE_URL`, and re-fetches current provider objects. It emits event IDs and generic outcomes, not payloads or secrets. Scheduling bulk replay/queues remains the background-job phase.

## Tests

Normal `npm test`, `npm run test:db`, and `npm run test:auth` use mock provider responses and synthetic signed events. They make no Stripe API calls.

The real sandbox suite requires explicit opt-in, valid sandbox configuration, and a disposable PostgreSQL server with CREATEDB permission. It creates test customers/products/prices/subscriptions, checks activation/change/cancellation, then cancels/deactivates its test resources. It must never use a production database.

```sh
# Supply TEST_DATABASE_URL separately. .env.local must contain valid sandbox values.
RUN_STRIPE_SANDBOX_TESTS=true node --env-file=.env.local node_modules/vitest/vitest.mjs run --config vitest.stripe.config.ts
```

Without opt-in, `npm run test:stripe:sandbox` reports the sandbox suite as skipped. A skip is not proof of real-provider compatibility.

## Production blocker

Managed draft invoices are held using `auto_advance=false`. Direct subscription creation can nevertheless finalize the initial invoice before the webhook can intervene. Production/live-key activation is therefore blocked until the usage pipeline and invoice-creation/release strategy guarantee that the entire invoice waits for valid previous-calendar-month usage. Keep those guards in place. Verify retry/dunning settings do not automatically terminate service for delinquency before rollout.
