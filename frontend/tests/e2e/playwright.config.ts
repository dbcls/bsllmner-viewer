import { defineConfig, devices } from "@playwright/test"

/**
 * The tests drive the dev server, which proxies the api. Both must already be running, and the api
 * must serve the synthetic store; the global setup checks that before any test starts.
 */
const baseURL = process.env.BSLLMNER_VIEWER_E2E_BASE_URL ?? "http://frontend:5173"

export default defineConfig({
  testDir: ".",
  globalSetup: "./global-setup.ts",
  fullyParallel: true,
  workers: 4,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { outputFolder: "../../playwright-report", open: "never" }]],
  outputDir: "../../test-results",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
})
