# ADR 0009: Held-invoice subscription activation

Accepted 2026-09-23.

Stripe can finalize the first invoice as part of creating a normal automatic-collection subscription. The migration requirement is stricter: the whole invoice, including the recurring charge, must remain held until previous-calendar-month Flowroute usage has completed and the local calculation is sealed.

Stripe documents Subscription Schedules as the supported way to begin with a draft first invoice. However, the existing direct subscription integration uses Stripe's `billing_cycle_anchor_config` to retain each customer's required billing day and 11:00 UTC anchor, while the schedule API needs an explicit phase model to preserve that same anchor. The schedule phases must be designed and sandbox-tested before enabling this path.

Until then, direct activation for `charge_automatically` is blocked. `send_invoice` activation remains subject to the existing draft-invoice hold and webhook reconciliation. No production billing is enabled by this decision.
