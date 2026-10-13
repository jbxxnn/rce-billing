# Legacy workflow review

Reviewed on 2026-09-24 using the live legacy administrative interface and the archived PHP application in `fbc.versal.tech`.

## What happens in the legacy system

### 1. Create a phone plan

An administrator enters a plan name, monthly price, description, and one of three plan types.

| Plan type | Plan fields shown in the live interface                                    | Fields used by the archived billing code                                   |
| --------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Metered   | Included minutes, additional minutes, included numbers, extra-number cost  | Plan price, included numbers, extra-number cost                            |
| Unmetered | Included channels, extra-channel cost, included numbers, extra-number cost | Included channels, extra-channel cost, included numbers, extra-number cost |
| Others    | Basic plan details                                                         | Plan price; customer-specific SIP and hosting charges                      |

The archive creates a Stripe product and recurring price, then stores the legacy plan in `price_plans`. It stores the Stripe product/price IDs and the plan attributes together.

The minute fields are entered for a metered plan but are not used by the archived formula. They must still be preserved during import until production data proves they are obsolete.

### 2. Create a customer and choose a plan

The customer form records contact and address details, Flowroute access and secret keys, billing day, subscription type, and a plan matching that type.

Additional fields depend on the customer type:

| Customer type | Customer-specific fields                                                   |
| ------------- | -------------------------------------------------------------------------- |
| Metered       | Extra numbers                                                              |
| Unmetered     | Extra channels and extra numbers                                           |
| Others        | Metered billing plan, metered SIP trunk usage, cloud-server-hosting charge |

Saving the customer creates the customer record. It does **not** safely present a subscription confirmation step.

### 3. Create the Stripe subscription

On the customer detail screen, the legacy **Create Subscription** action creates a Stripe subscription from the selected plan price and saves the Stripe subscription and subscription-item IDs. The customer billing day is used as the billing-cycle anchor.

The action is immediate: the live interface showed that pressing it created an active subscription without a confirmation dialog. The replacement application prevents duplicate work with stored state, idempotency, and audit records.

### 4. Collect Flowroute usage

The scheduled legacy process selects customers whose billing day is tomorrow. For each one, it requests a Flowroute CDR export for the entire previous calendar month, polls until it completes, and saves Flowroute `total_cost` in `monthly_data`.

This is a calendar-month export, not a customer-specific Stripe period. The replacement application preserves the legacy calculation mode for reconciliation, while keeping immutable export and period snapshots.

### 5. Calculate additional billing

The billing scripts again select customers whose billing day is tomorrow. They retrieve the latest saved `total_cost`, the customer configuration, the Stripe subscription, and the matching stored plan price.

For a **metered** customer, the archived calculation is:

```
usage = ceil(Flowroute total_cost)
additional charge = (usage - 0.35 × plan price) × 4
                  + (extra numbers - included numbers) × extra-number cost
```

For an **unmetered** customer, Flowroute usage is retrieved but does not affect the charge:

```
additional charge = customer extra channels × extra-channel cost
                  + (extra numbers - included numbers) × extra-number cost
```

For **others**:

```
usage = ceil(Flowroute total_cost)
additional charge = usage × plan price + metered SIP trunk usage
hosting charge = cloud-server-hosting charge
```

The legacy script deletes prior invoice items associated with the subscription, creates new additional invoice items, and sends a usage record to Stripe. This is not safe to retry. The replacement application instead records immutable calculations and synchronizes them idempotently.

## What the replacement already covers

- Plan fields and immutable price versions.
- Customer billing anchors, Flowroute credentials encrypted per customer, and subscription records.
- Flowroute CDR export, retry handling, and immutable usage snapshots.
- The three legacy formula paths in `legacy-v1`, including protection against negative charges.
- Immutable billing runs, line items, calculation snapshots, and safe Stripe invoice synchronization.

## What must be confirmed before importing production data

1. Obtain an export of the actual production legacy database. The archived PHP contains conflicting table names and cannot be treated as the source of truth.
2. For every active customer, confirm the selected plan, billing day, Stripe customer/subscription IDs, Flowroute credentials, extra numbers, extra channels, SIP charge, and hosting charge.
3. Confirm whether metered-plan minute fields have any business meaning outside the archived formula.
4. Recalculate at least one completed historical billing period per active customer and compare the replacement result with the legacy Stripe invoice.
5. Import only after those records reconcile; then run the two systems in shadow mode for a full billing cycle before cutover.
