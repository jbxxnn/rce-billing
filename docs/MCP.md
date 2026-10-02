# RCE Billing MCP

RCE Billing has a local administrative MCP server and a remote Cloudflare-hosted MCP endpoint. Both expose the same tightly scoped billing tools. Neither returns encrypted Flowroute keys or raw provider payloads.

It exposes nine tools:

- `search_customers`
- `customer_overview`
- `usage_history`
- `list_active_plan_versions`
- `list_billing_runs`
- `billing_run_detail`
- `operational_attention`
- `create_customer_draft`
- `create_subscription_draft`

The first seven tools only query the billing database. The two draft-creation tools require an explicit confirmation value. They do not create or update Stripe objects, store Flowroute keys, send messages, invoice, charge, or replay jobs.

## Remote endpoint

The production endpoint is `https://billing.re-circuit.com/mcp`. It uses OAuth 2.1 with PKCE and Google Workspace sign-in. Any active `@re-circuit.com` Google Workspace member can connect; they do not need separate administrator approval. Access tokens are short-lived, opaque, and stored only as hashes.

The endpoint also publishes the required discovery documents:

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-authorization-server`

Before enabling it, add this exact OAuth redirect URI to the existing Google Cloud OAuth client:

```text
https://billing.re-circuit.com/mcp/oauth/google/callback
```

Then deploy the application and apply migration `0019_mcp_oauth.sql`. Each teammate can add the remote URL to Codex and complete the normal Google sign-in prompt; they do not need a database URL or local launcher.

## Start locally

Set a database URL in the process environment, then run:

```sh
RCE_BILLING_MCP_DATABASE_URL='postgresql://…' npm run mcp:start
```

`DATABASE_URL` is also accepted for local development. `RCE_BILLING_MCP_DATABASE_URL` is preferred because it makes the MCP connection explicit and separate from the application runtime.

To enable the two draft-creation tools, also supply `RCE_BILLING_MCP_ACTOR_ID` with the UUID of an active RCE Billing user. The application writes this ID to its existing audit log for every MCP draft creation. Without it, all read-only tools remain available and write requests are refused.

## MCP client configuration

Configure the client to start this repository’s server with Node and `tsx`:

```json
{
  "command": "node",
  "args": [
    "--conditions=react-server",
    "--import",
    "tsx",
    "/absolute/path/to/rce-billing/scripts/mcp/start.ts"
  ],
  "env": {
    "RCE_BILLING_MCP_DATABASE_URL": "set-this-in-your-secret-manager",
    "RCE_BILLING_MCP_ACTOR_ID": "active-rce-billing-user-uuid"
  }
}
```

Do not put a production connection string in source control or a shared configuration file. Supply it from the MCP client’s secret storage.

For this repository’s local Codex setup, `scripts/mcp/start-production.ts` reads the ignored `.env.production.local` file and maps its production pooler URL into the MCP process. The Codex configuration contains only the launcher path and the user audit ID; it does not contain the database URL.

## Verify the protocol connection

```sh
npm run mcp:verify
```

This starts the server in a child process and confirms that the nine intended tools are available. It does not connect to the database.

To confirm an actual read-only database call with local development configuration, run:

```sh
npm run mcp:smoke
```
