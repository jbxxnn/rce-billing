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
    include: ["src/db/**/*.integration.test.ts"],
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
