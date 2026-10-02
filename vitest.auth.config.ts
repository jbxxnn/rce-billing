import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/auth/http.integration.test.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 40_000,
  },
});
