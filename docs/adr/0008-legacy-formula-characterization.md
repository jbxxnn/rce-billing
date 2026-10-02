# ADR 0008: Legacy formula characterization

Accepted 2026-09-23.

Until billing economics are redesigned and reconciled, calculations retain the legacy source value: Flowroute CDR export `total_cost`, rounded upward to a whole unit. Billed minutes are retained as evidence but do not drive the legacy formulas.

The metered formula preserves the observed `0.35` and `4` constants. The other/custom formula retains the observed usage, SIP-trunk, and hosting components. The unmetered formula retains channel and number components. All resulting negative charges are clamped to zero by product-owner decision; credits are not created.

These rules live behind the `legacy-v1` version so historical calculation snapshots remain reproducible when a replacement formula is approved. This ADR does not approve Stripe synchronization or production invoicing.
