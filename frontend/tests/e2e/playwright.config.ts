import { defineConfig, devices } from "@playwright/test"

/**
 * The end-to-end tests drive a deployment with its real dataset, not this source. The address comes
 * from the environment so that the same scenarios run against any deployment; the global setup stops
 * the run when it is missing.
 */
const baseURL = process.env.BSLLMNER_VIEWER_E2E_BASE_URL

/**
 * What the deployment is meant to be, which its responses cannot show: a deployment configured by
 * mistake answers like one configured as intended. The runner passes both values in, and the
 * scenarios that need them skip when they are missing.
 */
export const EXPECTED = {
  /** `true` or `false`: the BSLLMNER_VIEWER_NOINDEX of the deployment. */
  noindex: process.env.BSLLMNER_VIEWER_E2E_NOINDEX ?? "",
  /** The commit that the deployment was built from. */
  commit: process.env.BSLLMNER_VIEWER_E2E_COMMIT ?? "",
}

// The deployment serves real users, so the run is small and a failure is never retried away.
export default defineConfig({
  testDir: ".",
  globalSetup: "./global-setup.ts",
  fullyParallel: true,
  workers: 2,
  retries: 0,
  timeout: 90_000,
  // Aggregations over the full dataset take up to about a second, and the site is across a network.
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { outputFolder: "../../playwright-report", open: "never" }]],
  outputDir: "../../test-results",
  use: {
    ...(baseURL ? { baseURL } : {}),
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
