import { defineConfig, devices } from "@playwright/test";

/**
 * The port. DELIBERATELY not 4173: that is Vite `preview`'s default, so any
 * other project running on the machine could sit on it. A check that
 * measures a foreign page is worse than a missing check.
 */
const PORT = Number(process.env.TL_E2E_PORT ?? 41737);

/**
 * Playwright: the browser evidence.
 *
 * What the core's tests cannot tell: whether the BROWSER agrees. The gesture
 * logic runs on synthetic pointer sequences, without a DOM, and it has to
 * run there; but whether `touch-action` really stops page scrolling under a
 * real finger can only be measured with a real finger.
 *
 * `chromium-headless-shell`: uses the installed, version-pinned binary.
 * With device emulation (Pixel 7) the page sees a touch screen, coordinates
 * go in CSS pixels, and CDP's `Input.dispatchTouchEvent` can do TWO touch
 * points — which is why we have a pinch test at all.
 */
export default defineConfig({
  // A stray test.only would quietly run one test and call the suite green.
  forbidOnly: true,
  testDir: "./e2e",
  // The gesture state machine is serial: parallel runs would share one port.
  workers: 1,
  fullyParallel: false,
  // A flaky e2e test is worse than a missing one: no retries, so that the
  // uncertainty shows.
  retries: 0,
  reporter: [["list"], ["json", { outputFile: ".e2e-touch-report.json" }]],
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    channel: "chromium-headless-shell",
    trace: "off",
  },
  projects: [
    {
      name: "pixel-7",
      use: { ...devices["Pixel 7"], channel: "chromium-headless-shell" },
    },
  ],
  webServer: {
    command: "node e2e/serve.mjs",
    url: `http://127.0.0.1:${String(PORT)}/index.html`,
    // `false`, not `true`. `true` means: if something sits on the port,
    // assume it is our server. On 2026-10-26 it was not: another project's
    // `vite preview --port 4173` sat on it, and the browser suite's 15 tests
    // ran on a FOREIGN page. All failed, and the failures said nothing about
    // why. The real danger, though, is the reverse: OUR server with an old
    // dist, which makes the suite lie in GREEN. With `false` Playwright
    // starts it itself, and if the port is taken, the server fails loudly.
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
