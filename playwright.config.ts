import { defineConfig, devices } from "@playwright/test";

const port = 3107;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // The deterministic repository is process-local; one worker keeps browser
  // workflows ordered and makes state assertions reproducible.
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `yarn next dev --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL: "",
      NEXT_PUBLIC_APP_URL: baseURL,
      NEXT_PUBLIC_V2_DEMO_USER_ID: "creator@example.test",
      V2_CHAIN_BROADCAST_ENABLED: "false",
      V2_FUNDING_MODE: "mock",
      V2_NEAR_NETWORK: "testnet",
      NEXT_PUBLIC_NEAR_NETWORK: "testnet",
      NEXT_PUBLIC_V2_CONTRACT_ID: "crossword-campaigns-v2.testnet",
      NEXT_PUBLIC_V2_USDC_CONTRACT_ID: "mock-usdc.testnet",
    },
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
      testMatch: /mobile\.spec\.ts/,
    },
  ],
});
