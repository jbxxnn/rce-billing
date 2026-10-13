import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      "@runtime/database": new URL(
        "./src/db/runtime-source.node.ts",
        import.meta.url,
      ).pathname,
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
