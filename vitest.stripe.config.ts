import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: {
    alias: {
      "server-only": new URL("./src/db/test-server-only.ts", import.meta.url)
        .pathname,
    },
  },
  test: {
    environment: "node",
    include: ["src/stripe/sandbox.integration.test.ts"],
    testTimeout: 120000,
    hookTimeout: 60000,
  },
});
