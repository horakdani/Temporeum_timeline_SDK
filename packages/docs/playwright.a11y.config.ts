import { defineConfig, devices } from "@playwright/test";

/**
 * The axe check: the browser half of accessibility.
 *
 * Its own port, so that even alongside the touch suite neither sits on the
 * other's server (a suite running on a foreign page is worse than a missing
 * one). Two projects: desktop Chromium with a keyboard — axe and the
 * keyboard path run here — and Pixel 7, where the narrow view and the
 * bottom sheet are put in front of axe.
 */
const PORT = Number(process.env.TL_A11Y_PORT ?? 31741);

export default defineConfig({
  // A stray test.only would quietly run one test and call the suite green.
  forbidOnly: true,
  testDir: "./e2e",
  testMatch: "a11y.spec.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: ".e2e-a11y-report.json" }]],
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    channel: "chromium-headless-shell",
    trace: "off",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chromium-headless-shell" } },
    { name: "pixel-7", use: { ...devices["Pixel 7"], channel: "chromium-headless-shell" } },
  ],
  webServer: {
    command: "node e2e/serve.mjs",
    env: { TL_E2E_PORT: String(PORT) },
    url: `http://127.0.0.1:${String(PORT)}/index.html`,
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
