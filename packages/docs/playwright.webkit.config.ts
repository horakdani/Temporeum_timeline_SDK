import { defineConfig, devices } from "@playwright/test";

/** A port: nem a Chromium-készleté (41737), hogy a kettő egymás mellett is fusson. */
const PORT = Number(process.env.TL_E2E_PORT ?? 41738);

/**
 * G-E2E-TOUCH-WEBKIT (P31): ugyanaz a gesztus-készlet (`e2e/touch.spec.ts`),
 * mint a Chromiumos G-E2E-TOUCH, a Playwright WebKitjében — az iOS Safari
 * motorjában —, emulált iPhone-on és iPaden.
 *
 * Amit ez a készlet NEM mér, és miért: a Playwright WebKitje macOS-en fut,
 * az iOS UIKit-rétege nélkül. Az érintés itt nem görgeti a lapot és nem
 * nagyítja — `touch-action: none`, `pan-y` és `auto` mellett is `scrollY` 0
 * marad, és `pointercancel` sem jön (P31, 2026-10-31, mérve). A két
 * `touch-action`-állítás ezért itt üresen menne át, illetve hamisan bukna;
 * a `grepInvert` kiveszi őket, és a valódi Mobile Safariban, az
 * iOS-szimulátorban mérjük őket (`scripts/sdk_ios_touch.mjs`), negatív
 * kontrollal. A kapu (`sdk_check_e2e_touch_webkit.mjs`) a kettőt együtt kéri.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "touch.spec.ts",
  grepInvert: /touch-action tényleg szól|ELVESZI a gesztust/,
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
