import { defineConfig } from "@playwright/test";

/** The same port of our own as the touch suite's — the two run one after the other. */
const PORT = Number(process.env.TL_E2E_PORT ?? 31737);

/**
 * The responsive suite's config — a SEPARATE file, not a second project next
 * to the touch one.
 *
 * Two reasons. The touch suite runs on every project of its config
 * (`playwright test e2e/touch.spec.ts` with no project filter), so a desktop
 * project added there would run the gestures written for the Pixel 7 too.
 * And its report goes to a different file: the two checks read two separate
 * pieces of evidence, and neither run may overwrite the other's report.
 *
 * The devices are in the spec, per width (`test.use`), because the width is
 * itself what is measured: 375 / 768 / 1440 px, each with its own hand —
 * the phone and the tablet by touch, the desktop with a mouse.
 */
export default defineConfig({
  // A stray test.only would quietly run one test and call the suite green.
  forbidOnly: true,
  testDir: "./e2e",
  testMatch: "responsive.spec.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: ".e2e-responsive-report.json" }]],
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    channel: "chromium-headless-shell",
    trace: "off",
  },
  projects: [{ name: "widths", use: { channel: "chromium-headless-shell" } }],
  webServer: {
    command: "node e2e/serve.mjs",
    url: `http://127.0.0.1:${String(PORT)}/responsive.html`,
    // See the touch config: a foreign or stale server is not accepted.
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
