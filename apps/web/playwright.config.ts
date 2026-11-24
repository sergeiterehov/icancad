import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  // Every test opens its own project in its own browser context, so the file a
  // test lives in carries no order: run them side by side, especially the large
  // ones whose start-up (a fresh kernel) dominates the run.
  fullyParallel: true,
  // Three at a time. Each page instantiates the 63 MB OpenCascade kernel and the
  // formula specs also boot Pyodide, so five workers oversubscribe the machine:
  // the main threads stall and a formula test times out at three minutes.
  workers: 3,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    acceptDownloads: true,
    locale: 'en-US',
  },
  webServer: {
    command:
      'node ../../scripts/copy-occt.mjs && node ../../scripts/copy-pyodide.mjs && corepack pnpm exec vite --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
