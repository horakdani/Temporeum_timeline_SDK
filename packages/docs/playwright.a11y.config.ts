import { defineConfig, devices } from "@playwright/test";

/**
 * G-AXE: az akadálymentesség böngészős fele.
 *
 * Saját port, hogy a touch-készlettel párhuzamosan se üljenek egymás
 * szerverén (a P4 tanulsága: idegen lapon futó készlet rosszabb, mint a
 * hiányzó). Két projekt: asztali Chromium billentyűzettel — itt fut az axe
 * és a billentyűs út —, és Pixel 7, ahol a keskeny nézet és az alsó lap
 * kerül az axe elé.
 */
const PORT = Number(process.env.TL_A11Y_PORT ?? 41741);

export default defineConfig({
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
