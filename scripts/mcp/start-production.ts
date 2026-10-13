/**
 * Local-only launcher for Codex. The production pooler URL stays in the ignored
 * .env.production.local file; it is never written to Codex configuration.
 */
export {};

const productionDatabaseUrl = process.env.SUPABASE_PRODUCTION_POOLER_URL;
if (!productionDatabaseUrl) {
  process.stderr.write(
    "SUPABASE_PRODUCTION_POOLER_URL is required to start the production RCE Billing MCP server.\n",
  );
  process.exit(1);
}

process.env.RCE_BILLING_MCP_DATABASE_URL ??= productionDatabaseUrl;

const { StdioServerTransport } =
  await import("@modelcontextprotocol/sdk/server/stdio.js");
const { createRceBillingMcpServer } = await import("../../src/mcp/server");

const server = createRceBillingMcpServer();
await server.connect(new StdioServerTransport());
