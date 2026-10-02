# ADR 0005: Plans, subscription drafts, and billing calendar

Accepted 2026-09-22.

The product owner confirmed that billing days 29–31 clamp to the last day of shorter months and subscription billing anchors remain at 11:00 UTC. The configured day is retained: a day-31 schedule uses February 28 (29 in leap years), then March 31. The next anchor is strictly later than the reference instant. Usage remains the previous full UTC calendar month, independent of the billing day. Calendar policy is recorded as `monthly-last-day-1100utc-v1`.

Plan writes append an immutable price snapshot and retire the former current version. A partial unique index permits one current version per plan. Catalog edits and availability changes do not alter assigned subscription versions. Dollar inputs convert directly to bigint cents; snapshots serialize cents as decimal strings. Legacy formulas and sub-cent provider costs are not inferred from these catalog fields.

Phase 4 creates and edits unactivated subscription drafts only. Draft creation uses a unique request UUID to deduplicate retries. A proposed anchor and policy are stored separately from actual provider billing periods. Activation must recalculate the anchor and coordinate with Stripe. Live plan changes must apply immediately with Stripe proration; live cancellation must take effect at period end. Local-only updates cannot fulfill those requirements and are rejected until Phase 5.

Plan and subscription revisions detect stale forms. Administrator, customer, subscription, and plan locks serialize conflicting changes; mutations and audit events share transactions. Inactive or retired plan prices cannot be assigned to new drafts. Archived customers cannot create drafts. Draft discard retains history with CANCELED status.

No provider calls, invoices, proration, or live subscription cancellation are introduced by this phase.
