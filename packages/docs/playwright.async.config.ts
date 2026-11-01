import { defineConfig, devices } from "@playwright/test";

/**
 * G-ASYNC böngészős fele: gyors zoom egy igazi böngészőben, valódi
 * időzítőkkel és valódi DOM-mal.
 *
 * Saját port (a P4 tanulsága: egy idegen lapon futó készlet rosszabb, mint a
 * hiányzó). Asztali Chromium: a gyors zoom itt Ctrl+görgő — ugyanaz az út,
 * amit egy trackpad-csipesz ad.
 */
const PORT = Number(process.env.TL_ASYNC_PORT ?? 41743);

export default defineConfig({
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
