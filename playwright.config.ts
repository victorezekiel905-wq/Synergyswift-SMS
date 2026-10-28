import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "fs";
import { join } from "path";

/**
 * End-to-end tests in a real browser (phase 14q): `npm run test:e2e`.
 *  - e2e/site.e2e.ts and e2e/flows.e2e.ts run against this app with the server's
 *    replies stubbed where a database would be needed, so they run anywhere.
 *  - e2e/roles.e2e.ts signs in as each role on a seeded test copy of the system
 *    (scripts/load/seed-staging.mjs). It runs only when E2E_BASE_URL and the
 *    E2E_* accounts are set; otherwise it is skipped.
 * E2E_BASE_URL points the tests at a running site; without it, one is started
 * here with `next start` (run `npm run build` first) on port 3123.
 */
const local = join(process.env.USERPROFILE ?? process.env.HOME ?? "", "AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe");
const executablePath = process.env.PW_CHROME || (existsSync(local) ? local : undefined);
const baseURL = process.env.E2E_BASE_URL || "http://localhost:3123";

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: { baseURL, trace: "retain-on-failure", launchOptions: executablePath ? { executablePath } : {} },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "phone", use: { ...devices["Pixel 7"] } }
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: "npx next start -p 3123",
    url: "http://localhost:3123/login",
    timeout: 120_000,
    reuseExistingServer: true
  }
});
