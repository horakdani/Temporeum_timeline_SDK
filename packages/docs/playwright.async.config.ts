import { defineConfig, devices } from "@playwright/test";

/**
 * The browser half of the async check: a fast zoom in a real browser, with real
 * timers and a real DOM.
 *
 * Its own port (a suite running on a foreign page is worse than a missing
 * one). Desktop Chromium: the fast zoom here is Ctrl+wheel — the same path
 * a trackpad pinch takes.
 */
const PORT = Number(process.env.TL_ASYNC_PORT ?? 31743);

export default defineConfig({
  // A stray test.only would quietly run one test and call the suite green.
  forbidOnly: true,
  testDir: "./e2e",
  testMatch: "async.spec.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: ".e2e-async-report.json" }]],
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    channel: "chromium-headless-shell",
    trace: "off",
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chromium-headless-shell" } }],
  webServer: {
    command: "node e2e/serve.mjs",
    env: { TL_E2E_PORT: String(PORT) },
    url: `http://127.0.0.1:${String(PORT)}/async.html`,
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
