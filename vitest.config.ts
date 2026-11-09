import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          // Fixed test values. They win over anything in .dev.vars, so tests never see the real
          // TinyFish key, and every outbound request is answered by tests/helpers/fetch-mock.ts.
          TINYFISH_API_KEY: "test-tinyfish-key",
          ADMIN_TOKEN: "test-admin",
          WEBHOOK_SECRET: "test-secret",
          PUBLIC_BASE_URL: "https://backed.test",
          // The site is on in tests; the test that checks it switched off sets it per request.
          SITE_ENABLED: "1",
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
        },
      },
    })),
  ],
  test: {
    setupFiles: ["./tests/setup.ts"],
  },
});
