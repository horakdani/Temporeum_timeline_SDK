import { defineConfig, devices } from "@playwright/test";

/**
 * G-CLUSTER böngészős fele: a jelölők az élő DOM-ban, igazi koppintással,
 * egérrel és billentyűvel.
 *
 * Saját port (a P4 tanulsága: egy idegen lapon futó készlet rosszabb, mint a
 * hiányzó). Két eszköz: asztali Chromium (egér, görgő, billentyű) és egy
 * Pixel 7 emuláció, ahol a koppintás valódi touch-esemény.
 */
const PORT = Number(process.env.TL_CLUSTER_PORT ?? 41745);

export default defineConfig({
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
