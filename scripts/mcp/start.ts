import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRceBillingMcpServer } from "../../src/mcp/server";

const server = createRceBillingMcpServer();
await server.connect(new StdioServerTransport());
