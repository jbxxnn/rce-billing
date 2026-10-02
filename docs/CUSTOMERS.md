# Customer management and Flowroute credentials

## Administrator workflows

Open `/customers` after signing in. Search by name/email, filter status, and navigate pages of 25 records. Searches treat `%`, `_`, and backslash literally. Paging uses a stable internal-ID cursor; it is not alphabetical sorting. Audit history is paged separately in groups of 20.

Create a draft customer with contact/address information, billing day, and billing timezone. Credentials are entered separately after creation. New customer records do not create a Stripe customer, subscription, invoice, or Flowroute request. Plan selection and subscription lifecycle controls arrive in Phase 4.

The profile form validates inputs on the server, preserves entered profile values on errors, and rejects client-supplied provider IDs, account state, or payment status. Billing dates for existing nonterminal subscriptions cannot be changed through the profile form; they require a coordinated subscription operation. The unresolved short-month billing policy is not guessed here: configured days 1–31 are stored as specified.

Each form includes a customer revision. If another administrator changes the record, a stale save fails with a refresh instruction. Changes, revision increments, and audit records are committed atomically.

## Archive and restore

Archiving preserves the record and audit history and disables stored Flowroute keys locally. It is blocked while there are nonterminal subscriptions or billing runs other than completed/canceled. It does not cancel a subscription, issue a refund, or change provider-side service.

Restoring returns the record to DRAFT and leaves credentials disabled. Archived records cannot be edited or have replacement credentials saved. Database guards serialize new subscription/billing activity against archive operations and reject new activity for archived customers.

## Encryption setup

Configure these server-only values in `.env.local` for local Next.js, `.dev.vars` for local Workers, and Cloudflare Secrets for deployed Workers:

```text
FLOWROUTE_ENCRYPTION_KEY_VERSION=v1
FLOWROUTE_ENCRYPTION_KEYS={"v1":"YOUR_GENERATED_32_BYTE_BASE64_KEY"}
```

Generate a key with `openssl rand -base64 32` and store it through the approved secret-management process. Never commit a real key or a credential. The template values are placeholders and will deliberately fail validation. Profile management works without encryption configuration; saving credentials fails closed until a valid key ring is configured.

Encryption uses AES-256-GCM, a fresh 96-bit random nonce, and a 128-bit authentication tag. Additional authenticated data binds the ciphertext to the customer, provider, field, and key version. The application encrypts both the access key and secret key before persistence. Database constraints reject plaintext-shaped values; cryptographic integrity is verified during decryption.

The application exposes only stored-key status and modification time. It never exposes stored plaintext or ciphertext in customer pages, API responses, or audit events. Backend decryption is a primitive for the future Flowroute adapter, not an administrator retrieval endpoint.

## Replace, disable, and rotate

Replacement requires both new keys and resets status to UNVERIFIED. Saving a pair alone does not prove that the keys are valid. The Flowroute export service marks a pair ACTIVE after a successful provider request and INVALID after an authentication rejection. “Disable stored keys” sets REVOKED locally; revoke or rotate compromised keys directly with the provider as well.

To introduce a new encryption key, add a new key-ring entry and switch `FLOWROUTE_ENCRYPTION_KEY_VERSION`. Retain every previous key while any record or required backup still depends on it. New replacements use the active version; existing rows retain their original version. This phase does not perform automatic bulk re-encryption. Losing a key makes its stored values unreadable and requires provider credential replacement.

Credential changes record provider, state, key version, actor, and request identifier in the audit trail. Plaintext, ciphertext, and encryption keys are excluded. Profile audit records contain contact details and must be treated as administrator-only customer data.

## Validation and deployment

Apply migrations 0004–0006 before running this version. The encrypted-envelope constraint assumes only the new application’s encrypted values exist; do not import legacy plaintext into the credentials table. Keep Hyperdrive query caching disabled.

Tests cover form bounds, duplicate fields, authorization, literal search, cursor paging, stale concurrent edits, archive blockers, ciphertext tampering/cross-customer copying, key-version retention, and full HTTP create/edit/key replacement/archive/restore flows in both runtime targets. No real provider credentials were read or changed during implementation.
