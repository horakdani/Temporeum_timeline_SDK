import { defineConfig, devices } from "@playwright/test";

/**
 * The examples check, the browser half: every live example of the docs site runs.
 *
 * Its own port, like every suite here (an idle server of another suite would
 * be measured instead). Desktop Chromium only: the examples are code, not
 * gestures, and the accessibility suite covers the phone viewport.
 */
const PORT = Number(process.env.TL_EXAMPLES_PORT ?? 41765);

export default defineConfig({
  // A stray test.only would quietly run one test and call the suite green.
  forbidOnly: true,
  testDir: "./e2e",
  testMatch: "examples.spec.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: ".e2e-examples-report.json" }]],
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    channel: "chromium-headless-shell",
    trace: "off",
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chromium-headless-shell" } }],
  webServer: {
    command: "node e2e/serve.mjs",
    env: { TL_E2E_PORT: String(PORT) },
    url: `http://127.0.0.1:${String(PORT)}/site/index.html`,
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
