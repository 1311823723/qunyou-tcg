import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results",
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: isCI ? [["line"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:4321",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "npm run dev -- --host 127.0.0.1 --port 4321",
      url: "http://127.0.0.1:4321/play",
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
    {
      command: "npm run dev:battle -- --ip 127.0.0.1 --port 8787",
      url: "http://127.0.0.1:8787/lobby",
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ],
});
