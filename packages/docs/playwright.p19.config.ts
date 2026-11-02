import { defineConfig, devices } from "@playwright/test";

/**
 * The browser half of G-DROP (dragging in an external element, and its
 * keyboard twin) and G-TEMPLATE, in a real Chromium (the script WOULD run if
 * the template let it through — and in the negative control it does run).
 *
 * Its own port, as for every e2e suite.
 */
const PORT = Number(process.env.TL_P19_PORT ?? 41751);

export default defineConfig({
  testDir: "./e2e",
  testMatch: process.env.TL_P19_SPEC ?? /(drop|template)\.spec\.ts/,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: process.env.TL_P19_REPORT ?? ".e2e-p19-report.json" }]],
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    channel: "chromium-headless-shell",
    trace: "off",
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chromium-headless-shell", viewport: { width: 1200, height: 800 } } }],
  webServer: {
    command: "node e2e/serve.mjs",
    env: { TL_E2E_PORT: String(PORT) },
    url: `http://127.0.0.1:${String(PORT)}/p19.html`,
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
