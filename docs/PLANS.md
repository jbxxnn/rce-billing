# Plans and subscription drafts

Administrators can search the plan catalog, create plans, save a new price version, and activate/deactivate plans. Amount fields accept non-negative USD values with at most two decimals. Included minutes retain up to twelve decimal places. Counts are non-negative integers.

Each save appends a pricing snapshot. Price history is read-only; existing subscriptions retain their assigned version. Deactivation removes the plan from draft choices without changing existing subscriptions.

From a customer record, choose **New subscription draft**, select an active price and collection method, and save. Plan choices are searched and paginated. A draft can be edited or discarded. A repeated submission with the same request key returns the same draft. Stale forms must be refreshed before editing.

Billing is scheduled at 11:00 UTC on the customer's configured day. Short months use their final day while retaining the configured day for later months. The displayed anchor is proposed and will be recalculated during activation; it is not an actual Stripe period. Usage is always the previous full calendar month.

Draft preparation creates no Stripe objects or charges. With sandbox credentials configured, test subscriptions support activation, immediate Stripe-prorated changes, and end-of-period cancellation. See [Stripe setup](STRIPE.md). Live production operations remain blocked. The stored historical pricing remains available after cancellation.

Apply migrations 0007–0009 using the documented migration command before opening these screens. These add revisions, draft request identity, proposed anchor/policy fields, and a single-current-price constraint. Production legacy import and financial formula characterization remain separate work.
