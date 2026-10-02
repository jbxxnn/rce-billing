# Flowroute usage exports

Phase 6 adds a server-only Flowroute CDR export adapter. It is not a billing engine and it does not collect, finalize, or send invoices.

Each customer stores a separate encrypted Flowroute access-key/secret-key pair. Save a pair on the customer page first. A successful export request changes its local status from `UNVERIFIED` to `ACTIVE`; a Flowroute authentication rejection changes it to `INVALID`. Replacing the pair returns it to `UNVERIFIED`. Disabled credentials are never used.

The service creates an export for a requested full-calendar-month period, then retrieves that same export later. It records Flowroute's exact total cost and billed minutes in an immutable snapshot. It does not download the CDR file, persist the response's temporary download URL, or interpret those values as customer billing amounts. The meaning of `total_cost` is still a documented legacy-characterization question.

No global Flowroute secret is configured. The saved customer credentials are used only in the provider service. Configure the application encryption key ring from [customer management](CUSTOMERS.md) before processing an export.

For a manually reserved export, process one ID from a trusted server shell:

```sh
npm run flowroute:process -- USAGE_EXPORT_UUID
```

The command requires `DATABASE_URL` and the encryption key-ring variables, normally loaded from the ignored `.env.local`. It prints only the export ID and resulting status. Retryable problems schedule `next_attempt_at`; invoke it again after that time. Permanent failures remain visible in the database/audit history for review.

## Scheduled delivery

Phase 7 adds an hourly UTC Cron Trigger and the `rce-billing-flowroute-jobs` Cloudflare Queue. At and after each customer’s 11:00 UTC billing anchor, discovery creates one billing run, one usage export, and one durable outbox job for the previous full calendar month. The job is safe to enqueue more than once.

Queue delivery performs one provider operation only. It never polls in an HTTP request or sleeps. The stored job schedules the next retry, recovers a message that was never delivered, and records a terminal failure as `NEEDS_REVIEW` on both the job and billing run. The configured Queue dead-letter queue retains infrastructure failures for operator investigation.

The Queue names are declared in `wrangler.jsonc`, but no Cloudflare Queue has been provisioned or deployed from this repository. Create/provision the bindings in the target account before deployment; local and production delivery both require Hyperdrive and the encryption key ring.

After an administrator has reviewed a non-completed job in the database/audit history, they may reset it for the next cron dispatch from a trusted server shell:

```sh
npm run flowroute:replay -- BACKGROUND_JOB_UUID
```

The command only accepts jobs in `NEEDS_REVIEW`, resets the linked non-completed export’s bounded retry state, returns the billing run to `WAITING_FOR_USAGE`, and writes an audit event. It never changes completed usage.

Normal tests use a mock provider and synthetic encrypted credentials. They make no Flowroute calls. Do not use legacy credentials from the PHP archive for testing. Before a real integration test, create new restricted test credentials in Flowroute and store them through the customer UI.
