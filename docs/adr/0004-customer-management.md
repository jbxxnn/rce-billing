# ADR 0004: Customer changes and credential storage

Date: 2026-09-22
Status: Accepted for Phase 3.

## Decisions

Use soft archive rather than destructive deletion. New records are drafts. Existing subscription billing dates cannot be edited independently from Stripe/subscription state. Archive requires no ongoing subscriptions or unresolved billing runs, disables application credential use, and preserves history. Restore returns to draft without re-enabling keys.

Add an integer revision incremented by a PostgreSQL trigger. Mutations lock the customer, compare the submitted revision, and write changes and audit records in one transaction. Concurrent stale edits fail explicitly. New subscription/run activity takes a compatible customer lock and rejects archived state, closing the race between new work and archiving.

Use AES-256-GCM through Web Crypto, which is supported by the [Workers runtime](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/). Encrypt access and secret keys independently with random nonces and authenticated customer/provider/field/version context. A versioned key ring allows retained keys to decrypt existing records during rotation. Credentials are marked UNVERIFIED until a later provider check; storage success is not connection verification.

Expose no credential retrieval endpoint. Customer reads select only status/timestamps, and credential audits exclude plaintext and ciphertext. Local key disablement does not imply provider-side revocation.

Use bounded, parameterized, literal case-insensitive name/email search and cursor pagination. Every page and mutation checks administrator authorization; mutations also require the configured Origin. Browser-supplied state, payment status, Stripe IDs, and encrypted payloads are not writable form fields.

## Boundaries

Phase 3 does not implement activation, plan assignment, Stripe synchronization, provider connection verification, cancellation, or billing formulas. Subscriptions and pricing arrive in Phase 4; Flowroute API calls arrive in Phase 6. No existing business billing rules were changed.
