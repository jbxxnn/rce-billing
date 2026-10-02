import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [
    "--conditions=react-server",
    "--import",
    "tsx",
    process.env.RCE_BILLING_MCP_PRODUCTION === "true"
      ? "scripts/mcp/start-production.ts"
      : "scripts/mcp/start.ts",
  ],
  cwd: process.cwd(),
  env: Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  ),
  stderr: "inherit",
});
const client = new Client({ name: "rce-billing-mcp-smoke", version: "0.1.0" });

try {
  await client.connect(transport);
  const result = await client.callTool({
    name: "operational_attention",
    arguments: {},
  });
  if (result.isError) throw new Error("The operational_attention tool returned an error.");
  console.log("MCP read-only database smoke test passed.");
} finally {
  await client.close();
}
