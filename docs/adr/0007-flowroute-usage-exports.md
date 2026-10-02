# ADR 0007: Flowroute usage export boundary

Accepted 2026-09-23.

The application uses Flowroute's CDR Export v2 API with per-customer HTTP Basic credentials. It creates an asynchronous export for the exact previous full calendar month using UTC `00:00:00` bounds, then retrieves the specific export by its provider ID. No callback URL, CSV download, or individual call record is requested or retained. A completed response provides exact `total_cost` and `billed_minutes`; their billing meaning remains intentionally undecided until formula characterization.

The adapter is the only component that knows the Flowroute endpoint and JSON:API wire format. It has a ten-second request timeout and maps provider outcomes to `AUTHENTICATION_FAILED`, `RATE_LIMITED`, `TEMPORARY_PROVIDER_ERROR`, `INVALID_REQUEST`, `EXPORT_FAILED`, or `UNKNOWN_PROVIDER_ERROR`. It never logs credentials, response bodies, signed download URLs, or provider error detail.

The export service decrypts credentials only after it claims an export and only inside server execution. It stores no plaintext. A successful request marks previously unverified credentials active; an authentication rejection marks them invalid. Revoked credentials are never decrypted. Missing/invalid credentials and permanent provider failures require review. Retryable failures use bounded exponential backoff and become permanent after eight attempts.

Database claim tokens expire after two minutes, and provider calls occur after the claim transaction commits. A later worker may recover a crashed claim. The stable `(customer, provider, period)` uniqueness already prevents duplicate logical exports. Provider export IDs and calendar identity become immutable after storage. Completed exports atomically create an immutable sanitized snapshot and mark the export complete.

No Flowroute request runs in a browser route or a long-lived HTTP request. The current command is a controlled manual processor; durable scheduled discovery and queue delivery are Phase 7. A completed export only records source usage. It does not calculate charges, create a billing run, or finalize/send a Stripe invoice.

References: [create CDR export](https://developer.flowroute.com/api/cdrexports/v2.0/query-cdrs/), [check export status](https://developer.flowroute.com/api/cdrexports/v2.0/cdr-status/), and [Flowroute API conventions](https://developer.flowroute.com/libraries/).
