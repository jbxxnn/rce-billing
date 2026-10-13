import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [
    "--conditions=react-server",
    "--import",
    "tsx",
    "scripts/mcp/start.ts",
  ],
  cwd: process.cwd(),
  env: Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  ),
  stderr: "inherit",
});
const client = new Client({
  name: "rce-billing-mcp-verifier",
  version: "0.1.0",
});

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name).sort();
  const expected = [
    "billing_run_detail",
    "create_customer_draft",
    "create_subscription_draft",
    "customer_overview",
    "list_active_plan_versions",
    "list_billing_runs",
    "operational_attention",
    "search_customers",
    "usage_history",
  ];
  if (JSON.stringify(names) !== JSON.stringify(expected))
    throw new Error(`Unexpected tool list: ${names.join(", ")}`);
  console.log(`MCP verification passed: ${names.join(", ")}`);
} finally {
  await client.close();
}
