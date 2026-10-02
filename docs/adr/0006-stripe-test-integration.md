# ADR 0006: Durable Stripe test integration

Accepted 2026-09-22. Production activation is deliberately unavailable pending the invoice-hold and usage pipeline.

## Provider boundary

Use official `stripe` 22.6.2, pinned API version `2026-08-26.dahlia`, fetch transport and asynchronous Web Crypto signature verification. The adapter accepts test keys only; runtime configuration additionally requires explicit enablement and a development/test/staging environment. The configured sandbox account is checked against `/v1/account` and bound immutably to the database. Do not mix sandbox and production mappings or reuse this database for another account.

The product owner asked to leave proration to Stripe. Initial subscriptions use `create_prorations`, and changing an existing plan updates its item immediately with `create_prorations` and a saved proration timestamp. Credits/charges are placed on the normal Stripe invoice rather than forcing an immediate invoice. No local financial formula approximates Stripe proration. Emailed invoices require the administrator to enter days-until-due explicitly; no global payment-term assumption is introduced. Cancellation sets `cancel_at_period_end=true` and does not mark the local subscription canceled early.

## Durable effects and ordering

A subscription workflow reserves the local row before external writes and prevents draft edits or conflicting actions. A durable request ledger saves the exact provider input before the first request. Each row supplies a stable Stripe idempotency key, including after a lost response or process restart. Request/workflow claims use expiring ownership tokens; HTTP is outside database transactions. Final updates compare ownership and commit provider mapping/state with audit records atomically.

Stripe may prune idempotency keys after 24 hours. Uncertain requests stop after 23 hours and require reconciliation, rather than risk creating another object with an expired key. Saved request inputs, IDs and successful results are guarded by database triggers. Completed steps can be reused indefinitely because their provider IDs are already persisted.

Verified webhook event IDs are unique. Event completion, state changes, and audits commit together. Transient failures return non-2xx so Stripe retries; a bounded operator replay command also processes saved pending events. Event payloads trigger retrieval of the current provider state instead of overwriting with stale event snapshots. Customer/subscription revisions prevent an older in-flight fetch from overwriting a concurrent local change. Events arriving during a reserved workflow remain retryable until the operation finishes.

Invoice delinquency is tracked per invoice and aggregated with subscription status. Paying one invoice cannot clear another unpaid invoice. Payment failures never suspend the local customer. Supported subscription and invoice events are listed in `docs/STRIPE.md`; unsupported events are acknowledged without business mutations. Customer deletion is audited for review, never cascaded into local financial history.

## Invoice hold and release limitation

Stripe's direct subscription creation can finalize its first invoice immediately. An `invoice.created` webhook alone cannot guarantee the required whole-invoice usage hold, especially during outages. This phase sets `auto_advance=false` on managed draft invoices but makes no claim that this is sufficient for production. Production mode and live keys remain rejected until a creation/scheduling design and explicit invoice release process guarantee that fixed and usage charges stay together. No invoice finalization/send/pay or refund endpoint is added here.

## Validation boundary

The owner has not configured sandbox credentials and requested test values in `.env.local`. That ignored file contains disabled placeholders only. Adapter and workflow tests use generated synthetic fixtures. A separate opt-in real-sandbox lifecycle suite is present but cannot be validated against Stripe until credentials are supplied.

References: [Stripe idempotency](https://docs.stripe.com/api/idempotent_requests), [subscription creation](https://docs.stripe.com/api/subscriptions/create), [subscription updates](https://docs.stripe.com/api/subscriptions/update), [webhooks](https://docs.stripe.com/webhooks), [payment collection holds](https://docs.stripe.com/billing/subscriptions/pause-payment).
