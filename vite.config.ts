import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
export default defineConfig({
  resolve: {
    alias: {
      "@runtime/database": new URL(
        "./src/db/runtime-source.worker.ts",
        import.meta.url,
      ).pathname,
    },
  },
  plugins: [
    vinext(),
    cloudflare({
      viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
    }),
  ],
});
