import { defineConfig } from "@playwright/test";

const port = Number.parseInt(process.env.MAGNA_WEB_E2E_PORT ?? "4173", 10);
const baseURL = process.env.MAGNA_WEB_E2E_BASE_URL ?? `http://localhost:${port}`;
const reuseExistingServer = process.env.MAGNA_WEB_E2E_REUSE_SERVER === "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 180_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    // Force a fresh Vite dependency graph for deterministic browser-boot tests.
    command: `npm run dev -- --force --host localhost --port ${port}`,
    port,
    timeout: 120_000,
    reuseExistingServer,
  },
});
