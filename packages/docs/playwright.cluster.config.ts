import { defineConfig, devices } from "@playwright/test";

/**
 * The browser half of the cluster check: the markers in the live DOM, with real
 * taps, mouse and keyboard.
 *
 * Its own port (a suite running on a foreign page is worse than a missing
 * one). Two devices: desktop Chromium (mouse, wheel, keys) and a Pixel 7
 * emulation, where a tap is a real touch event.
 */
const PORT = Number(process.env.TL_CLUSTER_PORT ?? 31745);

export default defineConfig({
  // A stray test.only would quietly run one test and call the suite green.
  forbidOnly: true,
  testDir: "./e2e",
  testMatch: "cluster.spec.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: ".e2e-cluster-report.json" }]],
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    channel: "chromium-headless-shell",
    trace: "off",
  },
  projects: [
    // Each test runs where its input exists, and nowhere else: a test
    // skipped on the other device would be a skip the gate has to explain.
    { name: "desktop", grep: /@desktop/, use: { ...devices["Desktop Chrome"], channel: "chromium-headless-shell" } },
    { name: "pixel-7", grep: /@touch/, use: { ...devices["Pixel 7"], channel: "chromium-headless-shell" } },
  ],
  webServer: {
    command: "node e2e/serve.mjs",
    env: { TL_E2E_PORT: String(PORT) },
    url: `http://127.0.0.1:${String(PORT)}/cluster.html`,
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
