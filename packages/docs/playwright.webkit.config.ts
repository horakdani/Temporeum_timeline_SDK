import { defineConfig, devices } from "@playwright/test";

/** The port: not the Chromium suite's (41737), so the two can run side by side. */
const PORT = Number(process.env.TL_E2E_PORT ?? 41738);

/**
 * The e2e-touch-webkit check: the same gesture suite (`e2e/touch.spec.ts`) as
 * the Chromium e2e-touch check, in Playwright's WebKit — the iOS Safari engine —
 * on an emulated iPhone and iPad.
 *
 * What this suite does NOT measure, and why: Playwright's WebKit runs on
 * macOS, without iOS's UIKit layer. Touch here neither scrolls the page nor
 * zooms it — with `touch-action: none`, `pan-y` and `auto` alike `scrollY`
 * stays 0, and no `pointercancel` arrives (measured 2026-10-31). The two
 * `touch-action` claims would therefore pass vacuously here, or fail
 * falsely; `grepInvert` takes them out, and they are measured in real
 * Mobile Safari, in the iOS simulator (`scripts/sdk_ios_touch.mjs`), with a
 * negative control. The check (`sdk_check_e2e_touch_webkit.mjs`) asks for
 * both together.
 */
export default defineConfig({
  // A stray test.only would quietly run one test and call the suite green.
  forbidOnly: true,
  testDir: "./e2e",
  testMatch: "touch.spec.ts",
  grepInvert: /touch-action really takes effect|TAKES the gesture/,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: ".e2e-touch-webkit-report.json" }]],
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    trace: "off",
  },
  projects: [
    { name: "iphone-15", use: { ...devices["iPhone 15"], browserName: "webkit" } },
    { name: "ipad-pro-11", use: { ...devices["iPad Pro 11"], browserName: "webkit" } },
  ],
  webServer: {
    command: `TL_E2E_PORT=${String(PORT)} node e2e/serve.mjs`,
    url: `http://127.0.0.1:${String(PORT)}/index.html`,
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
